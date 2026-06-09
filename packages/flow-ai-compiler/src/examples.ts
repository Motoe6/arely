import type { LLMWorkflowOutput } from "./schema.js"

export const FEW_SHOT_EXAMPLES: { input: string; output: LLMWorkflowOutput }[] = [
  {
    input: "When a user signs up, send a welcome email",
    output: {
      workflow: {
        id: "signup-welcome",
        version: "1.0.0",
        trigger: { type: "webhook", config: { path: "user/signup" } },
        steps: [{ id: "send_email", type: "email", input: { template: "welcome" } }],
      },
      confidence: 0.95,
      assumptions: ["Signup webhook path assumed as user/signup", "Email template name assumed as welcome"],
    },
  },
  {
    input: "If payment fails, retry up to 3 times then notify admin",
    output: {
      workflow: {
        id: "payment-retry",
        version: "1.0.0",
        trigger: { type: "webhook", config: { path: "payment/failed" } },
        steps: [
          {
            id: "retry_payment",
            type: "payment.retry",
            input: {},
            onFailure: { retry: { maxAttempts: 3, delayMs: 1000 } },
          },
          { id: "notify_admin", type: "email", input: { template: "payment_failed_admin" }, next: "retry_payment" },
        ],
      },
      confidence: 0.9,
      assumptions: ["Payment system available as payment.retry node"],
    },
  },
  {
    input: "Summarize incoming webhook data using AI",
    output: {
      workflow: {
        id: "ai-summarize",
        version: "1.0.0",
        trigger: { type: "webhook", config: { path: "data/incoming" } },
        steps: [{ id: "summarize", type: "llm", input: { prompt: "Summarize: {{ trigger.payload }}" } }],
      },
      confidence: 0.92,
      assumptions: ["LLM node available", "Trigger payload passed as context"],
    },
  },
  {
    input: "Every hour, check server status and send alert if down",
    output: {
      workflow: {
        id: "health-check",
        version: "1.0.0",
        trigger: { type: "interval", config: { intervalMs: 3600000 } },
        steps: [
          { id: "check_status", type: "http", input: { url: "{{ secrets.health_endpoint }}", method: "GET" } },
          { id: "send_alert", type: "email", input: { template: "server_down" }, next: "check_status" },
        ],
      },
      confidence: 0.88,
      assumptions: ["Health endpoint stored in secrets"],
    },
  },
]
