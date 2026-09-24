#!/usr/bin/env bash
# Runs a headless Claude Code worker on the local NInfer-4090 (Qwen3.8-27B) server.
# Usage: scripts/ninfer-worker.sh tasks/NN-name.md   (log -> tasks/NN-name.log)
set -euo pipefail
cd "$(dirname "$0")/.."
task="$1"; log="${task%.md}.log"
# Requests go through scripts/ninfer-proxy.py so ninfer can reuse its prompt cache.
# A task file line "thinking: off" (mechanical tasks: loaders, fixes, wiring) uses the
# thinking-disabled proxy on :8100; faithful simulation ports keep low-effort thinking on :8099.
port=8099
grep -qiE '^thinking:\s*off' "$task" && port=8100
# Fix passes inherit the setting of the task they fix.
case "$task" in *.fix[0-9].md) base="${task%.fix?.md}.md"; [ -f "$base" ] && grep -qiE '^thinking:\s*off' "$base" && port=8100;; esac
curl -sf -m 3 "http://127.0.0.1:$port/health" >/dev/null || {
  echo "ninfer-proxy not running on :$port (start: python3 scripts/ninfer-proxy.py 8099; NINFER_PROXY_THINKING=off python3 scripts/ninfer-proxy.py 8100)" >&2; exit 3; }
exec env \
  ANTHROPIC_BASE_URL="http://127.0.0.1:$port" \
  ANTHROPIC_AUTH_TOKEN="ninfer" \
  ANTHROPIC_MODEL="qwen3.8coding" \
  ANTHROPIC_SMALL_FAST_MODEL="qwen3.8coding" \
  ANTHROPIC_DEFAULT_SONNET_MODEL="qwen3.8coding" \
  ANTHROPIC_DEFAULT_OPUS_MODEL="qwen3.8coding" \
  ANTHROPIC_DEFAULT_HAIKU_MODEL="qwen3.8coding" \
  CLAUDE_CODE_EFFORT_LEVEL="low" \
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
