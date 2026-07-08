#!/usr/bin/env bash
# Fake claude CLI for testing ClaudeAdapter envelope parsing.
# Prints a JSON envelope like `claude -p --output-format json` and embeds the
# received argv so tests can assert which flags the adapter appended.
#
# Env vars:
#   CLAUDE_FAKE_BAD_JSON=true   Print plain text instead of the envelope
#   CLAUDE_FAKE_NO_SESSION=true Omit session_id from the envelope
#   CLAUDE_FAKE_EXIT=<n>        Exit code (default 0)

set -euo pipefail

if [ "${CLAUDE_FAKE_BAD_JSON:-}" = "true" ]; then
  printf 'plain text, not an envelope'
  exit "${CLAUDE_FAKE_EXIT:-0}"
fi

ARGS_JSON=""
for a in "$@"; do
  esc=$(printf '%s' "$a" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n' ' ')
  [ -n "$ARGS_JSON" ] && ARGS_JSON="$ARGS_JSON, "
  ARGS_JSON="$ARGS_JSON\"$esc\""
done

SESSION_PART='"session_id": "sess-fake-123", '
if [ "${CLAUDE_FAKE_NO_SESSION:-}" = "true" ]; then
  SESSION_PART=''
fi

printf '{"type": "result", "subtype": "success", "is_error": false, "result": "ok", %s"total_cost_usd": 0.42, "usage": {"input_tokens": 100, "cache_creation_input_tokens": 50, "cache_read_input_tokens": 25, "output_tokens": 10}, "argv": [%s]}\n' "$SESSION_PART" "$ARGS_JSON"

exit "${CLAUDE_FAKE_EXIT:-0}"
