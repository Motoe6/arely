---
id: benchmark-large-project
title: "Scale: Analyze and refactor a 50+ file TypeScript project"
tags: [scale, large-project, refactoring, analysis]
difficulty: hard
success_criteria:
  - "Maps all 50+ files and their dependencies"
  - "Identifies circular dependencies"
  - "Measures code duplication ratio"
  - "Proposes refactoring plan with estimated effort"
  - "Implements at least 3 refactorings correctly"
  - "Tests pass after refactoring"
  - "Produces a dependency graph (text format)"
expected_tool_calls: 25
expected_tokens_max: 15000
swarm_roles: [analyst, architect, refactoring-executor, validator]
---

Analyze and refactor a large TypeScript project with 50+ files.

The project is a web application backend with:

```
src/
  config/         — 4 files (env, db, auth, cache)
  controllers/    — 8 files (auth, users, posts, comments, search, admin, webhooks, health)
  middleware/     — 6 files (auth, validation, logging, error, cors, rate-limit)
  models/         — 5 files (user, post, comment, tag, audit-log)
  routes/         — 8 files (auth, users, posts, comments, search, admin, webhooks, health)
  services/       — 10 files (auth, users, posts, comments, search, email, cache, queue, analytics, notification)
  utils/          — 6 files (date, string, crypto, pagination, validation, logger)
  tests/          — 8 files
```

Known issues:
1. Circular dependency between `services/auth` ↔ `services/users`
2. 40% code duplication in validation logic across controllers
3. Mixed concerns in `services/analytics` (should be split)
4. Missing error boundaries in middleware chain
5. Inconsistent error response format across routes

The workflow:
1. **Analyze**: Map all files, dependencies, and identify issues
2. **Measure**: Quantify duplication, coupling, and complexity metrics
3. **Plan**: Create a prioritized refactoring plan with effort estimates
4. **Execute**: Implement the top 3 refactorings
5. **Validate**: Ensure tests still pass and no regressions

Output requirements:
- Dependency graph (ASCII or Mermaid)
- Complexity metrics table
- Refactoring plan with risk assessment
- Code diff for each implemented refactoring
