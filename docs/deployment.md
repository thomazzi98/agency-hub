# Deployment

How the Agency Hub gets from a push on `main` to a running site, and how to put it back
if that goes wrong. The design and its reasoning are in
[sdd/19-deployment-and-cicd.md](sdd/19-deployment-and-cicd.md); this page is the
operating manual.

## What runs where

One VPS (2 vCPU / 8 GB — [ADR-0011](decisions/0011-infrastructure-sizing.md)) running
four containers from `docker-compose.prod.yml`:

| Service    | What it is                                                         |
| ---------- | ------------------------------------------------------------------ |
| `web`      | Caddy. Serves the built frontend, proxies `/api`, terminates TLS.   |
| `api`      | The Fastify API.                                                   |
| `worker`   | Background jobs: uploads cleanup, push, overdue sweep, backups.     |
| `postgres` | The database. **Publishes no port**; reachable only from the above. |

Files are not on this box: uploads go straight from the browser to Cloudflare R2
([sdd/07-upload-architecture.md](sdd/07-upload-architecture.md)).

## First-time VPS setup

Once, by hand. Everything after this is the pipeline's job.

```bash
# 1. Docker, as root
curl -fsSL https://get.docker.com | sh

# 2. A user for the deploy, with no more rights than it needs
adduser --disabled-password --gecos '' deploy
usermod -aG docker deploy

# 3. The application directory
mkdir -p /opt/agency-hub && chown deploy:deploy /opt/agency-hub

# 4. The deploy key. Generate it on your machine, put the public half here,
#    and the private half in the DEPLOY_SSH_KEY secret. Never a personal key.
mkdir -p /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
# paste the public key into /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys

# 5. Only 22, 80 and 443 reach this machine
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

Then, as `deploy`, create `/opt/agency-hub/.env` from
[`.env.example`](../.env.example) with real values. **That file is the only place
production secrets live on the box**; it is never committed and never printed.

Point the domain's A/AAAA records at the VPS before the first deploy — Caddy asks for
the certificate on startup and needs the name to already resolve.

## GitHub Secrets

Set under **Settings → Secrets and variables → Actions**. The `production`
environment is where the deploy job runs, so approvals can be added there later.

| Secret            | What it is                                                       |
| ----------------- | ---------------------------------------------------------------- |
| `DEPLOY_HOST`     | The VPS hostname or IP.                                           |
| `DEPLOY_USER`     | `deploy`.                                                        |
| `DEPLOY_SSH_KEY`  | The **private** half of the dedicated deploy key. Not a personal key. |
| `DEPLOY_PORT`     | Optional; defaults to 22.                                        |
| `DEPLOY_PATH`     | Optional; defaults to `/opt/agency-hub`.                         |
| `GHCR_READ_TOKEN` | A token that can read packages, so the VPS can pull images.      |

Application secrets — `PASSWORD_PEPPER`, `STORAGE_*`, `VAPID_*`,
`BACKUP_ENCRYPTION_KEY`, the database passwords — live in the VPS's `.env`, not here.
They are needed by the running containers, not by the pipeline.

## What a deploy does

Push to `main` →
[`ci.yml`](../.github/workflows/ci.yml) (lint, format, migration review, typecheck,
tests, E2E, compose review, image builds) →
build and push `…-api:<sha>` and `…-web:<sha>` to GHCR →
copy the compose file and deploy script to the VPS →
run [`scripts/deploy.sh <sha>`](../scripts/deploy.sh).

That script is the only implementation of "deploy" — the pipeline runs it over SSH and
a person runs it by hand with the same arguments, so the two cannot drift apart. It:

1. checks the environment before touching anything;
2. pulls the images (a failure here changes nothing);
3. runs migrations as a separate, awaited step — **if they fail it stops, restarts
   nothing, and leaves the volume alone**;
4. prints the schema version now live;
5. restarts `api`, `worker` and `web` only;
6. waits for `/health/ready`, and records the tag in `.deployed-tag`.

## Rollback

A rollback is a deploy of an earlier tag. One command, the one you have already run:

```bash
# On the VPS
cd /opt/agency-hub
IMAGE_REPO="<owner>/agency-hub" ./scripts/deploy.sh <previous-sha>
```

or from **Actions → Deploy → Run workflow**, giving the earlier tag as the input — it
skips the build and deploys that tag.

The tag that was live before the current one is in `/opt/agency-hub/.deployed-tag`
before a deploy overwrites it, and every deploy prints both.

**This never touches the database.** Rolling the application back to an older image does
not undo a migration, which matters in one specific case:

> **After a destructive migration**, the old image may not understand the new schema.
> An image rollback is then *not enough*: restore the backup taken immediately before
> that migration ([sdd/11-backup-and-recovery.md](sdd/11-backup-and-recovery.md)), then
> deploy the old tag. This is why `scripts/check-migrations.mjs` refuses a migration
> that drops anything without saying why in the diff — so that "was this deploy
> destructive?" is answerable in seconds, under pressure.

To reverse one migration deliberately, on a database you have just backed up:

```bash
docker compose -f docker-compose.prod.yml run --rm --entrypoint sh migrate \
  -c 'npm run db:migrate:down --workspace=@agency-hub/api'
```

## Never, under any circumstances

These are not conventions; they are the ways this deployment loses data permanently
([sdd/16-security-requirements.md](sdd/16-security-requirements.md)).

- **Never `docker compose down -v`** against production. `-v` removes the volumes, and
  the database is in one of them. Use `docker compose stop` or `restart`.
- **Never delete or recreate the PostgreSQL volume** as part of a deploy or a fix.
- **Never delete data to recover from a failed deploy.** The pipeline stops and reports
  instead; so should you.
- **Never echo a secret into a log**, including "just to check it is set". GitHub masks
  secrets, and that is not a reason to test it.

## Checking on it

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail 200 api
docker compose -f docker-compose.prod.yml logs --tail 200 worker
curl -sS https://<domain>/health/ready

cat .deployed-tag                       # what is live
docker compose -f docker-compose.prod.yml run --rm --entrypoint sh migrate \
  -c 'npx prisma migrate status --schema apps/api/prisma/schema.prisma'
```

## Before the first production deploy

Four things cannot be verified from a development machine and must be done once:

1. **Apply CORS and lifecycle rules to the R2 bucket.** Direct browser uploads **fail
   without CORS** — `npm run storage:configure --workspace=@agency-hub/api` against the
   production credentials ([sdd/07-upload-architecture.md](sdd/07-upload-architecture.md)).
2. **Generate a VAPID key pair** (`npm run push:keys --workspace=@agency-hub/api`), set
   the three `VAPID_*` variables, and confirm one push arrives on a real phone.
3. **Upload a large file from a real phone** on a real connection, and interrupt it —
   resumability is the point of that subsystem and has never been exercised on a device.
4. **Take one backup and restore it into a throwaway database.** An untested backup is
   not a backup.
