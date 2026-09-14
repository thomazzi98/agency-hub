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
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/scripts ./apps/api/scripts

USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
