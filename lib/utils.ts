export function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function pickTitle(text: string) {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.slice(0, 24) || "新对话";
}

export function clampText(text: string, max = 6000) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
