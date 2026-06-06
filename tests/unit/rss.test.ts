import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchRSS, formatRSSEntries } from "../../src/tools/rss.js";

const mockRSSXml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Test Blog</title>
    <description>A test blog feed</description>
    <link>https://example.com</link>
    <item>
      <title>First Article</title>
      <link>https://example.com/first</link>
      <description>Description of first article with some content</description>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
      <guid>https://example.com/first</guid>
      <author>John Doe</author>
      <category>tech</category>
      <category>ai</category>
    </item>
    <item>
      <title>Second Article</title>
      <link>https://example.com/second</link>
      <description>Description of second article</description>
      <pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
      <guid>https://example.com/second</guid>
    </item>
  </channel>
</rss>`;

const mockAtomXml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Blog</title>
  <link href="https://atom.example.com"/>
  <entry>
    <title>Atom Entry</title>
    <link href="https://atom.example.com/entry1"/>
    <summary>Summary of atom entry</summary>
    <published>2024-01-01T00:00:00Z</published>
    <id>https://atom.example.com/entry1</id>
    <author><name>Jane Doe</name></author>
    <category term="science"/>
  </entry>
</feed>`;

const emptyRssXml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Empty Feed</title>
    <description>No items</description>
    <link>https://example.com</link>
  </channel>
</rss>`;

describe("fetchRSS", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockReset();
  });

  it("should parse RSS 2.0 feed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(mockRSSXml),
    } as Response);

    const feed = await fetchRSS("https://example.com/feed.xml");
    expect(feed.title).toBe("Test Blog");
    expect(feed.description).toBe("A test blog feed");
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0].title).toBe("First Article");
    expect(feed.items[0].author).toBe("John Doe");
    expect(feed.items[0].categories).toEqual(["tech", "ai"]);
    expect(feed.items[1].title).toBe("Second Article");
  });

  it("should parse Atom feed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(mockAtomXml),
    } as Response);

    const feed = await fetchRSS("https://example.com/atom.xml");
    expect(feed.title).toBe("Atom Blog");
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].title).toBe("Atom Entry");
    expect(feed.items[0].author).toBe("Jane Doe");
  });

  it("should respect limit parameter", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(mockRSSXml),
    } as Response);

    const feed = await fetchRSS("https://example.com/feed.xml", 1);
    expect(feed.items).toHaveLength(1);
  });

  it("should handle empty feeds", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(emptyRssXml),
    } as Response);

    const feed = await fetchRSS("https://example.com/empty.xml");
    expect(feed.items).toHaveLength(0);
  });

  it("should throw on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    } as Response);

    await expect(fetchRSS("https://example.com/bad")).rejects.toThrow("RSS fetch error: 404 Not Found");
  });
});

describe("formatRSSEntries", () => {
  it("should format feed with entries", () => {
    const feed = {
      title: "Test Feed",
      description: "Desc",
      link: "https://example.com",
      items: [
        {
          title: "Article 1",
          link: "https://example.com/1",
          description: "Some description here",
          pubDate: "Mon, 01 Jan 2024 00:00:00 GMT",
          guid: "1",
          author: "Author One",
          categories: ["tech"],
        },
      ],
    };

    const result = formatRSSEntries(feed);
    expect(result).toContain("Test Feed");
    expect(result).toContain("Article 1");
    expect(result).toContain("Author One");
    expect(result).toContain("[tech]");
  });

  it("should handle empty items", () => {
    const feed = {
      title: "Empty Feed",
      description: "",
      link: "",
      items: [],
    };

    const result = formatRSSEntries(feed);
    expect(result).toContain("has no entries");
  });
});
