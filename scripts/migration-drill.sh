#!/usr/bin/env bash
#
# Rehearses the two things a deploy must get right about migrations, on a database
# that exists only for the length of this script (22-acceptance-criteria.md #24,
# 21-mvp-roadmap.md Stage 15):
#
#   1. A migration that fails halts everything and leaves data and schema exactly as
#      they were - including the valid statements earlier in the same file.
#   2. The newest migration can be reversed with its down.sql and re-applied.
#
# It starts its own PostgreSQL container on a port of its own, writes synthetic rows,
# and removes the container at the end. It never reads DATABASE_URL from .env, so it
# cannot touch the development, test or production databases by mistake. The
# deliberately broken migration lives only for the duration of step 4 and is deleted
# by the trap below even if the script is interrupted.
#
#   ./scripts/migration-drill.sh            # default port 45432
#   DRILL_PORT=45999 ./scripts/migration-drill.sh
#
# Run it before any deploy whose migration you are not certain of.

set -Eeuo pipefail
cd "$(dirname "$0")/.."

CONTAINER="${DRILL_CONTAINER:-agency-hub-migration-drill}"
PORT="${DRILL_PORT:-45432}"
OWNER=drill
OWNER_PW=drill-owner-pw
DB=drill
export DATABASE_URL="postgresql://agency_hub_app:drill-app-pw@localhost:${PORT}/${DB}?connection_limit=5"
export DB_OWNER_USER="$OWNER"
export DB_OWNER_PASSWORD="$OWNER_PW"
BROKEN=apps/api/prisma/migrations/99999999999999_drill_deliberately_broken
LOG="$(mktemp)"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m!!! %s\033[0m\n' "$1" >&2; exit 1; }
sql() { docker exec -i "$CONTAINER" psql -U "$OWNER" -d "$DB" -tA -c "$1"; }
migrate() { node apps/api/scripts/prisma.mjs "$@"; }

cleanup() {
  rm -rf "$BROKEN" "$LOG"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ── 1. A database nobody else is using ────────────────────────────────────────
step "Disposable PostgreSQL on :$PORT"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -e POSTGRES_USER="$OWNER" -e POSTGRES_PASSWORD="$OWNER_PW" \
  -e POSTGRES_DB="$DB" -p "${PORT}:5432" postgres:16-alpine >/dev/null
# The image initialises with a temporary server and restarts, so wait for the
# "ready" line to appear twice rather than trusting the first pg_isready.
for _ in $(seq 1 60); do
  if [ "$(docker logs "$CONTAINER" 2>&1 | grep -c 'database system is ready to accept connections')" -ge 2 ] &&
    docker exec "$CONTAINER" pg_isready -U "$OWNER" -d "$DB" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U "$OWNER" -d "$DB" >/dev/null || fail "PostgreSQL never became ready."

# ── 2. The same steps the deploy runs (db:setup) ──────────────────────────────
step "Provisioning the application role and applying every migration"
node apps/api/scripts/provision-app-role.mjs "$DATABASE_URL"
migrate migrate deploy >"$LOG" 2>&1 || { cat "$LOG"; fail "The current migrations do not apply cleanly."; }
APPLIED="$(sql "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")"
echo "Applied migrations: $APPLIED"

step "Synthetic rows to protect"
sql "INSERT INTO companies (name, updated_at) VALUES ('Empresa de exercício', now())" >/dev/null
ROWS_BEFORE="$(sql "SELECT count(*) FROM companies")"
TABLES_BEFORE="$(sql "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
echo "companies=$ROWS_BEFORE tables=$TABLES_BEFORE"

# ── 3. A migration that cannot succeed ────────────────────────────────────────
step "Adding a deliberately broken migration (one valid statement, then one that fails)"
mkdir -p "$BROKEN"
cat >"$BROKEN/migration.sql" <<'SQL'
-- DRILL ONLY. Created and deleted by scripts/migration-drill.sh; never commit this.
ALTER TABLE "companies" ADD COLUMN "drill_marker" TEXT;
ALTER TABLE "table_that_does_not_exist" ADD COLUMN "boom" INTEGER;
SQL

step "CI's migration review refuses it"
if node scripts/check-migrations.mjs >"$LOG" 2>&1; then
  fail "check-migrations accepted a migration with no down.sql."
fi
grep -- '- 99999999999999' "$LOG" | sed 's/^/    /'

step "migrate deploy fails and stops"
if migrate migrate deploy >"$LOG" 2>&1; then
  fail "migrate deploy succeeded; it must not have."
fi
grep -E 'Error: P30|does not exist' "$LOG" | head -2 | sed 's/^/    /'

step "Nothing changed: not the rows, not the tables, not even the valid ALTER"
MARKER="$(sql "SELECT count(*) FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'drill_marker'")"
ROWS_AFTER="$(sql "SELECT count(*) FROM companies")"
TABLES_AFTER="$(sql "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
echo "companies=$ROWS_AFTER tables=$TABLES_AFTER drill_marker_columns=$MARKER"
[ "$ROWS_AFTER" = "$ROWS_BEFORE" ] || fail "Row count changed."
[ "$TABLES_AFTER" = "$TABLES_BEFORE" ] || fail "Table count changed."
[ "$MARKER" = "0" ] || fail "The valid statement of the failed migration was kept."
[ "$(sql "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL")" = "1" ] ||
  fail "The failed migration was not recorded."

step "A second deploy is refused until someone resolves it - no silent retry"
if migrate migrate deploy >"$LOG" 2>&1; then
  fail "A deploy over a failed migration succeeded."
fi
grep -E 'Error: P3009' "$LOG" | sed 's/^/    /'

# ── 4. Recovery ───────────────────────────────────────────────────────────────
step "Recovery: mark it rolled back, remove it, deploy again"
migrate migrate resolve --rolled-back 99999999999999_drill_deliberately_broken >"$LOG" 2>&1 ||
  { cat "$LOG"; fail "migrate resolve failed."; }
rm -rf "$BROKEN"
migrate migrate deploy >"$LOG" 2>&1 || { cat "$LOG"; fail "Deploy after recovery failed."; }
# The failed row stays, marked rolled back, which is the audit trail you want.
echo "rolled_back_at set on the failed row: $(sql "SELECT count(*) FROM _prisma_migrations WHERE rolled_back_at IS NOT NULL")"
node scripts/check-migrations.mjs

# ── 5. Reversing the newest real migration ────────────────────────────────────
step "Rollback drill: down.sql of the newest migration, then re-apply"
NEWEST="$(sql "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1")"
echo "Newest: $NEWEST"
node apps/api/scripts/migrate-down.mjs
echo "Applied after down: $(sql "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL") (was $APPLIED)"
[ "$(sql "SELECT count(*) FROM companies")" = "$ROWS_BEFORE" ] || fail "Rolling back lost rows."
migrate migrate deploy >"$LOG" 2>&1 || { cat "$LOG"; fail "Re-applying after the rollback failed."; }
[ "$(sql "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")" = "$APPLIED" ] ||
  fail "Not every migration came back."
echo "Applied after re-deploy: $APPLIED"

step "Drill passed. Removing the disposable database."
