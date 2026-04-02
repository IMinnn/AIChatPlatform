"use client";

import { ChangeEvent, ClipboardEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { MessageMarkdown } from "@/components/message-markdown";
import type {
  ChatAttachment,
  Conversation,
  KnowledgeBase,
  ModelProviderConfig,
  ProviderModelConfig,
  PublicModelConfig,
  Settings
} from "@/lib/types";

interface AppBootstrap {
  conversations: Conversation[];
  settings: Settings;
  models: PublicModelConfig[];
  modelProviders: ModelProviderConfig[];
  knowledgeBases: KnowledgeBase[];
}

interface ChatResponseChunk {
  type: "delta" | "reasoning" | "done" | "error";
  content?: string;
  conversationId?: string;
  message?: string;
}

interface StatsResponse {
  filter: {
    mode: "range" | "all";
    startDate: string | null;
    endDate: string | null;
  };
  pricing: Settings["tokenPricing"];
  summary: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheCreationTokens: number;
    cacheHitTokens: number;
    requests: number;
    totalCost: number;
  };
  chart: Array<{
    date: string;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  conversations: Array<{
    conversationId: string;
    conversationTitle: string;
    requests: number;
    lastUsedAt: string;
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      cacheCreationTokens: number;
      cacheHitTokens: number;
    };
    totalCost: number;
  }>;
  records: Array<{
    id: string;
    conversationId: string;
    conversationTitle: string;
    userPrompt: string;
    userMessageId: string;
    assistantMessageId: string;
    modelId: string;
    modelName: string;
    provider: string;
    thinkingMode: boolean;
    knowledgeChunkCount: number;
    createdAt: string;
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      cacheCreationTokens: number;
      cacheHitTokens: number;
      source: "provider" | "estimated";
    };
    totalCost: number;
  }>;
}

type LibraryPage = "list" | "create" | "detail";

interface LibraryProgressState {
  status: "idle" | "processing" | "completed" | "failed";
  progress: number;
  message: string;
  error?: string;
}

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const text = await response.text();
    const normalized = text.replace(/\s+/g, " ").trim();
    const isHtmlError =
      normalized.startsWith("<!DOCTYPE html") ||
      normalized.startsWith("<html") ||
      normalized.includes("<head") ||
      normalized.includes("__next");
    throw new Error(isHtmlError ? "请求失败，请稍后重试。" : text || "Request failed");
  }
  return response.json();
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatConversationListTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function normalizeThinkingDisplay(reasoning: string, answer: string) {
  const nextReasoning = reasoning.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  let nextAnswer = answer.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  if (nextReasoning && nextAnswer) {
    if (nextAnswer.includes(nextReasoning)) {
      nextAnswer = nextAnswer.replace(nextReasoning, "").trim();
    } else {
      let overlapLength = 0;
      const maxLength = Math.min(nextReasoning.length, nextAnswer.length);
      for (let index = maxLength; index >= 40; index -= 1) {
        if (nextAnswer.startsWith(nextReasoning.slice(0, index))) {
          overlapLength = index;
          break;
        }
      }
      if (overlapLength > 0) {
        nextAnswer = nextAnswer.slice(overlapLength).trim();
      }
    }
  }

  return {
    reasoning: nextReasoning,
    answer: nextAnswer
  };
}

function compactStreamingContent(content: string) {
  return content.replace(/\r\n/g, "\n").replace(/\n{2,}/g, "\n").trim();
}

function formatStatsRecordTitle(value: string, fallback: string) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.length > 48 ? `${normalized.slice(0, 48)}…` : normalized;
}

function formatDateInput(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getRelativeDate(days: number) {
  const next = new Date();
  next.setDate(next.getDate() - days);
  return formatDateInput(next);
}

function getInitials(name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    return "AI";
  }
  return trimmed.slice(0, 2).toUpperCase();
}

function Avatar({
  name,
  image,
  className
}: {
  name: string;
  image?: string;
  className: string;
}) {
  if (image) {
    return <img className={`${className} avatar-image`} src={image} alt={name || "头像"} />;
  }
  return <span className={className}>{getInitials(name)}</span>;
}

function SidebarIcon({ symbol }: { symbol: string }) {
  return <span className="sidebar-icon">{symbol}</span>;
}

function formatAttachmentSize(size: number) {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }
  return `${size} B`;
}

function getAttachmentBadgeLabel(attachment: ChatAttachment) {
  if (attachment.kind === "image") {
    return "图片";
  }
  const extension = attachment.fileName.split(".").pop()?.toUpperCase();
  return extension || "文件";
}

function formatVectorizationStatus(status?: "idle" | "processing" | "completed" | "failed") {
  switch (status) {
    case "processing":
      return "向量化中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return "未开始";
  }
}

