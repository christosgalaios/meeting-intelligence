# Build context is the repo root (see docker-compose.yml).
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
# The lockfile covers every workspace, so npm needs each workspace's package.json even when only api is installed.
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
# The root `prepare` script sets a git hook path and the slim image has no git.
ENV ONNXRUNTIME_NODE_INSTALL=skip
RUN npm pkg delete scripts.prepare && npm ci --workspace apps/api && npm cache clean --force
COPY apps/api apps/api
RUN npm run build --workspace apps/api

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
# The root `prepare` script sets a git hook path and the slim image has no git.
ENV ONNXRUNTIME_NODE_INSTALL=skip
# onnxruntime-node ships binaries for every OS and the browser build is never used on the server, so keep only this
# platform. Same layer as the install: a later layer could not give the space back.
RUN npm pkg delete scripts.prepare && npm ci --workspace apps/api --omit=dev && npm cache clean --force \
 && cd node_modules/onnxruntime-node/bin/napi-v6 && rm -rf darwin win32 \
 && for d in linux/*; do [ "$(basename $d)" = "$(node -p process.arch)" ] || rm -rf $d; done \
 && rm -rf /app/node_modules/onnxruntime-web
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/migrations apps/api/migrations
COPY apps/api/seed apps/api/seed

# The embedding model is baked into the image so the first start needs no network and is deterministic.
ENV HF_HUB_CACHE=/models
WORKDIR /app/apps/api
# The model is downloaded as the runtime user so no chown layer duplicates it.
RUN mkdir /models && chown node:node /models
USER node
RUN node dist/embed/download.js

EXPOSE 3001
CMD ["node", "dist/index.js"]
