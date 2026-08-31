# Build the API from the monorepo root context (docker compose sets that).
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Install with the workspace manifests so the api workspace resolves.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci

COPY apps/api ./apps/api
RUN npm run build -w @aphelion/api

# Prune dev dependencies for the runtime image.
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/migrations ./apps/api/migrations
COPY --from=build /app/apps/api/models ./apps/api/models

WORKDIR /app/apps/api
EXPOSE 4000

# migrate:deploy is a no-op-safe up migration, then boot.
CMD ["node", "dist/server.js"]
