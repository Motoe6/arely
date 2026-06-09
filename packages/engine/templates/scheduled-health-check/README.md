# Scheduled Health Check

Periodically check if an HTTP endpoint is responding.

## Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| target_url | string | yes | — | The URL to health-check |
| interval_ms | number | no | 60000 | How often to check in milliseconds |
| method | string | no | GET | HTTP method for the health check |
| timeout_ms | number | no | 30000 | Request timeout in milliseconds |

## Trigger

`schedule` — runs on a recurring interval.

## Example

```json
{
  "target_url": "https://api.example.com/health",
  "interval_ms": 300000,
  "method": "GET",
  "timeout_ms": 10000
}
```
