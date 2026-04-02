import { NextResponse } from "next/server";
import { buildMessageInputContent } from "@/lib/chat-attachments";
import {
  buildKnowledgeContext,
  buildSharedMemory,
  buildSystemPrompt,
  createChatCompletionStream,
  detectPreferredOutputLanguage,
  isBailianQwenModel
} from "@/lib/chat";
import { readState, updateState } from "@/lib/fs-db";
import { appendChatLog } from "@/lib/logger";
import { getPreferredModel, normalizeChatCompletionsUrl } from "@/lib/models";
import { ChatAttachment, ChatRole, KnowledgeBase, TokenUsageBreakdown } from "@/lib/types";
import { createId, nowIso, pickTitle } from "@/lib/utils";
import { searchWeb, WebSearchResult } from "@/lib/web-search";

function estimateTokenCount(text: string) {
  if (!text.trim()) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 4));
}

function normalizeVisibleText(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeUsage(raw: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_creation_tokens?: number;
    cached_creation_tokens?: number;
  };
}): TokenUsageBreakdown {
  const inputTokens = raw.prompt_tokens ?? 0;
  const outputTokens = raw.completion_tokens ?? 0;
  const cacheCreationTokens =
    raw.prompt_tokens_details?.cache_creation_tokens ?? raw.prompt_tokens_details?.cached_creation_tokens ?? 0;
  const cacheHitTokens = raw.prompt_tokens_details?.cached_tokens ?? 0;
  const totalTokens = raw.total_tokens ?? inputTokens + outputTokens;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheCreationTokens,
    cacheHitTokens,
    source: "provider"
  };
}

function estimateUsage(args: {
  promptMessages: Array<{
    role: "system" | "user" | "assistant";
    content:
      | string
      | Array<
          | { type: "text"; text: string }
          | { type: "image_url"; image_url: { url: string } }
        >;
  }>;
  answer: string;
}): TokenUsageBreakdown {
  const inputTokens = estimateTokenCount(
    args.promptMessages
      .map((message) =>
        typeof message.content === "string"
          ? message.content
          : message.content.map((part) => (part.type === "text" ? part.text : "[图片附件]")).join("\n")
      )
      .join("\n")
  );
  const outputTokens = estimateTokenCount(args.answer);

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cacheCreationTokens: 0,
    cacheHitTokens: 0,
    source: "estimated"
  };
}

