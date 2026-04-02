import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const storageDir = path.join(process.cwd(), "storage");
const logDir = path.join(storageDir, "chat-logs");
const legacyLogFile = path.join(storageDir, "chat-logs.log");
const legacyTxtLogFile = path.join(storageDir, "chat-logs.txt");

export interface ChatLogTimelineItem {
  time: string;
  stage: string;
  content: string;
}

export interface ChatLogEntry {
  eventId: string;
  time: string;
  conversationId: string;
  conversationTitle: string;
  conversationTurn: number;
  userMessageId: string;
  modelId: string;
  modelName: string;
  provider: string;
  modelUrl: string;
  resolvedChatUrl: string;
  modelParameters: {
    temperature: number;
    thinkingMode: boolean;
    webSearch: boolean;
  };
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheCreationTokens: number;
    cacheHitTokens: number;
    source: "provider" | "estimated";
  };
  knowledgeBaseId: string | null;
  knowledgeBaseName: string | null;
  sharedMemoryEnabled: boolean;
  contextMemorySummary: {
    conversationMessageCount: number;
    sharedMemoryMessageCount: number;
    knowledgeChunkCount: number;
    promptMessageCount: number;
    systemPromptLength: number;
  };
  contextSummary: string;
  prompts: {
    systemPrompt: string;
    userPrompt: string;
  };
  timeline: ChatLogTimelineItem[];
  result: {
    status: "success" | "error";
    responseLength: number;
    reasoningLength: number;
    errorMessage?: string;
  };
}

async function ensureLogStorage() {
  await mkdir(logDir, { recursive: true });
}

function toLogFileName(isoTime: string) {
  const safe = isoTime.replace(/[-:.TZ]/g, "");
  return `log_${safe}.txt`;
}

function toLogDateFolderName(isoTime: string) {
  return isoTime.replace(/[-:.TZ]/g, "").slice(0, 8);
}

function getLogDateDirectoryPath(folderName: string) {
  return path.join(logDir, folderName);
}

async function ensureLogDateDirectory(isoTime: string) {
  const directoryPath = getLogDateDirectoryPath(toLogDateFolderName(isoTime));
  await mkdir(directoryPath, { recursive: true });
  return directoryPath;
}

export async function migrateHistoricalChatLogs() {
  await ensureLogStorage();
  const entries = await readdir(logDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !/^log_\d{8,}\.txt$/.test(entry.name)) {
      continue;
    }
    const folderName = entry.name.slice(4, 12);
    const targetDirectory = getLogDateDirectoryPath(folderName);
    await mkdir(targetDirectory, { recursive: true });
    await rename(path.join(logDir, entry.name), path.join(targetDirectory, entry.name));
  }
}

function renderTimeline(items: ChatLogTimelineItem[]) {
  if (!items.length) {
    return "暂无时间线记录。";
  }

  return items
    .map((item, index) => {
      return [
        `${index + 1}. [${item.time}] ${item.stage}`,
        item.content ? item.content : "无附加内容"
      ].join("\n");
    })
    .join("\n\n");
}

