#!/usr/bin/env bash
# Runs worker tasks in order: scripts/run-queue.sh tasks/01b-....md tasks/01c-....md ...
# Per task: worker run -> gate (typecheck + tests + worker report) -> up to 2 fix passes -> local commit.
# Stops at the first task that fails its gate. Status lines go to tasks/queue.status.
set -uo pipefail
cd "$(dirname "$0")/.."
status() { echo "$(date +%T) $*" | tee -a tasks/queue.status; }

gate() {
  local out
  out=$( { npm run -s typecheck && npm test --silent; } 2>&1 ) && return 0
  printf '%s\n' "$out" | tail -60 > tasks/.gate-failure.txt
  return 1
}

for task in "$@"; do
  name=$(basename "$task" .md)
  status "START $name"
  scripts/worker.sh "$task" || status "worker exited non-zero on $name"
  ok=0
  for attempt in 1 2 3; do
    if gate && grep -q '^## Worker report' "$task"; then ok=1; break; fi
    [ "$attempt" = 3 ] && break
    status "GATE FAIL $name (fix pass $attempt)"
    fix="tasks/${name}.fix${attempt}.md"
    {
      echo "# Fix pass for $task"
      echo
      echo "The task in \`$task\` is not finished: \`npm run typecheck\` and \`npm test\` must pass, and \`$task\` must end with a '## Worker report' section."
      echo "Fix the code (do not weaken or delete tests that check source-faithful values). Last gate output:"
      echo; echo '```'; cat tasks/.gate-failure.txt 2>/dev/null; echo '```'
    } > "$fix"
    scripts/worker.sh "$fix" || true
  done
  if [ "$ok" != 1 ]; then status "STOP: $name failed its gate"; exit 1; fi
  git add -A && git -c user.name=dev -c user.email=dev@local commit -q -m "game: $name (worker)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && status "DONE $name $(git rev-parse --short HEAD)"
done
status "QUEUE EMPTY"
