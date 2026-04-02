import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { getLatestChatLogDirectoryPath } from "@/lib/logger";

const execFileAsync = promisify(execFile);

export async function POST() {
  const logDirectoryPath = await getLatestChatLogDirectoryPath();

  try {
    await mkdir(logDirectoryPath, { recursive: true });

    if (process.platform === "darwin") {
      await execFileAsync("open", [logDirectoryPath]);
    } else if (process.platform === "win32") {
      await execFileAsync("cmd", ["/c", "start", "", logDirectoryPath]);
    } else {
      await execFileAsync("xdg-open", [logDirectoryPath]);
    }

    return NextResponse.json({
      ok: true,
      path: logDirectoryPath
    });
  } catch (error) {
    return new NextResponse(error instanceof Error ? error.message : "打开日志文件夹失败", { status: 500 });
  }
}
