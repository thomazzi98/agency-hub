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
| `STORAGE_PUBLIC_ORIGIN` (required)             | The origin of the presigned URLs the browser PUTs file parts to. With `STORAGE_FORCE_PATH_STYLE=false` (R2) the bucket is part of the host: `https://<bucket>.<account>.r2.cloudflarestorage.com`; with path style it is the endpoint origin. The Content-Security-Policy in [deploy/Caddyfile](../deploy/Caddyfile) allows exactly this origin; wrong or missing, the browser blocks every upload with nothing in any server log — found this way on the first online run. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DB_OWNER_USER`, `DB_OWNER_PASSWORD`, `DATABASE_URL` (required) | The owner role and the least-privilege `agency_hub_app` role, as in `.env.example` but with real passwords. |
| `PASSWORD_PEPPER` (required)                   | Long and random; permanent for the life of the database.                                                                |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Its **own** pair, from `npm run push:keys --workspace=@agency-hub/api`. Empty disables push; in-app notifications still work. |
| `BACKUP_ENCRYPTION_KEY`                        | Optional, 64 hex characters. Empty stores dumps compressed but unencrypted on the volume.                              |
| `APP_TIMEZONE`                                 | Optional IANA zone the dashboard's "hoje", the calendar's flags and a deadline's day are measured in. Empty means `America/Sao_Paulo`; set it only if the agency works on another zone. |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_PASSWORD` | Who the first administrator is (see below). With the password set, the seed uses it instead of printing a generated one; it is temporary either way. |

Point the domain's A/AAAA records at the VPS before the first deploy — Caddy asks for
the certificate on startup and needs the name to already resolve.

### Going live before the domain exists

The site can be published on the VPS's public IP first, with nothing weakened. An IP
address cannot carry a certificate, and without one the session cookie's `Secure` flag
would keep every browser from signing in — so `APP_DOMAIN` is set to a **wildcard-DNS
name that resolves to the IP** (`2-25-72-199.sslip.io` for `2.25.72.199`; sslip.io
answers `<a>-<b>-<c>-<d>.sslip.io` with that address and needs no configuration).
Caddy obtains a real Let's Encrypt certificate for it, cookies stay `Secure`, the CSP
stays as written, and Web Push has the secure context it requires. Port 80 sends
anything else — the bare IP typed into a browser included — to that name.

When the real domain is ready: point its records at the VPS, change `APP_DOMAIN`,
redeploy (a re-run of the workflow with the current tag is enough), and re-run
`storage:configure` for the new origin so uploads keep working from it.

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

### Other projects on this host

`web` is the only thing that can listen on ports 80 and 443, so another project on
the VPS is served through it rather than beside it. It drops one site file into
`/opt/edge/sites` - a block for its own hostname that proxies to its container on
the external `edge` network - and reloads Caddy:

```bash
docker exec agency-hub-web-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

Its certificate is obtained and renewed the same way as this site's. A file Caddy
cannot parse would stop `web` from starting on the next deploy, so validate one
before it goes in; the reload itself is atomic and keeps the running configuration
if it fails.

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
| `GHCR_READ_TOKEN` | Optional. The job pulls with its own short-lived `GITHUB_TOKEN` (`packages: read`); set this only to use a long-lived token instead. |

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

Run by hand, the VPS has to be logged in to GHCR first (`docker login ghcr.io` with a
token that can read packages); the pipeline does that with its own token and logs out
after.

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

## Checking a published site

`npm run test:e2e:online` drives a real browser through the deployed site — health
through the proxy, sign-in with the cookie flags checked, the shell, a company with a
file sent straight to storage from the browser (which proves the bucket's CORS rule for
that origin), archived afterwards, sign-out — on a desktop and a phone profile. It needs
`E2E_ONLINE_BASE_URL` and an `agency_admin` whose first password change is done, in
`E2E_ONLINE_ADMIN_EMAIL` / `E2E_ONLINE_ADMIN_PASSWORD`. It creates nothing else and
drops nothing; the one company it leaves is archived and named for what it is.

## Checking on it

`API_IMAGE` and `WEB_IMAGE` must be in the environment for any `docker compose` command
here — see [Everyday commands on the VPS](#everyday-commands-on-the-vps).

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail 200 api
docker compose -f docker-compose.prod.yml logs --tail 200 worker
curl -sS https://<domain>/health/ready

cat .deployed-tag                       # what is live
docker compose -f docker-compose.prod.yml run --rm --entrypoint sh migrate \
  -c 'npx prisma migrate status --schema apps/api/prisma/schema.prisma'
```

## The site as deployed on 2026-09-14

