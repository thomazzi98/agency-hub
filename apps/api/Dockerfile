# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
WORKDIR /app

# Install stage: copy only package manifests first for better layer caching.
# apps/web's package.json is required here too because it's a sibling npm
# workspace member — `npm ci` validates the full workspace set.
# The Prisma schema is copied before `npm ci` because the api workspace's
# postinstall generates the Prisma client from it.
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/prisma ./apps/api/prisma
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/api ./apps/api
RUN npm run build --workspace=@agency-hub/api

FROM base AS runtime
ENV NODE_ENV=production

# pg_dump for the manual backup job (docs/sdd/11-backup-and-recovery.md). Pinned to
# the same major version as the server in docker-compose.yml: pg_dump refuses to dump
# a newer server than itself, so the two have to move together.
RUN apk add --no-cache postgresql16-client

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
# The root manifest is what makes `npm run <script> --workspace=@agency-hub/api` resolve
# inside the container - the production migrate service and the rollback runbook both
# run exactly that. Without it npm stops at "Could not read package.json" and no
# deploy gets past its migration step.
COPY package.json ./package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/scripts ./apps/api/scripts

# The backups volume mounts here (docker-compose*.yml). A new named volume takes its
# ownership from the directory the image has at that path, and from root when the
# image has none - and the dump is written as `node`, so without this line every
# backup fails with EACCES the moment it starts. Found by running one in Docker.
RUN mkdir -p /var/agency-hub/backups && chown node:node /var/agency-hub/backups

USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
