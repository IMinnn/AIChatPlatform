import { clampText, createId } from "@/lib/utils";
import { KnowledgeBase, KnowledgeChunk, KnowledgeDocument } from "@/lib/types";

const VECTOR_SIZE = 128;

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/u)
    .filter(Boolean);
}

function embedText(text: string) {
  const vector = new Array<number>(VECTOR_SIZE).fill(0);
  for (const token of tokenize(text)) {
    let hash = 0;
    for (let i = 0; i < token.length; i += 1) {
      hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
    }
    vector[hash % VECTOR_SIZE] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

function cosineSimilarity(a: number[], b: number[]) {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    sum += a[i] * b[i];
  }
  return sum;
}

export function chunkDocument(document: KnowledgeDocument): KnowledgeChunk[] {
  const clean = clampText(document.content, 60000);
  const size = 700;
  const overlap = 120;
  const chunks: KnowledgeChunk[] = [];

  for (let start = 0; start < clean.length; start += size - overlap) {
    const text = clean.slice(start, start + size).trim();
    if (!text) {
      continue;
    }
    chunks.push({
      id: createId("chunk"),
      documentId: document.id,
      text,
      embedding: embedText(text)
    });
  }

  return chunks;
}

export function rebuildKnowledgeBase(kb: KnowledgeBase): KnowledgeBase {
  const vectorizedAt = new Date().toISOString();
  const documentChunks = kb.documents.map((document) => {
    const chunks = chunkDocument(document);
    return {
      document: {
        ...document,
        chunkCount: chunks.length,
        vectorizationStatus: "completed" as const,
        vectorizationError: null,
        vectorizedAt
      },
      chunks
    };
  });
  const nextDocuments = documentChunks.map((item) => item.document);
  const chunks = documentChunks.flatMap((item) => item.chunks);
  return {
    ...kb,
    documents: nextDocuments,
    chunks,
    vectorizationStatus: nextDocuments.length ? "completed" : "idle",
    vectorizationProgress: nextDocuments.length ? 100 : 0,
    vectorizationError: null,
    vectorizedAt: nextDocuments.length ? vectorizedAt : kb.vectorizedAt ?? null,
    updatedAt: new Date().toISOString()
  };
}

export function searchKnowledgeBase(kb: KnowledgeBase, query: string, limit = 5) {
  const queryEmbedding = embedText(query);
  const scoredChunks = kb.chunks
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const documentNameMap = new Map(kb.documents.map((document) => [document.id, document.fileName]));
  const groupedByDocument = new Map<
    string,
    Array<{
      chunk: KnowledgeChunk;
      score: number;
    }>
  >();

  scoredChunks.forEach((item) => {
    const items = groupedByDocument.get(item.chunk.documentId) ?? [];
    items.push(item);
    groupedByDocument.set(item.chunk.documentId, items);
  });

  const rankedDocuments = Array.from(groupedByDocument.entries()).sort((left, right) => {
    return (right[1][0]?.score ?? 0) - (left[1][0]?.score ?? 0);
  });

  const selected: Array<{
    chunk: KnowledgeChunk;
    score: number;
  }> = [];
  let round = 0;

  while (selected.length < limit) {
    let pickedInRound = false;
    rankedDocuments.forEach(([, items]) => {
      const candidate = items[round];
      if (!candidate || selected.length >= limit) {
        return;
      }
      selected.push(candidate);
      pickedInRound = true;
    });

    if (!pickedInRound) {
      break;
    }
    round += 1;
  }

  return selected.map((item) => {
    const fileName = documentNameMap.get(item.chunk.documentId);
    return fileName ? `[文件：${fileName}]\n${item.chunk.text}` : item.chunk.text;
  });
}
