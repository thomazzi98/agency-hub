#!/usr/bin/env bash
#
# Starts MinIO for a CI job and creates the disposable buckets, the way the
# `minio` and `minio-buckets` services in docker-compose.yml do for a developer.
# GitHub's `services:` cannot pass a command to a container, and MinIO needs one
# (`server /data`), so it runs as a step instead. Same image tag as the compose file,
# so CI and a laptop test against the same storage build.
#
# Reads the STORAGE_* / *_STORAGE_BUCKET variables the workflow already sets.

set -Eeuo pipefail

: "${STORAGE_ACCESS_KEY_ID:?}" "${STORAGE_SECRET_ACCESS_KEY:?}"
: "${TEST_STORAGE_BUCKET:?}" "${E2E_STORAGE_BUCKET:?}"

# Registries answer 5xx now and then; a pull that fails on the first try is not a
# reason to fail the whole run, so each image gets a few attempts.
pull() {
  for attempt in 1 2 3 4 5; do
    docker pull -q "$1" >/dev/null && return 0
    echo "pull of $1 failed (attempt $attempt); retrying" >&2
    sleep $((attempt * 5))
  done
  return 1
}
pull quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z
pull quay.io/minio/mc:latest

docker run -d --name minio -p 9000:9000 \
  -e MINIO_ROOT_USER="$STORAGE_ACCESS_KEY_ID" \
  -e MINIO_ROOT_PASSWORD="$STORAGE_SECRET_ACCESS_KEY" \
  quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z server /data >/dev/null

for _ in $(seq 1 60); do
  if curl -sf http://localhost:9000/minio/health/live >/dev/null; then
    break
  fi
  sleep 1
done
curl -sf http://localhost:9000/minio/health/live >/dev/null || {
  echo "MinIO never became healthy" >&2
  docker logs minio >&2
  exit 1
}

docker run --rm --network host --entrypoint sh quay.io/minio/mc:latest -c "
  mc alias set local http://localhost:9000 '$STORAGE_ACCESS_KEY_ID' '$STORAGE_SECRET_ACCESS_KEY' >/dev/null &&
  mc mb --ignore-existing local/'$TEST_STORAGE_BUCKET' &&
  mc mb --ignore-existing local/'$E2E_STORAGE_BUCKET'
"

echo "MinIO ready with buckets $TEST_STORAGE_BUCKET and $E2E_STORAGE_BUCKET"
