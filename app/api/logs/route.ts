import { NextResponse } from "next/server";
import { getLatestChatLogDirectoryPath, readChatLogFile } from "@/lib/logger";

export async function GET() {
  const content = await readChatLogFile();
  const directoryPath = await getLatestChatLogDirectoryPath();
  return new NextResponse(content || "日志文件为空。\n", {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Log-Directory-Path": directoryPath
    }
  });
}
