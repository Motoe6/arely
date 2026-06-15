# Cognition Architecture

## Overview

ARELY's cognitive stack is organized in four tiers (T7–T10). Each tier builds on the one below it, forming a closed learning loop from execution to improved decision-making.

```
T10  Meta Reasoning + Strategy Selection    ← autoconocimiento
T9   Memory + Decision + Outcome Learning   ← recuerda y aprende
T8   Structural Evolution                   ← mejora su arquitectura
T7   Parameter Optimization                 ← ajusta configuraciones
```

---

## The Complete Learning Cycle

```
Execution (agent loop)
    │
    ▼
Tool Calls → Decision Log
    │                      │
    ▼                      ▼
Outcome Learner      Model Performance
(learnFromOutcome)   (recordFromDecision)
    │                      │
    ▼                      ▼
Memory Store ────────► Recommendation
(episodic + semantic)    (mejores modelos por tarea)
    │
    ▼
Meta Reasoner
(buildMetaContextString)
    │
    ├── Decision History (per-type success rates)
    ├── Learned Patterns (memories tagged auto-learned)
    ├── Areas Needing Attention (<60% success rate, ≥2 uses)
    └── Strategy Performance (per-strategy stats)
    │
    ▼
Strategy Selector
(argmax expected success rate)
    │
    ├── Observed strategy perf (≥2 obs) → use that rate
    ├── Session overall rate → fallback
    └── 50% → default
    │
    ▼
Strategy Injected Into Context
[Strategy Recommendation]
    │
    ▼
LLM Call (with memory + self-knowledge + strategy)
    │
    ▼
Decision
    │
    ▼
Execution ────► (cycle repeats)
```

---

## Tier 7 — Parameter Optimization

**Files:** `templates/parameter-recommender.ts`, `templates/parameter-effectiveness.ts`

Optimizes template parameters based on historical execution data.

### Flow

```
Workflow executions
    │
    ▼
workflow_feedback table
(success, durationMs, parameters)
    │
    ▼
ParameterEffectivenessService
(per-parameter success rates per value)
    │
    ▼
ParameterRecommenderService.getRecommendations(templateId)
  ├── Filters: ≥5 executions, ≥0.25 confidence, ≥60% success rate
  ├── Score = successRate × confidence²
  └── Returns sorted ParameterRecommendation[]
    │
    ▼
EvolutionProposalService.getProposals(templateId)
  ├── Filters: score ≥ 0.6, executions ≥ 20
  └── Creates EvolutionProposal (type: "parameter_change")
```

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Parameter** | A configurable value in a workflow template (e.g., model, temperature, prompt) |
| **Candidate value** | A specific value a parameter was set to during execution |
| **Effectiveness** | Success rate × confidence for a parameter-value pair |
| **Recommendation** | Suggested new default for a parameter, backed by data |

---

## Tier 8 — Structural Evolution

**Files:** `structural/structural-evolution-service.ts`

Modifies workflow structure (not just parameters) to improve reliability and capability.

### Evolution Kinds

| Kind | What It Does |
|------|-------------|
| `add_retry` | Adds retry config to each step's `onFailure` |
| `add_error_handling` | Inserts error handler step + fallback |
| `split_into_chain` | Splits single-step workflow into two-step chain |
| `parameterize_value` | Replaces hardcoded value with a parameter binding |

### Flow

```
Approved Structural Proposal
    │
    ▼
StructuralEvolutionService.applyProposal(proposalId)
  ├── Validates: proposal exists, is approved, is "structural"
  ├── Loads template, deep-clones workflow
  ├── Applies transformation
  ├── Bumps version, re-registers template
  ├── Creates template version record
  └── Creates audit trail
```

---

## Tier 9 — Memory + Decisions + Outcome Learning

### 9A — Memory System

**Files:** `llm/memory-types.ts`, `persistence/memory-store.ts`, `llm/memory-retrieval-service.ts`, `llm/context-epoch-service.ts`

#### Memory Types

| Type | Source | Example |
|------|--------|---------|
| `workflow_pattern` | Outcome learner | "research_first followed by implement has 90% success" |
| `project_fact` | Outcome learner + meta | "Auth module uses JWT, needs-attention on error handling" |
| `conversation_summary` | Meta-reasoner | "Session focused on debugging API rate limits" |
| `config_preference` | Parameter optimizer | "temperature=0.2 works best for code generation" |
| `session_reflection` | Meta-reasoner | "This session had 3 decisions with 66% success" |

#### Memory Retrieval (`memory-retrieval-service.ts`)

