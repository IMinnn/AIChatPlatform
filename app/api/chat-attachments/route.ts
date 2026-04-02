import { NextResponse } from "next/server";
import { createChatAttachment } from "@/lib/chat-attachments";
import { appendSystemLog } from "@/lib/system-logger";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData();
  const fileEntries = formData.getAll("files");
  const files = fileEntries.filter((entry): entry is File => entry instanceof File);

  if (!files.length) {
    return new NextResponse("请至少上传一个文件", { status: 400 });
  }

  try {
    await appendSystemLog({
      category: "chat-attachments",
      level: "info",
      message: "开始处理聊天附件上传",
      details: files.map((file) => `- ${file.name} (${file.type || "unknown"}, ${file.size} bytes)`).join("\n")
    });
    const attachments = await Promise.all(files.map((file) => createChatAttachment(file)));
    await appendSystemLog({
      category: "chat-attachments",
      level: "info",
      message: "聊天附件上传处理成功",
      details: attachments
        .map((attachment) => `- ${attachment.fileName} -> ${attachment.kind}${attachment.extractedText ? " [text]" : ""}`)
        .join("\n")
    });
    return NextResponse.json(attachments);
  } catch (error) {
    await appendSystemLog({
      category: "chat-attachments",
      level: "error",
      message: "聊天附件上传处理失败",
      details: error instanceof Error ? error.stack || error.message : "未知错误"
    });
    return new NextResponse(error instanceof Error ? error.message : "文件解析失败", { status: 400 });
  }
}
