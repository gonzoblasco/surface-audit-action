#!/usr/bin/env bash
# resolve-config.sh - decide QUÉ config corre el audit.
#
# Regla: una config declarada por el repo siempre gana. Si no hay, se genera una
# temporal autodetectando el directorio fuente. Esto es lo que permite que el
# action entre a un repo el primer día sin pedirle que escriba YAML.
#
# Vive en un script y no inline en action.yml porque un heredoc dentro de un
# `run: |` deja el delimitador a columna 0 y rompe el YAML del action.

set -euo pipefail

cd "${REPO_ROOT:?REPO_ROOT no definido}"

if [ -f "${CFG_INPUT:-}" ]; then
  echo "config=$CFG_INPUT" >> "$GITHUB_OUTPUT"
  echo "modo=declarada ($CFG_INPUT)" >> "$GITHUB_OUTPUT"
  exit 0
fi

TARGET="${PATH_INPUT:-}"

if [ -z "$TARGET" ]; then
  for cand in src app components styles public .; do
    [ -d "$cand" ] || continue
    if find "$cand" -maxdepth 6 -type f \
        \( -name '*.css' -o -name '*.scss' -o -name '*.tsx' -o -name '*.jsx' -o -name '*.vue' -o -name '*.svelte' \) \
        -not -path '*/node_modules/*' -print -quit | grep -q .; then
      TARGET="$cand"
      break
    fi
  done
fi

if [ -z "$TARGET" ]; then
  echo "::error::No se encontró superficie para auditar. Pasá el input 'path' o declará un config."
  exit 1
fi

DS_PATH="null"
if [ -n "${TOKENS_INPUT:-}" ] && [ -f "$TOKENS_INPUT" ]; then
  DS_PATH="\"$(dirname "$TOKENS_INPUT")\""
fi

TMP="${RUNNER_TEMP:-/tmp}/surface-audit"
mkdir -p "$TMP"

REPO_NAME="${GITHUB_REPOSITORY##*/}"

{
  echo "project:"
  echo "  name: \"$REPO_NAME\""
  echo "  design_system_path: $DS_PATH"
  echo "rules:"
  echo "  enforceTokens: true"
  echo "  blockHardcoded: true"
  echo "  aiLookVeto: true"
  echo "whitelist:"
  echo "  hex: []"
  echo "exclude: []"
} > "$TMP/enforcer.config.yaml"

{
  echo "project:"
  echo "  name: \"$REPO_NAME\""
  echo "stages:"
  echo "  - skill: design-system-enforcer"
  echo "    path: \"$TARGET\""
  echo "    config: \"$TMP/enforcer.config.yaml\""
  echo "gate:"
  echo "  block_on: [\"critical\", \"stage-error\"]"
  echo "  warn_on: [\"warning\", \"ai-look\", \"hardcoded-value\", \"misaligned\"]"
  echo "on_stage_error: block"
  echo "output:"
  echo "  dir: \"$TMP/reports\""
  echo "  formats: [json, html]"
} > "$TMP/pipeline.config.yaml"

echo "config=$TMP/pipeline.config.yaml" >> "$GITHUB_OUTPUT"
echo "modo=autodetectada (target: $TARGET)" >> "$GITHUB_OUTPUT"
