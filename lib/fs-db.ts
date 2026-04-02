import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppState, Conversation, KnowledgeBase, Settings, TokenPricing } from "@/lib/types";
import { recoverStateFromLogs } from "@/lib/state-recovery";

const storageDir = path.join(process.cwd(), "storage");
const stateFile = path.join(storageDir, "app-state.json");
const backupStateFile = path.join(storageDir, "app-state.backup.json");

const defaultTokenPricing: TokenPricing = {
  inputPerMillion: 0,
  outputPerMillion: 0,
  cacheCreationPerMillion: 0,
  cacheHitPerMillion: 0
};

const defaultSettings: Settings = {
  assistantName: "Nova",
  userName: "我",
  userAvatar: "",
  assistantStyle: "冷静、专业、友好，回答要有条理，必要时主动给出下一步建议。",
  sharedMemory: false,
  defaultModelId: "",
  tokenPricing: defaultTokenPricing
};

const defaultState: AppState = {
  settings: defaultSettings,
  conversations: [],
  knowledgeBases: [],
  usageRecords: []
};

async function ensureStorage() {
  await mkdir(storageDir, { recursive: true });
}

function normalizeState(parsed: Partial<AppState>): AppState {
  const rawTokenPricing = parsed.settings?.tokenPricing;
  return {
    settings: {
      ...defaultSettings,
      ...parsed.settings,
      tokenPricing: {
        ...defaultTokenPricing,
        ...rawTokenPricing,
        inputPerMillion:
          rawTokenPricing?.inputPerMillion ?? defaultTokenPricing.inputPerMillion,
        outputPerMillion:
          rawTokenPricing?.outputPerMillion ?? defaultTokenPricing.outputPerMillion,
        cacheCreationPerMillion:
          rawTokenPricing?.cacheCreationPerMillion ??
          // backward compatibility
          (parsed.settings as Partial<Settings> & { tokenPricing?: { reasoningPerMillion?: number } })?.tokenPricing
            ?.reasoningPerMillion ??
          defaultTokenPricing.cacheCreationPerMillion,
        cacheHitPerMillion:
          rawTokenPricing?.cacheHitPerMillion ??
          // backward compatibility
          (parsed.settings as Partial<Settings> & { tokenPricing?: { cachedInputPerMillion?: number } })?.tokenPricing
            ?.cachedInputPerMillion ??
          defaultTokenPricing.cacheHitPerMillion
      }
    },
    conversations: parsed.conversations ?? [],
    knowledgeBases: (parsed.knowledgeBases ?? []).map((kb) => ({
      ...kb,
      enabled: kb.enabled ?? false,
      vectorizationStatus: kb.vectorizationStatus ?? (kb.documents?.length ? "completed" : "idle"),
      vectorizationProgress: kb.vectorizationProgress ?? (kb.documents?.length ? 100 : 0),
      vectorizationError: kb.vectorizationError ?? null,
      vectorizedAt: kb.vectorizedAt ?? null,
      documents: (kb.documents ?? []).map((document) => ({
        ...document,
        chunkCount:
          document.chunkCount ??
          (kb.chunks ?? []).filter((chunk) => chunk.documentId === document.id).length,
        vectorizationStatus: document.vectorizationStatus ?? "completed",
        vectorizationError: document.vectorizationError ?? null,
        vectorizedAt: document.vectorizedAt ?? kb.vectorizedAt ?? null
      }))
    })),
    usageRecords: parsed.usageRecords ?? []
  };
}

export async function readState(): Promise<AppState> {
  await ensureStorage();
  try {
    const raw = await readFile(stateFile, "utf8");
    const nextState = normalizeState(JSON.parse(raw) as Partial<AppState>);
    if (!nextState.conversations.length && !nextState.usageRecords.length) {
      const recovered = await recoverStateFromLogs(nextState.settings);
      if (recovered) {
        await writeState(recovered);
        return recovered;
      }
    }
    return nextState;
  } catch {
    try {
      const backupRaw = await readFile(backupStateFile, "utf8");
      const recovered = normalizeState(JSON.parse(backupRaw) as Partial<AppState>);
      await writeState(recovered);
      return recovered;
    } catch {
      const recoveredFromLogs = await recoverStateFromLogs(defaultSettings);
      if (recoveredFromLogs) {
        await writeState(recoveredFromLogs);
        return recoveredFromLogs;
      }
      await writeState(defaultState);
      return defaultState;
    }
  }
}

export async function writeState(state: AppState) {
  await ensureStorage();
  const tempStateFile = `${stateFile}.tmp`;
  try {
    await copyFile(stateFile, backupStateFile);
  } catch {
    // Ignore missing previous state on first write.
  }
  await writeFile(tempStateFile, JSON.stringify(state, null, 2), "utf8");
  await rename(tempStateFile, stateFile);
}

export async function updateState(
  updater: (current: AppState) => AppState | Promise<AppState>
) {
  const current = await readState();
  const next = await updater(current);
  await writeState(next);
  return next;
}

export function sortConversations(conversations: Conversation[]) {
  return [...conversations].sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export function sortKnowledgeBases(knowledgeBases: KnowledgeBase[]) {
  return [...knowledgeBases].sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}
