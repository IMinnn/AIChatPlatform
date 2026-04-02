export type ChatRole = "system" | "user" | "assistant";

export interface ChatAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  kind: "text" | "image";
  extractedText?: string;
  previewUrl?: string;
  storedPath?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  reasoning?: string;
  attachments?: ChatAttachment[];
  createdAt: string;
}

export interface TokenUsageBreakdown {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheCreationTokens: number;
  cacheHitTokens: number;
  source: "provider" | "estimated";
}

export interface TokenPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheCreationPerMillion: number;
  cacheHitPerMillion: number;
}

export interface TokenUsageRecord {
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
  usage: TokenUsageBreakdown;
}

export interface Conversation {
  id: string;
  title: string;
  modelId: string;
  knowledgeBaseId: string | null;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface Settings {
  assistantName: string;
  userName: string;
  userAvatar: string;
  assistantStyle: string;
  sharedMemory: boolean;
  defaultModelId: string;
  tokenPricing: TokenPricing;
}

export interface ModelConfig {
  providerId: string;
  id: string;
  name: string;
  apiUrl: string;
  token: string;
  provider: string;
  providerKind: "openai-compatible" | "ollama" | "custom";
  enabled: boolean;
}

export interface PublicModelConfig {
  providerId: string;
  id: string;
  name: string;
  provider: string;
  providerKind: "openai-compatible" | "ollama" | "custom";
  enabled: boolean;
}

export interface ProviderModelConfig {
  id: string;
  name: string;
  apiUrl: string;
  token: string;
  enabled: boolean;
}

export interface ModelProviderConfig {
  id: string;
  name: string;
  kind: "openai-compatible" | "ollama" | "custom";
  models: ProviderModelConfig[];
}

export interface KnowledgeDocument {
  id: string;
  fileName: string;
  mimeType: string;
  content: string;
  uploadedAt: string;
  storedPath?: string;
  chunkCount?: number;
  vectorizationStatus?: "idle" | "processing" | "completed" | "failed";
  vectorizationError?: string | null;
  vectorizedAt?: string | null;
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  text: string;
  embedding: number[];
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  vectorizationStatus?: "idle" | "processing" | "completed" | "failed";
  vectorizationProgress?: number;
  vectorizationError?: string | null;
  vectorizedAt?: string | null;
  documents: KnowledgeDocument[];
  chunks: KnowledgeChunk[];
}

export interface AppState {
  settings: Settings;
  conversations: Conversation[];
  knowledgeBases: KnowledgeBase[];
  usageRecords: TokenUsageRecord[];
}
