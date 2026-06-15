---
id: coding-refactor
category: coding
title: Code Refactoring
tags: [python, refactoring, clean-code]
difficulty: medium
success_criteria:
  - Improved code readability
  - Added type hints
  - Split into smaller functions
  - No functional changes to output
expected_tool_calls: 2
expected_tokens_max: 1200
---

Refactor this Python code. Add type hints, split into smaller functions, and improve variable names without changing the output:

```python
def p(d):
    r = []
    for i in range(len(d)):
        if d[i] > 0:
            r.append(d[i] * 2)
        else:
            r.append(0)
    t = 0
    for v in r:
        t = t + v
    return t / len(r) if r else 0
```
