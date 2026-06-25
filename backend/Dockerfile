FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY backend/package*.json ./backend/
# Workspace packages the backend depends on (file: deps) must be present so
# `npm install` can link @sparkcanvas/* into node_modules.
COPY packages ./packages
RUN npm install

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY packages ./packages
COPY backend ./backend
# Build the workspace packages the backend imports (core/database/ai-design first
# so dependents resolve their types), then the backend itself. Invoke the root-
# hoisted tsc directly per tsconfig to avoid npm workspace bin-resolution quirks.
RUN for pkg in core database ai-design-language asset-store brand-store memory-engine model-router skill-runtime workflow-engine pi-adapter; do \
      echo "build packages/$pkg" && ./node_modules/.bin/tsc -p "packages/$pkg/tsconfig.json" || exit 1; \
    done \
  && ./node_modules/.bin/tsc -p backend/tsconfig.json

FROM node:20-alpine AS runner
WORKDIR /app/backend
ENV NODE_ENV=production
RUN apk add --no-cache python3 sqlite
COPY --from=deps /app/node_modules /app/node_modules
# The backend resolves @sparkcanvas/* to packages/*/dist at runtime, so the built
# packages must ship alongside node_modules.
COPY --from=build /app/packages /app/packages
COPY --from=build /app/backend/dist ./dist
COPY backend/package.json ./
COPY scripts /app/scripts
COPY frontend/public /app/frontend/public
RUN mkdir -p /app/data
EXPOSE 4100
CMD ["node", "dist/server.js"]
