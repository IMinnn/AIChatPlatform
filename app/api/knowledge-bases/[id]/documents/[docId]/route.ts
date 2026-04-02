import { unlink } from "node:fs/promises";
import { NextResponse } from "next/server";
import { updateState } from "@/lib/fs-db";
import { rebuildKnowledgeBase } from "@/lib/rag";
import { KnowledgeBase } from "@/lib/types";

export async function DELETE(
  _: Request,
  context: { params: Promise<{ id: string; docId: string }> }
) {
  const { id, docId } = await context.params;

  let foundKnowledgeBase = false;
  let foundDocument = false;

  await updateState((state) => {
    const knowledgeBases = state.knowledgeBases.map((kb) => {
      if (kb.id !== id) {
        return kb;
      }
      foundKnowledgeBase = true;
      const document = kb.documents.find((item) => item.id === docId);
      if (!document) {
        return kb;
      }
      foundDocument = true;
      if (document.storedPath) {
        void unlink(document.storedPath).catch(() => {
          // Ignore missing file cleanup failures.
        });
      }
      const nextKnowledgeBase: KnowledgeBase = rebuildKnowledgeBase({
        ...kb,
        documents: kb.documents.filter((item) => item.id !== docId)
      });
      return nextKnowledgeBase;
    });
    return { ...state, knowledgeBases };
  });

  if (!foundKnowledgeBase) {
    return new NextResponse("Knowledge base not found", { status: 404 });
  }
  if (!foundDocument) {
    return new NextResponse("Knowledge document not found", { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
