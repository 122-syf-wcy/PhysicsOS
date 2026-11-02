#!/usr/bin/env bash
# Run the web app on this machine against the deployment's own services.
#
# The point is to change code, see it fail, and fix it here — instead of
# pushing to the server and waiting out a 10–18 minute image build for every
# attempt.
#
# What it connects to (all over one SSH tunnel, nothing exposed publicly):
#   postgres  → a dedicated `physicsos_dev` database on the deployment host,
#               same schema as production but separate data
#   redis     → the deployment's instance (shared-state only; dev traffic is
#               negligible and carries its own keyspace prefixes)
#
# Credentials are read from the host at start-up and never written to disk
# here. The model layer points straight at the upstream the deployment's pool
# routes to, so replies are real; the pool itself lives inside the app
# container and is not reachable from outside it.
#
#   scripts/dev/local-against-server.sh            # run on :3080
#   PHYSICSOS_LOCAL_PORT=3100 scripts/dev/local-against-server.sh
set -euo pipefail

REMOTE=${PHYSICSOS_REMOTE:-root@107.151.246.59}
PG_LOCAL_PORT=${PHYSICSOS_DEV_PG_PORT:-15432}
REDIS_LOCAL_PORT=${PHYSICSOS_DEV_REDIS_PORT:-16379}
APP_PORT=${PHYSICSOS_LOCAL_PORT:-3080}
DEV_DB=${PHYSICSOS_DEV_DB:-physicsos_dev}
DEV_HOME=${PHYSICSOS_DEV_HOME:-"$HOME/.physicsos-dev"}

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
HARNESS="$ROOT/vendor/deepseek-harness"

say() { printf 'local-against-server: %s\n' "$*"; }
die() { printf 'local-against-server: %s\n' "$*" >&2; exit 1; }

# The web app loads the built `lib/`, never the overlay sources. Editing a
# source file and restarting proves nothing on its own: the process keeps
# loading the previous `lib/index.js` and the change looks like it had no
# effect. Build first, then start:
#
#   scripts/dev/rebuild-package.sh packages/physicsos/paper-host
#   scripts/dev/local-against-server.sh
if [[ "${PHYSICSOS_SKIP_BUILD:-0}" != "1" ]]; then
  stale=$(find "$HARNESS/packages" -name 'index.ts' -path '*/src/*' -newer "$HARNESS/packages/physicsos/paper-host/lib/index.js" 2>/dev/null | head -1 || true)
  if [[ -n "$stale" ]]; then
    say 'WARNING: some sources are newer than the built lib/ — run scripts/dev/rebuild-package.sh first'
  fi
fi

say "reading service addresses from $REMOTE"
PG_URL=$(ssh -o BatchMode=yes "$REMOTE" 'cat /opt/physicsos/.env.database_url')
REDIS_URL=$(ssh -o BatchMode=yes "$REMOTE" 'cat /opt/physicsos/.env.redis_url')
IMAGE_KEY=$(ssh -o BatchMode=yes "$REMOTE" 'cat /opt/physicsos/.env.image_api_key' 2>/dev/null || true)
ADMIN_PASSWORD=$(ssh -o BatchMode=yes "$REMOTE" 'cat /opt/physicsos/.env.admin_password' 2>/dev/null || true)
# The bundle seeds `admin` unless told otherwise; production names its own.
ADMIN_USERNAME=$(ssh -o BatchMode=yes "$REMOTE" \
  'grep -E "^PHYSICSOS_ADMIN_USERNAME=" /opt/physicsos/.env 2>/dev/null | cut -d= -f2-' | tr -d '\n' || true)

[[ -n "$PG_URL" ]] || die 'could not read the database URL'
[[ -n "$REDIS_URL" ]] || die 'could not read the redis URL'

# Rewrite each URL's host:port onto the tunnel and point postgres at the dev
# database, keeping the credentials the deployment already uses.
# Replace host:port AND the trailing database name; leaving the original name
# in place produced a URL ending in "<dev-db><prod-db>".
PG_DEV_URL=$(printf '%s' "$PG_URL" | sed -E "s#@[^/]+/[^?]*#@127.0.0.1:${PG_LOCAL_PORT}/${DEV_DB}#")
REDIS_DEV_URL=$(printf '%s' "$REDIS_URL" | sed -E "s#@[^/]+/#@127.0.0.1:${REDIS_LOCAL_PORT}/#")

