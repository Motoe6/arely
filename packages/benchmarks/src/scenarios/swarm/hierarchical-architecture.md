---
id: hierarchical-architecture
title: "Hierarchical: Research → Design → Implement → Test → Document"
tags: [hierarchical, multi-step, architecture]
difficulty: hard
success_criteria:
  - "Produces a complete architecture document"
  - "Code implements the architecture correctly"
  - "Tests validate the implementation"
  - "Documentation explains design decisions"
  - "Each phase produces intermediate artifacts"
expected_tool_calls: 20
expected_tokens_max: 8000
swarm_roles: [researcher, architect, developer, tester, writer]
---

Design and implement a rate-limiting middleware library for Node.js (TypeScript) that supports:

1. Token bucket algorithm
2. Sliding window counter
3. Distributed rate limiting via Redis
4. Express/Koa/Fastify middleware adapters
5. Configurable storage backends (in-memory, Redis, SQLite)

The implementation should follow this workflow:

1. **Research**: Analyze existing rate-limiting libraries (express-rate-limit, rate-limiter-flexible) and document trade-offs
2. **Design**: Produce an architecture document with class diagrams and data flow
3. **Implement**: Build the library following the architecture
4. **Test**: Write unit + integration tests
5. **Document**: Write README with examples and API reference

Each phase should produce intermediate artifacts that feed into the next phase.
