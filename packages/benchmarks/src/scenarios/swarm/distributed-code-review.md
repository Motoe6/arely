---
id: distributed-code-review
title: "Distributed: Large-scale code review across multiple workers"
tags: [distributed, code-review, multi-worker]
difficulty: hard
success_criteria:
  - "All 20 files are reviewed"
  - "Each reviewer produces actionable feedback"
  - "Synthesis report identifies top 5 issues"
  - "No file is reviewed by the same reviewer twice"
  - "Final report prioritizes fixes by severity"
expected_tool_calls: 30
expected_tokens_max: 12000
swarm_roles: [reviewer, security-auditor, performance-analyst, synthesis-writer]
---

Perform a distributed code review of a 20-file Node.js/TypeScript project.

The codebase is a REST API with the following structure:
- `src/routes/` — 5 route handlers
- `src/services/` — 5 service modules
- `src/models/` — 3 data models
- `src/middleware/` — 3 middleware functions
- `src/utils/` — 2 utility modules
- `tests/` — 2 test files

Each file has approximately 50-200 lines of code containing intentional issues:
- Security vulnerabilities (SQL injection, XSS, CSRF)
- Performance problems (N+1 queries, missing indexes)
- Code smells (magic numbers, deep nesting, dead code)
- Missing error handling
- Incorrect types

The review should be distributed across multiple reviewer roles:
1. **Code Reviewers**: Focus on logic, correctness, and best practices
2. **Security Auditor**: Focus on vulnerabilities and attack surface
3. **Performance Analyst**: Focus on bottlenecks and optimization
4. **Synthesis Writer**: Combine all feedback into a prioritized report

Each reviewer handles a subset of files. Final output must be a ranked list of
the top 5 most critical issues with code examples and fix recommendations.
