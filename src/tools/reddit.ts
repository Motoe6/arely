export interface RedditPost {
  id: string;
  title: string;
  url: string;
  permalink: string;
  author: string;
  subreddit: string;
  score: number;
  numComments: number;
  createdUtc: number;
  domain: string;
  selftext?: string;
  thumbnail?: string;
}

export interface RedditSearchResult {
  subreddit: string;
  posts: RedditPost[];
}

export class RedditProvider {
  private readonly userAgent: string;
  private readonly clientId: string | null;
  private readonly clientSecret: string | null;

  constructor(clientId?: string, clientSecret?: string) {
    this.userAgent = "OpenCodeAgent/1.0 (by /u/opencode)";
    this.clientId = clientId ?? null;
    this.clientSecret = clientSecret ?? null;
  }

  async hot(subreddit: string, limit = 25, signal?: AbortSignal): Promise<RedditPost[]> {
    const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/hot.json?limit=${limit}`;
    return this.fetchPosts(url, signal);
  }

  async trending(subreddit: string, limit = 25, signal?: AbortSignal): Promise<RedditPost[]> {
    const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/hot.json?limit=${limit}`;
    return this.fetchPosts(url, signal);
  }

  async new(subreddit: string, limit = 25, signal?: AbortSignal): Promise<RedditPost[]> {
    const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/new.json?limit=${limit}`;
    return this.fetchPosts(url, signal);
  }

  async top(subreddit: string, time = "day", limit = 25, signal?: AbortSignal): Promise<RedditPost[]> {
    const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/top.json?t=${time}&limit=${limit}`;
    return this.fetchPosts(url, signal);
  }

  async search(subreddit: string, query: string, limit = 25, signal?: AbortSignal): Promise<RedditPost[]> {
    const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search.json?q=${encodeURIComponent(query)}&restrict_sr=on&limit=${limit}`;
    return this.fetchPosts(url, signal);
  }

  async globalSearch(query: string, limit = 25, signal?: AbortSignal): Promise<RedditSearchResult[]> {
    const listing = await this.rawFetch(`https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=${limit}`, signal);
    const children = listing.data?.children ?? [];
    const grouped = new Map<string, RedditPost[]>();
    for (const child of children) {
      if (!child.data) continue;
      const post = this.mapPost(child.data);
      if (post) {
        const sr = post.subreddit;
        const existing = grouped.get(sr);
        if (existing) {
          existing.push(post);
        } else {
          grouped.set(sr, [post]);
        }
      }
    }
    return Array.from(grouped.entries()).map(([subreddit, posts]) => ({ subreddit, posts }));
  }

  private async fetchPosts(url: string, signal?: AbortSignal): Promise<RedditPost[]> {
    const listing = await this.rawFetch(url, signal);
    const children = listing.data?.children ?? [];
    return children
      .map((child) => {
        if (!child.data) return null;
        return this.mapPost(child.data);
      })
      .filter((p): p is RedditPost => p !== null);
  }

  private mapPost(data: Record<string, unknown> | undefined): RedditPost | null {
    if (!data) return null;
    if (typeof data.id !== "string") return null;
    return {
      id: data.id,
      title: typeof data.title === "string" ? data.title : "",
      url: typeof data.url === "string" ? data.url : "",
      permalink: typeof data.permalink === "string" ? `https://www.reddit.com${data.permalink}` : "",
      author: typeof data.author === "string" ? data.author : "",
      subreddit: typeof data.subreddit === "string" ? data.subreddit : "",
      score: typeof data.score === "number" ? data.score : 0,
      numComments: typeof data.num_comments === "number" ? data.num_comments : 0,
      createdUtc: typeof data.created_utc === "number" ? data.created_utc : 0,
      domain: typeof data.domain === "string" ? data.domain : "",
      selftext: typeof data.selftext === "string" && data.selftext ? data.selftext : undefined,
      thumbnail: typeof data.thumbnail === "string" && data.thumbnail.startsWith("http") ? data.thumbnail : undefined,
    };
  }

  private async rawFetch(url: string, signal?: AbortSignal): Promise<{ data?: { children?: { data?: Record<string, unknown> }[] } }> {
    const headers: Record<string, string> = {
      "User-Agent": this.userAgent,
      Accept: "application/json",
    };
    if (this.clientId) {
      const creds = Buffer.from(`${this.clientId}:${this.clientSecret ?? ""}`).toString("base64");
      headers.Authorization = `Basic ${creds}`;
    }
    const res = await fetch(url, { headers, signal });
    if (!res.ok) {
      throw new Error(`Reddit API error: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<{ data?: { children?: { data?: Record<string, unknown> }[] } }>;
  }
}

export function formatRedditPosts(posts: RedditPost[], subreddit?: string): string {
  if (posts.length === 0) return "No posts found.";
  const header = subreddit ? `## r/${subreddit}\n\n` : "";
  const lines = posts.map((p, i) => {
    const age = formatAge(p.createdUtc);
    return `[${i + 1}] ${p.title} (${p.score} pts, ${p.numComments} comments)\n    URL: ${p.url}\n    Author: u/${p.author} | ${age}`;
  });
  return header + lines.join("\n\n");
}

function formatAge(createdUtc: number): string {
  const seconds = Math.floor(Date.now() / 1000) - createdUtc;
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
