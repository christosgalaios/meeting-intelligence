# Build context is the repo root (see docker-compose.yml).
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
# The lockfile covers every workspace, so npm needs each workspace's package.json even when only api is installed.
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
# The root `prepare` script sets a git hook path and the slim image has no git.
RUN npm pkg delete scripts.prepare && npm ci --workspace apps/api
COPY apps/api apps/api
RUN npm run build --workspace apps/api

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
# The root `prepare` script sets a git hook path and the slim image has no git.
RUN npm pkg delete scripts.prepare && npm ci --workspace apps/api --omit=dev
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/migrations apps/api/migrations
COPY apps/api/seed apps/api/seed

# The embedding model is baked into the image so the first start needs no network and is deterministic.
ENV HF_HUB_CACHE=/models
WORKDIR /app/apps/api
RUN node dist/embed/download.js && chown -R node:node /models

USER node
EXPOSE 3001
CMD ["node", "dist/index.js"]
