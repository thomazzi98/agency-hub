#!/usr/bin/env bash
#
# Deploys, or rolls back, the production stack (docs/sdd/19-deployment-and-cicd.md).
#
# This script is the *only* implementation of "deploy". GitHub Actions runs it over
# SSH and a person runs it by hand with the same arguments, so the automated and the
# manual path cannot drift apart — which is the whole reason the spec asks for both.
#
#   ./scripts/deploy.sh <image-tag>
#
# A rollback is the same command with an earlier tag. That is deliberate: there is one
# procedure to remember, and it is the one people have already run.
#
# What it will never do, under any argument (16-security-requirements.md,
# 11-backup-and-recovery.md):
#   - remove the PostgreSQL volume, or any volume;
#   - run `docker compose down -v`;
#   - delete data to recover from a failed deploy. It stops and says so instead.

set -Eeuo pipefail

TAG="${1:-}"
APP_DIR="${APP_DIR:-/opt/agency-hub}"
REGISTRY="${REGISTRY:-ghcr.io}"
IMAGE_REPO="${IMAGE_REPO:?IMAGE_REPO must be set, e.g. owner/agency-hub}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/health/ready}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-30}"

if [[ -z "$TAG" ]]; then
  echo "usage: $0 <image-tag>" >&2
  echo "       the tag to deploy, or an earlier one to roll back to" >&2
  exit 2
fi

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m!!! %s\033[0m\n' "$1" >&2; exit 1; }

# ── Preflight ────────────────────────────────────────────────────────────────
say "Checking the environment before touching anything"

cd "$APP_DIR" || fail "APP_DIR $APP_DIR does not exist. Provision the VPS first (docs/deployment.md)."
[[ -f "$COMPOSE_FILE" ]] || fail "$COMPOSE_FILE is missing in $APP_DIR."
[[ -f .env ]] || fail ".env is missing in $APP_DIR. It holds the secrets and is never committed."

command -v docker >/dev/null || fail "docker is not installed."
docker compose version >/dev/null || fail "docker compose v2 is not available."

# The network other projects on this host join so this Caddy can serve them
# (deploy/Caddyfile). The compose file declares it external, so it has to exist
# before any compose command runs; creating it is idempotent.
docker network inspect edge >/dev/null 2>&1 || docker network create edge >/dev/null

export API_IMAGE="${REGISTRY}/${IMAGE_REPO}-api:${TAG}"
export WEB_IMAGE="${REGISTRY}/${IMAGE_REPO}-web:${TAG}"

# Records what was live before this ran. A rollback needs to know where to go back to,
# and the answer must survive the deploy that is about to replace it.
PREVIOUS_TAG="$(cat .deployed-tag 2>/dev/null || echo 'none')"
echo "Currently deployed: ${PREVIOUS_TAG}"
echo "Deploying:          ${TAG}"

# ── Pull ─────────────────────────────────────────────────────────────────────
say "Pulling images"
docker compose -f "$COMPOSE_FILE" pull api web ||
  fail "Could not pull ${TAG}. Nothing was changed; the running version is untouched."

# ── Migrate ──────────────────────────────────────────────────────────────────
# A separate, awaited step before anything restarts — never a side effect of an
# application container starting, which could race two replicas against each other.
say "Applying migrations"
if ! docker compose -f "$COMPOSE_FILE" run --rm migrate; then
  fail "Migrations failed. The running services were NOT restarted and the database
volume was NOT touched. Investigate before retrying; if the migration was destructive,
restore the pre-migration backup (docs/deployment.md#rollback)."
fi

say "Schema version now live"
docker compose -f "$COMPOSE_FILE" run --rm --entrypoint sh migrate \
  -c 'npx prisma migrate status --schema apps/api/prisma/schema.prisma' || true

# ── Restart ──────────────────────────────────────────────────────────────────
# Only the services whose image changed. Postgres is deliberately absent: it restarts
# when its own image is updated, by hand, not as a side effect of shipping a feature.
say "Restarting application services"
docker compose -f "$COMPOSE_FILE" up -d --no-deps api worker web

# ── Health ───────────────────────────────────────────────────────────────────
say "Waiting for the API to report ready"
for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
  if docker compose -f "$COMPOSE_FILE" exec -T api wget -qO- "$HEALTH_URL" >/dev/null 2>&1; then
    echo "$TAG" > .deployed-tag
    say "Deployed ${TAG} successfully (previous: ${PREVIOUS_TAG})"
    docker image prune -f --filter 'until=168h' >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 2
  printf '.'
done

fail "The API never became ready after ${HEALTH_ATTEMPTS} attempts.
Nothing was rolled back automatically — this script does not guess. To go back:

    ./scripts/deploy.sh ${PREVIOUS_TAG}

Logs: docker compose -f ${COMPOSE_FILE} logs --tail 200 api"
