# Scheduled Monitor Analysis

Periodically fetch data from an HTTP endpoint and analyze it with an LLM.

## Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| target_url | string | yes | — | The data source URL to monitor |
| interval_ms | number | no | 300000 | How often to check in milliseconds |
| analysis_prompt | string | yes | — | Instructions for what to look for in the fetched data |

## Trigger

`schedule` — runs on a recurring interval.

## Example

```json
{
  "target_url": "https://status.example.com/api/incidents",
  "interval_ms": 600000,
  "analysis_prompt": "Review the incidents list and flag any that have been open for more than 24 hours without an update."
}
```
