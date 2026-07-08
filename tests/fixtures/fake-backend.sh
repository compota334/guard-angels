#!/usr/bin/env bash
# Unified fake backend script for Guard Angels integration tests.
# Reads the prompt from stdin, extracts the PHASE and response file path,
# dispatches to a phase-specific handler, and writes a canned JSON response
# (the v0.3.0 response contract — see src/protocol/response-schema.ts).
#
# Portable POSIX bash. No external deps beyond grep/sed/awk.
#
# Supported phases: REVIEW, EXECUTE, INIT, SWEEP, DISCOVERY, ASK
#
# Environment variables (all optional):
#
# Common:
#   FAKE_BACKEND_VERDICT     Response verdict (default varies by phase)
#   FAKE_BACKEND_CONCERNS    Concerns text (default: empty)
#   FAKE_BACKEND_EXIT        Exit code (default: 0)
#   FAKE_BACKEND_DELAY       Sleep seconds before responding (default: 0)
#
# EXECUTE / SWEEP only:
#   FAKE_BACKEND_FILES_CHANGED     Comma-separated list of files "changed"
#   FAKE_BACKEND_ANGEL_MD_UPDATED  true|false (default: false)
#   FAKE_BACKEND_CABLES_SENT       Comma-separated "to: type" pairs, or "none"
#   FAKE_BACKEND_DRIFT_REPORT      Drift report text (default: empty)
#
# EXECUTE only:
#   FAKE_BACKEND_WRITE_FILES    Comma-separated ABSOLUTE paths to actually create
#   FAKE_BACKEND_WRITE_CONTENT  Content for each created file (default: "modified by angel")
#
# ASK only:
#   FAKE_BACKEND_ANSWER      Answer text placed in proposed_plan
#
# Echo backend mode (no response file):
#   FAKE_BACKEND_ECHO_MODE   Set to "true" to just echo stdin (like echo-backend.sh)
#   ECHO_BACKEND_EXTRA       Extra text to print before echoing stdin
#   ECHO_BACKEND_EXIT        Exit code for echo mode (default: 0)
#
# Stderr mode:
#   FAKE_BACKEND_STDERR_MODE Set to "true" to write to stderr and exit non-zero

set -euo pipefail

# --- Stderr mode (replaces stderr-backend.sh) ---
if [ "${FAKE_BACKEND_STDERR_MODE:-}" = "true" ]; then
  cat >/dev/null
  echo "something went wrong" >&2
  exit "${ECHO_BACKEND_EXIT:-1}"
fi

# --- Echo mode (replaces echo-backend.sh) ---
if [ "${FAKE_BACKEND_ECHO_MODE:-}" = "true" ]; then
  if [ -n "${ECHO_BACKEND_EXTRA:-}" ]; then
    printf '%s\n' "$ECHO_BACKEND_EXTRA"
  fi
  cat
  exit "${ECHO_BACKEND_EXIT:-0}"
fi

# --- Standard fake backend: read prompt, detect phase, write JSON response ---

PROMPT=$(cat)

# Extract response path from the prompt
RESPONSE_PATH=$(echo "$PROMPT" | sed -n 's/^Write your response to: //p' | head -1)

if [ -z "$RESPONSE_PATH" ]; then
  echo "ERROR: Could not find response path in prompt" >&2
  exit 1
fi

# Detect phase from the prompt (look for PHASE: line in the brief section)
PHASE=$(echo "$PROMPT" | sed -n 's/^PHASE: //p' | head -1)
if [ -z "$PHASE" ]; then
  PHASE="review"
fi

# Common parameters
EXIT_CODE="${FAKE_BACKEND_EXIT:-0}"
DELAY="${FAKE_BACKEND_DELAY:-0}"
CONCERNS="${FAKE_BACKEND_CONCERNS:-}"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [ "$DELAY" != "0" ]; then
  sleep "$DELAY"
fi

# Ensure the response directory exists
mkdir -p "$(dirname "$RESPONSE_PATH")"

# --- JSON helpers ---

# Escape a string for inclusion inside a JSON string literal:
# backslash, double quote, and newlines (joined as \n).
json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'NR>1{printf "\\n"} {printf "%s", $0}'
}

# "a, b ,c" -> "a", "b", "c"   ("" or "none" -> empty)
files_json() {
  local input="$1" out="" item
  if [ -z "$input" ] || [ "$input" = "none" ]; then
    printf ''
    return
  fi
  IFS=',' read -ra ITEMS <<< "$input"
  for item in "${ITEMS[@]}"; do
    item=$(echo "$item" | xargs)
    [ -z "$item" ] && continue
    [ -n "$out" ] && out="$out, "
    out="$out\"$(json_escape "$item")\""
  done
  printf '%s' "$out"
}

# "src-api: fyi, src-db: breaking_change" -> {"to": "src-api", "type": "fyi"}, ...
# ("" or "none" -> empty)
cables_json() {
  local input="$1" out="" pair to type
  if [ -z "$input" ] || [ "$input" = "none" ]; then
    printf ''
    return
  fi
  IFS=',' read -ra PAIRS <<< "$input"
  for pair in "${PAIRS[@]}"; do
    pair=$(echo "$pair" | xargs)
    [ -z "$pair" ] && continue
    to=$(echo "$pair" | cut -d':' -f1 | xargs)
    type=$(echo "$pair" | cut -d':' -f2- | xargs)
    [ -n "$out" ] && out="$out, "
    out="$out{\"to\": \"$(json_escape "$to")\", \"type\": \"$(json_escape "$type")\"}"
  done
  printf '%s' "$out"
}

