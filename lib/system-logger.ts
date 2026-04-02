import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const storageDir = path.join(process.cwd(), "storage");
const systemLogDir = path.join(storageDir, "system-logs");

export type SystemLogLevel = "info" | "error";

export interface SystemLogEntry {
  category: string;
  level: SystemLogLevel;
  message: string;
  details?: string;
}

async function ensureSystemLogDir() {
  await mkdir(systemLogDir, { recursive: true });
}

function getSystemLogFileName() {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `system_${year}${month}${day}.log`;
}

function renderSystemLog(entry: SystemLogEntry) {
  return [
    `[${new Date().toISOString()}] [${entry.level.toUpperCase()}] [${entry.category}] ${entry.message}`,
    entry.details ? entry.details : null,
    ""
  ]
    .filter(Boolean)
    .join("\n");
}

export async function appendSystemLog(entry: SystemLogEntry) {
  await ensureSystemLogDir();
  const filePath = path.join(systemLogDir, getSystemLogFileName());
  await appendFile(filePath, `${renderSystemLog(entry)}\n`, "utf8");
  return filePath;
}

export function getSystemLogDirectoryPath() {
  return systemLogDir;
}

