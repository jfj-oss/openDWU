#!/usr/bin/env bash
# Runs a headless Claude Code worker on one task file.
# Usage: scripts/worker.sh tasks/NN-name.md   (log -> tasks/NN-name.log)
# Default: Sonnet at low effort; a task can pick its model with a "model: haiku|sonnet|opus" line. WORKER=ninfer uses the local NInfer-4090 server instead.
set -euo pipefail
cd "$(dirname "$0")/.."
task="$1"; log="${task%.md}.log"

args=(
  -p "Do the task described in $task. Read CLAUDE.md first. When finished, append a short '## Worker report' section to $task listing files changed, what is done, and anything left undone."
  --permission-mode acceptEdits
  --allowedTools "Read" "Edit" "Write" "Glob" "Grep" "TodoWrite"
    "Bash(npm:*)" "Bash(npx:*)" "Bash(node:*)" "Bash(ls:*)" "Bash(cat:*)" "Bash(grep:*)"
    "Bash(sed:*)" "Bash(head:*)" "Bash(tail:*)" "Bash(find:*)" "Bash(wc:*)" "Bash(mkdir:*)"
    "Bash(awk:*)" "Bash(file:*)" "Bash(python3:*)"
  --output-format stream-json --verbose
)

if [ "${WORKER:-sonnet}" = ninfer ]; then
  exec "$(dirname "$0")/ninfer-worker.sh" "$task"
fi

# Per-task model: a line "model: haiku|sonnet|opus" near the top of the task file (default sonnet).
model=$(grep -m1 -oP '^model:\s*\K(haiku|sonnet|opus)' "$task" || true)
CLAUDE_CODE_EFFORT_LEVEL=low exec claude --model "${model:-sonnet}" "${args[@]}" > "$log" 2>&1
