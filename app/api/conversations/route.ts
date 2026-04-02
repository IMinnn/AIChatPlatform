import { NextResponse } from "next/server";
import { readState, sortConversations, updateState } from "@/lib/fs-db";
import { getPreferredModelId } from "@/lib/models";
import { createId, nowIso } from "@/lib/utils";
import { Conversation } from "@/lib/types";

export async function GET() {
  const state = await readState();
  return NextResponse.json(sortConversations(state.conversations));
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    modelId?: string;
    knowledgeBaseId?: string | null;
  };
  const now = nowIso();
  const modelId = await getPreferredModelId(body.modelId);

  const conversation: Conversation = {
    id: createId("conv"),
    title: "新对话",
    modelId,
    knowledgeBaseId: body.knowledgeBaseId ?? null,
    createdAt: now,
    updatedAt: now,
    messages: []
  };

  await updateState((state) => ({
    ...state,
    conversations: [conversation, ...state.conversations]
  }));

  return NextResponse.json(conversation);
}
