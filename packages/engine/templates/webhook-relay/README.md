# Webhook Relay

Receive a webhook and relay its payload to another HTTP endpoint.

## Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| target_url | string | yes | — | The URL to forward the webhook payload to |
| method | string | no | POST | HTTP method to use when forwarding |
| headers | json | no | {} | Additional headers to include in the relay request |

## Trigger

`webhook` — the workflow runs when an HTTP POST is received at the webhook URL.

## Example

```json
{
  "target_url": "https://hooks.example.com/events",
  "method": "POST",
  "headers": { "X-Source": "opencode-webhook" }
}
```
