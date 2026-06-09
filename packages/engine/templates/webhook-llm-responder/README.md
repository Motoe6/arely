# Webhook LLM Responder

Receive a webhook, process it with an LLM, and respond with the result.

## Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| system_prompt | string | yes | — | System-level instruction for how to process webhook input |
| temperature | number | no | 0.7 | LLM temperature (0.0 to 1.0) |

## Trigger

`webhook` — the workflow runs when an HTTP POST is received at the webhook URL.

## Example

```json
{
  "system_prompt": "Classify the incoming webhook payload as 'urgent', 'normal', or 'low-priority'. Respond with just the classification.",
  "temperature": 0.3
}
```
