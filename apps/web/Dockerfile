# Production image for the WGOS studio (Next.js, apps/web). Build context is the
# monorepo root. apps/web has no @sparkcanvas/* workspace deps, so the install is
# self-contained; we still install via pnpm against the root workspace to honor
# the lockfile, then emit a standalone server.
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.1.3 --activate

# Manifests first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages ./packages
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json
RUN pnpm install --frozen-lockfile --filter @sparkcanvas/web...

COPY apps/web ./apps/web
# Bake the in-cluster backend target into the Next rewrites (rewrite
# destinations are resolved at build time). Overridable via build arg.
ARG WGOS_API_TARGET=http://backend:4100
ENV WGOS_API_TARGET=${WGOS_API_TARGET}
RUN pnpm --filter @sparkcanvas/web build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3203
ENV HOSTNAME=0.0.0.0
# Standalone server + its traced node_modules, then the static + public assets
# Next does not bundle into the standalone output.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3203
CMD ["node", "apps/web/server.js"]
