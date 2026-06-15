@echo off
SETLOCAL
SET ARELY_PROVIDER=ollama
SET ARELY_BASE_URL=http://localhost:11434/v1
SET ARELY_MODEL=qwen2.5:3b
SET ARELY_DEFAULT_MODEL=qwen2.5:3b
SET ARELY_API_KEY=
SET ARELY_PERMIT_WEBSEARCH=allow
SET ARELY_PERMIT_WEBFETCH=allow

echo Starting ARELY TUI with qwen2.5:3b via Ollama...
echo.
npx tsx packages\cli\src\index.tsx
