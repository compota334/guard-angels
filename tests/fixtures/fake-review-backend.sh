#!/usr/bin/env bash
# Fake backend script for testing the orchestrator.
# Reads the prompt from stdin, extracts the response file path from
# [OUTPUT INSTRUCTIONS], and writes a canned "proceed" response there.
#
# Environment variables:
# - FAKE_BACKEND_VERDICT: response verdict (default: proceed)
# - FAKE_BACKEND_CONCERNS: concerns text (default: empty)
# - FAKE_BACKEND_EXIT: exit code (default: 0)
# - FAKE_BACKEND_DELAY: sleep seconds before responding (default: 0)

set -euo pipefail

PROMPT=$(cat)

# Extract response path from the prompt
RESPONSE_PATH=$(echo "$PROMPT" | grep -oP 'Write your response to: \K.+' || true)

if [ -z "$RESPONSE_PATH" ]; then
  echo "ERROR: Could not find response path in prompt" >&2
  exit 1
fi

# Configurable parameters
VERDICT="${FAKE_BACKEND_VERDICT:-proceed}"
CONCERNS="${FAKE_BACKEND_CONCERNS:-}"
EXIT_CODE="${FAKE_BACKEND_EXIT:-0}"
DELAY="${FAKE_BACKEND_DELAY:-0}"

if [ "$DELAY" != "0" ]; then
  sleep "$DELAY"
fi

# Ensure the directory exists
mkdir -p "$(dirname "$RESPONSE_PATH")"

# Write the response file
cat > "$RESPONSE_PATH" <<RESPONSE
FROM: test-angel
TIMESTAMP: $(date -u +%Y-%m-%dT%H:%M:%SZ)
RESPONSE: ${VERDICT}

CONCERNS:
${CONCERNS}

PROPOSED PLAN:
No changes needed.

QUESTIONS FOR MAIN:


PROCEED IF:


TEST_RESULTS:


DRIFT REPORT:

RESPONSE

# Echo something to stdout for logging
echo "Fake backend invoked successfully. Verdict: ${VERDICT}"

exit "${EXIT_CODE}"
