#!/usr/bin/env bash
#
# Restores a backup downloaded from the admin screen into a PostgreSQL that exists
# only for the length of this script, and reports what came back. This is the restore
# test 11-backup-and-recovery.md asks for at least monthly: a backup nobody has
# restored is a file, not a backup.
#
#   ./scripts/restore-drill.sh ~/Downloads/database-backup-2026-09-14-181146.dump
#
# The dump is `pg_dump --format=custom --no-owner --no-acl`, so it restores into any
# role. An encrypted backup (BACKUP_ENCRYPTION_KEY set) is decrypted by the API while
# it is downloaded, so the file on disk is always a plain custom-format dump.
#
# Nothing here reads .env or touches any existing database or volume. The container
# is removed by the trap below even if the script is interrupted.

set -Eeuo pipefail
# Git Bash on Windows rewrites arguments that look like POSIX paths (/tmp/x) into
# Windows paths before docker sees them; this keeps them intact. Harmless elsewhere.
export MSYS_NO_PATHCONV=1

DUMP="${1:-}"
CONTAINER="${DRILL_CONTAINER:-agency-hub-restore-drill}"
PORT="${DRILL_PORT:-45433}"
DB=restore_check
USER_NAME=restore

[[ -n "$DUMP" ]] || { echo "usage: $0 <backup.dump>" >&2; exit 2; }
[[ -f "$DUMP" ]] || { echo "$DUMP does not exist" >&2; exit 2; }
[[ "$(head -c 5 "$DUMP")" == "PGDMP" ]] || {
  echo "$DUMP is not a pg_dump custom-format file (no PGDMP header)." >&2
  echo "If BACKUP_ENCRYPTION_KEY is set, download it through the admin screen: the API decrypts it on the way out." >&2
  exit 2
}

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m!!! %s\033[0m\n' "$1" >&2; exit 1; }
sql() { docker exec -i "$CONTAINER" psql -U "$USER_NAME" -d "$DB" -tA -c "$1"; }

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

step "Disposable PostgreSQL 16 on :$PORT"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -e POSTGRES_USER="$USER_NAME" -e POSTGRES_PASSWORD=restore-drill-pw \
  -e POSTGRES_DB="$DB" -p "${PORT}:5432" postgres:16-alpine >/dev/null
for _ in $(seq 1 60); do
  if [ "$(docker logs "$CONTAINER" 2>&1 | grep -c 'database system is ready to accept connections')" -ge 2 ] &&
    docker exec "$CONTAINER" pg_isready -U "$USER_NAME" -d "$DB" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U "$USER_NAME" -d "$DB" >/dev/null || fail "PostgreSQL never became ready."

step "pg_restore $(basename "$DUMP") ($(wc -c <"$DUMP") bytes)"
docker cp "$DUMP" "$CONTAINER:/tmp/backup.dump"
# --exit-on-error: a partial restore that looks complete is the failure mode to fear.
docker exec "$CONTAINER" pg_restore -U "$USER_NAME" -d "$DB" --no-owner --no-acl --exit-on-error /tmp/backup.dump ||
  fail "pg_restore reported errors; the backup is not restorable as-is."

step "What came back"
printf '  %-28s %s\n' "tables" "$(sql "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
printf '  %-28s %s\n' "indexes" "$(sql "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'")"
printf '  %-28s %s\n' "tables with RLS" "$(sql "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND rowsecurity")"
printf '  %-28s %s\n' "policies" "$(sql "SELECT count(*) FROM pg_policies")"
printf '  %-28s %s\n' "schema version" "$(sql "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1")"
for table in users companies projects files content pending_requests notifications campaigns audit_logs; do
  printf '  %-28s %s\n' "$table" "$(sql "SELECT count(*) FROM \"$table\"")"
done

step "Basic integrity"
[ "$(sql "SELECT count(*) FROM users WHERE password_hash NOT LIKE '\$argon2id\$%'")" = "0" ] ||
  fail "A user row carries something other than an argon2id hash."
[ "$(sql "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL")" = "0" ] ||
  fail "The backup carries an unfinished migration."
echo "  passwords are hashes, every migration finished"

step "Restore drill passed. Removing the disposable database."
