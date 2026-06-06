import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/config/**/*.ts",
        "src/persistence/**/*.ts",
        "src/server/sse.ts",
        "src/server/agent-loop.ts",
        "src/server/session-manager.ts",
        "src/transport/router.ts",
        "src/transport/http-server.ts",
        "src/tools/*.ts",
        "src/permissions/*.ts",
        "src/llm/adapter.ts",
        "src/llm/openaicompat.ts",
        "src/llm/conversation.ts",
      ],
      exclude: [
        "tests/**",
        "src/types/**",
        "src/ui/**",
        "src/index.ts",
        "src/tools/base-tool.ts",
        "src/persistence/schema.ts",
        "src/persistence/database.ts",
        "src/persistence/migrate.ts",
        "src/transport/http-server.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
