# LLM Query

Send a prompt to an LLM and get a response.

## Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| prompt_template | string | yes | — | The prompt to send to the LLM |
| system_prompt | string | no | You are a helpful assistant. | System-level instruction for the LLM |
| temperature | number | no | 0.7 | LLM temperature (0.0 to 1.0) |

## Trigger

`manual` — the workflow is triggered manually.

## Example

```json
{
  "prompt_template": "Summarize the latest quarterly results",
  "system_prompt": "You are a financial analyst.",
  "temperature": 0.3
}
```