function buildEnabledKnowledgeContext(knowledgeBases: KnowledgeBase[], query: string) {
  return knowledgeBases.flatMap((knowledgeBase) =>
    buildKnowledgeContext(knowledgeBase, query).map((text) => `[知识库：${knowledgeBase.name}]\n${text}`)
  );
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    conversationId: string;
    content: string;
    modelId: string;
    attachments?: ChatAttachment[];
    knowledgeBaseId?: string | null;
    knowledgeSearchEnabled?: boolean;
    thinkingMode?: boolean;
    webSearch?: boolean;
  };

  const state = await readState();
  const conversation = state.conversations.find((item) => item.id === body.conversationId);
  if (!conversation) {
    return new NextResponse("Conversation not found", { status: 404 });
  }

  const model = await getPreferredModel(body.modelId || conversation.modelId || state.settings.defaultModelId);
  if (!model) {
    return new NextResponse("Model not available", { status: 400 });
  }

  const selectedKnowledgeBaseId =
    body.knowledgeBaseId === undefined ? conversation.knowledgeBaseId : body.knowledgeBaseId;
  const selectedKnowledgeBase =
    state.knowledgeBases.find((item) => item.id === selectedKnowledgeBaseId) ?? null;
  const enabledKnowledgeBases = state.knowledgeBases.filter((item) => item.enabled);
  const shouldUseKnowledgeSearch = Boolean(body.knowledgeSearchEnabled) && enabledKnowledgeBases.length > 0;
  const knowledgeTexts = shouldUseKnowledgeSearch ? buildEnabledKnowledgeContext(enabledKnowledgeBases, body.content) : [];
  const kb = selectedKnowledgeBase;
  const sharedMemoryMessages = buildSharedMemory(state.conversations, conversation.id, state.settings.sharedMemory);
  let webSearchResults: WebSearchResult[] = [];
  let webSearchError = "";
  if (body.webSearch) {
    try {
      webSearchResults = await searchWeb(body.content, 5);
    } catch (error) {
      webSearchError = error instanceof Error ? error.message : "联网搜索失败";
    }
  }
  const preferredLanguage = detectPreferredOutputLanguage(body.content);
  const useNativeReasoningChannel = Boolean(body.thinkingMode) && isBailianQwenModel(model);
  const systemPrompt = buildSystemPrompt(
    state.settings,
    knowledgeTexts,
    preferredLanguage,
    Boolean(body.thinkingMode),
    useNativeReasoningChannel,
    webSearchResults
  );
  const inputTitleSeed = body.content.trim() || body.attachments?.[0]?.fileName || "新对话";
  const conversationTitle = conversation.messages.length ? conversation.title : pickTitle(inputTitleSeed);
  const conversationTurn = Math.floor(conversation.messages.filter((message) => message.role === "user").length) + 1;
  const contextSummary = [
    `当前对话标题：${conversationTitle}`,
    `当前对话历史消息数：${conversation.messages.length}`,
    `跨对话共享记忆：${state.settings.sharedMemory ? "开启" : "关闭"}，注入 ${sharedMemoryMessages.length} 条系统消息`,
    `知识库：${shouldUseKnowledgeSearch ? enabledKnowledgeBases.map((item) => item.name).join("、") : `本次未启用${enabledKnowledgeBases.length ? `（已启用：${enabledKnowledgeBases.map((item) => item.name).join("、")}）` : ""}`}，命中 ${knowledgeTexts.length} 个片段`,
    `联网搜索：${body.webSearch ? "开启" : "关闭"}，命中 ${webSearchResults.length} 条结果${webSearchError ? `，错误：${webSearchError}` : ""}`,
    `发送给模型的消息总数：${conversation.messages.length + sharedMemoryMessages.length + 2}`,
    `本次消息附件：${body.attachments?.length ? body.attachments.map((attachment) => attachment.fileName).join("、") : "无"}`,
    conversation.messages.length
      ? `最近历史内容摘要：${conversation.messages
          .slice(-4)
          .map((message) => `${message.role}: ${message.content.slice(0, 80)}`)
          .join(" | ")}`
      : "最近历史内容摘要：当前是该对话的第一轮"
  ].join("\n");
  const now = nowIso();
  const userMessage = {
    id: createId("msg"),
    role: "user" as const,
    content: body.content,
    attachments: body.attachments?.length ? body.attachments : undefined,
    createdAt: now
  };
  const assistantMessageId = createId("msg");
  const logEventId = createId("log");
  const timeline: Array<{ time: string; stage: string; content: string }> = [];
  let finalUsage: TokenUsageBreakdown | null = null;
  const pushTimeline = (stage: string, content: string) => {
    timeline.push({
      time: nowIso(),
      stage,
      content
    });
  };

  pushTimeline(
    "用户发送消息",
    [
      body.content || "无额外文字输入",
      ...(body.attachments?.length
        ? ["", "附件列表：", ...body.attachments.map((attachment) => `- ${attachment.fileName} (${attachment.mimeType})`)]
        : [])
    ].join("\n")
  );
  pushTimeline(
    "系统准备请求",
    [
      `模型：${model.name} (${model.id})`,
      `temperature: 0.7`,
      `thinkingMode: ${body.thinkingMode ? "true" : "false"}`,
      `preferredLanguage: ${preferredLanguage}`,
      `webSearch: ${body.webSearch ? "true" : "false"}`,
      `知识库：${shouldUseKnowledgeSearch ? enabledKnowledgeBases.map((item) => item.name).join("、") : `本次未启用${enabledKnowledgeBases.length ? `（已启用：${enabledKnowledgeBases.map((item) => item.name).join("、")}）` : ""}`}`,
      `共享记忆：${state.settings.sharedMemory ? "true" : "false"}`
    ].join("\n")
  );
  if (body.webSearch) {
    if (webSearchResults.length) {
      pushTimeline(
        "联网搜索结果",
        webSearchResults
          .map((item, index) => `${index + 1}. ${item.title}\n${item.url}\n${item.snippet}`)
          .join("\n\n")
      );
    }
    if (webSearchError) {
      pushTimeline("联网搜索失败", webSearchError);
    }
  }

  await updateState((current) => ({
    ...current,
    conversations: current.conversations.map((item) =>
      item.id === body.conversationId
        ? {
            ...item,
            title: conversationTitle,
            modelId: body.modelId || item.modelId,
            knowledgeBaseId:
              body.knowledgeBaseId === undefined ? item.knowledgeBaseId : body.knowledgeBaseId,
            updatedAt: now,
            messages: [...item.messages, userMessage]
          }
        : item
    )
  }));

  const chatMessages = [
    {
      role: "system" as const,
      content: systemPrompt
    },
    ...sharedMemoryMessages,
    ...(await Promise.all(
      conversation.messages.map(async (message) => ({
        role: (message.role === "system" ? "system" : message.role) as ChatRole,
        content: await buildMessageInputContent(message)
      }))
    )),
    {
      role: "user" as const,
      content: await buildMessageInputContent({
        content: body.content,
        attachments: body.attachments ?? []
      })
    }
  ];

  try {
    const upstream = await createChatCompletionStream({
      model,
      messages: chatMessages,
      thinkingMode: body.thinkingMode
    });
    pushTimeline("大模型已接收请求", `请求已发往 ${normalizeChatCompletionsUrl(model.apiUrl)}`);

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let pending = "";
    let finalText = "";
    let finalReasoning = "";
    const useReasoningChannel = Boolean(body.thinkingMode) && isBailianQwenModel(model);
    let isAnswering = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstream.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              break;
            }
            pending += decoder.decode(value, { stream: true });
            const lines = pending.split("\n");
            pending = lines.pop() ?? "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) {
                continue;
              }
              const payload = trimmed.slice(5).trim();
              if (!payload || payload === "[DONE]") {
                continue;
              }
              const parsed = JSON.parse(payload) as {
                choices?: Array<{
                  delta?: {
                    content?: string;
                    reasoning_content?: string;
                    tool_calls?: unknown;
                  };
                }>;
                usage?: {
                  prompt_tokens?: number;
                  completion_tokens?: number;
                  total_tokens?: number;
                  prompt_tokens_details?: {
                    cached_tokens?: number;
                  };
                  completion_tokens_details?: {
                    reasoning_tokens?: number;
                  };
                };
              };
              if (parsed.usage) {
                finalUsage = normalizeUsage(parsed.usage);
              }
              const reasoningContent = parsed.choices?.[0]?.delta?.reasoning_content;
              if (useReasoningChannel && !isAnswering && reasoningContent) {
                finalReasoning += reasoningContent;
                controller.enqueue(
                  encoder.encode(`${JSON.stringify({ type: "reasoning", content: reasoningContent })}\n`)
                );
              }
              const toolCalls = parsed.choices?.[0]?.delta?.tool_calls;
              if (toolCalls) {
                pushTimeline("模型调用工具", JSON.stringify(toolCalls, null, 2));
              }
              const content = parsed.choices?.[0]?.delta?.content;
              if (!content) {
                continue;
              }

              if (useReasoningChannel) {
                if (!isAnswering) {
                  isAnswering = true;
                }
                finalText += content;
                controller.enqueue(
                  encoder.encode(`${JSON.stringify({ type: "delta", content })}\n`)
                );
                continue;
              }

              finalText += content;
              controller.enqueue(
                encoder.encode(`${JSON.stringify({ type: "delta", content })}\n`)
              );
            }
          }

          finalText = normalizeVisibleText(finalText);
          finalReasoning = normalizeVisibleText(finalReasoning);

          if (!useReasoningChannel) {
            finalReasoning = "";
          }

          if (finalReasoning) {
            pushTimeline("模型思考内容", finalReasoning);
          }

          const resolvedUsage =
            finalUsage ??
            estimateUsage({
              promptMessages: chatMessages,
              answer: finalText
            });
          pushTimeline(
            "Token 统计",
            [
              `source: ${resolvedUsage.source}`,
              `inputTokens: ${resolvedUsage.inputTokens}`,
              `outputTokens: ${resolvedUsage.outputTokens}`,
              `totalTokens: ${resolvedUsage.totalTokens}`,
              `cacheCreationTokens: ${resolvedUsage.cacheCreationTokens}`,
              `cacheHitTokens: ${resolvedUsage.cacheHitTokens}`
            ].join("\n")
          );

          await updateState((current) => ({
            ...current,
            conversations: current.conversations.map((item) =>
              item.id === body.conversationId
                ? {
                    ...item,
                    updatedAt: nowIso(),
                    messages: [
                      ...item.messages,
                      {
                        id: assistantMessageId,
                        role: "assistant",
                        content: finalText,
                        reasoning: finalReasoning || undefined,
                        createdAt: nowIso()
                      }
                    ]
                  }
                : item
            ),
            usageRecords: [
              {
                id: logEventId,
                conversationId: body.conversationId,
                conversationTitle,
                userPrompt: body.content,
                userMessageId: userMessage.id,
                assistantMessageId,
                modelId: model.id,
                modelName: model.name,
                provider: model.provider,
                thinkingMode: Boolean(body.thinkingMode),
                knowledgeChunkCount: knowledgeTexts.length,
                createdAt: nowIso(),
                usage: resolvedUsage
              },
              ...current.usageRecords
            ].slice(0, 2000)
          }));
          pushTimeline("模型返回完成", finalText || "模型未返回正文内容");

          await appendChatLog({
            eventId: logEventId,
            time: nowIso(),
            conversationId: body.conversationId,
            conversationTitle,
            conversationTurn,
            userMessageId: userMessage.id,
            modelId: model.id,
            modelName: model.name,
            modelUrl: model.apiUrl,
            resolvedChatUrl: normalizeChatCompletionsUrl(model.apiUrl),
            provider: model.provider,
            modelParameters: {
              temperature: 0.7,
              thinkingMode: Boolean(body.thinkingMode),
              webSearch: Boolean(body.webSearch)
            },
            tokenUsage: resolvedUsage,
            knowledgeBaseId: kb?.id ?? null,
            knowledgeBaseName: kb?.name ?? null,
            sharedMemoryEnabled: state.settings.sharedMemory,
            contextMemorySummary: {
              conversationMessageCount: conversation.messages.length + 1,
              sharedMemoryMessageCount: sharedMemoryMessages.length,
              knowledgeChunkCount: knowledgeTexts.length,
              promptMessageCount: chatMessages.length,
              systemPromptLength: systemPrompt.length
            },
            contextSummary,
            prompts: {
              systemPrompt,
              userPrompt: body.content
            },
            timeline,
            result: {
              status: "success",
              responseLength: finalText.length,
              reasoningLength: finalReasoning.length
            }
          });
          controller.enqueue(
            encoder.encode(`${JSON.stringify({ type: "done", conversationId: body.conversationId })}\n`)
          );
          controller.close();
        } catch (error) {
          pushTimeline("模型处理失败", error instanceof Error ? error.message : "聊天失败");
          await appendChatLog({
            eventId: logEventId,
            time: nowIso(),
            conversationId: body.conversationId,
            conversationTitle,
            conversationTurn,
            userMessageId: userMessage.id,
            modelId: model.id,
            modelName: model.name,
            modelUrl: model.apiUrl,
            resolvedChatUrl: normalizeChatCompletionsUrl(model.apiUrl),
            provider: model.provider,
            modelParameters: {
              temperature: 0.7,
              thinkingMode: Boolean(body.thinkingMode),
              webSearch: Boolean(body.webSearch)
            },
            tokenUsage:
              finalUsage ??
              estimateUsage({
                promptMessages: chatMessages,
                answer: finalText
              }),
            knowledgeBaseId: kb?.id ?? null,
            knowledgeBaseName: kb?.name ?? null,
            sharedMemoryEnabled: state.settings.sharedMemory,
            contextMemorySummary: {
              conversationMessageCount: conversation.messages.length + 1,
              sharedMemoryMessageCount: sharedMemoryMessages.length,
              knowledgeChunkCount: knowledgeTexts.length,
              promptMessageCount: chatMessages.length,
              systemPromptLength: systemPrompt.length
            },
            contextSummary,
            prompts: {
              systemPrompt,
              userPrompt: body.content
            },
            timeline,
            result: {
              status: "error",
              responseLength: finalText.length,
              reasoningLength: finalReasoning.length,
              errorMessage: error instanceof Error ? error.message : "聊天失败"
            }
          });
          controller.enqueue(
            encoder.encode(
              `${JSON.stringify({
                type: "error",
                message: error instanceof Error ? error.message : "聊天失败"
              })}\n`
            )
          );
          controller.close();
        } finally {
          reader.releaseLock();
        }
      }
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform"
      }
    });
  } catch (error) {
    pushTimeline("请求初始化失败", error instanceof Error ? error.message : "聊天失败");
    await appendChatLog({
      eventId: logEventId,
      time: nowIso(),
      conversationId: body.conversationId,
      conversationTitle,
      conversationTurn,
      userMessageId: userMessage.id,
      modelId: model.id,
      modelName: model.name,
      modelUrl: model.apiUrl,
      resolvedChatUrl: normalizeChatCompletionsUrl(model.apiUrl),
      provider: model.provider,
      modelParameters: {
        temperature: 0.7,
        thinkingMode: Boolean(body.thinkingMode),
        webSearch: Boolean(body.webSearch)
      },
      tokenUsage: estimateUsage({
        promptMessages: chatMessages,
        answer: ""
      }),
      knowledgeBaseId: kb?.id ?? null,
      knowledgeBaseName: kb?.name ?? null,
      sharedMemoryEnabled: state.settings.sharedMemory,
      contextMemorySummary: {
        conversationMessageCount: conversation.messages.length + 1,
        sharedMemoryMessageCount: sharedMemoryMessages.length,
        knowledgeChunkCount: knowledgeTexts.length,
        promptMessageCount: chatMessages.length,
        systemPromptLength: systemPrompt.length
      },
      contextSummary,
      prompts: {
        systemPrompt,
        userPrompt: body.content
      },
      timeline,
      result: {
        status: "error",
        responseLength: 0,
        reasoningLength: 0,
        errorMessage: error instanceof Error ? error.message : "聊天失败"
      }
    });
    return new NextResponse(error instanceof Error ? error.message : "聊天失败", { status: 500 });
  }
}
