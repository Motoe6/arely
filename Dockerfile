FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/agent-core/package.json packages/agent-core/
COPY packages/llm-core/package.json packages/llm-core/
COPY packages/persistence/package.json packages/persistence/
COPY packages/cli/package.json packages/cli/
COPY packages/benchmarks/package.json packages/benchmarks/
COPY packages/flow-runtime/package.json packages/flow-runtime/
COPY packages/flow-sdk/package.json packages/flow-sdk/
COPY packages/flow-ai-compiler/package.json packages/flow-ai-compiler/
RUN npm ci
COPY tsconfig.json ./
COPY packages/engine/tsconfig.json packages/engine/
COPY packages/agent-core/tsconfig.json packages/agent-core/
COPY packages/llm-core/tsconfig.json packages/llm-core/
COPY packages/persistence/tsconfig.json packages/persistence/
COPY packages/cli/tsconfig.json packages/cli/
COPY packages/benchmarks/tsconfig.json packages/benchmarks/
COPY packages/flow-runtime/tsconfig.json packages/flow-runtime/
COPY packages/flow-sdk/tsconfig.json packages/flow-sdk/
COPY packages/flow-ai-compiler/tsconfig.json packages/flow-ai-compiler/
COPY packages/engine/src packages/engine/src/
COPY packages/agent-core/src packages/agent-core/src/
COPY packages/llm-core/src packages/llm-core/src/
COPY packages/persistence/src packages/persistence/src/
COPY packages/cli/src packages/cli/src/
COPY packages/benchmarks/src packages/benchmarks/src/
COPY packages/flow-runtime/src packages/flow-runtime/src/
COPY packages/flow-sdk/src packages/flow-sdk/src/
COPY packages/flow-ai-compiler/src packages/flow-ai-compiler/src/
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache curl
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/engine/dist ./packages/engine/dist
COPY --from=builder /app/packages/agent-core/dist ./packages/agent-core/dist
COPY --from=builder /app/packages/llm-core/dist ./packages/llm-core/dist
COPY --from=builder /app/packages/persistence/dist ./packages/persistence/dist
COPY --from=builder /app/packages/cli/dist ./packages/cli/dist
COPY --from=builder /app/packages/benchmarks/dist ./packages/benchmarks/dist
COPY --from=builder /app/packages/flow-runtime/dist ./packages/flow-runtime/dist
COPY --from=builder /app/packages/flow-sdk/dist ./packages/flow-sdk/dist
COPY --from=builder /app/packages/flow-ai-compiler/dist ./packages/flow-ai-compiler/dist
COPY --from=builder /app/packages/engine/package.json ./packages/engine/
COPY --from=builder /app/packages/agent-core/package.json ./packages/agent-core/
COPY --from=builder /app/packages/llm-core/package.json ./packages/llm-core/
COPY --from=builder /app/packages/persistence/package.json ./packages/persistence/
COPY --from=builder /app/packages/cli/package.json ./packages/cli/
COPY --from=builder /app/packages/benchmarks/package.json ./packages/benchmarks/
COPY --from=builder /app/packages/flow-runtime/package.json ./packages/flow-runtime/
COPY --from=builder /app/packages/flow-sdk/package.json ./packages/flow-sdk/
COPY --from=builder /app/packages/flow-ai-compiler/package.json ./packages/flow-ai-compiler/
COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.json ./
RUN mkdir -p /root/.arely
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -sf http://localhost:8081/health || exit 1
CMD ["node", "packages/engine/dist/index.js"]
