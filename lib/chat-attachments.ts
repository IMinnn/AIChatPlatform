import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatAttachment, ChatMessage } from "@/lib/types";
import { createId } from "@/lib/utils";

const attachmentDir = path.join(process.cwd(), "public", "uploads", "chat-attachments");
const maxExtractedTextLength = 24000;

type ModelContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function getFileExtension(name: string, mimeType: string) {
  const ext = path.extname(name).trim();
  if (ext) {
    return ext;
  }
  if (mimeType === "image/png") {
    return ".png";
  }
  if (mimeType === "image/jpeg") {
    return ".jpg";
  }
  if (mimeType === "image/webp") {
    return ".webp";
  }
  if (mimeType === "image/gif") {
    return ".gif";
  }
  if (mimeType === "application/pdf") {
    return ".pdf";
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return ".docx";
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return ".xlsx";
  }
  return ".bin";
}

function truncateExtractedText(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= maxExtractedTextLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxExtractedTextLength)}\n\n[内容过长，已截断]`;
}

function looksLikeTextFile(fileName: string, mimeType: string) {
  const lowerName = fileName.toLowerCase();
  return (
    mimeType.startsWith("text/") ||
    [
      ".txt",
      ".md",
      ".markdown",
      ".csv",
      ".json",
      ".xml",
      ".yaml",
      ".yml",
      ".log",
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".py",
      ".java",
      ".go",
      ".rs",
      ".sql",
      ".html",
      ".css"
    ].some((ext) => lowerName.endsWith(ext))
  );
}

async function ensureAttachmentDir() {
  await mkdir(attachmentDir, { recursive: true });
}

async function extractSpreadsheetText(buffer: Buffer) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(sheet, {
      header: 1,
      raw: false
    }) as Array<Array<string | number | boolean | null>>;
    const body = rows
      .map((row) => row.map((cell) => String(cell ?? "")).join("\t"))
      .join("\n")
      .trim();
    return `[工作表: ${sheetName}]\n${body}`;
  })
    .filter(Boolean)
    .join("\n\n");
}

export async function extractAttachmentText(fileName: string, mimeType: string, buffer: Buffer) {
  const lowerName = fileName.toLowerCase();
  if (looksLikeTextFile(fileName, mimeType)) {
    return buffer.toString("utf8");
  }
  if (mimeType === "application/pdf" || lowerName.endsWith(".pdf")) {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      return parsed.text;
    } finally {
      await parser.destroy();
    }
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lowerName.endsWith(".docx")
  ) {
    const mammoth = await import("mammoth");
    const parsed = await mammoth.extractRawText({ buffer });
    return parsed.value;
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel" ||
    lowerName.endsWith(".xlsx") ||
    lowerName.endsWith(".xls")
  ) {
    return await extractSpreadsheetText(buffer);
  }
  return "";
}

export async function createChatAttachment(file: File): Promise<ChatAttachment> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName = file.name || "未命名文件";
  const mimeType = file.type || "application/octet-stream";
  const attachmentId = createId("att");

  if (mimeType.startsWith("image/")) {
    await ensureAttachmentDir();
    const extension = getFileExtension(fileName, mimeType);
    const savedName = `${attachmentId}${extension}`;
    const storedPath = path.join(attachmentDir, savedName);
    await writeFile(storedPath, buffer);
    return {
      id: attachmentId,
      fileName,
      mimeType,
      size: file.size,
      kind: "image",
      previewUrl: `/uploads/chat-attachments/${savedName}`,
      storedPath
    };
  }

  const extractedText = truncateExtractedText(await extractAttachmentText(fileName, mimeType, buffer));
  if (!extractedText) {
    throw new Error(`暂不支持解析文件：${fileName}`);
  }

  return {
    id: attachmentId,
    fileName,
    mimeType,
    size: file.size,
    kind: "text",
    extractedText
  };
}

export async function buildMessageInputContent(message: Pick<ChatMessage, "content" | "attachments">) {
  const attachments = message.attachments ?? [];
  const textSegments = [message.content.trim()].filter(Boolean);
  const imageAttachments = attachments.filter((attachment) => attachment.kind === "image" && attachment.storedPath);

  for (const attachment of attachments) {
    if (attachment.kind === "text" && attachment.extractedText) {
      textSegments.push(`[附件：${attachment.fileName}]\n${attachment.extractedText}`);
    }
  }

  const combinedText = textSegments.join("\n\n").trim();
  if (!imageAttachments.length) {
    return combinedText;
  }

  const parts: ModelContentPart[] = [
    {
      type: "text",
      text: combinedText || `请结合以下图片附件理解用户输入：${imageAttachments.map((item) => item.fileName).join("、")}`
    }
  ];

  for (const attachment of imageAttachments) {
    const fileBuffer = await readFile(attachment.storedPath!);
    const dataUrl = `data:${attachment.mimeType};base64,${fileBuffer.toString("base64")}`;
    parts.push({
      type: "image_url",
      image_url: {
        url: dataUrl
      }
    });
  }

  return parts;
}
