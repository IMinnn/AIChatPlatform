import { NextResponse } from "next/server";
import { updateState } from "@/lib/fs-db";
import { rebuildKnowledgeBase } from "@/lib/rag";
import { KnowledgeBase } from "@/lib/types";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let updated: KnowledgeBase | null = null;

  await updateState((state) => {
    const knowledgeBases = state.knowledgeBases.map((kb) => {
      if (kb.id !== id) {
        return kb;
      }
      const nextKnowledgeBase: KnowledgeBase = rebuildKnowledgeBase(kb);
      updated = nextKnowledgeBase;
      return nextKnowledgeBase;
    });
    return { ...state, knowledgeBases };
  });

  if (!updated) {
    return new NextResponse("Knowledge base not found", { status: 404 });
  }
  return NextResponse.json(updated);
}
