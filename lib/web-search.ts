export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export async function searchWeb(query: string, limit = 5): Promise<WebSearchResult[]> {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 AIPlatform/1.0"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`联网搜索失败：${response.status}`);
  }

  const html = await response.text();
  const matches = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];

  return matches.slice(0, limit).map((match) => ({
    url: decodeHtml(match[1]).trim(),
    title: decodeHtml(match[2].replace(/<[^>]+>/g, "")).trim(),
    snippet: decodeHtml(match[3].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
  }));
}
