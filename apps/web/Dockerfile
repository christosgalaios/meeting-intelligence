# Build context is the repo root (see docker-compose.yml).
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
# The lockfile covers every workspace, so npm needs each workspace's package.json even when only web is installed.
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
# The root `prepare` script sets a git hook path and the slim image has no git.
RUN npm pkg delete scripts.prepare && npm ci --workspace apps/web && npm cache clean --force
COPY apps/web apps/web
RUN npm run build --workspace apps/web

FROM nginxinc/nginx-unprivileged:alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
