import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedditProvider, formatRedditPosts } from "@arely/engine/tools/reddit.js";

const mockHotResponse = {
  data: {
    children: [
      {
        data: {
          id: "abc123",
          title: "Test Post Title",
          url: "https://example.com/test",
          permalink: "/r/test/comments/abc123/test_post_title/",
          author: "testuser",
          subreddit: "test",
          score: 42,
          num_comments: 7,
          created_utc: Math.floor(Date.now() / 1000) - 3600,
          domain: "example.com",
          selftext: "",
          thumbnail: "",
        },
      },
      {
        data: {
          id: "def456",
          title: "Second Post",
          url: "https://example.com/second",
          permalink: "/r/test/comments/def456/second_post/",
          author: "anotheruser",
          subreddit: "test",
          score: 15,
          num_comments: 3,
          created_utc: Math.floor(Date.now() / 1000) - 7200,
          domain: "example.com",
          selftext: "Some self text content",
          thumbnail: "https://example.com/thumb.jpg",
        },
      },
    ],
  },
};

const emptyResponse = { data: { children: [] } };

describe("RedditProvider", () => {
  let provider: RedditProvider;

  beforeEach(() => {
    provider = new RedditProvider();
    vi.spyOn(globalThis, "fetch").mockReset();
  });

  describe("hot", () => {
    it("should fetch hot posts from a subreddit", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockHotResponse),
      } as Response);

      const posts = await provider.hot("test");
      expect(posts).toHaveLength(2);
      expect(posts[0].title).toBe("Test Post Title");
      expect(posts[0].score).toBe(42);
      expect(posts[0].author).toBe("testuser");
    });

    it("should return empty array when no posts", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(emptyResponse),
      } as Response);

      const posts = await provider.hot("empty");
      expect(posts).toHaveLength(0);
    });

    it("should throw on non-ok response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      } as Response);

      await expect(provider.hot("test")).rejects.toThrow("Reddit API error: 429 Too Many Requests");
    });
  });

  describe("search", () => {
    it("should search within a subreddit", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockHotResponse),
      } as Response);

      const posts = await provider.search("test", "AI");
      expect(posts).toHaveLength(2);
    });
  });

  describe("globalSearch", () => {
    it("should group results by subreddit", async () => {
      const globalResponse = {
        data: {
          children: [
            {
              data: {
                id: "1",
                title: "Post 1",
                url: "https://a.com/1",
                permalink: "/r/artificial/comments/1/post1/",
                author: "u1",
                subreddit: "artificial",
                score: 10,
                num_comments: 2,
                created_utc: Math.floor(Date.now() / 1000) - 500,
                domain: "a.com",
              },
            },
            {
              data: {
                id: "2",
                title: "Post 2",
                url: "https://b.com/2",
                permalink: "/r/MachineLearning/comments/2/post2/",
                author: "u2",
                subreddit: "MachineLearning",
                score: 20,
                num_comments: 5,
                created_utc: Math.floor(Date.now() / 1000) - 1000,
                domain: "b.com",
              },
            },
          ],
        },
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(globalResponse),
      } as Response);

      const results = await provider.globalSearch("AI");
      expect(results).toHaveLength(2);
      expect(results[0].subreddit).toBe("artificial");
      expect(results[1].subreddit).toBe("MachineLearning");
    });
  });

  describe("new", () => {
    it("should fetch new posts", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockHotResponse),
      } as Response);

      const posts = await provider.new("test");
      expect(posts).toHaveLength(2);
    });
  });

  describe("top", () => {
    it("should fetch top posts with time parameter", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockHotResponse),
      } as Response);

      const posts = await provider.top("test", "week");
      expect(posts).toHaveLength(2);
    });
  });
});

describe("formatRedditPosts", () => {
  it("should format posts with header", () => {
    const posts = [
      {
        id: "1",
        title: "Post Title",
        url: "https://example.com",
        permalink: "https://www.reddit.com/r/test/comments/1/post/",
        author: "user",
        subreddit: "test",
        score: 100,
        numComments: 10,
        createdUtc: Math.floor(Date.now() / 1000) - 60,
        domain: "example.com",
      },
    ];

    const result = formatRedditPosts(posts, "test");
    expect(result).toContain("r/test");
    expect(result).toContain("Post Title");
    expect(result).toContain("100 pts");
    expect(result).toContain("10 comments");
    expect(result).toContain("u/user");
    expect(result).toContain("ago");
  });

  it("should handle empty posts", () => {
    expect(formatRedditPosts([])).toBe("No posts found.");
  });

  it("should format posts without subreddit header", () => {
    const posts = [
      {
        id: "1",
        title: "Post",
        url: "https://example.com",
        permalink: "https://www.reddit.com/r/test/comments/1/post/",
        author: "user",
        subreddit: "test",
        score: 10,
        numComments: 1,
        createdUtc: Math.floor(Date.now() / 1000) - 86400,
        domain: "example.com",
      },
    ];

    const result = formatRedditPosts(posts);
    expect(result).not.toContain("r/");
    expect(result).toContain("1d ago");
  });
});