```
getRelevant(query, opts)
    │
    ├── Search memory_store (sessionId + type filter, minConfidence ≥ 0.3)
    │
    └── Score each memory:
          ├── semantic × 0.6      (token overlap similarity)
          ├── confidence × 0.25
          ├── accessBoost × 0.1
          └── recencyBoost × 0.05
    │
    └── Return top N, filtered relevanceScore > 0
```

`simpleSimilarity()`: Token-based matching with partial substring bonus.

#### Epoch Management (`context-epoch-service.ts`)

```
Context Window
    │
    ├── Current epoch (active messages, ≤ threshold)
    │     └── On threshold hit → rotate
    │           ├── Statistical summary (synchronous)
    │           └── LLM summary via setEpochSummarizer() (fire-and-forget)
    │
    └── buildContext(sessionId)
          ├── compressed (older epochs summary)
          └── currentMessages (active epoch)
```

#### Auto Memory Extraction (`auto-memory-extractor.ts`)

```
After epoch rotation or session end
    │
    ├── extractMemories(conversationMessages)
    │     ├── Filters out system messages
    │     ├── LLM call with MEMORY_EXTRACTION_PROMPT
    │     ├── Validates JSON: { type, key, value, confidence, tags }
    │     └── Persists with source="inferred"
    │
    └── extractEpochSummary(epochMessages)
          ├── LLM call with EPOCH_SUMMARY_PROMPT
          └── Returns 2-3 sentence summary
```

### 9B — Decision System

**Files:** `llm/decision-types.ts`, `llm/decision-service.ts`, `persistence/decision-store.ts`

#### Decision Recording

```
agent loop: on tool call
    │
    ▼
DecisionService.logDecision({
  decisionType:     "tool_choice" | "strategy" | "parameter" | "structural" | "delegation",
  decision:         "use websearch to find API docs",
  rationale:        "need latest version info",
  confidence:       85,
  metadata: {
    strategy:       "research_first",    ← from StrategySelector
    model:          "gpt-4",
    provider:       "openai",
    taskType:       "research",
    latencyMs:      1234,
    tokens:         567
  }
})
    │
    ├── Generates ULID
    ├── Captures current epoch
    ├── Snapshots recent memories
    └── Persists to decision_log table
    │
    ▼
Outcome updated later (via API or auto)
    │
    └── setOutcomeUpdatedCallback() fires:
          ├── DecisionOutcomeLearner.learnFromOutcome()
          └── ModelPerformanceService.recordFromDecision()
```

#### Decision Outcomes

| Outcome | Meaning |
|---------|---------|
| `success` | Decision led to desired result |
| `failure` | Decision led to error or wrong result |
| `partial` | Partially achieved goal |
| `pending` | Outcome not yet determined |

### 9C — Outcome Learning

**Files:** `llm/decision-outcome-learner.ts`

```
learnFromOutcome(decisionId)
    │
    ├── Fetch decision record
    ├── LLM call with OUTCOME_LEARNING_PROMPT
    │     └── Generates 1-2 structured learnings
    │
    ├── Persist as memories with tags:
    │     ["auto-learned", "outcome:{success|failure}"]
    │
    └── correlateWithPastDecisions()
          ├── Query decisions of same type
          ├── ≥80% success across ≥2 decisions → store workflow_pattern
          └── ≥2 failures AND failures ≥ successes → store project_fact
                with tag "needs-attention"
```

---

## Tier 10 — Meta Reasoning + Strategy

### 10A — Meta Reasoner

**File:** `llm/meta-reasoner.ts`

```
MetaReasoner
    │
    ├── buildDecisionStats(sessionId)
    │     └── Groups decisions by type
    │           ├── total, successes, failures, pending
    │           └── successRate per type
    │
    ├── buildMetaContextString(sessionId)
    │     └── Returns [Self-Knowledge] block:
    │           ├── Decision History
    │           │     └── "tool_choice: 12 decisions, 75% success"
    │           ├── Learned Patterns
    │           │     └── memories tagged auto-learned or correlated
    │           ├── Areas Needing Attention
    │           │     └── types with <60% success, ≥2 uses
    │           └── Strategy Performance History
    │                 └── per-strategy stats from strategy-evaluator
    │
    └── reflectOnSession(sessionId)
          ├── Computes overall + per-type success rates
          └── Stores session_reflection_* memory
```

### 10B — Strategy Selector

**File:** `llm/strategy-selector.ts`

Strategies are **chosen by expected-value maximization**, not hardcoded rules.

#### Available Strategies

| Strategy | Best When |
|----------|-----------|
| `exploratory` | No prior data, new domain |
| `research_first` | Task requires up-to-date or external info |
| `template_driven` | Template evolution > structural changes |
| `confident` | Consistent past success on similar tasks |
| `cautious` | Mixed results, needs verification |

#### Selection Algorithm

