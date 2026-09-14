# syntax=docker/dockerfile:1
#
# The frontend is static files plus a reverse proxy. Caddy does both, and terminates
# TLS with an automatic certificate, so production needs no separate proxy container
# and no certificate cron (19-deployment-and-cicd.md).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/prisma ./apps/api/prisma
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY apps/web ./apps/web
# Same-origin in production: Caddy serves these files and proxies /api to the API
# container, so the session cookie needs no CORS or SameSite special-casing.
RUN npm run build --workspace=@agency-hub/web

FROM caddy:2-alpine AS runtime
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
EXPOSE 80 443
