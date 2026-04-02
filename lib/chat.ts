import { Conversation, KnowledgeBase, ModelConfig, Settings } from "@/lib/types";
import { normalizeChatCompletionsUrl } from "@/lib/models";
import { searchKnowledgeBase } from "@/lib/rag";
import { WebSearchResult } from "@/lib/web-search";

export type PreferredOutputLanguage = "zh-CN" | "en-US" | "ja-JP" | "ko-KR" | "es-ES" | "fr-FR" | "de-DE";

export function detectPreferredOutputLanguage(input: string): PreferredOutputLanguage {
  const text = input || "";
  const chineseCount = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const englishCount = (text.match(/[A-Za-z]/g) ?? []).length;
  const japaneseCount = (text.match(/[\u3040-\u30ff]/g) ?? []).length;
  const koreanCount = (text.match(/[\uac00-\ud7af]/g) ?? []).length;
  const spanishCount = (text.match(/[áéíóúñü¿¡]/gi) ?? []).length;
  const frenchCount = (text.match(/[àâçéèêëîïôùûüÿœæ]/gi) ?? []).length;
  const germanCount = (text.match(/[äöüß]/gi) ?? []).length;

  if (chineseCount > 0) {
    return "zh-CN";
  }
  if (englishCount > 0) {
    return "en-US";
  }

  const candidates: Array<{ language: PreferredOutputLanguage; count: number }> = [
    { language: "ja-JP", count: japaneseCount },
    { language: "ko-KR", count: koreanCount },
    { language: "es-ES", count: spanishCount },
    { language: "fr-FR", count: frenchCount },
    { language: "de-DE", count: germanCount }
  ];
  candidates.sort((left, right) => right.count - left.count);

  return candidates[0]?.count ? candidates[0].language : "zh-CN";
}

function buildLanguagePrompt(language: PreferredOutputLanguage) {
  switch (language) {
    case "en-US":
      return "用户输入以英文为主。思考内容与最终正文都必须优先使用英文输出。";
    case "ja-JP":
      return "用户输入以日文为主。思考内容与最终正文都必须优先使用日文输出。";
    case "ko-KR":
      return "用户输入以韩文为主。思考内容与最终正文都必须优先使用韩文输出。";
    case "es-ES":
      return "用户输入以西班牙文为主。思考内容与最终正文都必须优先使用西班牙文输出。";
    case "fr-FR":
      return "用户输入以法文为主。思考内容与最终正文都必须优先使用法文输出。";
    case "de-DE":
      return "用户输入以德文为主。思考内容与最终正文都必须优先使用德文输出。";
    case "zh-CN":
    default:
      return "用户输入包含中文或默认按中文处理。思考内容与最终正文都必须优先使用中文输出。若草稿中混入英文，请先翻译成中文再输出。";
  }
}

export function buildSystemPrompt(
  settings: Settings,
  knowledgeTexts: string[],
  language: PreferredOutputLanguage,
  thinkingMode = false,
  useNativeReasoningChannel = false,
  webSearchResults: WebSearchResult[] = []
) {
  const knowledgePrompt = knowledgeTexts.length
    ? `\n\n你可以优先参考以下知识库内容作答：\n${knowledgeTexts
        .map((text, index) => `[片段 ${index + 1}]\n${text}`)
        .join("\n\n")}`
    : "";
  const webPrompt = webSearchResults.length
    ? `\n\n当前已开启联网搜索。你可以参考以下最新网页检索结果作答，引用时优先综合多条信息，不要捏造不存在的来源：\n${webSearchResults
        .map(
          (item, index) =>
            `[网页 ${index + 1}]\n标题：${item.title}\n链接：${item.url}\n摘要：${item.snippet}`
        )
        .join("\n\n")}`
    : "";
  const thinkingPrompt = thinkingMode
    ? useNativeReasoningChannel
      ? "\n\n当前已明确开启深度思考模式。请先深度思考，再输出最终正文。最终正文不要重复思考过程，不要暴露草稿、自检、规划说明。"
      : "\n\n当前已明确开启深度思考模式。请严格按照以下格式输出：先输出<thinking>你的思考内容</thinking>，紧接着再输出最终正文。不要在正文中重复思考过程，不要输出规划说明、自检内容或草稿。"
    : "\n\n当前已明确关闭深度思考模式。请直接输出最终正文，不要输出思考过程、推理草稿、自检内容或任何中间分析。";
  const searchPrompt = webSearchResults.length
    ? "\n\n联网搜索结果仅作为参考，若结果互相冲突或信息不足，请明确说明不确定性。"
    : "\n\n当前未开启联网搜索，不要假装引用最新网页信息。";

  return [
    `你是 ${settings.assistantName}。`,
    `用户昵称是 ${settings.userName}。`,
    `你的说话风格设定：${settings.assistantStyle}`,
    "回答时要尽量准确，若知识库内容不足以支持结论，要明确说明。",
    buildLanguagePrompt(language)
  ].join("\n") + knowledgePrompt + webPrompt + thinkingPrompt + searchPrompt;
}

