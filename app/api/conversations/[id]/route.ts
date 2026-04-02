import { NextResponse } from "next/server";
import { readState, updateState } from "@/lib/fs-db";
import { ChatMessage, Conversation } from "@/lib/types";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const state = await readState();
  const conversation = state.conversations.find((item) => item.id === id);
  if (!conversation) {
    return new NextResponse("Conversation not found", { status: 404 });
  }
  return NextResponse.json(conversation);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json()) as {
    title?: string;
    modelId?: string;
    knowledgeBaseId?: string | null;
    messages?: ChatMessage[];
  };

  let updated: Conversation | null = null;
  await updateState((state) => {
    const conversations = state.conversations.map((conversation) => {
      if (conversation.id !== id) {
        return conversation;
      }
      const nextConversation: Conversation = {
        ...conversation,
        title: body.title ?? conversation.title,
        modelId: body.modelId ?? conversation.modelId,
        knowledgeBaseId:
          body.knowledgeBaseId === undefined ? conversation.knowledgeBaseId : body.knowledgeBaseId,
        messages: body.messages ?? conversation.messages,
        updatedAt: new Date().toISOString()
      };
      updated = nextConversation;
      return nextConversation;
    });
    return { ...state, conversations };
  });

  if (!updated) {
    return new NextResponse("Conversation not found", { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  await updateState((state) => ({
    ...state,
    conversations: state.conversations.filter((conversation) => conversation.id !== id)
  }));
  return NextResponse.json({ ok: true });
}
