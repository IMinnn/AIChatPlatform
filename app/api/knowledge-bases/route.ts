import { NextResponse } from "next/server";
import { readState, sortKnowledgeBases, updateState } from "@/lib/fs-db";
import { createId, nowIso } from "@/lib/utils";
import { KnowledgeBase } from "@/lib/types";

export async function GET() {
  const state = await readState();
  return NextResponse.json(sortKnowledgeBases(state.knowledgeBases));
}

export async function POST(request: Request) {
  const body = (await request.json()) as { name?: string; description?: string };
  if (!body.name?.trim()) {
    return new NextResponse("Knowledge base name is required", { status: 400 });
  }
  const now = nowIso();
  const kb: KnowledgeBase = {
    id: createId("kb"),
    name: body.name.trim(),
    description: body.description?.trim() ?? "",
    enabled: false,
    createdAt: now,
    updatedAt: now,
    vectorizationStatus: "idle",
    vectorizationProgress: 0,
    vectorizationError: null,
    vectorizedAt: null,
    documents: [],
    chunks: []
  };

  await updateState((state) => ({
    ...state,
    knowledgeBases: [kb, ...state.knowledgeBases]
  }));

  return NextResponse.json(kb);
}
