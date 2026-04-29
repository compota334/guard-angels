#!/usr/bin/env bash
# Fake backend script for testing the SWEEP phase.
# Reads the prompt from stdin, extracts the response file path,
# writes a canned sweep response (done or concerns).
#
# Environment variables:
# - FAKE_BACKEND_VERDICT: response verdict (default: done)
# - FAKE_BACKEND_CONCERNS: concerns text (default: empty)
# - FAKE_BACKEND_DRIFT_REPORT: drift report text (default: "No drift detected.")
# - FAKE_BACKEND_ANGEL_MD_UPDATED: true|false (default: false)
# - FAKE_BACKEND_CABLES_SENT: cables sent text (default: none)
# - FAKE_BACKEND_FILES_CHANGED: files changed text (default: empty)
# - FAKE_BACKEND_EXIT: exit code (default: 0)

set -euo pipefail

PROMPT=$(cat)

# Extract response path from the prompt
RESPONSE_PATH=$(echo "$PROMPT" | grep -oP 'Write your response to: \K.+' || true)

if [ -z "$RESPONSE_PATH" ]; then
  echo "ERROR: Could not find response path in prompt" >&2
  exit 1
fi

# Configurable parameters
VERDICT="${FAKE_BACKEND_VERDICT:-done}"
CONCERNS="${FAKE_BACKEND_CONCERNS:-}"
DRIFT_REPORT="${FAKE_BACKEND_DRIFT_REPORT:-No drift detected.}"
ANGEL_MD_UPDATED="${FAKE_BACKEND_ANGEL_MD_UPDATED:-false}"
CABLES_SENT="${FAKE_BACKEND_CABLES_SENT:-none}"
FILES_CHANGED="${FAKE_BACKEND_FILES_CHANGED:-}"
EXIT_CODE="${FAKE_BACKEND_EXIT:-0}"

# Ensure the response directory exists
mkdir -p "$(dirname "$RESPONSE_PATH")"

# Write the response file
if [ "$VERDICT" = "done" ]; then
  cat > "$RESPONSE_PATH" <<RESPONSE
FROM: test-angel
TIMESTAMP: $(date -u +%Y-%m-%dT%H:%M:%SZ)
RESPONSE: done

CONCERNS:
${CONCERNS}

PROPOSED PLAN:

QUESTIONS FOR MAIN:


PROCEED IF:


TEST_RESULTS:


DRIFT REPORT:
${DRIFT_REPORT}

CABLES SENT: ${CABLES_SENT}
FILES CHANGED: ${FILES_CHANGED}
ANGEL_MD_UPDATED: ${ANGEL_MD_UPDATED}
RESPONSE
else
  cat > "$RESPONSE_PATH" <<RESPONSE
FROM: test-angel
TIMESTAMP: $(date -u +%Y-%m-%dT%H:%M:%SZ)
RESPONSE: ${VERDICT}

CONCERNS:
${CONCERNS}

PROPOSED PLAN:

QUESTIONS FOR MAIN:


PROCEED IF:


TEST_RESULTS:


DRIFT REPORT:
${DRIFT_REPORT}

RESPONSE
fi

# Echo something to stdout for logging
echo "Fake sweep backend invoked. Verdict: ${VERDICT}"

exit "${EXIT_CODE}"