export function buildSharedMemory(
  conversations: Conversation[],
  activeConversationId: string,
  enabled: boolean
) {
  if (!enabled) {
    return [];
  }

  const messages = conversations
    .filter((conversation) => conversation.id !== activeConversationId)
    .flatMap((conversation) => conversation.messages.slice(-4))
    .slice(-8);

  if (!messages.length) {
    return [];
  }

  return [
    {
      role: "system" as const,
      content: `以下是跨对话共享记忆，请只在相关时自然使用：\n${messages
        .map((message) => `${message.role}: ${message.content}`)
        .join("\n")}`
    }
  ];
}

export function buildKnowledgeContext(kb: KnowledgeBase | null, query: string) {
  if (!kb) {
    return [];
  }
  return searchKnowledgeBase(kb, query, 4);
}

export function isBailianQwenModel(model: ModelConfig) {
  const normalizedProviderHint = `${model.provider} ${model.apiUrl}`.toLowerCase();
  const normalizedModelHint = `${model.id} ${model.name}`.toLowerCase();
  const isBailianProvider =
    normalizedProviderHint.includes("百炼") ||
    normalizedProviderHint.includes("dashscope") ||
    normalizedProviderHint.includes("aliyuncs");
  return isBailianProvider && normalizedModelHint.includes("qwen");
}

export async function createChatCompletionStream(args: {
  model: ModelConfig;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content:
      | string
      | Array<
          | { type: "text"; text: string }
          | { type: "image_url"; image_url: { url: string } }
        >;
  }>;
  thinkingMode?: boolean;
}) {
  const finalUrl = normalizeChatCompletionsUrl(args.model.apiUrl);
  const extraBody = isBailianQwenModel(args.model)
    ? {
        enable_thinking: Boolean(args.thinkingMode)
      }
    : {};

  const body: Record<string, unknown> = {
    model: args.model.id,
    messages: args.messages,
    stream: true,
    temperature: 0.7,
    stream_options: {
      include_usage: true
    },
    ...extraBody
  };

  const response = await fetch(finalUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(args.model.token ? { Authorization: `Bearer ${args.model.token}` } : {})
    },
    body: JSON.stringify(body)
  });

  if (!response.ok || !response.body) {
    const detail = await response.text();
    throw new Error(detail || "模型接口请求失败");
  }

  return response.body;
}

export function createTaggedThinkingStreamParser() {
  const openTag = "<thinking>";
  const closeTag = "</thinking>";
  let buffer = "";
  let mode: "searching" | "reasoning" | "answer" = "searching";

  function takeSafeText(pending: string, marker: string) {
    const safeLength = Math.max(0, pending.length - marker.length + 1);
    return {
      flushed: pending.slice(0, safeLength),
      rest: pending.slice(safeLength)
    };
  }

  function process(chunk: string) {
    buffer += chunk;
    let reasoning = "";
    let answer = "";

    while (buffer) {
      if (mode === "searching") {
        const openIndex = buffer.indexOf(openTag);
        if (openIndex >= 0) {
          buffer = buffer.slice(openIndex + openTag.length);
          mode = "reasoning";
          continue;
        }
        const { rest } = takeSafeText(buffer, openTag);
        buffer = rest;
        break;
      }

      if (mode === "reasoning") {
        const closeIndex = buffer.indexOf(closeTag);
        if (closeIndex >= 0) {
          reasoning += buffer.slice(0, closeIndex);
          buffer = buffer.slice(closeIndex + closeTag.length);
          mode = "answer";
          continue;
        }
        const { flushed, rest } = takeSafeText(buffer, closeTag);
        reasoning += flushed;
        buffer = rest;
        break;
      }

      answer += buffer;
      buffer = "";
    }

    return { reasoning, answer };
  }

  function flush() {
    if (!buffer) {
      return { reasoning: "", answer: "" };
    }

    const remaining = buffer;
    buffer = "";

    if (mode === "reasoning") {
      return { reasoning: remaining, answer: "" };
    }

    return { reasoning: "", answer: remaining };
  }

  return {
    process,
    flush
  };
}
