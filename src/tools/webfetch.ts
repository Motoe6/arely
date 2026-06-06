import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
});

const ALLOWED_PROTOCOLS = ["http:", "https:"];

function isPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]") {
    return true;
  }
  if (hostname.startsWith("10.") || hostname.startsWith("192.168.")) return true;
  if (hostname.startsWith("172.")) {
    const second = parseInt(hostname.split(".")[1] ?? "", 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function validateUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    throw new Error(`Blocked URL scheme: ${parsed.protocol}`);
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error(`Blocked private host: ${parsed.hostname}`);
  }
  return parsed;
}

export async function performWebFetch(url: string, signal?: AbortSignal): Promise<{ url: string; title: string; content: string; images?: string[] }> {
  const validated = validateUrl(url);
  const res = await fetch(validated.href, {
    headers: {
      "User-Agent": `OpenCodeAgent/1.0`,
      Accept: "text/html, text/plain, application/json",
    },
    redirect: "follow",
    signal,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  const html = await res.text();
  const title = extractTitle(html);
  const markdown = contentType.includes("text/html") ? turndown.turndown(html) : html;
  const images = extractImages(html);
  return { url: validated.href, title, content: markdown, images };
}

function extractTitle(html: string): string {
  const re = /<title[^>]*>([^<]*)<\/title>/i;
  const match = re.exec(html);
  return match ? match[1].trim() : "Untitled";
}

function extractImages(html: string): string[] {
  const re = /<img[^>]+src="([^"]+)"/gi;
  const images: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const src = m[1];
    if (src.startsWith("http") && !src.endsWith(".svg")) {
      images.push(src);
    }
  }
  return images.slice(0, 5);
}
