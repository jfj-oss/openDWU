#!/usr/bin/env bash
# Runs a headless Claude Code worker on the local NInfer-4090 (Qwen3.8-27B) server.
# Usage: scripts/ninfer-worker.sh tasks/NN-name.md   (log -> tasks/NN-name.log)
set -euo pipefail
cd "$(dirname "$0")/.."
# Requests go through scripts/ninfer-proxy.py (:8099) so ninfer can reuse its prompt cache.
curl -sf -m 3 http://127.0.0.1:8099/health >/dev/null || {
  echo "ninfer-proxy not running on :8099 (start: python3 scripts/ninfer-proxy.py 8099)" >&2; exit 3; }
task="$1"; log="${task%.md}.log"
exec env \
  ANTHROPIC_BASE_URL="http://127.0.0.1:8099" \
  ANTHROPIC_AUTH_TOKEN="ninfer" \
  ANTHROPIC_MODEL="qwen3.8coding" \
  ANTHROPIC_SMALL_FAST_MODEL="qwen3.8coding" \
  ANTHROPIC_DEFAULT_SONNET_MODEL="qwen3.8coding" \
  ANTHROPIC_DEFAULT_OPUS_MODEL="qwen3.8coding" \
  ANTHROPIC_DEFAULT_HAIKU_MODEL="qwen3.8coding" \
  CLAUDE_CODE_EFFORT_LEVEL="medium" \
  CLAUDE_CODE_ATTRIBUTION_HEADER="0" \
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1" \
  API_TIMEOUT_MS="1800000" \
  CLAUDE_CODE_MAX_CONTEXT_TOKENS="108000" \
  claude -p "Do the task described in $task. Read CLAUDE.md first. When finished, append a short '## Worker report' section to $task listing files changed, what is done, and anything left undone." \
    --permission-mode acceptEdits \
    --allowedTools "Read" "Edit" "Write" "Glob" "Grep" "TodoWrite" \
      "Bash(npm:*)" "Bash(npx:*)" "Bash(node:*)" "Bash(ls:*)" "Bash(cat:*)" "Bash(grep:*)" \
      "Bash(sed:*)" "Bash(head:*)" "Bash(tail:*)" "Bash(find:*)" "Bash(wc:*)" "Bash(mkdir:*)" \
      "Bash(awk:*)" "Bash(file:*)" "Bash(python3:*)" \
    --disallowedTools "Read(**/*.png)" "Read(**/*.jpg)" "Read(**/*.jpeg)" "Read(**/*.webp)" "Read(**/*.gif)" \
    --output-format stream-json --verbose > "$log" 2>&1
