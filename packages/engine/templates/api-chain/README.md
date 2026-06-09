# API Chain

Call one API, then pipe its result into a second API call.

## Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| first_url | string | yes | — | First API endpoint to call |
| second_url | string | yes | — | Second API endpoint to receive the result |
| first_method | string | no | GET | HTTP method for the first call |
| second_method | string | no | POST | HTTP method for the second call |

## Trigger

`manual` — the workflow is triggered manually.

## Example

```json
{
  "first_url": "https://api.example.com/users",
  "second_url": "https://api.example.com/process",
  "first_method": "GET",
  "second_method": "POST"
}
```
