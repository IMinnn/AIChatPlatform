import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { AppState, ChatMessage, Conversation, Settings, TokenUsageRecord } from "@/lib/types";

const storageDir = path.join(process.cwd(), "storage");
const logDir = path.join(storageDir, "chat-logs");

function readSection(content: string, name: string, nextName: string) {
  const match = content.match(new RegExp(`\\[${name}\\]\\n([\\s\\S]*?)\\n\\n\\[${nextName}\\]`));
  return match?.[1]?.trim() ?? "";
}

function readLine(content: string, label: string) {
  const match = content.match(new RegExp(`${label}: (.*)`));
  return match?.[1]?.trim() ?? "";
}

function toBoolean(value: string) {
  return value === "true";
}

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseTimelineStage(content: string, stage: string) {
  const match = content.match(new RegExp(`\\d+\\. \\[[^\\]]+\\] ${stage}\\n([\\s\\S]*?)(?=\\n\\n\\d+\\. \\[|\\n\\n\\[结果统计\\])`));
  return match?.[1]?.trim() ?? "";
}

function pushMessage(messages: ChatMessage[], message: ChatMessage) {
  const exists = messages.some((item) => item.id === message.id);
  if (!exists) {
    messages.push(message);
  }
}

export async function recoverStateFromLogs(settings: Settings): Promise<AppState | null> {
  let names: string[] = [];
  try {
    names = (await readdir(logDir)).filter((name) => name.endsWith(".txt")).sort();
  } catch {
    return null;
  }

  if (!names.length) {
    return null;
  }

  const conversationMap = new Map<string, Conversation>();
  const usageRecords: TokenUsageRecord[] = [];

  for (const name of names) {
    const raw = await readFile(path.join(logDir, name), "utf8");
    const time = readLine(raw, "日志时间");
    const conversationId = readLine(raw, "对话 ID");
    const conversationTitle = readLine(raw, "对话标题") || "已恢复对话";
    const userMessageId = readLine(raw, "用户消息 ID");
    const modelId = readLine(raw, "模型 ID");
    const modelName = readLine(raw, "模型名称") || modelId;
    const provider = readLine(raw, "服务商");
    const userPrompt = readSection(raw, "用户本次输入", "上下文摘要");
    const reasoning = parseTimelineStage(raw, "模型思考内容");
    const answer = parseTimelineStage(raw, "模型返回完成");

    if (!conversationId || !time || !userPrompt) {
      continue;
    }

    const conversation =
      conversationMap.get(conversationId) ??
      {
        id: conversationId,
        title: conversationTitle,
        modelId,
        knowledgeBaseId: null,
        createdAt: time,
        updatedAt: time,
        messages: []
      };

    conversation.title = conversationTitle;
    conversation.modelId = modelId || conversation.modelId;
    conversation.updatedAt = time > conversation.updatedAt ? time : conversation.updatedAt;
    conversation.createdAt = time < conversation.createdAt ? time : conversation.createdAt;

    pushMessage(conversation.messages, {
      id: userMessageId || `${conversationId}_user_${time}`,
      role: "user",
      content: userPrompt,
      createdAt: time
    });

    if (answer) {
      pushMessage(conversation.messages, {
        id: `${conversationId}_assistant_${time}`,
        role: "assistant",
        content: answer,
        reasoning: reasoning || undefined,
        createdAt: time
      });
    }

    conversation.messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    conversationMap.set(conversationId, conversation);

    usageRecords.push({
      id: readLine(raw, "事件 ID") || `${conversationId}_${time}`,
      conversationId,
      conversationTitle,
      userPrompt,
      userMessageId: userMessageId || `${conversationId}_user_${time}`,
      assistantMessageId: `${conversationId}_assistant_${time}`,
      modelId,
      modelName,
      provider,
      thinkingMode: toBoolean(readLine(raw, "thinkingMode")),
      knowledgeChunkCount: toNumber(readLine(raw, "知识库命中片段数")),
      createdAt: time,
      usage: {
        inputTokens: toNumber(readLine(raw, "inputTokens")),
        outputTokens: toNumber(readLine(raw, "outputTokens")),
        totalTokens: toNumber(readLine(raw, "totalTokens")),
        cacheCreationTokens:
          toNumber(readLine(raw, "cacheCreationTokens")) || toNumber(readLine(raw, "reasoningTokens")),
        cacheHitTokens:
          toNumber(readLine(raw, "cacheHitTokens")) || toNumber(readLine(raw, "cachedInputTokens")),
        source: readLine(raw, "source") === "estimated" ? "estimated" : "provider"
      }
    });
  }

  const conversations = [...conversationMap.values()].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  if (!conversations.length && !usageRecords.length) {
    return null;
  }

  return {
    settings,
    conversations,
    knowledgeBases: [],
    usageRecords: usageRecords.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  };
}
