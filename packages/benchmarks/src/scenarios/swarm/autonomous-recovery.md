---
id: autonomous-recovery
title: "Autonomous: Recovery from worker crash + provider failure + replanning"
tags: [autonomous, recovery, hierarchical, resilient]
difficulty: hard
success_criteria:
  - "Detects worker crash within timeout"
  - "Re-routes tasks to healthy workers"
  - "Falls back to alternative provider on failure"
  - "Replans incomplete tasks"
  - "Completes goal despite failures"
  - "Logs all recovery events with timestamps"
expected_tool_calls: 15
expected_tokens_max: 6000
swarm_roles: [executor, monitor, recovery-coordinator]
---

Simulate an autonomous system that must recover from infrastructure failures.

The system has:
- 3 workers (worker-1, worker-2, worker-3)
- 2 providers (primary: OpenAI, fallback: Anthropic)
- A coordinator with round-robin scheduling

The goal is: "Process 10 CSV files, transform them to JSON, validate schema, and generate a summary report."

During execution, inject these failures:
1. **Worker crash** (iteration 3): worker-2 disconnects mid-task
2. **Provider failure** (iteration 5): primary provider returns 503 errors
3. **Corrupted data** (iteration 7): file-8 has invalid CSV format

The system must:
1. Detect worker-2 crash via heartbeat timeout
2. Reassign its tasks to worker-1 and worker-3
3. On provider failure, fall back to Anthropic without losing context
4. On corrupted CSV, replan: attempt repair, skip if irreparable, note in report
5. Continue execution until all 10 files are processed or declared unrecoverable
6. Produce a final report with: files processed, failures encountered, recovery actions taken
