---
id: coding-rest-api
category: coding
title: REST API Design
tags: [python, fastapi, api, web]
difficulty: medium
success_criteria:
  - Complete FastAPI application with GET and POST endpoints
  - In-memory data store
  - Input validation
  - Error handling
expected_tool_calls: 2
expected_tokens_max: 1500
---

Design a REST API using FastAPI for a simple task manager. It should support:
- `GET /tasks` — list all tasks
- `POST /tasks` — create a task with title and description
- `GET /tasks/{id}` — get a task by ID
- `DELETE /tasks/{id}` — delete a task

Use an in-memory list as storage. Include proper error handling for missing tasks.