function renderChatLog(entry: ChatLogEntry) {
  return [
    `日志文件: ${toLogFileName(entry.time)}`,
    `日志时间: ${entry.time}`,
    "",
    "[对话信息]",
    `事件 ID: ${entry.eventId}`,
    `对话 ID: ${entry.conversationId}`,
    `对话标题: ${entry.conversationTitle}`,
    `对话轮次: 第 ${entry.conversationTurn} 轮`,
    `用户消息 ID: ${entry.userMessageId}`,
    "",
    "[模型信息]",
    `模型 ID: ${entry.modelId}`,
    `模型名称: ${entry.modelName}`,
    `服务商: ${entry.provider}`,
    `模型 URL: ${entry.modelUrl}`,
    `实际请求 URL: ${entry.resolvedChatUrl}`,
    "",
    "[模型参数]",
    `temperature: ${entry.modelParameters.temperature}`,
    `thinkingMode: ${entry.modelParameters.thinkingMode ? "true" : "false"}`,
    `webSearch: ${entry.modelParameters.webSearch ? "true" : "false"}`,
    `sharedMemory: ${entry.sharedMemoryEnabled ? "true" : "false"}`,
    `knowledgeBaseId: ${entry.knowledgeBaseId ?? "无"}`,
    `knowledgeBaseName: ${entry.knowledgeBaseName ?? "无"}`,
    "",
    "[Token 统计]",
    `source: ${entry.tokenUsage.source}`,
    `inputTokens: ${entry.tokenUsage.inputTokens}`,
    `outputTokens: ${entry.tokenUsage.outputTokens}`,
    `totalTokens: ${entry.tokenUsage.totalTokens}`,
    `cacheCreationTokens: ${entry.tokenUsage.cacheCreationTokens}`,
    `cacheHitTokens: ${entry.tokenUsage.cacheHitTokens}`,
    "",
    "[系统提示词]",
    entry.prompts.systemPrompt || "无",
    "",
    "[用户本次输入]",
    entry.prompts.userPrompt || "无",
    "",
    "[上下文摘要]",
    entry.contextSummary,
    "",
    "[上下文统计]",
    `当前对话历史消息数: ${entry.contextMemorySummary.conversationMessageCount}`,
    `共享记忆注入数: ${entry.contextMemorySummary.sharedMemoryMessageCount}`,
    `知识库命中片段数: ${entry.contextMemorySummary.knowledgeChunkCount}`,
    `发送给模型的消息总数: ${entry.contextMemorySummary.promptMessageCount}`,
    `系统提示词长度: ${entry.contextMemorySummary.systemPromptLength}`,
    "",
    "[时间线]",
    renderTimeline(entry.timeline),
    "",
    "[结果统计]",
    `状态: ${entry.result.status}`,
    `正文长度: ${entry.result.responseLength}`,
    `思考长度: ${entry.result.reasoningLength}`,
    `错误信息: ${entry.result.errorMessage ?? "无"}`
  ].join("\n");
}

export async function appendChatLog(entry: ChatLogEntry) {
  await migrateHistoricalChatLogs();
  const directoryPath = await ensureLogDateDirectory(entry.time);
  const filePath = path.join(directoryPath, toLogFileName(entry.time));
  await writeFile(filePath, renderChatLog(entry), "utf8");
  return filePath;
}

async function getLatestLogFilePath() {
  await migrateHistoricalChatLogs();
  const latestDirectoryPath = await getLatestChatLogDirectoryPath();
  if (latestDirectoryPath) {
    const names = (await readdir(latestDirectoryPath)).filter((name) => name.endsWith(".txt")).sort().reverse();
    if (names.length) {
      return path.join(latestDirectoryPath, names[0]);
    }
  }
  return null;
}

export async function readChatLogFile() {
  await migrateHistoricalChatLogs();
  const latestFilePath = await getLatestLogFilePath();
  if (latestFilePath) {
    return await readFile(latestFilePath, "utf8");
  }

  for (const legacyPath of [legacyTxtLogFile, legacyLogFile]) {
    try {
      return await readFile(legacyPath, "utf8");
    } catch {
      continue;
    }
  }

  return "";
}

export function getChatLogFilePath() {
  const isoTime = new Date().toISOString();
  return path.join(getLogDateDirectoryPath(toLogDateFolderName(isoTime)), toLogFileName(isoTime));
}

export function getChatLogDirectoryPath() {
  return logDir;
}

export async function getLatestChatLogDirectoryPath() {
  await migrateHistoricalChatLogs();
  const entries = await readdir(logDir, { withFileTypes: true });
  const datedDirectories = entries
    .filter((entry) => entry.isDirectory() && /^\d{8}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  if (datedDirectories.length) {
    return getLogDateDirectoryPath(datedDirectories[0]);
  }

  return logDir;
}