# true|yes -> true, everything else -> false
bool_json() {
  case "$1" in
    true|yes) printf 'true' ;;
    *) printf 'false' ;;
  esac
}

# Write the response JSON.
#   $1 verdict   $2 proposed_plan   $3 drift_report   $4 include done-only fields (0|1)
emit_response() {
  local verdict="$1" plan="$2" drift="$3" include_done="$4"
  {
    printf '{\n'
    printf '  "format_version": 1,\n'
    printf '  "from": "test-angel",\n'
    printf '  "timestamp": "%s",\n' "$TIMESTAMP"
    printf '  "verdict": "%s",\n' "$verdict"
    printf '  "concerns": "%s",\n' "$(json_escape "$CONCERNS")"
    printf '  "proposed_plan": "%s",\n' "$(json_escape "$plan")"
    printf '  "drift_report": "%s"' "$(json_escape "$drift")"
    if [ "$include_done" = "1" ]; then
      printf ',\n'
      printf '  "cables_sent": [%s],\n' "$(cables_json "${CABLES_SENT:-none}")"
      printf '  "files_changed": [%s],\n' "$(files_json "${FILES_CHANGED:-}")"
      printf '  "angel_md_updated": %s\n' "$(bool_json "${ANGEL_MD_UPDATED:-false}")"
    else
      printf '\n'
    fi
    printf '}\n'
  } > "$RESPONSE_PATH"
}

# --- EXECUTE phase ---
if [ "$PHASE" = "execute" ]; then
  VERDICT="${FAKE_BACKEND_VERDICT:-done}"
  FILES_CHANGED="${FAKE_BACKEND_FILES_CHANGED:-}"
  ANGEL_MD_UPDATED="${FAKE_BACKEND_ANGEL_MD_UPDATED:-false}"
  CABLES_SENT="${FAKE_BACKEND_CABLES_SENT:-none}"
  DRIFT_REPORT="${FAKE_BACKEND_DRIFT_REPORT:-}"
  WRITE_FILES="${FAKE_BACKEND_WRITE_FILES:-}"
  WRITE_CONTENT="${FAKE_BACKEND_WRITE_CONTENT:-modified by angel}"

  # Actually create/modify files to simulate angel work
  if [ -n "$WRITE_FILES" ]; then
    IFS=',' read -ra FILES <<< "$WRITE_FILES"
    for FILE in "${FILES[@]}"; do
      FILE=$(echo "$FILE" | xargs) # trim whitespace
      mkdir -p "$(dirname "$FILE")"
      echo "$WRITE_CONTENT" > "$FILE"
    done
  fi

  if [ "$VERDICT" = "done" ]; then
    emit_response "$VERDICT" "Changes applied as requested." "$DRIFT_REPORT" 1
  else
    emit_response "$VERDICT" "Document findings and notify main agent." "$DRIFT_REPORT" 0
  fi

  echo "Fake execute backend invoked. Verdict: ${VERDICT}"

# --- SWEEP phase ---
elif [ "$PHASE" = "sweep" ]; then
  VERDICT="${FAKE_BACKEND_VERDICT:-done}"
  DRIFT_REPORT="${FAKE_BACKEND_DRIFT_REPORT:-No drift detected.}"
  ANGEL_MD_UPDATED="${FAKE_BACKEND_ANGEL_MD_UPDATED:-false}"
  CABLES_SENT="${FAKE_BACKEND_CABLES_SENT:-none}"
  FILES_CHANGED="${FAKE_BACKEND_FILES_CHANGED:-}"

  if [ "$VERDICT" = "done" ]; then
    emit_response "$VERDICT" "" "$DRIFT_REPORT" 1
  else
    emit_response "$VERDICT" "Document findings and notify main agent." "$DRIFT_REPORT" 0
  fi

  echo "Fake sweep backend invoked. Verdict: ${VERDICT}"

# --- DISCOVERY / INIT phase ---
elif [ "$PHASE" = "discovery" ] || [ "$PHASE" = "init" ]; then
  VERDICT="${FAKE_BACKEND_VERDICT:-done}"
  CABLES_SENT="none"
  FILES_CHANGED=""
  ANGEL_MD_UPDATED="true"

  DISCOVERY_BODY='## Charter
Owns authentication and session management utilities for the project.

## Public contract
Exports session middleware and auth helpers consumed by the application layer.

## Invariants
- Session tokens must never be logged in plaintext.
- Auth state is managed exclusively within this folder.

## Decision log
Initial discovery by fake backend.

## Open questions

## Dependencies
None identified during fake discovery.'

  if [ "$VERDICT" = "done" ]; then
    emit_response "$VERDICT" "$DISCOVERY_BODY" "" 1
  else
    emit_response "$VERDICT" "$DISCOVERY_BODY" "" 0
  fi

  echo "Fake discovery/init backend invoked. Verdict: ${VERDICT}"

# --- ASK phase ---
elif [ "$PHASE" = "ask" ]; then
  ANSWER="${FAKE_BACKEND_ANSWER:-The answer to your question is: this is a fake backend response.}"
  CABLES_SENT="none"
  FILES_CHANGED=""
  ANGEL_MD_UPDATED="false"

  emit_response "done" "$ANSWER" "" 1

  echo "Fake ask backend invoked."

# --- REVIEW phase (default) ---
else
  VERDICT="${FAKE_BACKEND_VERDICT:-proceed}"

  emit_response "$VERDICT" "No changes needed." "" 0

  echo "Fake backend invoked successfully. Verdict: ${VERDICT}"
fi

exit "${EXIT_CODE}"
