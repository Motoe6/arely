---
id: swarm-implementation-design
category: swarm
title: Design & Implementation
tags: [swarm, design, implementation, architecture]
difficulty: hard
success_criteria:
  - Complete architecture design
  - Implementation plan with tasks
  - Working code example
  - Testing strategy
expected_tool_calls: 6
expected_tokens_max: 3500
swarm_roles: [architect, developer, tester]
---

Design and implement a simple rate-limiting middleware for a Node.js HTTP server.

**Architect tasks:**
1. Design the middleware architecture
2. Choose between token bucket, leaky bucket, or sliding window
3. Define the API (configuration options, headers returned)
4. Create a sequence diagram in text

**Developer tasks:**
1. Implement the chosen rate limiter
2. Create the Express middleware wrapper
3. Add proper TypeScript types
4. Handle edge cases (overflow, reset, cleanup)

**Tester tasks:**
1. Write unit tests for the rate limiter
2. Write integration tests for the middleware
3. Test edge cases (high concurrency, config limits)
4. Verify headers are correct (X-RateLimit-*)
