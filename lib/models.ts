import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createId } from "@/lib/utils";
import { ModelConfig, ModelProviderConfig, PublicModelConfig } from "@/lib/types";

const modelFile = path.join(process.cwd(), "data", "models.json");

interface ModelsFile {
  providers: ModelProviderConfig[];
}

type LegacyModelsFile = Array<{
  id: string;
  name: string;
  apiUrl: string;
  token: string;
  provider: string;
  enabled: boolean;
}>;

function normalizeProviderName(name: string) {
  return name.trim() || "未命名供应商";
}

function inferProviderKind(kind?: string, name?: string, apiUrl?: string) {
  if (kind === "ollama" || /ollama/i.test(name ?? "") || /11434/.test(apiUrl ?? "")) {
    return "ollama" as const;
  }
  if (kind === "custom") {
    return "custom" as const;
  }
  return "openai-compatible" as const;
}

function migrateLegacyModels(legacy: LegacyModelsFile): ModelsFile {
  const providerMap = new Map<string, ModelProviderConfig>();

  for (const model of legacy) {
    const providerName = normalizeProviderName(model.provider);
    const existing = providerMap.get(providerName);
    if (existing) {
      existing.models.push({
        id: model.id,
        name: model.name,
        apiUrl: model.apiUrl,
        token: model.token,
        enabled: model.enabled
      });
      continue;
    }

    providerMap.set(providerName, {
      id: createId("provider"),
      name: providerName,
      kind: inferProviderKind(undefined, providerName, model.apiUrl),
      models: [
        {
          id: model.id,
          name: model.name,
          apiUrl: model.apiUrl,
          token: model.token,
          enabled: model.enabled
        }
      ]
    });
  }

  return {
    providers: [...providerMap.values()]
  };
}

function sanitizeProviders(providers: ModelProviderConfig[]) {
  return providers.map((provider) => ({
    id: provider.id || createId("provider"),
    name: normalizeProviderName(provider.name),
    kind: inferProviderKind(provider.kind, provider.name),
    models: provider.models.map((model) => ({
      id: model.id.trim(),
      name: model.name.trim() || model.id.trim(),
      apiUrl: model.apiUrl.trim(),
      token: model.token,
      enabled: Boolean(model.enabled)
    }))
  }));
}

async function readRawModelsFile() {
  const raw = await readFile(modelFile, "utf8");
  return JSON.parse(raw) as ModelsFile | LegacyModelsFile;
}

export async function getModelProviders(): Promise<ModelProviderConfig[]> {
  const parsed = await readRawModelsFile();

  if (Array.isArray(parsed)) {
    const migrated = migrateLegacyModels(parsed);
    await writeModelProviders(migrated.providers);
    return migrated.providers;
  }

  const providers = sanitizeProviders(parsed.providers ?? []);
  return providers;
}

export async function writeModelProviders(providers: ModelProviderConfig[]) {
  const next: ModelsFile = {
    providers: sanitizeProviders(providers)
  };
  await writeFile(modelFile, JSON.stringify(next, null, 2), "utf8");
  return next.providers;
}

export async function getModels(): Promise<ModelConfig[]> {
  const providers = await getModelProviders();
  return providers.flatMap((provider) =>
    provider.models.map((model) => ({
      providerId: provider.id,
      id: model.id,
      name: model.name,
      apiUrl: model.apiUrl,
      token: model.token,
      provider: provider.name,
      providerKind: provider.kind,
      enabled: model.enabled
    }))
  );
}

export async function getEnabledModels() {
  const models = await getModels();
  return models.filter((model) => model.enabled);
}

export async function getModelById(id: string) {
  const models = await getModels();
  return models.find((model) => model.id === id);
}

export async function getPublicModels(): Promise<PublicModelConfig[]> {
  const models = await getEnabledModels();
  return models.map(({ providerId, id, name, provider, providerKind, enabled }) => ({
    providerId,
    id,
    name,
    provider,
    providerKind,
    enabled
  }));
}

export async function getPreferredModelId(preferredId?: string | null) {
  const enabledModels = await getEnabledModels();
  if (!enabledModels.length) {
    return preferredId ?? "";
  }
  const matched = enabledModels.find((model) => model.id === preferredId);
  return matched?.id ?? enabledModels[0].id;
}

export async function getPreferredModel(preferredId?: string | null) {
  const enabledModels = await getEnabledModels();
  if (!enabledModels.length) {
    return null;
  }
  return enabledModels.find((model) => model.id === preferredId) ?? enabledModels[0];
}

export function normalizeChatCompletionsUrl(apiUrl: string) {
  const trimmed = apiUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}