```
recommend(sessionId) → { strategy, instruction }
    │
    ├── Get decision stats + strategy performance from DB
    │
    ├── For each strategy:
    │     ├── ≥2 observations → use observed success rate
    │     ├── else → use session overall success rate
    │     └── else → 0.50 (default)
    │
    ├── selected = argmax(expected_rate) across all strategies
    │
    ├── Check weak areas (decision types with <60% success, ≥2 uses)
    │     └── Injected into instruction but does NOT change strategy
    │         (avoids oscillating based on local signal)
    │
    └── Return { strategy: selected, instruction: [Strategy Recommendation] }
```

### 10C — Strategy Evaluator

**File:** `llm/strategy-evaluator.ts`

```
StrategyEvaluator
    │
    ├── getStrategyPerformance(sessionId)
    │     └── Groups decisions by metadata.strategy
    │           ├── strategy name, total, successes, failures
    │           ├── successRate, description
    │           └── Only counts decisions with metadata.strategy set
    │
    ├── buildStrategyContext(sessionId)
    │     └── Returns [Strategy Performance] text block
    │
    ├── getStrategyConvergence(sessionId)
    │     └── confidence = min(1, observations / 30)
    │         (30 observations = full statistical confidence)
    │
    └── storeStrategySummary(sessionId)
          └── Persists as memory with tag "strategy-performance"
```

### 10D — Model Performance Intelligence

**File:** `llm/model-performance-service.ts`

Tracks per-(model, provider, taskType) success rates for data-driven model selection.

```
ModelPerformanceService
    │
    ├── recordExecution(model, provider, taskType, success, latencyMs?, tokens?)
    │     └── Upserts with running averages
    │
    ├── recordFromDecision(decisionId)
    │     └── Reads model, provider, taskType from decision.metadata
    │
    ├── getBestModel(taskType, minConfidence?)
    │     └── Sorted by success rate, tie-break by total decisions
    │
    ├── recommendModel(taskType)
    │     └── Formatted: "gpt-4 (78% success, 45 execs, confidence 100%)"
    │
    └── getConvergence(taskType?)
          └── confidence = min(100, round(total / 30 * 100))
```

#### Task Types

| Type | Description |
|------|-------------|
| `coding` | Code generation |
| `debugging` | Error analysis |
| `planning` | Task decomposition |
| `research` | Information retrieval |
| `translation` | Language translation |
| `conversation` | General dialogue |
| `tool_use` | Tool orchestration |
| `agentic` | Multi-step autonomous work |

---

## Context Injection Order

LLM calls in agent mode receive three layers of injected context, applied in this order:

```
1. [Self-Knowledge]     ← MetaReasoner.buildMetaContextString()
   Decision stats + learned patterns + weak areas + strategy history

2. [Strategy Performance] ← StrategyEvaluator.buildStrategyContext()
   Per-strategy success rates + convergence

3. [Strategy Recommendation] ← StrategySelector.recommend()
   Selected strategy + instruction + weak area flags

4. [Relevant Memories]  ← MemoryRetrievalService.getRelevant()
   Top-N scored memories relevant to current query
```

Order rationale: identity context first (who I am) → capability context (what I do well) → task context (relevant memories).

---

## Fire-and-Forget Learning

All post-learning operations are async and do not block the response:

```
Session ends
    │
    ├── 🟢 extractConversationMemory()      → memory_store
    │     (tag: inferred)
    │
    ├── 🟢 learnFromSessionOutcomes()       → memory_store
    │     (tags: auto-learned, outcome:*)
    │
    ├── 🟢 reflectOnSession()               → memory_store
    │     (tag: meta-reflection)
    │
    ├── 🟢 evaluateStrategies()             → memory_store
    │     (tag: strategy-performance)
    │
    └── 🟢 modelPerformance.recordFromDecision()
          (via setOutcomeUpdatedCallback, tag: model-performance)
```

All fire-and-forget calls use `.catch(() => {})` — never block the response.

---

## Tag Index

Tags connect learning outputs to memory retrieval queries:

| Tag | Source | Purpose |
|-----|--------|---------|
| `inferred` | Auto-memory-extractor | LLM-extracted from conversation |
| `auto-learned` | Outcome learner | Learned from decision outcome |
| `correlated` | Outcome learner | Cross-decision pattern detected |
| `needs-attention` | Outcome learner | Area with repeated failures |
| `meta-reflection` | Meta-reasoner | Session-level reflection |
| `strategy-performance` | Strategy evaluator | Per-strategy stats |
| `model-performance` | Model performance | Per-model per-task stats |
| `outcome:success` | Outcome learner | Tag on memories derived from success |
| `outcome:failure` | Outcome learner | Tag on memories derived from failure |
