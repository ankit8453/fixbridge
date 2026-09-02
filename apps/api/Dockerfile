# Build from the REPOSITORY ROOT, not this directory:
#
#     docker build -f apps/api/Dockerfile -t fixbridge-api .
#
# The API imports `@fixbridge/shared`, an npm workspace sibling, so the build
# context has to contain the whole monorepo. Building from `apps/api` would
# fail at `npm ci` with an unresolvable workspace dependency.

# ---------------------------------------------------------------------------
# Stage 1 — build (keeps devDependencies)
# ---------------------------------------------------------------------------
FROM node:20-slim AS build

# Prisma's engines need OpenSSL, and the slim image does not carry it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

# Manifests first, on their own layer. Dependencies change far less often than
# source, so this layer stays cached across ordinary code deploys — which on a
# 1 GB VM is the difference between a 30-second deploy and a five-minute one.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
# The API's own postinstall runs `prisma generate`, so the schema has to exist
# before `npm ci` rather than after it. Migrations come along for the ride and
# are needed anyway by the `migrate` stage.
COPY apps/api/prisma/ apps/api/prisma/

# `packages/shared` is copied in full *before* the install, not just its
# manifest, because its `prepare` script runs tsc over these sources during
# `npm ci` — and `--ignore-scripts` does not suppress a workspace's own
# lifecycle scripts in npm 10, so withholding the sources fails the install
# with `TS5058: tsconfig.json does not exist`. Shared is small and changes
# rarely, so this costs little cache.
COPY packages/shared/ packages/shared/

RUN npm ci --workspace @fixbridge/shared --workspace @fixbridge/api \
        --include-workspace-root

# The API's sources land after the install, so editing a route does not
# invalidate the dependency layer.
COPY apps/api/ apps/api/

RUN npx --workspace @fixbridge/api prisma generate \
    && npm run build --workspace @fixbridge/api

# ---------------------------------------------------------------------------
# Stage 2 — production dependencies
# ---------------------------------------------------------------------------
#
# Pruned here, in a stage that still has the sources, rather than by a second
# `npm ci` in the runtime stage. That install would re-run `packages/shared`'s
# `prepare` script — which invokes tsc against sources the runtime stage does
# not have, and which `--ignore-scripts` does not suppress for a workspace's
# own lifecycle scripts. Pruning in place sidesteps it and leaves a
# node_modules the runtime stage copies verbatim, so the shipped image can
# never disagree with what was built.
FROM build AS prod-deps

RUN npm prune --omit=dev --workspaces --include-workspace-root \
    && npm cache clean --force

# ---------------------------------------------------------------------------
# Stage 3 — runtime
# ---------------------------------------------------------------------------
FROM node:20-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

# Production dependencies, already pruned. Includes the generated Prisma
# client, which is platform-specific and must come from the build rather than
# be regenerated here.
COPY --from=prod-deps /repo/node_modules node_modules

COPY --from=build /repo/packages/shared/dist packages/shared/dist
# `resolveJsonModule` means tsc already emitted the locale JSON into dist, so
# there is nothing extra to copy.
COPY --from=build /repo/apps/api/dist apps/api/dist

# Never root. A container escape should not land in a privileged shell.
USER node

EXPOSE 3000

# tini reaps zombies and forwards SIGTERM, so `docker compose down` stops the
# API in a second rather than waiting out a ten-second kill timeout — which
# matters because the outbox dispatcher holds a Redis lock it should release.
ENTRYPOINT ["/usr/bin/tini", "--"]

WORKDIR /repo/apps/api
CMD ["node", "dist/index.js"]

# ---------------------------------------------------------------------------
# Stage 4 — migrations and seeding
# ---------------------------------------------------------------------------
#
# Built on `build`, not `runtime`, because the Prisma CLI and `tsx` are
# devDependencies: the runtime image is pruned and cannot run them. Rather than
# ship a fatter production image for two commands that run only at deploy time,
# this target reuses the stage that already has both.
#
#     docker compose -f docker-compose.prod.yml run --rm migrate
#
# It exits when done; nothing keeps it running.
FROM build AS migrate

ENV NODE_ENV=production
WORKDIR /repo/apps/api

CMD ["npx", "prisma", "migrate", "deploy"]
