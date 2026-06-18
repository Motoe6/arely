export type EntityType =
  | "person"
  | "organization"
  | "project"
  | "technology"
  | "provider"
  | "model"
  | "concept"
  | "location"
  | "task";

export interface ExtractedEntity {
  value: string;
  type: EntityType;
  confidence: number;
}

const KNOWN_ORGANIZATIONS = new Set([
  "openai", "anthropic", "google", "meta", "microsoft", "amazon", "ibm",
  "apple", "nvidia", "alibaba", "baidu", "tencent", "hugging face", "mistral",
  "cohere", "ai21", "together", "replicate", "openrouter", "groq",
]);

const KNOWN_PROVIDERS = new Set([
  "openai", "anthropic", "google", "meta", "mistral", "cohere", "ai21",
  "together", "replicate", "openrouter", "groq", "deepseek", "perplexity",
  "xai", "stability", "midjourney",
]);

const KNOWN_MODELS = new Set([
  "gpt-4", "gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo",
  "claude", "claude-4", "claude-4-sonnet", "claude-3.5", "claude-3", "claude-3-opus",
  "claude-3-sonnet", "claude-3-haiku",
  "gemini-2", "gemini-2-pro", "gemini-2-flash", "gemini-1.5",
  "llama-3", "llama-3.1", "llama-3.2", "llama-4",
  "qwen-2.5", "qwen-3", "qwen-2",
  "mixtral", "mistral-7b", "mistral-large",
  "command-r", "command-r+",
  "deepseek-v4", "deepseek-v3", "deepseek-r1",
  "grok-3", "grok-2",
  "stable-diffusion", "dall-e", "midjourney",
]);

const KNOWN_TECHNOLOGIES = new Set([
  "typescript", "javascript", "python", "rust", "go", "java", "c++", "c#",
  "react", "node", "next.js", "vue", "angular", "svelte",
  "docker", "kubernetes", "k8s", "terraform", "ansible",
  "postgresql", "postgres", "mysql", "mongodb", "redis", "sqlite",
  "aws", "gcp", "azure", "cloudflare", "vercel", "netlify",
  "websocket", "http", "grpc", "rest", "graphql",
  "prometheus", "grafana", "otel", "opentelemetry", "datadog",
  "vitest", "jest", "mocha", "cypress", "playwright",
  "git", "github", "gitlab", "ci/cd",
  "llm", "rag", "agent", "swarm", "embedding", "transformer",
  "tensorflow", "pytorch", "jax", "langchain", "llamaindex",
  "redis", "kafka", "rabbitmq", "nats",
  "sql", "nosql", "vector-db", "pinecone", "weaviate", "qdrant",
]);

const KNOWN_PROJECTS = new Set([
  "arely", "opencode", "vscode", "cursor", "copilot",
  "linux", "nginx", "traefik", "envoy",
  "spring", "django", "rails", "laravel", "fastapi",
  "next.js", "nuxt", "remix",
]);

const TASK_PATTERNS = [
  /(?:task|objective|goal|mission|job|assignment)s?\s*[::is]+\s*[""']?([A-Z][a-zA-Z\s]{2,50})[""']?/gi,
  /(?:analyz|review|check|validate|test|debug|fix|implement|build|create|design|migrate|deploy|optimize|refactor|monitor)\s+[A-Z][a-zA-Z\s]{2,50}/g,
];

const TECHNOLOGY_PATTERNS = [
  /\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)+\b/g,
  /\b[A-Z]{2,5}\b/g,
];

const MODEL_PATTERNS = [
  /\b(gpt|claude|gemini|llama|qwen|mistral|mixtral|command|dall-e|grok|deepseek)[-\s]?[\w.+-]+\b/gi,
];

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

function deduplicate(entities: ExtractedEntity[]): ExtractedEntity[] {
  const seen = new Map<string, ExtractedEntity>();
  for (const e of entities) {
    const key = normalize(e.value);
    const existing = seen.get(key);
    if (!existing || e.confidence > existing.confidence) {
      seen.set(key, existing ? { ...e, type: existing.type } : e);
    }
  }
  return Array.from(seen.values());
}

export function extractEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const lower = text.toLowerCase();

  // Dictionary-based extraction
  const words = text.split(/[\s,.;!?()\[\]{}""''/\\]+/).filter(Boolean);

  for (const word of words) {
    const w = normalize(word);
    if (KNOWN_MODELS.has(w)) {
      entities.push({ value: word, type: "model", confidence: 0.95 });
    }
    if (KNOWN_PROVIDERS.has(w)) {
      entities.push({ value: word, type: "provider", confidence: 0.9 });
    }
    if (KNOWN_ORGANIZATIONS.has(w)) {
      entities.push({ value: word, type: "organization", confidence: 0.85 });
    }
    if (KNOWN_TECHNOLOGIES.has(w)) {
      entities.push({ value: word, type: "technology", confidence: 0.8 });
    }
    if (KNOWN_PROJECTS.has(w)) {
      entities.push({ value: word, type: "project", confidence: 0.75 });
    }
  }

  // Multi-word matching (bigrams from the text)
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = normalize(`${words[i]} ${words[i + 1]}`);
    if (KNOWN_MODELS.has(bigram)) {
      entities.push({ value: `${words[i]} ${words[i + 1]}`, type: "model", confidence: 0.95 });
    }
    if (KNOWN_ORGANIZATIONS.has(bigram)) {
      entities.push({ value: `${words[i]} ${words[i + 1]}`, type: "organization", confidence: 0.85 });
    }
    if (KNOWN_TECHNOLOGIES.has(bigram)) {
      entities.push({ value: `${words[i]} ${words[i + 1]}`, type: "technology", confidence: 0.8 });
    }
  }

  // Model pattern matching (e.g., "GPT-4o", "Claude-4-sonnet")
  for (const pattern of MODEL_PATTERNS) {
    const matches = text.matchAll(pattern);
    for (const m of matches) {
      entities.push({ value: m[0], type: "model", confidence: 0.9 });
    }
  }

  // Task pattern matching
  for (const pattern of TASK_PATTERNS) {
    const matches = text.matchAll(pattern);
    for (const m of matches) {
      const task = m[0].length > 100 ? m[0].slice(0, 100) : m[0];
      entities.push({ value: task, type: "task", confidence: 0.6 });
    }
  }

  // Capitalized multi-word phrases as concepts (3+ words, all starting with capital)
  const capPhrases = text.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+){2,}\b/g);
  if (capPhrases) {
    for (const phrase of capPhrases) {
      const n = normalize(phrase);
      if (!KNOWN_MODELS.has(n) && !KNOWN_ORGANIZATIONS.has(n) && !KNOWN_PROJECTS.has(n)) {
        entities.push({ value: phrase, type: "concept", confidence: 0.5 });
      }
    }
  }

  return deduplicate(entities);
}

export function extractEntitiesFromMultiple(texts: string[]): ExtractedEntity[] {
  const all: ExtractedEntity[] = [];
  for (const t of texts) {
    all.push(...extractEntities(t));
  }
  return deduplicate(all);
}
