---
id: cross-session-learning
title: "Learning: Cross-session knowledge reuse and weight optimization"
tags: [learning, cross-session, memory, optimization]
difficulty: hard
success_criteria:
  - "Session 2 outperforms Session 1 on same task category"
  - "Learning weights shift towards effective strategies"
  - "Memory recall improves decision quality"
  - "Avoids repeating Session 1 mistakes"
  - "Demonstrates measurable learning gain"
expected_tool_calls: 12
expected_tokens_max: 5000
swarm_roles: [executor, memory-analyst, strategy-optimizer]
---

Demonstrate cross-session learning across 3 related tasks.

The system has:
- Global memory store with session-scoped tags
- Learning weight optimizer (UCB / Thompson Sampling / ε-greedy)
- Strategy registry with past outcomes

**Session 1**: "Build a CLI tool that reads a JSON config file and generates TypeScript interfaces"
- Expected to learn which strategies work for code generation tasks
- Record outcomes in global memory with tag "codegen"

**Session 2**: "Build a CLI tool that reads a YAML config file and generates Zod schemas"
- Should reuse successful strategies from Session 1
- Learning weights should favor patterns that worked for codegen
- Expected to complete faster with higher quality than Session 1

**Session 3**: "Write a migration script that converts YAML configs to TypeScript + Zod"
- Should combine learnings from Sessions 1 and 2
- Demonstrate strategy transfer across related but distinct tasks
- Produce a final report comparing performance across all 3 sessions

Metrics to capture:
- Success rate per session
- Average latency improvement
- Strategy selection distribution
- Weight evolution (before vs after)
- Mistake repetition rate
