# HTTP Webhook Proxy

Proxy incoming webhooks to a target endpoint with configurable header forwarding.

## Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| target_url | string | yes | — | The URL to proxy the webhook to |
| method | string | no | POST | HTTP method to use |
| forward_headers | boolean | no | true | Whether to forward original webhook headers |

## Trigger

`webhook` — the workflow runs when an HTTP POST is received at the webhook URL.

## Example

```json
{
  "target_url": "https://internal.example.com/api/events",
  "method": "POST",
  "forward_headers": true
}
```