# One tunnel for both ports; reuse an existing one rather than stacking them.
if ! nc -z -w1 127.0.0.1 "$PG_LOCAL_PORT" 2>/dev/null ||
   ! nc -z -w1 127.0.0.1 "$REDIS_LOCAL_PORT" 2>/dev/null; then
  say "opening tunnel → 127.0.0.1:${PG_LOCAL_PORT}/${REDIS_LOCAL_PORT}"
  # The container addresses are read live: they change when compose recreates
  # the stack, and a stale one fails as "connection refused" much later.
  PG_ADDR=$(ssh -o BatchMode=yes "$REMOTE" \
    'docker inspect physicsos-postgres-1 --format "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"')
  REDIS_ADDR=$(ssh -o BatchMode=yes "$REMOTE" \
    'docker inspect physicsos-redis-1 --format "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"')
  [[ -n "$PG_ADDR" ]] || die 'postgres container has no address'
  [[ -n "$REDIS_ADDR" ]] || die 'redis container has no address'
  ssh -f -N \
    -L "${PG_LOCAL_PORT}:${PG_ADDR}:5432" \
    -L "${REDIS_LOCAL_PORT}:${REDIS_ADDR}:6379" \
    -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
    "$REMOTE"
  sleep 1
fi

nc -z -w2 127.0.0.1 "$PG_LOCAL_PORT" || die "tunnel to postgres is not up"
nc -z -w2 127.0.0.1 "$REDIS_LOCAL_PORT" || die "tunnel to redis is not up"

mkdir -p "$DEV_HOME"

# The model layer goes straight at the upstream pool target so replies are
# real, and the image endpoint is the one the deployment already uses.
FALLBACK_URL=$(ssh -o BatchMode=yes "$REMOTE" \
  'docker inspect physicsos-app-1 --format "{{range .Config.Env}}{{println .}}{{end}}" | sed -n "s/^PHYSICSOS_MODEL_FALLBACK_BASE_URL=//p"')
FALLBACK_KEY=$(ssh -o BatchMode=yes "$REMOTE" 'cat /opt/physicsos/.env.deepseek_api_key' 2>/dev/null || true)

say "starting dsh web on :${APP_PORT} against ${DEV_DB}"

# Built as an array: `${VAR:+NAME="$VAR"}` word-splits on a password containing
# spaces or quotes, and silently drops the whole assignment, which is how the
# first run came up with no bootstrap administrator.
ENVARGS=(
  DSH_HOME="$DEV_HOME"
  DSH_TELEMETRY_DISABLED=1
  DSH_CLIENT_TITLE=PhysicsOS
  PHYSICSOS_STORAGE_BACKEND=postgres
  PHYSICSOS_STORAGE_SCHEMA=physicsos
  DATABASE_URL="$PG_DEV_URL"
  PHYSICSOS_SHARED_STATE_BACKEND=redis
  REDIS_URL="$REDIS_DEV_URL"
)
[[ -n "$ADMIN_PASSWORD" ]] && ENVARGS+=(PHYSICSOS_ADMIN_PASSWORD="$ADMIN_PASSWORD")
[[ -n "$ADMIN_USERNAME" ]] && ENVARGS+=(PHYSICSOS_ADMIN_USERNAME="$ADMIN_USERNAME")
[[ -n "$FALLBACK_URL" ]] && ENVARGS+=(PHYSICSOS_MODEL_FALLBACK_BASE_URL="$FALLBACK_URL")
[[ -n "$FALLBACK_KEY" ]] && ENVARGS+=(PHYSICSOS_MODEL_FALLBACK_API_KEY="$FALLBACK_KEY")
[[ -n "$IMAGE_KEY" ]] && ENVARGS+=(PHYSICSOS_IMAGE_API_KEY="$IMAGE_KEY")

# The model layer is a profile patch rather than an env var: the pool id has to
# resolve to a registered provider, and without one every drafting call dies
# with NO_ADAPTER. Written next to the dev home so it does not shadow the
# deployment's own patch.
PATCH_FILE="$DEV_HOME/model.patch.yml"
cat > "$PATCH_FILE" <<YAML
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      physicsos-pool:
        displayName: 平台公益模型
        api: openai-completions
        baseURL: ${FALLBACK_URL:-https://api.fengshao1227.com/v1}
        apiKeyEnv: PHYSICSOS_MODEL_FALLBACK_API_KEY
        models:
          - id: deepseek-v4.1-flash
            name: 平台公益模型
            contextWindow: 1000000
            maxTokens: 32768

- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: physicsos-pool
    model: deepseek-v4.1-flash

YAML

env -u PHYSICOS_STORAGE_BACKEND "${ENVARGS[@]}" \
  node "$ROOT/vendor/deepseek-harness/apps/cli/lib/bin.js" web \
    --patch "$PATCH_FILE" \
    --port "$APP_PORT" --no-open \
    --trusted-host localhost --trusted-host 127.0.0.1