**Live at `https://2-25-72-199.sslip.io`** (VPS `2.25.72.199`; `http://2.25.72.199`
redirects there). Deployed by the pipeline — run 34899362038, tag `00c61c6defed` — after
the VPS was prepared per [First-time VPS setup](#first-time-vps-setup) and the secrets
`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` were set. Certificate from Let's Encrypt
(`YE2`), valid to 2026-12-13 and renewed by Caddy.

Verified against the published site the same day:

| Check | Result |
| --- | --- |
| Pipeline | verify (24 test files, 115 E2E) → images to GHCR → SSH → pull → migrations (14, as a separate service) → restart → `/health/ready` |
| Containers | `api` healthy, `worker` up with push **enabled**, `web` on 80/443, `postgres` healthy with **no published port**; ~140 MB RAM in total |
| Database | `agency_hub_app` is `NOSUPERUSER NOBYPASSRLS`; 22 tables with RLS, 24 policies; `audit_logs` and `campaign_history` append-only |
| First administrator | created with the compiled seed; must change its password at first sign-in |
| Browser, desktop and phone (`npm run test:e2e:online`) | health through the proxy; sign-in with `HttpOnly; Secure; SameSite=Lax`; shell; a company with a 64 KB file sent **from the browser straight to R2** and downloaded back through a signed URL; archive; sign-out |
| R2 | CORS for `https://2-25-72-199.sslip.io` applied and read back; the browser's PUTs go to `https://agency-hub.<account>.r2.cloudflarestorage.com`, which the CSP allows |
| Backup | requested through the API (202), produced by the worker's `pg_dump`, encrypted at rest (file 28 bytes longer than the download: IV + tag), downloaded as `PGDMP`, restored into a throwaway PostgreSQL by `scripts/restore-drill.sh` with zero errors and every count matching; a second request while one ran answered `409 backup_already_running` |
| Recovery | API process killed → restarted by Docker, healthy in 1 s; PostgreSQL restarted → API healthy again in 2 s, rows intact; worker unaffected. (`docker kill`/`docker stop` count as manual stops and are **not** restarted under `unless-stopped` — that is Docker's rule, not a fault.) |

What the validation left behind: six archived companies named `Validação online …`
with two 64 KB files, and the account `validacao-e2e@example.com` — **deactivated**.

### What the IP-first setup cannot do

- **The real domain.** Point its records at the VPS, set `APP_DOMAIN` in the VPS `.env`,
  re-run the Deploy workflow with the current tag, and run
  `storage:configure --origin https://<domain>` so uploads keep working from it. Until
  then the site answers only at the sslip.io name.
- **Push on a phone.** The production VAPID pair is in the `.env` and the worker reports
  push enabled; the device contract is covered by E2E. Whether a notification arrives
  needs a phone: sign in there, Notificações → "Ativar avisos neste dispositivo", accept,
  then have someone open a pendência addressed to you.
- **A large upload interrupted on a phone**, on mobile data: lock the screen, switch
  networks mid-transfer, pause, resume, cancel. Every transition is covered by E2E at a
  phone viewport with parked and refused storage requests; a real radio is not.

### Running the online check again

It needs an `agency_admin` whose first password change is done. Rather than using the
real administrator, create a throwaway one on the VPS (its password goes to a root-only
file, never to a terminal), run the check, then deactivate it:

```bash
cd /opt/agency-hub && TAG=$(cat .deployed-tag)
export API_IMAGE=ghcr.io/thomazzi98/agency-hub-api:$TAG WEB_IMAGE=ghcr.io/thomazzi98/agency-hub-web:$TAG
umask 077
docker compose -f docker-compose.prod.yml run --rm --no-deps -T --entrypoint node api --input-type=module -e '
const { getPrismaClient, disconnectPrismaClient } = await import("/app/apps/api/dist/shared/db.js");
const { hashPassword } = await import("/app/apps/api/dist/modules/auth/password.js");
const password = (await import("node:crypto")).randomBytes(18).toString("base64url");
const passwordHash = await hashPassword(password);
await getPrismaClient().user.upsert({
  where: { email: "validacao-e2e@example.com" },
  update: { passwordHash, status: "active", mustChangePassword: false },
  create: { email: "validacao-e2e@example.com", name: "Validação automática", role: "agency_admin", status: "active", mustChangePassword: false, passwordHash },
});
await disconnectPrismaClient();
process.stdout.write(password);
' > /root/agency-hub-validation-admin.txt
```

Then, from the development machine:

```bash
E2E_ONLINE_BASE_URL=https://2-25-72-199.sslip.io \
E2E_ONLINE_ADMIN_EMAIL=validacao-e2e@example.com \
E2E_ONLINE_ADMIN_PASSWORD="$(ssh root@2.25.72.199 cat /root/agency-hub-validation-admin.txt)" \
  npm run test:e2e:online
```

And afterwards, on the VPS, set that user's `status` to `inactive` the same way and
delete the file.

### Everyday commands on the VPS

The compose file interpolates the image tags, so give it the live ones first:

```bash
cd /opt/agency-hub && TAG=$(cat .deployed-tag)
export API_IMAGE=ghcr.io/thomazzi98/agency-hub-api:$TAG WEB_IMAGE=ghcr.io/thomazzi98/agency-hub-web:$TAG
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail 200 api
```
