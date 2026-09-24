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
prompt="Do the task described in $task. Read CLAUDE.md first. When finished, append a short '## Worker report' section to $task listing files changed, what is done, and anything left undone."
allowed=("Read" "Edit" "Write" "Glob" "Grep" "TodoWrite"
  "Bash(npm:*)" "Bash(npx:*)" "Bash(node:*)" "Bash(ls:*)" "Bash(cat:*)" "Bash(grep:*)"
  "Bash(sed:*)" "Bash(head:*)" "Bash(tail:*)" "Bash(find:*)" "Bash(wc:*)" "Bash(mkdir:*)"
  "Bash(awk:*)" "Bash(file:*)" "Bash(python3:*)")
denied=("Read(**/*.png)" "Read(**/*.jpg)" "Read(**/*.jpeg)" "Read(**/*.webp)" "Read(**/*.gif)")
# "scope: locked" tasks carry everything the worker needs (source excerpts pasted in by the
# orchestrator). The worker can't read the original game install and may only run npm/npx/node,
# so it translates and wires instead of searching.
locked=0
grep -qiE '^scope:\s*locked' "$task" && locked=1
case "$task" in *.fix[0-9].md) base="${task%.fix?.md}.md"; [ -f "$base" ] && grep -qiE '^scope:\s*locked' "$base" && locked=1;; esac
if [ "$locked" = 1 ]; then
  prompt="$prompt Everything you need is in the task file (source excerpts are pasted in it). Do not search for anything else: you cannot access the original game files. Only edit the files the task names. Start editing immediately."
  allowed=("Read" "Edit" "Write" "Glob" "Grep" "TodoWrite" "Bash(npm:*)" "Bash(npx:*)" "Bash(node:*)" "Bash(mkdir:*)")
  denied+=("Bash(node -e:*)" "Bash(node --eval:*)" "Bash(node -p:*)" "Read(//home/justinf/.local/share/Steam/**)" "Read(**/public/assets/**)" "Read(//home/justinf/data/**)")
fi
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
  claude -p "$prompt" \
    --permission-mode acceptEdits \
    --allowedTools "${allowed[@]}" \
    --disallowedTools "${denied[@]}" \
    --output-format stream-json --verbose > "$log" 2>&1
