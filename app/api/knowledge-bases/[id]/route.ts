import { NextResponse } from "next/server";
import { readState, updateState } from "@/lib/fs-db";
import { KnowledgeBase } from "@/lib/types";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    enabled?: boolean;
  };

  let updated: KnowledgeBase | null = null;
  await updateState((state) => {
    const knowledgeBases = state.knowledgeBases.map((kb) => {
      if (kb.id !== id) {
        return kb;
      }
      const nextKb: KnowledgeBase = {
        ...kb,
        name: body.name?.trim() ? body.name.trim() : kb.name,
        description: body.description === undefined ? kb.description : body.description.trim(),
        enabled: body.enabled === undefined ? kb.enabled : body.enabled,
        updatedAt: new Date().toISOString()
      };
      updated = nextKb;
      return nextKb;
    });
    return { ...state, knowledgeBases };
  });

  if (!updated) {
    return new NextResponse("Knowledge base not found", { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const state = await readState();
  const exists = state.knowledgeBases.some((kb) => kb.id === id);
  if (!exists) {
    return new NextResponse("Knowledge base not found", { status: 404 });
  }

  await updateState((current) => ({
    ...current,
    conversations: current.conversations.map((conversation) =>
      conversation.knowledgeBaseId === id ? { ...conversation, knowledgeBaseId: null } : conversation
    ),
    knowledgeBases: current.knowledgeBases.filter((kb) => kb.id !== id)
  }));

  return NextResponse.json({ ok: true });
}
