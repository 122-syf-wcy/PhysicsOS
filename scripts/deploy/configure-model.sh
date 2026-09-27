#!/usr/bin/env bash
# Ensure the hosted model is presented as the platform's public service while
# keeping the provider-owned model id unchanged.
set -euo pipefail

PROJECT_DIR=${PHYSICSOS_DIR:-/opt/physicsos}
DISPLAY_NAME=${PHYSICSOS_MODEL_DISPLAY_NAME:-平台公益模型}
MODEL_ID=${PHYSICSOS_MODEL_ID:-deepseek-v4-flash}

fail() {
  printf 'configure-model: %s\n' "$*" >&2
  exit 1
}

[[ "$DISPLAY_NAME" =~ ^[[:print:]]{1,40}$ ]] || fail 'invalid model display name'
[[ "$DISPLAY_NAME" != *'&'* && "$DISPLAY_NAME" != *'/'* ]] || fail 'model display name cannot contain & or /'
[[ "$MODEL_ID" =~ ^[A-Za-z0-9._:-]+$ ]] || fail 'invalid model id'
[[ -f "$PROJECT_DIR/compose.yml" ]] || fail "compose.yml not found under $PROJECT_DIR"

cd "$PROJECT_DIR"
docker compose exec -T app sh -eu -c '
settings=/var/lib/physicsos/settings.yaml
mkdir -p "$(dirname "$settings")"

if [ ! -s "$settings" ]; then
  cat >"$settings" <<EOF
llm-deepseek:
  maxTokens: 32768
  models:
    - id: '"$MODEL_ID"'
      name: '"$DISPLAY_NAME"'
      contextWindow: 1000000
      maxTokens: 32768

agent-default-model:
  provider: deepseek-official
  model: '"$MODEL_ID"'
  reasoningEffort: off
EOF
else
  sed -i "s/name: DeepSeek V4\\.1 Flash/name: '"$DISPLAY_NAME"'/g" "$settings"
  sed -i -E "s/^    - id: .*/    - id: '"$MODEL_ID"'/" "$settings"
  sed -i -E "s/^  model: .*/  model: '"$MODEL_ID"'/" "$settings"
  sed -i "s/^  reasoningEffort: .*/  reasoningEffort: off/" "$settings"
fi

grep -q "name: '"$DISPLAY_NAME"'" "$settings" || {
  printf "configure-model: display name was not applied\\n" >&2
  exit 1
}
grep -q "model: '"$MODEL_ID"'" "$settings" || {
  printf "configure-model: model id was not applied\\n" >&2
  exit 1
}
grep -q "reasoningEffort: off" "$settings" || {
  printf "configure-model: reasoning default was not applied\\n" >&2
  exit 1
}
'

printf 'configure-model: %s advertised as %s\n' "$MODEL_ID" "$DISPLAY_NAME"