function createProviderDraft(kind: ModelProviderConfig["kind"] = "openai-compatible"): ModelProviderConfig {
  return {
    id: `provider_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: kind === "ollama" ? "本地 Ollama" : "",
    kind,
    models: []
  };
}

function createModelDraft(kind: ModelProviderConfig["kind"]): ProviderModelConfig {
  return {
    id: "",
    name: "",
    apiUrl: kind === "ollama" ? "http://127.0.0.1:11434/v1" : "",
    token: "",
    enabled: true
  };
}

export function ChatApp() {
  const thinkingModeStorageKey = "ai-platform-thinking-mode";
  const webSearchStorageKey = "ai-platform-web-search-mode";
  const knowledgeSearchStorageKey = "ai-platform-knowledge-search-mode";
  const [bootstrap, setBootstrap] = useState<AppBootstrap | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeModelId, setActiveModelId] = useState("");
  const [activeKbId, setActiveKbId] = useState<string>("");
  const [libraryPage, setLibraryPage] = useState<LibraryPage>("list");
  const [libraryDetailKbId, setLibraryDetailKbId] = useState<string | null>(null);
  const [libraryDraftName, setLibraryDraftName] = useState("");
  const [libraryDraftDescription, setLibraryDraftDescription] = useState("");
  const [libraryPendingFiles, setLibraryPendingFiles] = useState<File[]>([]);
  const [librarySaving, setLibrarySaving] = useState(false);
  const [libraryProgress, setLibraryProgress] = useState<LibraryProgressState | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [thinkingMode, setThinkingMode] = useState(false);
  const [webSearchMode, setWebSearchMode] = useState(false);
  const [knowledgeSearchEnabled, setKnowledgeSearchEnabled] = useState(false);
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<"main" | "models">("main");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [statsFilterMode, setStatsFilterMode] = useState<"range" | "all">("range");
  const [statsStartDate, setStatsStartDate] = useState(getRelativeDate(6));
  const [statsEndDate, setStatsEndDate] = useState(formatDateInput(new Date()));
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>({});
  const [settingsToast, setSettingsToast] = useState("");
  const [composerToast, setComposerToast] = useState("");
  const [stickToBottom, setStickToBottom] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const profileAvatarInputRef = useRef<HTMLInputElement | null>(null);
  const chatHistoryRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const composingRef = useRef(false);
  const settingsToastTimerRef = useRef<number | null>(null);
  const composerToastTimerRef = useRef<number | null>(null);
  const chatAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!bootstrap) {
      return;
    }

    const updateUserMessageLayout = () => {
      const nodes = document.querySelectorAll<HTMLElement>("[data-user-message-text='true']");
      nodes.forEach((node) => {
        const lineHeight = Number.parseFloat(window.getComputedStyle(node).lineHeight || "0");
        const isMultiline = lineHeight > 0 ? node.scrollHeight > lineHeight * 1.5 : false;
        node.classList.toggle("chat-text-multiline", isMultiline);
      });
    };

    updateUserMessageLayout();
    window.addEventListener("resize", updateUserMessageLayout);
    return () => {
      window.removeEventListener("resize", updateUserMessageLayout);
    };
  }, [bootstrap, activeConversationId, submitting]);

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    try {
      const storedThinkingMode = window.localStorage.getItem(thinkingModeStorageKey);
      const storedWebSearchMode = window.localStorage.getItem(webSearchStorageKey);
      const storedKnowledgeSearchMode = window.localStorage.getItem(knowledgeSearchStorageKey);
      if (storedThinkingMode !== null) {
        setThinkingMode(storedThinkingMode === "true");
      }
      if (storedWebSearchMode !== null) {
        setWebSearchMode(storedWebSearchMode === "true");
      }
      if (storedKnowledgeSearchMode !== null) {
        setKnowledgeSearchEnabled(storedKnowledgeSearchMode === "true");
      }
    } catch {
      // Ignore localStorage access failures.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(thinkingModeStorageKey, String(thinkingMode));
    } catch {
      // Ignore localStorage access failures.
    }
  }, [thinkingMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(webSearchStorageKey, String(webSearchMode));
    } catch {
      // Ignore localStorage access failures.
    }
  }, [webSearchMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(knowledgeSearchStorageKey, String(knowledgeSearchEnabled));
    } catch {
      // Ignore localStorage access failures.
    }
  }, [knowledgeSearchEnabled]);

  useEffect(() => {
    return () => {
      if (settingsToastTimerRef.current) {
        window.clearTimeout(settingsToastTimerRef.current);
      }
      if (composerToastTimerRef.current) {
        window.clearTimeout(composerToastTimerRef.current);
      }
      chatAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!statsOpen) {
      return;
    }
    void refreshStats();
  }, [statsOpen, statsFilterMode, statsStartDate, statsEndDate]);

  async function refresh() {
    const [conversations, settings, models, modelProviders, knowledgeBases] = await Promise.all([
      jsonFetch<Conversation[]>("/api/conversations"),
      jsonFetch<Settings>("/api/settings"),
      jsonFetch<PublicModelConfig[]>("/api/models"),
      jsonFetch<ModelProviderConfig[]>("/api/model-providers"),
      jsonFetch<KnowledgeBase[]>("/api/knowledge-bases")
    ]);

    const next = { conversations, settings, models, modelProviders, knowledgeBases };
    setBootstrap(next);
    setActiveConversationId((current) => current ?? null);
    setActiveModelId((current) => {
      const currentIsValid = models.some((model: PublicModelConfig) => model.id === current);
      if (currentIsValid) {
        return current;
      }
      const settingsIsValid = models.some((model: PublicModelConfig) => model.id === settings.defaultModelId);
      if (settingsIsValid) {
        return settings.defaultModelId;
      }
      return models[0]?.id || "";
    });
    setActiveKbId((current) => {
      const currentIsValid = knowledgeBases.some((kb: KnowledgeBase) => kb.id === current);
      if (currentIsValid) {
        return current;
      }
      return knowledgeBases[0]?.id || "";
    });
  }

  async function refreshStats() {
    try {
      setStatsLoading(true);
      const params = new URLSearchParams();
      if (statsFilterMode === "all") {
        params.set("mode", "all");
      } else {
        params.set("mode", "range");
        params.set("startDate", statsStartDate);
        params.set("endDate", statsEndDate);
      }
      const nextStats = await jsonFetch<StatsResponse>(`/api/stats?${params.toString()}`);
      setStats(nextStats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "统计数据加载失败");
    } finally {
      setStatsLoading(false);
    }
  }

  const activeConversation =
    bootstrap?.conversations.find((conversation: Conversation) => conversation.id === activeConversationId) ?? null;

  const lastMessage = activeConversation?.messages.at(-1) ?? null;

  useEffect(() => {
    if (!activeConversation || !bootstrap) {
      return;
    }
    const validConversationModel =
      bootstrap.models.find((model: PublicModelConfig) => model.id === activeConversation.modelId)?.id ??
      bootstrap.settings.defaultModelId ??
      bootstrap.models[0]?.id ??
      "";
    setActiveModelId(validConversationModel);
  }, [activeConversation, bootstrap]);

  useEffect(() => {
    setStickToBottom(true);
  }, [activeConversationId]);

  useEffect(() => {
    if (!stickToBottom) {
      return;
    }
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [activeConversationId, lastMessage?.id, lastMessage?.content, lastMessage?.reasoning, submitting, stickToBottom]);

  const filteredConversations = useMemo(() => {
    if (!bootstrap) {
      return [];
    }
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) {
      return bootstrap.conversations;
    }
    return bootstrap.conversations.filter((conversation: Conversation) =>
      conversation.title.toLowerCase().includes(keyword)
    );
  }, [bootstrap, searchQuery]);

  const enabledKnowledgeBases = useMemo(
    () => bootstrap?.knowledgeBases.filter((kb: KnowledgeBase) => kb.enabled) ?? [],
    [bootstrap]
  );
  const selectedLibraryKnowledgeBase =
    bootstrap?.knowledgeBases.find((kb: KnowledgeBase) => kb.id === libraryDetailKbId) ?? null;

  useEffect(() => {
    if (!selectedLibraryKnowledgeBase) {
      return;
    }
    setLibraryDraftName(selectedLibraryKnowledgeBase.name);
    setLibraryDraftDescription(selectedLibraryKnowledgeBase.description);
    setActiveKbId(selectedLibraryKnowledgeBase.id);
  }, [selectedLibraryKnowledgeBase]);

  async function createConversation() {
    if (!activeModelId && !bootstrap?.settings.defaultModelId) {
      setError("请先在 data/models.json 中启用至少一个模型。");
      return;
    }
    setError("");
    setActiveConversationId(null);
    setSidebarOpen(false);
  }

  async function saveSettings(partial: Partial<Settings>) {
    try {
      const settings = await jsonFetch<Settings>("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial)
      });
      setBootstrap((current: AppBootstrap | null) => (current ? { ...current, settings } : current));
      setStats((current) => (current ? { ...current, pricing: settings.tokenPricing } : current));
      if (statsOpen) {
        await refreshStats();
      }
      return settings;
    } catch (err) {
      setError(err instanceof Error ? err.message : "设置保存失败");
      await refresh();
      return null;
    }
  }

  async function saveModelProviders() {
    if (!bootstrap) {
      return;
    }

    await jsonFetch<ModelProviderConfig[]>("/api/model-providers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providers: bootstrap.modelProviders
      })
    });
    await refresh();
    setSettingsToast("模型配置已保存");
    if (settingsToastTimerRef.current) {
      window.clearTimeout(settingsToastTimerRef.current);
    }
    settingsToastTimerRef.current = window.setTimeout(() => {
      setSettingsToast("");
      settingsToastTimerRef.current = null;
    }, 1800);
  }

  function showComposerToast(message: string) {
    setComposerToast(message);
    if (composerToastTimerRef.current) {
      window.clearTimeout(composerToastTimerRef.current);
    }
    composerToastTimerRef.current = window.setTimeout(() => {
      setComposerToast("");
      composerToastTimerRef.current = null;
    }, 1800);
  }

  function openLibraryListPage() {
    setLibraryPage("list");
    setLibraryPendingFiles([]);
    setLibraryProgress(null);
  }

  function openLibraryCreatePage() {
    setLibraryPage("create");
    setLibraryDetailKbId(null);
    setLibraryDraftName("");
    setLibraryDraftDescription("");
    setLibraryPendingFiles([]);
    setLibraryProgress(null);
  }

  function openLibraryDetailPage(kbId: string) {
    setLibraryPage("detail");
    setLibraryDetailKbId(kbId);
    setLibraryPendingFiles([]);
    setLibraryProgress(null);
  }

  function updateLibraryPendingFiles(files: FileList | null) {
    setLibraryPendingFiles(files ? Array.from(files) : []);
  }

  async function uploadKnowledgeFiles(kbId: string) {
    if (!libraryPendingFiles.length) {
      return null;
    }
    const formData = new FormData();
    libraryPendingFiles.forEach((file) => {
      formData.append("files", file);
    });
    const response = await fetch(`/api/knowledge-bases/${kbId}/upload`, {
      method: "POST",
      body: formData
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const knowledgeBase = (await response.json()) as KnowledgeBase;
    return knowledgeBase;
  }

  async function saveKnowledgeBaseDraft() {
    const trimmedName = libraryDraftName.trim();
    if (!trimmedName) {
      showComposerToast("请输入知识库名称");
      return;
    }

    try {
      setLibrarySaving(true);
      setLibraryProgress({
        status: "processing",
        progress: 10,
        message: libraryPage === "create" ? "正在创建知识库..." : "正在保存知识库..."
      });

      let targetKbId = libraryDetailKbId;
      let latestKnowledgeBase: KnowledgeBase | null = null;

      if (libraryPage === "create") {
        latestKnowledgeBase = await jsonFetch<KnowledgeBase>("/api/knowledge-bases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmedName, description: libraryDraftDescription })
        });
        targetKbId = latestKnowledgeBase.id;
        setLibraryDetailKbId(latestKnowledgeBase.id);
        setActiveKbId(latestKnowledgeBase.id);
      } else if (libraryDetailKbId) {
        latestKnowledgeBase = await jsonFetch<KnowledgeBase>(`/api/knowledge-bases/${libraryDetailKbId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmedName,
            description: libraryDraftDescription
          })
        });
      }

      if (!targetKbId) {
        throw new Error("知识库不存在");
      }

      if (libraryPendingFiles.length) {
        setLibraryProgress({
          status: "processing",
          progress: 42,
          message: `正在上传 ${libraryPendingFiles.length} 个文件...`
        });
        latestKnowledgeBase = await uploadKnowledgeFiles(targetKbId);
        setLibraryProgress({
          status: "processing",
          progress: 88,
          message: "正在进行向量化..."
        });
      }

      await refresh();
      setLibraryPage("detail");
      setLibraryDetailKbId(targetKbId);
      setLibraryPendingFiles([]);
      setLibraryProgress({
        status: "completed",
        progress: 100,
        message: libraryPendingFiles.length ? "向量化已完成" : "知识库已保存"
      });
      showComposerToast(libraryPendingFiles.length ? "知识库已保存并完成向量化" : "知识库已保存");
    } catch (err) {
      const message = err instanceof Error ? err.message : "知识库保存失败";
      setError(message);
      setLibraryProgress({
        status: "failed",
        progress: 0,
        message: "知识库保存失败",
        error: message
      });
      await refresh();
    } finally {
      setLibrarySaving(false);
    }
  }

  async function toggleKnowledgeBaseEnabled(kbId: string, enabled: boolean) {
    try {
      const updated = await jsonFetch<KnowledgeBase>(`/api/knowledge-bases/${kbId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled })
      });
      setBootstrap((current: AppBootstrap | null) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          knowledgeBases: current.knowledgeBases.map((kb: KnowledgeBase) => (kb.id === updated.id ? updated : kb))
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "知识库状态更新失败");
    }
  }

  async function removeKnowledgeBase(kbId: string) {
    try {
      await jsonFetch<{ ok: true }>(`/api/knowledge-bases/${kbId}`, {
        method: "DELETE"
      });
      setBootstrap((current: AppBootstrap | null) => {
        if (!current) {
          return current;
        }
        const nextKnowledgeBases = current.knowledgeBases.filter((kb: KnowledgeBase) => kb.id !== kbId);
        return {
          ...current,
          conversations: current.conversations.map((conversation: Conversation) =>
            conversation.knowledgeBaseId === kbId ? { ...conversation, knowledgeBaseId: null } : conversation
          ),
          knowledgeBases: nextKnowledgeBases
        };
      });
      setActiveKbId((current) => (current === kbId ? "" : current));
      if (libraryDetailKbId === kbId) {
        openLibraryListPage();
        setLibraryDetailKbId(null);
      }
      showComposerToast("知识库已删除");
    } catch (err) {
      setError(err instanceof Error ? err.message : "知识库删除失败");
    }
  }

  async function removeKnowledgeDocument(kbId: string, docId: string) {
    try {
      await jsonFetch<{ ok: true }>(`/api/knowledge-bases/${kbId}/documents/${docId}`, {
        method: "DELETE"
      });
      await refresh();
      showComposerToast("知识库文件已删除");
    } catch (err) {
      setError(err instanceof Error ? err.message : "知识库文件删除失败");
    }
  }

  async function uploadChatAttachments(files: FileList | File[] | null) {
    if (!files?.length) {
      return;
    }

    try {
      setUploadingAttachments(true);
      const formData = new FormData();
      Array.from(files).forEach((file) => {
        formData.append("files", file);
      });

      const attachments = await jsonFetch<ChatAttachment[]>("/api/chat-attachments", {
        method: "POST",
        body: formData
      });
      setPendingAttachments((current) => [...current, ...attachments]);
      setError("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "附件上传失败";
      setError(message);
      showComposerToast(message);
    } finally {
      setUploadingAttachments(false);
      if (composerAttachmentInputRef.current) {
        composerAttachmentInputRef.current.value = "";
      }
    }
  }

  function handleComposerPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const clipboardFiles = Array.from(e.clipboardData.items)
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (!clipboardFiles.length) {
      return;
    }

    e.preventDefault();
    void uploadChatAttachments(clipboardFiles);
    showComposerToast("已添加剪贴板附件");
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  async function updateUserAvatar(file?: File | null) {
    try {
      if (!file) {
        return;
      }
      if (!file.type.startsWith("image/")) {
        throw new Error("请选择图片文件");
      }
      const formData = new FormData();
      formData.append("file", file);
      const settings = await jsonFetch<Settings>("/api/avatar", {
        method: "POST",
        body: formData
      });
      setBootstrap((current: AppBootstrap | null) => (current ? { ...current, settings } : current));
      setStats((current) => (current ? { ...current, pricing: settings.tokenPricing } : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : "头像上传失败");
    } finally {
      if (profileAvatarInputRef.current) {
        profileAvatarInputRef.current.value = "";
      }
    }
  }

  async function submitMessage() {
    if ((!draft.trim() && !pendingAttachments.length) || submitting || uploadingAttachments) {
      return;
    }
    if (!activeModelId) {
      setError("当前没有可用模型，请先检查 data/models.json 配置。");
      return;
    }

    setError("");
    setSubmitting(true);
    setStickToBottom(true);

    let conversationId = activeConversationId;
    if (!conversationId) {
      const conversation = await jsonFetch<Conversation>("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: activeModelId || bootstrap?.settings.defaultModelId,
          knowledgeBaseId: activeKbId || null
        })
      });
      conversationId = conversation.id;
      setActiveConversationId(conversation.id);
      setBootstrap((current: AppBootstrap | null) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          conversations: [conversation, ...current.conversations]
        };
      });
    }

    const userText = draft;
    const attachments = pendingAttachments;
    setDraft("");
    setPendingAttachments([]);

    setBootstrap((current: AppBootstrap | null) => {
      if (!current || !conversationId) {
        return current;
      }
      return {
        ...current,
        conversations: current.conversations.map((conversation: Conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                knowledgeBaseId: activeKbId || null,
                modelId: activeModelId,
                messages: [
                  ...conversation.messages,
                  {
                    id: `local_user_${Date.now()}`,
                    role: "user",
                    content: userText,
                    attachments,
                    createdAt: new Date().toISOString()
                  },
                  {
                    id: `local_assistant_${Date.now()}`,
                    role: "assistant",
                    content: "",
                    reasoning: "",
                    createdAt: new Date().toISOString()
                  }
                ]
              }
            : conversation
        )
      };
    });

    try {
      const abortController = new AbortController();
      chatAbortControllerRef.current = abortController;
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          conversationId,
          content: userText,
          attachments,
          modelId: activeModelId,
          knowledgeBaseId: activeKbId || null,
          knowledgeSearchEnabled,
          thinkingMode,
          webSearch: webSearchMode
        })
      });

      if (!response.ok || !response.body) {
        throw new Error(await response.text());
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let assistantText = "";
      let reasoningText = "";
      let answered = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }
          const chunk = JSON.parse(line) as ChatResponseChunk;
          if (chunk.type === "reasoning" && chunk.content) {
            reasoningText += chunk.content;
            const normalized = normalizeThinkingDisplay(reasoningText, assistantText);
            reasoningText = normalized.reasoning;
            assistantText = normalized.answer;
            setBootstrap((current: AppBootstrap | null) => {
              if (!current || !conversationId) {
                return current;
              }
              return {
                ...current,
                conversations: current.conversations.map((conversation: Conversation) =>
                  conversation.id === conversationId
                    ? {
                        ...conversation,
                        messages: conversation.messages.map((message, index, arr) =>
                          index === arr.length - 1 && message.role === "assistant"
                            ? { ...message, reasoning: reasoningText, content: assistantText }
                            : message
                        )
                      }
                    : conversation
                )
              };
            });
          }
          if (chunk.type === "delta" && chunk.content) {
            answered = true;
            assistantText += chunk.content;
            const normalized = normalizeThinkingDisplay(reasoningText, assistantText);
            reasoningText = normalized.reasoning;
            assistantText = normalized.answer;
            setBootstrap((current: AppBootstrap | null) => {
              if (!current || !conversationId) {
                return current;
              }
              return {
                ...current,
                conversations: current.conversations.map((conversation: Conversation) =>
                  conversation.id === conversationId
                    ? {
                        ...conversation,
                        messages: conversation.messages.map((message, index, arr) =>
                          index === arr.length - 1 && message.role === "assistant"
                            ? { ...message, content: assistantText, reasoning: reasoningText }
                            : message
                        )
                      }
                    : conversation
                )
              };
            });
          }
          if (chunk.type === "error") {
            throw new Error(chunk.message || "聊天失败");
          }
          if (chunk.type === "done" && !answered) {
            setBootstrap((current: AppBootstrap | null) => {
              if (!current || !conversationId) {
                return current;
              }
              return {
                ...current,
                conversations: current.conversations.map((conversation: Conversation) =>
                  conversation.id === conversationId
                    ? {
                        ...conversation,
                        messages: conversation.messages.map((message, index, arr) =>
                          index === arr.length - 1 && message.role === "assistant"
                            ? { ...message, reasoning: reasoningText, content: assistantText }
                            : message
                        )
                      }
                    : conversation
                )
              };
            });
          }
        }
      }

      await refresh();
      if (statsOpen) {
        await refreshStats();
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        await refresh();
        if (statsOpen) {
          await refreshStats();
        }
        return;
      }
      setError(err instanceof Error ? err.message : "聊天失败");
      await refresh();
      if (statsOpen) {
        await refreshStats();
      }
    } finally {
      chatAbortControllerRef.current = null;
      setSubmitting(false);
    }
  }

  function stopStreaming() {
    chatAbortControllerRef.current?.abort();
  }

  function handleProfileField(key: keyof Settings, value: Settings[keyof Settings]) {
    setBootstrap((current: AppBootstrap | null) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        settings: {
          ...current.settings,
          [key]: value
        }
      };
    });
  }

  function updateProvider(providerId: string, updater: (provider: ModelProviderConfig) => ModelProviderConfig) {
    setBootstrap((current: AppBootstrap | null) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        modelProviders: current.modelProviders.map((provider) =>
          provider.id === providerId ? updater(provider) : provider
        )
      };
    });
  }

  function addProvider() {
    setBootstrap((current: AppBootstrap | null) =>
      current
        ? (() => {
            const provider = createProviderDraft();
            setExpandedProviders((prev) => ({ ...prev, [provider.id]: true }));
            return {
              ...current,
              modelProviders: [...current.modelProviders, provider]
            };
          })()
        : current
    );
  }

  function addOllamaProvider() {
    setBootstrap((current: AppBootstrap | null) =>
      current
        ? (() => {
            const provider = createProviderDraft("ollama");
            setExpandedProviders((prev) => ({ ...prev, [provider.id]: true }));
            return {
              ...current,
              modelProviders: [...current.modelProviders, provider]
            };
          })()
        : current
    );
  }

  function addProviderModel(providerId: string, kind: ModelProviderConfig["kind"]) {
    updateProvider(providerId, (provider) => {
      const nextIndex = provider.models.length;
      setExpandedProviders((prev) => ({ ...prev, [providerId]: true }));
      setExpandedModels((prev) => ({ ...prev, [`${providerId}:${nextIndex}`]: true }));
      return {
        ...provider,
        models: [...provider.models, createModelDraft(kind)]
      };
    });
  }

  function removeProvider(providerId: string) {
    setExpandedProviders((prev) => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });
    setExpandedModels((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((key) => {
        if (key.startsWith(`${providerId}:`)) {
          delete next[key];
        }
      });
      return next;
    });
    setBootstrap((current: AppBootstrap | null) =>
      current
        ? {
            ...current,
            modelProviders: current.modelProviders.filter((provider) => provider.id !== providerId)
          }
        : current
    );
  }

  function removeProviderModel(providerId: string, modelIndex: number) {
    setExpandedModels((prev) => {
      const next = { ...prev };
      delete next[`${providerId}:${modelIndex}`];
      return next;
    });
    updateProvider(providerId, (provider) => ({
      ...provider,
      models: provider.models.filter((_, index) => index !== modelIndex)
    }));
  }

  function toggleProviderExpanded(providerId: string) {
    setExpandedProviders((prev) => ({
      ...prev,
      [providerId]: !prev[providerId]
    }));
  }

  function toggleModelExpanded(providerId: string, modelIndex: number) {
    const key = `${providerId}:${modelIndex}`;
    setExpandedModels((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  }

  async function renameConversation(id: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) {
      setEditingConversationId(null);
      setEditingTitle("");
      return;
    }

    const conversation = await jsonFetch<Conversation>(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed })
    });

    setBootstrap((current: AppBootstrap | null) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        conversations: current.conversations.map((item: Conversation) =>
          item.id === id ? conversation : item
        )
      };
    });

    setEditingConversationId(null);
    setEditingTitle("");
  }

  async function removeConversation(id: string) {
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    const remaining = bootstrap?.conversations.filter((item: Conversation) => item.id !== id) ?? [];
    setBootstrap((current: AppBootstrap | null) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        conversations: current.conversations.filter((item: Conversation) => item.id !== id)
      };
    });
    if (activeConversationId === id) {
      setActiveConversationId(remaining[0]?.id ?? null);
    }
  }

  async function persistConversationModel(modelId: string) {
    if (!activeConversationId || !bootstrap?.conversations.some((item: Conversation) => item.id === activeConversationId)) {
      return;
    }

    const conversationId = activeConversationId;

    setBootstrap((current: AppBootstrap | null) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        conversations: current.conversations.map((item: Conversation) =>
          item.id === conversationId ? { ...item, modelId, updatedAt: new Date().toISOString() } : item
        )
      };
    });

    try {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId })
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const conversation = (await response.json()) as Conversation;

      setBootstrap((current: AppBootstrap | null) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          conversations: current.conversations.map((item: Conversation) =>
            item.id === conversationId ? conversation : item
          )
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "模型切换失败");
      await refresh();
    }
  }

  async function handleModelChange(nextModelId: string) {
    setError("");
    setActiveModelId(nextModelId);
    await saveSettings({ defaultModelId: nextModelId });
    if (activeConversationId) {
      await persistConversationModel(nextModelId);
    }
  }

  async function persistConversationMessages(messages: Conversation["messages"]) {
    if (!activeConversationId) {
      return;
    }

    const conversation = await jsonFetch<Conversation>(`/api/conversations/${activeConversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages })
    });

    setBootstrap((current: AppBootstrap | null) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        conversations: current.conversations.map((item: Conversation) =>
          item.id === activeConversationId ? conversation : item
        )
      };
    });
  }

  async function copyMessage(message: Conversation["messages"][number]) {
    const text = [message.reasoning ? `思考过程\n${message.reasoning}` : "", message.content]
      .filter(Boolean)
      .join("\n\n")
      .trim();
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showComposerToast("已复制");
    } catch {
      setError("复制失败，请稍后重试");
    }
  }

  async function removeMessageTurn(targetIndex: number) {
    if (!activeConversation) {
      return;
    }

    const startIndex =
      activeConversation.messages[targetIndex]?.role === "assistant" &&
      activeConversation.messages[targetIndex - 1]?.role === "user"
        ? targetIndex - 1
        : targetIndex;
    const deleteCount =
      activeConversation.messages[startIndex]?.role === "user" &&
      activeConversation.messages[startIndex + 1]?.role === "assistant"
        ? 2
        : 1;
    const nextMessages = activeConversation.messages.filter((_, index) => {
      return index < startIndex || index >= startIndex + deleteCount;
    });
    await persistConversationMessages(nextMessages);
    showComposerToast("已删除该轮对话");
  }

  async function openLogFile() {
    try {
      setError("");
      const response = await fetch("/api/logs/open", {
        method: "POST"
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "打开日志文件夹失败");
    }
  }

  function toggleSettingsPanel() {
    const nextOpen = !settingsOpen;
    setSettingsOpen(nextOpen);
    if (nextOpen) {
      setSettingsPage("main");
      setLibraryOpen(false);
      setStatsOpen(false);
    }
  }

  function handleChatHistoryScroll(viewport: HTMLDivElement) {
    const distanceToBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    setStickToBottom(distanceToBottom <= 24);
  }

  function toggleLibraryPanel() {
    const nextOpen = !libraryOpen;
    setLibraryOpen(nextOpen);
    if (nextOpen) {
      setSettingsOpen(false);
      setStatsOpen(false);
      setLibraryPage("list");
    }
  }

  if (!bootstrap) {
    return <main className="loading-shell">正在加载平台...</main>;
  }

  const selectedModel = bootstrap.models.find((model: PublicModelConfig) => model.id === activeModelId) ?? null;
  const chartMax = Math.max(...(stats?.chart.map((item) => item.totalTokens) ?? [0]), 1);

  function formatTokenCount(value: number) {
    return new Intl.NumberFormat("zh-CN").format(value);
  }

  function formatMoney(value: number | null | undefined) {
    const safeValue = typeof value === "number" && Number.isFinite(value) ? value : 0;
    return `¥${safeValue.toFixed(4)}`;
  }

  return (
    <main className="chatgpt-shell">
      <aside className={sidebarOpen ? "chatgpt-sidebar open" : "chatgpt-sidebar"}>
        {/*
        <div className="sidebar-topbar">
          <div className="sidebar-top-actions">
            <button className="icon-button" type="button" onClick={() => setSidebarOpen(false)}>
              <SidebarIcon symbol="☰" />
            </button>
            <button className="icon-button" type="button" onClick={() => void createConversation()}>
              <SidebarIcon symbol="✎" />
            </button>
          </div>
        </div>
        */}

        <div className="sidebar-search">
          <input
            value={searchQuery}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
            placeholder="搜索"
          />
        </div>

        <button className="sidebar-primary-entry active" type="button" onClick={() => void createConversation()}>
          <span className="entry-logo">◎</span>
          <span className="entry-copy">
            <strong>新建对话</strong>
          </span>
        </button>

        <div className="sidebar-shortcuts">
          <button className="sidebar-link" type="button" onClick={toggleLibraryPanel}>
            <SidebarIcon symbol="◫" />
            <span>知识库</span>
          </button>
        </div>

        <section className="sidebar-history">
          <div className="sidebar-section-head">
            <span>最近对话</span>
          </div>

          <div className="history-list">
            {filteredConversations.map((conversation: Conversation) => (
              <div
                key={conversation.id}
                className={conversation.id === activeConversationId ? "history-item active" : "history-item"}
              >
                <button
                  className="history-main"
                  type="button"
                  onClick={() => {
                    setActiveConversationId(conversation.id);
                    setSidebarOpen(false);
                  }}
                >
                  {editingConversationId === conversation.id ? (
                    <input
                      autoFocus
                      className="history-title-input"
                      value={editingTitle}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setEditingTitle(e.target.value)}
                      onBlur={() => void renameConversation(conversation.id, editingTitle)}
                      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void renameConversation(conversation.id, editingTitle);
                        }
                        if (e.key === "Escape") {
                          setEditingConversationId(null);
                          setEditingTitle("");
                        }
                      }}
                    />
                  ) : (
                    <strong className="history-title" title={conversation.title}>
                      {conversation.title}
                    </strong>
                  )}
                  <span>{formatConversationListTime(conversation.updatedAt)}</span>
                </button>
                <div className="history-actions">
                  <button
                    className="history-action-button"
                    type="button"
                    title="重命名"
                    aria-label="重命名"
                    onClick={() => {
                      setEditingConversationId(conversation.id);
                      setEditingTitle(conversation.title);
                    }}
                  >
                    <span aria-hidden="true">✎</span>
                  </button>
                  <button
                    className="history-action-button danger"
                    type="button"
                    title="删除"
                    aria-label="删除"
                    onClick={() => void removeConversation(conversation.id)}
                  >
                    <span aria-hidden="true">⌫</span>
                  </button>
                </div>
              </div>
            ))}
            {!filteredConversations.length && <p className="sidebar-empty">没有匹配的对话</p>}
          </div>
        </section>

        <button className="sidebar-profile" type="button" onClick={toggleSettingsPanel}>
          <Avatar
            className="profile-avatar"
            name={bootstrap.settings.userName}
            image={bootstrap.settings.userAvatar}
          />
          <span className="profile-meta">
            <strong>{bootstrap.settings.userName}</strong>
            <span>配置昵称、风格与模型API</span>
          </span>
        </button>
      </aside>

      <section className="chatgpt-main">
        <header className="workspace-header">
          <div className="workspace-left">
            <button className="workspace-mobile-toggle" type="button" onClick={() => setSidebarOpen(true)}>
              ☰
            </button>
            <div className="workspace-brand-pill">
              <span>{bootstrap.settings.assistantName || "ChatGPT"}</span>
              <span className="pill-arrow">›</span>
            </div>
          </div>

          <div className="workspace-actions">
            <button
              className={statsOpen ? "header-action active" : "header-action"}
              type="button"
              onClick={() => {
                setStatsOpen((current) => !current);
                setSettingsOpen(false);
                setLibraryOpen(false);
              }}
              title="统计"
              aria-label="统计"
            >
              <span aria-hidden="true">☷</span>
            </button>
          </div>
        </header>

        <div
          className="chat-history"
          ref={chatHistoryRef}
          onScroll={(e) => handleChatHistoryScroll(e.currentTarget)}
        >
          {!activeConversation?.messages.length && (
            <div className="empty-state">
              <h2>{bootstrap.settings.assistantName || "ChatGPT"}</h2>
              <p>欢迎回来，{bootstrap.settings.userName}</p>
              <div className="empty-meta-row">
                <span>模型：{selectedModel?.name ?? "未选择模型"}</span>
                <span>共享记忆：{bootstrap.settings.sharedMemory ? "开启" : "关闭"}</span>
                <span>联网搜索：{webSearchMode ? "开启" : "关闭"}</span>
                <span>知识库检索：{knowledgeSearchEnabled && enabledKnowledgeBases.length ? `${enabledKnowledgeBases.length} 个已启用知识库` : "未启用"}</span>
              </div>
            </div>
          )}

          {activeConversation?.messages.map((message, index) => (
            (() => {
              const normalizedThinking = normalizeThinkingDisplay(message.reasoning ?? "", message.content);
              const displayReasoning = normalizedThinking.reasoning;
              const displayContent = normalizedThinking.answer;
              const compactReasoning = compactStreamingContent(displayReasoning);
              const compactContent = compactStreamingContent(displayContent);
              const isStreamingAssistantMessage =
                submitting &&
                message.role === "assistant" &&
                message.id === activeConversation?.messages.at(-1)?.id;
              return (
            <article
              key={message.id}
              className={message.role === "user" ? "chat-row chat-row-user" : "chat-row chat-row-assistant"}
            >
              <Avatar
                className="chat-avatar"
                name={message.role === "user" ? bootstrap.settings.userName : bootstrap.settings.assistantName}
                image={message.role === "user" ? bootstrap.settings.userAvatar : ""}
              />
              <div className="chat-bubble">
                <div className="chat-author">
                  {message.role === "user" ? bootstrap.settings.userName : bootstrap.settings.assistantName}
                </div>
                {displayReasoning ? (
                  <details
                    className="chat-reasoning"
                    open={submitting && message.role === "assistant" && message.id === activeConversation?.messages.at(-1)?.id}
                  >
                    <summary>思考过程</summary>
                    <div className="chat-reasoning-text">
                      {isStreamingAssistantMessage ? (
                        <div className="chat-streaming-text">{compactReasoning}</div>
                      ) : (
                        <MessageMarkdown content={displayReasoning} />
                      )}
                    </div>
                  </details>
                ) : null}
                {message.attachments?.length ? (
                  <div className="chat-attachment-list">
                    {message.attachments.map((attachment) => (
                      <div key={attachment.id} className="chat-attachment-chip">
                        {attachment.kind === "image" && attachment.previewUrl ? (
                          <img className="chat-attachment-thumb" src={attachment.previewUrl} alt={attachment.fileName} />
                        ) : (
                          <span className="chat-attachment-icon">⎘</span>
                        )}
                        <span className="chat-attachment-name">{attachment.fileName}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="chat-text" data-user-message-text={message.role === "user" ? "true" : undefined}>
                  {displayContent ? (
                    isStreamingAssistantMessage ? (
                      <div className="chat-streaming-text">{compactContent}</div>
                    ) : (
                      <MessageMarkdown content={displayContent} />
                    )
                  ) : submitting && message.role === "assistant" ? (
                    "思考中..."
                  ) : (
                    ""
                  )}
                </div>
                {!isStreamingAssistantMessage ? (
                  <div className="chat-meta-row">
                    <span className="chat-meta-time">{formatTime(message.createdAt)}</span>
                    <div className="chat-meta-actions">
                      <button
                        type="button"
                        className="chat-meta-button"
                        title="复制"
                        aria-label="复制"
                        onClick={() => void copyMessage(message)}
                      >
                        <span aria-hidden="true">⧉</span>
                      </button>
                      <button
                        type="button"
                        className="chat-meta-button danger"
                        title="删除"
                        aria-label="删除"
                        onClick={() => void removeMessageTurn(index)}
                      >
                        <span aria-hidden="true">⌫</span>
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </article>
              );
            })()
          ))}
          <div ref={chatEndRef} />
        </div>

        <form
          className="composer-shell"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            void submitMessage();
          }}
        >
          {composerToast ? <div className="composer-toast">{composerToast}</div> : null}
          <input
            ref={composerAttachmentInputRef}
            className="hidden-file-input"
            type="file"
            multiple
            accept=".txt,.md,.markdown,.pdf,.docx,.xlsx,.xls,.csv,.json,.xml,.yaml,.yml,image/*"
            onChange={(e: ChangeEvent<HTMLInputElement>) => void uploadChatAttachments(e.target.files)}
          />
          {pendingAttachments.length ? (
            <div className="composer-attachment-list">
              {pendingAttachments.map((attachment) => (
                <div key={attachment.id} className="composer-attachment-chip">
                  <div className="composer-attachment-preview">
                    {attachment.kind === "image" && attachment.previewUrl ? (
                      <img src={attachment.previewUrl} alt={attachment.fileName} className="composer-attachment-thumb" />
                    ) : (
                      <span className="composer-attachment-badge">{getAttachmentBadgeLabel(attachment)}</span>
                    )}
                  </div>
                  <div className="composer-attachment-meta">
                    <span className="composer-attachment-filename" title={attachment.fileName}>
                      {attachment.fileName}
                    </span>
                    <span className="composer-attachment-filesize">{formatAttachmentSize(attachment.size)}</span>
                  </div>
                  <button
                    type="button"
                    className="composer-attachment-remove"
                    onClick={() => removePendingAttachment(attachment.id)}
                    aria-label="移除附件"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="composer-topline">
            <textarea
              placeholder="有问题，尽管问"
              value={draft}
              rows={3}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value)}
              onPaste={(e: ClipboardEvent<HTMLTextAreaElement>) => handleComposerPaste(e)}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
              }}
              onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                const isComposing = composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229;
                if (isComposing) {
                  return;
                }
                if (e.key === "Enter" && e.altKey) {
                  e.preventDefault();
                  showComposerToast("请使用 Shift+Enter 换行");
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submitMessage();
                }
              }}
            />
          </div>

          <div className="composer-toolbar">
            <div className="composer-left-actions">
              <button
                className="attach-toggle"
                type="button"
                onClick={() => composerAttachmentInputRef.current?.click()}
                title={uploadingAttachments ? "附件上传中..." : "添加附件"}
                aria-label={uploadingAttachments ? "附件上传中..." : "添加附件"}
              >
                {uploadingAttachments ? "…" : "📎"}
              </button>
              <button
                className={thinkingMode ? "thinking-toggle active" : "thinking-toggle"}
                type="button"
                onClick={() => setThinkingMode((current) => !current)}
                title={thinkingMode ? "思考模式已开启" : "思考模式已关闭"}
                aria-label={thinkingMode ? "思考模式已开启" : "思考模式已关闭"}
              >
                {thinkingMode ? "思考" : "思考"}
              </button>
              <button
                className={webSearchMode ? "search-toggle active" : "search-toggle"}
                type="button"
                onClick={() => setWebSearchMode((current) => !current)}
                title={webSearchMode ? "联网搜索已开启" : "联网搜索已关闭"}
                aria-label={webSearchMode ? "联网搜索已开启" : "联网搜索已关闭"}
              >
                <img className="search-toggle-icon" src="/network-search.png" alt="" aria-hidden="true" />
              </button>
              <button
                className={knowledgeSearchEnabled ? "knowledge-toggle active" : "knowledge-toggle"}
                type="button"
                onClick={() => {
                  if (!knowledgeSearchEnabled && !enabledKnowledgeBases.length) {
                    showComposerToast("请先在知识库面板启用至少一个知识库");
                    setLibraryOpen(true);
                    return;
                  }
                  setKnowledgeSearchEnabled((current) => !current);
                }}
                title={knowledgeSearchEnabled ? "知识库检索开启" : "知识库检索关闭"}
                aria-label={knowledgeSearchEnabled ? "知识库检索开启" : "知识库检索关闭"}
              >
                <span className="knowledge-toggle-icon" aria-hidden="true">
                  📚
                </span>
              </button>
              <select
                className="composer-select"
                value={activeModelId}
                title={selectedModel ? `切换模型，当前：${selectedModel.name}` : "切换模型"}
                aria-label={selectedModel ? `切换模型，当前：${selectedModel.name}` : "切换模型"}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                  const nextModelId = e.target.value;
                  void handleModelChange(nextModelId);
                }}
              >
                {bootstrap.models.map((model: PublicModelConfig) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="composer-right-actions">
              {error && <span className="error-text">{error}</span>}
              <button
                className={submitting ? "send-button stop-button" : "send-button"}
                type={submitting ? "button" : "submit"}
                onClick={submitting ? stopStreaming : undefined}
                disabled={!submitting && !draft.trim() && !pendingAttachments.length}
                aria-label={submitting ? "终止输出" : "发送消息"}
                title={submitting ? "终止输出" : "发送消息"}
              >
                {submitting ? "■" : "↑"}
              </button>
            </div>
          </div>
        </form>

        <aside className={statsOpen ? "stats-panel open" : "stats-panel"}>
          <div className="stats-panel-head">
            <div>
              <strong>Token 统计</strong>
              <span>查看用量、图表与价格维度</span>
            </div>
            <button className="icon-button" type="button" onClick={() => setStatsOpen(false)}>
              ×
            </button>
          </div>

          <div className="stats-filter-shell">
            <div className="stats-range-row">
              <button
                className={statsFilterMode === "range" && statsStartDate === statsEndDate ? "stats-range-pill active" : "stats-range-pill"}
                type="button"
                onClick={() => {
                  const today = formatDateInput(new Date());
                  setStatsFilterMode("range");
                  setStatsStartDate(today);
                  setStatsEndDate(today);
                }}
              >
                本日
              </button>
              <button
                className={statsFilterMode === "all" ? "stats-range-pill active" : "stats-range-pill"}
                type="button"
                onClick={() => setStatsFilterMode("all")}
              >
                全部
              </button>
            </div>

            <div className="stats-date-row">
              <label className="field-block stats-date-field">
                <span>开始日期</span>
                <input
                  type="date"
                  value={statsStartDate}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    setStatsFilterMode("range");
                    setStatsStartDate(e.target.value);
                  }}
                />
              </label>
              <label className="field-block stats-date-field">
                <span>结束日期</span>
                <input
                  type="date"
                  value={statsEndDate}
                  min={statsStartDate}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    setStatsFilterMode("range");
                    setStatsEndDate(e.target.value);
                  }}
                />
              </label>
            </div>
          </div>

          <div className="stats-panel-body">
            {statsLoading ? <p className="stats-empty">正在加载统计数据...</p> : null}

            {!statsLoading && stats ? (
              <>
                <section className="stats-summary-grid">
                  <article className="stats-card">
                    <span>输入 Token</span>
                    <strong>{formatTokenCount(stats.summary.inputTokens)}</strong>
                  </article>
                  <article className="stats-card">
                    <span>输出 Token</span>
                    <strong>{formatTokenCount(stats.summary.outputTokens)}</strong>
                  </article>
                  <article className="stats-card">
                    <span>显式缓存创建 Token</span>
                    <strong>{formatTokenCount(stats.summary.cacheCreationTokens)}</strong>
                  </article>
                  <article className="stats-card">
                    <span>显式缓存命中 Token</span>
                    <strong>{formatTokenCount(stats.summary.cacheHitTokens)}</strong>
                  </article>
                  <article className="stats-card">
                    <span>总 Token</span>
                    <strong>{formatTokenCount(stats.summary.totalTokens)}</strong>
                  </article>
                  <article className="stats-card">
                    <span>估算费用</span>
                    <strong>{formatMoney(stats.summary.totalCost)}</strong>
                  </article>
                </section>

                <section className="stats-chart-card">
                  <div className="field-block-inline">
                    <span>区间 Token 趋势</span>
                    <span className="stats-mini-copy">共 {stats.summary.requests} 次请求</span>
                  </div>
                  {stats.chart.length ? (
                    <div className="stats-chart">
                      {stats.chart.map((item) => (
                        <div key={item.date} className="stats-bar-item" title={`${item.date} · ${item.totalTokens} tokens`}>
                          <div
                            className="stats-bar"
                            style={{ height: `${Math.max(10, (item.totalTokens / chartMax) * 140)}px` }}
                          />
                          <span>{item.date.slice(5)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="stats-empty">当前区间还没有 token 数据。</p>
                  )}
                </section>

                <section className="stats-pricing-card">
                  <div className="field-block-inline">
                    <span>价格设置</span>
                    <span className="stats-mini-copy">单位：元 / 1M Tokens</span>
                  </div>
                  <div className="stats-pricing-grid">
                    <label className="field-block">
                      <span>输入单价</span>
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={bootstrap.settings.tokenPricing.inputPerMillion}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          handleProfileField("tokenPricing", {
                            ...bootstrap.settings.tokenPricing,
                            inputPerMillion: Number(e.target.value || 0)
                          })
                        }
                        onBlur={(e: ChangeEvent<HTMLInputElement>) =>
                          void saveSettings({
                            tokenPricing: {
                              ...bootstrap.settings.tokenPricing,
                              inputPerMillion: Number(e.target.value || 0)
                            }
                          })
                        }
                      />
                    </label>
                    <label className="field-block">
                      <span>输出单价</span>
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={bootstrap.settings.tokenPricing.outputPerMillion}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          handleProfileField("tokenPricing", {
                            ...bootstrap.settings.tokenPricing,
                            outputPerMillion: Number(e.target.value || 0)
                          })
                        }
                        onBlur={(e: ChangeEvent<HTMLInputElement>) =>
                          void saveSettings({
                            tokenPricing: {
                              ...bootstrap.settings.tokenPricing,
                              outputPerMillion: Number(e.target.value || 0)
                            }
                          })
                        }
                      />
                    </label>
                    <label className="field-block">
                      <span>显式缓存创建单价</span>
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={bootstrap.settings.tokenPricing.cacheCreationPerMillion}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          handleProfileField("tokenPricing", {
                            ...bootstrap.settings.tokenPricing,
                            cacheCreationPerMillion: Number(e.target.value || 0)
                          })
                        }
                        onBlur={(e: ChangeEvent<HTMLInputElement>) =>
                          void saveSettings({
                            tokenPricing: {
                              ...bootstrap.settings.tokenPricing,
                              cacheCreationPerMillion: Number(e.target.value || 0)
                            }
                          })
                        }
                      />
                    </label>
                    <label className="field-block">
                      <span>显式缓存命中单价</span>
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={bootstrap.settings.tokenPricing.cacheHitPerMillion}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          handleProfileField("tokenPricing", {
                            ...bootstrap.settings.tokenPricing,
                            cacheHitPerMillion: Number(e.target.value || 0)
                          })
                        }
                        onBlur={(e: ChangeEvent<HTMLInputElement>) =>
                          void saveSettings({
                            tokenPricing: {
                              ...bootstrap.settings.tokenPricing,
                              cacheHitPerMillion: Number(e.target.value || 0)
                            }
                          })
                        }
                      />
                    </label>
                  </div>
                </section>

                <section className="stats-list-card">
                  <div className="field-block-inline">
                    <span>对话汇总</span>
                    <span className="stats-mini-copy">{stats.conversations.length} 个对话</span>
                  </div>
                  <div className="stats-record-list">
                    {stats.conversations.slice(0, 12).map((conversation) => (
                      <article key={conversation.conversationId} className="stats-record-item">
                        <div className="stats-record-head">
                          <strong>{conversation.conversationTitle}</strong>
                          <span>{formatMoney(conversation.totalCost)}</span>
                        </div>
                        <span>
                          {conversation.requests} 次请求 · 总计 {formatTokenCount(conversation.usage.totalTokens)} tokens
                        </span>
                        <span>
                          输入 {formatTokenCount(conversation.usage.inputTokens)} / 输出 {formatTokenCount(conversation.usage.outputTokens)} / 创建{" "}
                          {formatTokenCount(conversation.usage.cacheCreationTokens)} / 命中{" "}
                          {formatTokenCount(conversation.usage.cacheHitTokens)}
                        </span>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="stats-list-card">
                  <div className="field-block-inline">
                    <span>单次请求明细</span>
                    <span className="stats-mini-copy">最近 {stats.records.length} 条</span>
                  </div>
                  <div className="stats-record-list">
                    {stats.records.map((record) => (
                      <article key={record.id} className="stats-record-item">
                        <div className="stats-record-head">
                          <strong>{formatStatsRecordTitle(record.userPrompt, record.conversationTitle)}</strong>
                          <span>{formatMoney(record.totalCost)}</span>
                        </div>
                        <span>
                          对话名称：{record.conversationTitle}
                        </span>
                        <span>
                          {formatTime(record.createdAt)} · {record.modelName} · {record.thinkingMode ? "思考模式" : "直接回答"}
                        </span>
                        <span>
                          输入 {formatTokenCount(record.usage.inputTokens)} / 输出 {formatTokenCount(record.usage.outputTokens)} / 创建{" "}
                          {formatTokenCount(record.usage.cacheCreationTokens)} / 命中 {formatTokenCount(record.usage.cacheHitTokens)}
                        </span>
                        <span>
                          总计 {formatTokenCount(record.usage.totalTokens)} tokens · 来源 {record.usage.source === "provider" ? "接口返回" : "估算"}
                        </span>
                      </article>
                    ))}
                  </div>
                </section>
              </>
            ) : null}
          </div>
        </aside>
      </section>

      {(settingsOpen || libraryOpen || sidebarOpen || statsOpen) && (
        <button
          aria-label="Close overlay"
          className="mobile-overlay active"
          type="button"
          onClick={() => {
            setSidebarOpen(false);
            setSettingsOpen(false);
            setLibraryOpen(false);
            setStatsOpen(false);
          }}
        />
      )}

      <aside className={settingsOpen ? "side-panel open" : "side-panel"}>
        {settingsToast ? <div className="settings-toast">{settingsToast}</div> : null}
        <div className="side-panel-head">
          <h3>{settingsPage === "main" ? "个人中心" : "配置模型"}</h3>
          <div className="side-panel-head-actions">
            {settingsPage === "models" ? (
              <button className="panel-button secondary panel-link-button" type="button" onClick={() => setSettingsPage("main")}>
                返回
              </button>
            ) : null}

            <button className="icon-button" type="button" onClick={() => setSettingsOpen(false)}>
              ×
            </button>
          </div>
        </div>
        <div className="side-panel-body">
          {settingsPage === "main" ? (
            <>
              <div className="field-block profile-avatar-field">
                <span>个人头像</span>
                <div className="profile-avatar-editor">
                  <Avatar
                    className="profile-avatar profile-avatar-large"
                    name={bootstrap.settings.userName}
                    image={bootstrap.settings.userAvatar}
                  />
                  <div className="profile-avatar-actions">
                    <input
                      ref={profileAvatarInputRef}
                      accept="image/*"
                      className="hidden-file-input"
                      type="file"
                      onChange={(e: ChangeEvent<HTMLInputElement>) => void updateUserAvatar(e.target.files?.[0] ?? null)}
                    />
                    <button
                      className="panel-button secondary"
                      type="button"
                      onClick={() => profileAvatarInputRef.current?.click()}
                    >
                      更换头像
                    </button>
                  </div>
                </div>
              </div>

              <label className="field-block">
                <span>大模型昵称</span>
                <input
                  value={bootstrap.settings.assistantName}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => handleProfileField("assistantName", e.target.value)}
                  onBlur={(e: ChangeEvent<HTMLInputElement>) => void saveSettings({ assistantName: e.target.value })}
                />
              </label>

              <label className="field-block">
                <span>我的昵称</span>
                <input
                  value={bootstrap.settings.userName}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => handleProfileField("userName", e.target.value)}
                  onBlur={(e: ChangeEvent<HTMLInputElement>) => void saveSettings({ userName: e.target.value })}
                />
              </label>

              <label className="field-block">
                <span>大模型说话风格</span>
                <textarea
                  rows={5}
                  value={bootstrap.settings.assistantStyle}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleProfileField("assistantStyle", e.target.value)}
                  onBlur={(e: ChangeEvent<HTMLTextAreaElement>) => void saveSettings({ assistantStyle: e.target.value })}
                />
              </label>

              <label className="switch-row">
                <span>跨对话共享记忆</span>
                <input
                  checked={bootstrap.settings.sharedMemory}
                  type="checkbox"
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    handleProfileField("sharedMemory", e.target.checked);
                    void saveSettings({ sharedMemory: e.target.checked });
                  }}
                />
              </label>

              <div className="field-block">
                <span>系统配置</span>
                <button
                  className="panel-button secondary panel-link-button" type="button" onClick={() => void openLogFile()}>
                  对话记录
                </button>
                  <button className="panel-button secondary" type="button" onClick={() => setSettingsPage("models")}>
                  模型配置
                </button>
              </div>
            </>
          ) : (
            <div className="field-block model-config-section">
              <div className="field-block-inline">
                <span>配置模型</span>
                <div className="inline-actions">
                  <button className="ghost-pill" type="button" onClick={addProvider}>
                    添加供应商
                  </button>
                  <button className="ghost-pill" type="button" onClick={addOllamaProvider}>
                    添加 Ollama
                  </button>
                </div>
              </div>

              <div className="provider-list">
                {bootstrap.modelProviders.map((provider) => (
                  <article key={provider.id} className="provider-card">
                    <button className="provider-accordion-toggle" type="button" onClick={() => toggleProviderExpanded(provider.id)}>
                      <div className="provider-toggle-copy">
                        <strong>{provider.name || "未命名供应商"}</strong>
                        <span>{expandedProviders[provider.id] ? "收起编辑" : "点击编辑"}</span>
                      </div>
                      <span className={expandedProviders[provider.id] ? "accordion-arrow open" : "accordion-arrow"}>›</span>
                    </button>

                    {expandedProviders[provider.id] ? (
                      <>
                        <div className="provider-card-head">
                          <span className="provider-kind-chip">{provider.kind}</span>
                          <button
                            className="history-action-button danger"
                            type="button"
                            aria-label="删除供应商"
                            title="删除供应商"
                            onClick={() => removeProvider(provider.id)}
                          >
                            <span aria-hidden="true">⌫</span>
                          </button>
                        </div>

                        <label className="field-block">
                          <span>供应商名称</span>
                          <input
                            placeholder="例如：百炼千问"
                            value={provider.name}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                              updateProvider(provider.id, (current) => ({
                                ...current,
                                name: e.target.value
                              }))
                            }
                          />
                        </label>

                        <label className="field-block">
                          <span>供应商类型</span>
                          <select
                            value={provider.kind}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                              updateProvider(provider.id, (current) => ({
                                ...current,
                                kind: e.target.value as ModelProviderConfig["kind"]
                              }))
                            }
                          >
                            <option value="openai-compatible">OpenAI Compatible</option>
                            <option value="ollama">Ollama</option>
                            <option value="custom">Custom</option>
                          </select>
                        </label>

                        <div className="provider-model-list">
                          {provider.models.map((model, modelIndex) => {
                            const modelKey = `${provider.id}:${modelIndex}`;
                            const modelExpanded = Boolean(expandedModels[modelKey]);
                            return (
                              <div key={`${provider.id}_${modelIndex}`} className="provider-model-card">
                                <button
                                  className="provider-accordion-toggle model-toggle"
                                  type="button"
                                  onClick={() => toggleModelExpanded(provider.id, modelIndex)}
                                >
                                  <div className="provider-toggle-copy">
                                    <strong>{model.name || model.id || "未命名模型"}</strong>
                                    <span>{modelExpanded ? "收起配置" : "展开配置"}</span>
                                  </div>
                                  <div className="provider-toggle-actions">
                                    <span className={modelExpanded ? "accordion-arrow open" : "accordion-arrow"}>›</span>
                                  </div>
                                </button>

                                {modelExpanded ? (
                                  <div className="provider-model-body">
                                    <div className="provider-card-head">
                                      <span className="provider-kind-chip">{model.enabled ? "已启用" : "未启用"}</span>
                                      <button
                                        className="history-action-button danger"
                                        type="button"
                                        aria-label="删除模型"
                                        title="删除模型"
                                        onClick={() => removeProviderModel(provider.id, modelIndex)}
                                      >
                                        <span aria-hidden="true">⌫</span>
                                      </button>
                                    </div>

                                    <label className="field-block">
                                      <span>模型 ID</span>
                                      <input
                                        placeholder="例如：qwen3.5-plus"
                                        value={model.id}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                          updateProvider(provider.id, (current) => ({
                                            ...current,
                                            models: current.models.map((item, index) =>
                                              index === modelIndex ? { ...item, id: e.target.value } : item
                                            )
                                          }))
                                        }
                                      />
                                    </label>

                                    <label className="field-block">
                                      <span>模型名称</span>
                                      <input
                                        placeholder="例如：Qwen 3.5 Plus"
                                        value={model.name}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                          updateProvider(provider.id, (current) => ({
                                            ...current,
                                            models: current.models.map((item, index) =>
                                              index === modelIndex ? { ...item, name: e.target.value } : item
                                            )
                                          }))
                                        }
                                      />
                                    </label>

                                    <label className="field-block">
                                      <span>模型 URL</span>
                                      <textarea
                                        rows={3}
                                        placeholder={provider.kind === "ollama" ? "http://127.0.0.1:11434/v1" : "https://example.com/v1"}
                                        value={model.apiUrl}
                                        onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                                          updateProvider(provider.id, (current) => ({
                                            ...current,
                                            models: current.models.map((item, index) =>
                                              index === modelIndex ? { ...item, apiUrl: e.target.value } : item
                                            )
                                          }))
                                        }
                                      />
                                    </label>

                                    <label className="field-block">
                                      <span>模型 API</span>
                                      <input
                                        placeholder={provider.kind === "ollama" ? "本地 Ollama 可留空" : "输入 API Token"}
                                        type="password"
                                        value={model.token}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                          updateProvider(provider.id, (current) => ({
                                            ...current,
                                            models: current.models.map((item, index) =>
                                              index === modelIndex ? { ...item, token: e.target.value } : item
                                            )
                                          }))
                                        }
                                      />
                                    </label>

                                    <label className="switch-row">
                                      <span>启用该模型</span>
                                      <input
                                        checked={model.enabled}
                                        type="checkbox"
                                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                          updateProvider(provider.id, (current) => ({
                                            ...current,
                                            models: current.models.map((item, index) =>
                                              index === modelIndex ? { ...item, enabled: e.target.checked } : item
                                            )
                                          }))
                                        }
                                      />
                                    </label>

                                    <button className="panel-button secondary" type="button" onClick={() => void saveModelProviders()}>
                                      保存当前配置
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>

                        <button className="panel-button secondary" type="button" onClick={() => addProviderModel(provider.id, provider.kind)}>
                          添加模型
                        </button>
                      </>
                    ) : null}
                  </article>
                ))}
              </div>

              <button className="panel-button" type="button" onClick={() => void saveModelProviders()}>
                保存模型配置
              </button>
            </div>
          )}
        </div>
      </aside>

      <aside className={libraryOpen ? "side-panel open library-panel" : "side-panel library-panel"}>
        <div className="side-panel-head">
          <div className="library-panel-title">
            {libraryPage !== "list" ? (
              <button className="library-back-button" type="button" onClick={openLibraryListPage}>
                ←
              </button>
            ) : null}
            <h3>
              {libraryPage === "create" ? "新建知识库" : libraryPage === "detail" ? "知识库详情" : "知识库"}
            </h3>
          </div>
          <button className="icon-button" type="button" onClick={() => setLibraryOpen(false)}>
            ×
          </button>
        </div>

        {libraryPage === "list" ? (
          <div className="library-page-shell">
            <button className="panel-button" type="button" onClick={openLibraryCreatePage}>
              新建知识库
            </button>

            <div className="library-list">
              {bootstrap.knowledgeBases.map((kb: KnowledgeBase) => (
                <article
                  key={kb.id}
                  className="library-card library-card-clickable"
                  role="button"
                  tabIndex={0}
                  onClick={() => openLibraryDetailPage(kb.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openLibraryDetailPage(kb.id);
                    }
                  }}
                >
                  <div className="library-card-head">
                    <div className="library-card-main">
                      <strong>{kb.name}</strong>
                      <p>{kb.description || "暂无描述"}</p>
                    </div>
                    <div className="library-card-actions">
                      <button
                        type="button"
                        className={kb.enabled ? "library-enable-toggle active" : "library-enable-toggle"}
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleKnowledgeBaseEnabled(kb.id, !kb.enabled);
                        }}
                      >
                        {kb.enabled ? "已启用" : "未启用"}
                      </button>
                      <button
                        type="button"
                        className="library-delete-button"
                        title="删除知识库"
                        aria-label="删除知识库"
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeKnowledgeBase(kb.id);
                        }}
                      >
                        ⌫
                      </button>
                    </div>
                  </div>
                  <div className="library-card-summary">
                    <span className="library-card-summary-line">
                      <span>更新时间：{formatConversationListTime(kb.updatedAt)}</span>
                    </span>
                    <span className="library-card-summary-line">
                      <span>{kb.documents.length} 个文件</span>
                      <span>{kb.chunks.length} 个片段</span>
                      {/* <span>状态：{formatVectorizationStatus(kb.vectorizationStatus)}</span> */}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}

        {libraryPage === "create" ? (
          <div className="library-page-shell">
            <div className="stack-form">
              <label className="field-block">
                <span>知识库名称</span>
                <input
                  placeholder="例如：产品资料库"
                  value={libraryDraftName}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setLibraryDraftName(e.target.value)}
                />
              </label>
              <label className="field-block">
                <span>知识库描述</span>
                <textarea
                  rows={4}
                  placeholder="描述这个知识库的用途"
                  value={libraryDraftDescription}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setLibraryDraftDescription(e.target.value)}
                />
              </label>
              <label className="field-block">
                <span>上传文件</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".txt,.md,.markdown,.pdf,.docx,.xlsx,.xls,.csv,.json,.xml,.yaml,.yml"
                  onChange={(e: ChangeEvent<HTMLInputElement>) => updateLibraryPendingFiles(e.target.files)}
                />
              </label>
              {libraryPendingFiles.length ? (
                <div className="library-selected-files">
                  {libraryPendingFiles.map((file) => (
                    <span key={`${file.name}-${file.size}`}>{file.name}</span>
                  ))}
                </div>
              ) : null}
              {libraryProgress ? (
                <div className={`library-progress-card ${libraryProgress.status}`}>
                  <div className="library-progress-head">
                    <strong>{libraryProgress.message}</strong>
                    <span>{libraryProgress.progress}%</span>
                  </div>
                  <div className="library-progress-bar">
                    <span style={{ width: `${libraryProgress.progress}%` }} />
                  </div>
                  {libraryProgress.error ? <p>{libraryProgress.error}</p> : null}
                </div>
              ) : null}
              <button className="panel-button" type="button" disabled={librarySaving} onClick={() => void saveKnowledgeBaseDraft()}>
                {librarySaving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        ) : null}

        {libraryPage === "detail" && selectedLibraryKnowledgeBase ? (
          <div className="library-page-shell">
            <div className="stack-form">
              <div className="library-detail-actions library-detail-actions-top">
                <button
                  type="button"
                  className={selectedLibraryKnowledgeBase.enabled ? "library-enable-toggle active" : "library-enable-toggle"}
                  onClick={() =>
                    void toggleKnowledgeBaseEnabled(
                      selectedLibraryKnowledgeBase.id,
                      !selectedLibraryKnowledgeBase.enabled
                    )
                  }
                >
                  {selectedLibraryKnowledgeBase.enabled ? "已启用" : "未启用"}
                </button>
              </div>

              <label className="field-block">
                <span>知识库名称</span>
                <input
                  value={libraryDraftName}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setLibraryDraftName(e.target.value)}
                />
              </label>
              <label className="field-block">
                <span>知识库描述</span>
                <textarea
                  rows={4}
                  value={libraryDraftDescription}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setLibraryDraftDescription(e.target.value)}
                />
              </label>

              <label className="field-block">
                <span>追加文件</span>
                <div className="library-file-picker">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".txt,.md,.markdown,.pdf,.docx,.xlsx,.xls,.csv,.json,.xml,.yaml,.yml"
                    onChange={(e: ChangeEvent<HTMLInputElement>) => updateLibraryPendingFiles(e.target.files)}
                  />
                </div>
              </label>
              {libraryPendingFiles.length ? (
                <div className="library-selected-files">
                  {libraryPendingFiles.map((file) => (
                    <span key={`${file.name}-${file.size}`}>{file.name}</span>
                  ))}
                </div>
              ) : null}
              {libraryProgress ? (
                <div className={`library-progress-card ${libraryProgress.status}`}>
                  <div className="library-progress-head">
                    <strong>{libraryProgress.message}</strong>
                    <span>{libraryProgress.progress}%</span>
                  </div>
                  <div className="library-progress-bar">
                    <span style={{ width: `${libraryProgress.progress}%` }} />
                  </div>
                  {libraryProgress.error ? <p>{libraryProgress.error}</p> : null}
                </div>
              ) : null}
              <button className="panel-button" type="button" disabled={librarySaving} onClick={() => void saveKnowledgeBaseDraft()}>
                {librarySaving ? "保存中..." : "保存"}
              </button>
            </div>

            <div className="library-document-list">
              {selectedLibraryKnowledgeBase.documents.map((document) => (
                <div key={document.id} className="library-document-item">
                  <div className="library-document-copy">
                    <strong title={document.fileName}>{document.fileName}</strong>
                    <span>上传时间：{formatConversationListTime(document.uploadedAt)}</span>
                    <span className="library-document-inline-meta">
                      <span>片段数量：{document.chunkCount ?? 0}</span>
                      <span>解析：{formatVectorizationStatus(document.vectorizationStatus)}</span>
                    </span>
                  </div>
                  <button
                    type="button"
                    className="library-document-delete"
                    title="删除文件"
                    aria-label="删除文件"
                    onClick={() => void removeKnowledgeDocument(selectedLibraryKnowledgeBase.id, document.id)}
                  >
                    ⌫
                  </button>
                </div>
              ))}
            </div>
            {/* <div className="library-card-summary"> */}
            <div className="library-detail-meta">
              <span className="library-card-summary-line">
                <span>更新时间：{formatConversationListTime(selectedLibraryKnowledgeBase.updatedAt)}</span>
              </span> 
              <span className="library-card-summary-line">
                <span>{selectedLibraryKnowledgeBase.documents.length} 个文件</span>
                <span>{selectedLibraryKnowledgeBase.chunks.length} 个片段</span>
                {/* <span>状态：{formatVectorizationStatus(selectedLibraryKnowledgeBase.vectorizationStatus)}</span> */}
              </span>
            </div>
            <div className="library-detail-delete-row">
              <button
                type="button"
                className="panel-button secondary library-danger-inline"
                onClick={() => void removeKnowledgeBase(selectedLibraryKnowledgeBase.id)}
              >
                删除
              </button>
            </div>
          </div>
        ) : null}
      </aside>
    </main>
  );
}
