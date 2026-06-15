export interface RSSFeed {
  title: string;
  description: string;
  link: string;
  items: RSSItem[];
}

export interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  guid: string;
  author?: string;
  categories?: string[];
}

export async function fetchRSS(url: string, limit = 10, signal?: AbortSignal): Promise<RSSFeed> {
  const res = await fetch(url, {
    headers: { "User-Agent": "ArelyAgent/1.0", Accept: "application/rss+xml, application/atom+xml, text/xml" },
    signal,
  });
  if (!res.ok) throw new Error(`RSS fetch error: ${res.status} ${res.statusText}`);
  const xml = await res.text();
  return parseRSS(xml, limit);
}

export function formatRSSEntries(feed: RSSFeed): string {
  if (feed.items.length === 0) return `Feed "${feed.title}" has no entries.`;
  const lines: string[] = [`# ${feed.title}`, feed.description, `Source: ${feed.link}`, ""];
  for (let i = 0; i < feed.items.length; i++) {
    const item = feed.items[i];
    const date = item.pubDate ? ` (${item.pubDate})` : "";
    const author = item.author ? ` by ${item.author}` : "";
    const cats = item.categories && item.categories.length > 0
      ? ` [${item.categories.join(", ")}]`
      : "";
    lines.push(`[${i + 1}] ${item.title}${date}${author}${cats}`);
    lines.push(`    URL: ${item.link}`);
    if (item.description) {
      const stripped = item.description.replace(/<[^>]*>/g, "").slice(0, 300);
      lines.push(`    ${stripped}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function parseRSS(xml: string, limit: number): RSSFeed {
  const title = extractTag(xml, "title") || "Untitled Feed";
  const description = extractTag(xml, "description") || "";
  const link = extractTag(xml, "link") || "";
  const items: RSSItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
    const block = match[1];
    items.push({
      title: extractTag(block, "title") || "Untitled",
      link: extractTag(block, "link") || "",
      description: extractTag(block, "description") || "",
      pubDate: extractTag(block, "pubDate") || "",
      guid: extractTag(block, "guid") || "",
      author: extractTag(block, "author") || undefined,
      categories: extractAllTags(block, "category"),
    });
  }
  if (items.length === 0) {
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
    while ((match = entryRegex.exec(xml)) !== null && items.length < limit) {
      const block = match[1];
      const linkMatch = /<link[^>]*href=["']([^"']+)["']/i.exec(block);
      items.push({
        title: extractTag(block, "title") || "Untitled",
        link: linkMatch?.[1] ?? (extractTag(block, "link") || ""),
        description: extractTag(block, "summary") || extractTag(block, "content") || "",
        pubDate: extractTag(block, "published") || extractTag(block, "updated") || "",
        guid: extractTag(block, "id") || "",
        author: extractTag(block, "name") || undefined,
        categories: extractAllTags(block, "category"),
      });
    }
  }
  return { title, description, link, items };
}

function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = regex.exec(xml);
  if (!m) return "";
  return (m[1] || m[2] || "").trim();
}

function extractAllTags(xml: string, tag: string): string[] {
  const results: string[] = [];
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = regex.exec(xml)) !== null) {
    const val = (m[1] || "").trim();
    if (val) results.push(val);
  }
  return results;
}
