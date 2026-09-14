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

Beyond the values `.env.example` carries for development, production needs these — the
compose file refuses to start without the ones marked required, so a missing one fails
loudly at deploy time rather than quietly at first use:

| Variable                                       | Value in production                                                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `APP_DOMAIN` (required)                        | The domain Caddy serves and gets its certificate for.                                                                   |
| `STORAGE_ENDPOINT`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`, `_BUCKET` (required) | The R2 values (`R2_*` in `.env.example`), with `STORAGE_FORCE_PATH_STYLE=false`.                       |
| `STORAGE_PUBLIC_ORIGIN` (required)             | `https://<account>.r2.cloudflarestorage.com` — the origin the browser PUTs file parts to. The Content-Security-Policy in [deploy/Caddyfile](../deploy/Caddyfile) allows exactly this origin; left out, the browser would block every upload with nothing in any server log. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DB_OWNER_USER`, `DB_OWNER_PASSWORD`, `DATABASE_URL` (required) | The owner role and the least-privilege `agency_hub_app` role, as in `.env.example` but with real passwords. |
| `PASSWORD_PEPPER` (required)                   | Long and random; permanent for the life of the database.                                                                |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Its **own** pair, from `npm run push:keys --workspace=@agency-hub/api`. Empty disables push; in-app notifications still work. |
| `BACKUP_ENCRYPTION_KEY`                        | Optional, 64 hex characters. Empty stores dumps compressed but unencrypted on the volume.                              |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`  | Who the first administrator is (see below).                                                                            |

Point the domain's A/AAAA records at the VPS before the first deploy — Caddy asks for
the certificate on startup and needs the name to already resolve.

### The first administrator

After the first successful deploy, once — the runtime image ships the compiled seed,
and it is a no-op if an `agency_admin` already exists:

```bash
cd /opt/agency-hub
docker compose -f docker-compose.prod.yml run --rm --no-deps --entrypoint sh api \
  -c 'node apps/api/dist/scripts/seed.js'
```

It prints a temporary password **exactly once**; the account must change it at first
sign-in. Run it through the `api` service, not `migrate`: the seed needs the full
application environment, which only `api` carries.

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

## Rehearsals

Two scripts rehearse the parts of this page that only matter on a bad day, each on a
PostgreSQL that exists only while the script runs — nothing in them reads `.env` or can
reach a real database:

- **`./scripts/migration-drill.sh`** — applies every migration, adds one that cannot
  succeed, and proves the deploy would halt: CI's migration review refuses it, `migrate
  deploy` fails and rolls the whole file back (including its valid statements), a second
  deploy is refused until someone resolves it, and after recovery the newest real
  migration is reversed with its `down.sql` and re-applied. Run it before any deploy
  whose migration you are not certain of.
- **`./scripts/restore-drill.sh <backup.dump>`** — restores a dump downloaded from the
  admin screen into a throwaway database with `--exit-on-error` and reports what came
  back. [sdd/11-backup-and-recovery.md](sdd/11-backup-and-recovery.md) asks for this at
  least monthly: a backup nobody has restored is a file, not a backup.

Both passed on 2026-09-14. The same day, `docker-compose.prod.yml` was brought up
locally against a private registry standing in for GHCR, and
[`scripts/deploy.sh`](../scripts/deploy.sh) ran the three drills Stage 15 asks for: a
deploy went end to end (pull → migrate → schema version → restart → health →
`.deployed-tag`), a deploy of an image whose migration step could not run stopped at
that step with nothing restarted and the volume untouched, and a rollback to the earlier
tag went through with the same command. What that rehearsal cannot cover is the VPS
itself — the SSH hop, the GHCR login, DNS and certificate issuance — which the first
real deploy will exercise for the first time.

### If the backups volume predates 2026-09-14

Images built before that date created the `backups` volume owned by root, and the job
writes as `node`, so every backup failed with `EACCES`. The image now owns the
directory, which a **new** volume inherits; an existing one needs a one-off fix:

```bash
docker compose -f docker-compose.prod.yml exec -u root worker chown node:node /var/agency-hub/backups
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

Checked on 2026-09-14 against the real bucket and the real VPS, read-only. What each
item needs, in the order it has to happen:

1. **Decide the domain and point it at the VPS.** Nothing below can be finished without
   it: Caddy needs it for the certificate, and the bucket needs it for CORS. It appears
   nowhere in the repository or in `.env` today.
2. **Apply CORS to the R2 bucket.** The bucket `agency-hub` exists and the credentials
   in `.env` are accepted, but **it has no CORS configuration** — direct browser uploads
   fail until it does. The 7-day abort-incomplete-multipart lifecycle rule is already
   present (R2 applies it by default). With the domain known:

   ```bash
   STORAGE_ENDPOINT=$R2_ENDPOINT STORAGE_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID \
   STORAGE_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY STORAGE_BUCKET=$R2_BUCKET \
   STORAGE_FORCE_PATH_STYLE=false \
     npm run storage:configure --workspace=@agency-hub/api -- --origin https://<domain>
   ```

   It writes one rule: `PUT`, `GET`, `HEAD` from that origin, all request headers,
   `ETag` exposed (without it multipart completion has nothing to assemble from), cached
   for an hour. Then confirm from a browser on the site that an upload completes.
3. **Provision the VPS** per [First-time VPS setup](#first-time-vps-setup). From the
   development machine: port 22 answers, ports 80 and 443 do not, the `id_ed25519` key
   there matches `VPS_SSH_PUBLIC_KEY`, and `.env` names `root` as the user. Whether
   Docker, the `deploy` user, the firewall and `/opt/agency-hub/.env` exist has not been
   checked from here — signing in to the server was left to a person.
4. **Set the GitHub side.** The repository has no secrets and no `production`
   environment yet, and `origin/main` is still at Stage 0 — the MVP has never been
   pushed, so CI has never run on it. Needed: the secrets in
   [GitHub Secrets](#github-secrets), including a `GHCR_READ_TOKEN` (a personal access
   token with `read:packages`; only a person can create one), and then a push to `main`,
   which runs CI, publishes both images and deploys.
5. **Create the first administrator** ([above](#the-first-administrator)).
6. **Generate the production VAPID pair** (`npm run push:keys --workspace=@agency-hub/api`),
   put it in the VPS `.env`, redeploy, and confirm one push arrives on a real phone: sign
   in on the phone, open Notificações → "Ativar avisos neste dispositivo", accept the
   prompt, then have someone else open a pendência addressed to you. The device
   contract (register, list, revoke) is covered by E2E; delivery through a push service
   is not reachable from a headless browser. The development `.env` has its own pair.
7. **Upload a large file from a real phone** on mobile data, and interrupt it: lock the
   screen, switch to Wi-Fi mid-transfer, then pause and resume from the queue, then
   cancel one and confirm the prompt. Watch that a paused item never advances, a
   resumed one continues rather than restarting at 0%, and the cancelled one is gone
   from the list. Every one of those transitions is covered by E2E at a phone viewport
   with parked and refused storage requests; what only a device can show is the
   behaviour of a real radio.
8. **Take one backup from the admin screen and run `./scripts/restore-drill.sh` on it.**
   Done locally on 2026-09-14 through the real job (`pg_dump` in the image, streamed
   download, `pg_restore` with zero errors, every count matching); repeat it once on
   the VPS so the volume and the image there are the ones proven.
