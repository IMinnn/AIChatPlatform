import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { extractAttachmentText } from "@/lib/chat-attachments";
import { readState, updateState } from "@/lib/fs-db";
import { rebuildKnowledgeBase } from "@/lib/rag";
import { KnowledgeBase, KnowledgeDocument } from "@/lib/types";
import { createId, nowIso } from "@/lib/utils";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const formData = await request.formData();
    const files = formData
      .getAll("files")
      .filter((item): item is File => item instanceof File);
    const fallbackFile = formData.get("file");
    const uploadFiles =
      files.length > 0 ? files : fallbackFile instanceof File ? [fallbackFile] : [];

    if (!uploadFiles.length) {
      return new NextResponse("At least one file is required", { status: 400 });
    }

    const state = await readState();
    const kb = state.knowledgeBases.find((item) => item.id === id);
    if (!kb) {
      return new NextResponse("Knowledge base not found", { status: 404 });
    }

    await updateState((current) => ({
      ...current,
      knowledgeBases: current.knowledgeBases.map((item) =>
        item.id === id
          ? {
              ...item,
              vectorizationStatus: "processing",
              vectorizationProgress: 20,
              vectorizationError: null,
              updatedAt: nowIso()
            }
          : item
      )
    }));

    const uploadDir = path.join(process.cwd(), "uploads");
    await mkdir(uploadDir, { recursive: true });

    const documents: KnowledgeDocument[] = [];
    for (const file of uploadFiles) {
      const raw = Buffer.from(await file.arrayBuffer());
      const content = await extractAttachmentText(file.name, file.type || "application/octet-stream", raw);
      if (!content.trim()) {
        throw new Error(`暂不支持解析文件：${file.name}`);
      }
      const fileName = `${Date.now()}_${file.name}`;
      const fullPath = path.join(uploadDir, fileName);
      await writeFile(fullPath, raw);
      documents.push({
        id: createId("doc"),
        fileName: file.name,
        mimeType: file.type || "text/plain",
        content,
        uploadedAt: nowIso(),
        storedPath: fullPath,
        chunkCount: 0,
        vectorizationStatus: "processing",
        vectorizationError: null,
        vectorizedAt: null
      });
    }

    let updatedKb: KnowledgeBase | null = null;
    await updateState((current) => {
      const knowledgeBases = current.knowledgeBases.map((item) => {
        if (item.id !== id) {
          return item;
        }
        const nextKnowledgeBase: KnowledgeBase = rebuildKnowledgeBase({
          ...item,
          vectorizationStatus: "processing",
          vectorizationProgress: 80,
          vectorizationError: null,
          documents: [...item.documents, ...documents],
          updatedAt: nowIso()
        });
        updatedKb = nextKnowledgeBase;
        return nextKnowledgeBase;
      });
      return { ...current, knowledgeBases };
    });

    return NextResponse.json(updatedKb!);
  } catch (error) {
    const message = error instanceof Error ? error.message : "知识库向量化失败";
    await updateState((current) => ({
      ...current,
      knowledgeBases: current.knowledgeBases.map((item) =>
        item.id === id
          ? {
              ...item,
              vectorizationStatus: "failed",
              vectorizationProgress: 0,
              vectorizationError: message,
              updatedAt: nowIso()
            }
          : item
      )
    }));
    return new NextResponse(message, { status: 400 });
  }
}
