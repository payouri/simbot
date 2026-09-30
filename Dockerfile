# syntax=docker/dockerfile:1
#
# One image: API, SSE and the built client on port 3000, state under /data.
# Build with `docker build -t yourikane/simbot:X.Y.Z .` (see README). The build needs network
# once, to bake the Seed SimC Build's item data; running the image does not.

# The Seed SimC Build's source image. Bump the tag to ship a newer seed with a new app version.
ARG SIMC_TAG=1210-2026-09-29-d08a1c3
FROM simulationcraftorg/simc:${SIMC_TAG} AS simc

FROM oven/bun:1-slim AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY packages/simc/package.json packages/simc/
RUN bun install --frozen-lockfile
COPY tsconfig.base.json tsconfig.json biome.json ./
COPY apps apps
COPY packages packages
RUN bun run build

# Lays out the Seed SimC Build like an installed one (simc, musl loader, shared libs, profiles),
# runs it once for build.json, and builds its item-meta and item-icons.
FROM build AS bake
ARG SIMC_TAG
ENV SEED=/seed/simc/${SIMC_TAG}
COPY --from=simc /app/SimulationCraft/simc ${SEED}/simc
COPY --from=simc /app/SimulationCraft/profiles ${SEED}/profiles
COPY --from=simc /lib/ld-musl-x86_64.so.1 /lib/libc.musl-x86_64.so.1 ${SEED}/lib/
COPY --from=simc /usr/lib/ ${SEED}/usr/lib/
# Shared libraries only, the rule selectBuildFile (apps/server/src/simc/tar.ts) applies to a runtime
# fetch: not the package manager's, engines or modules.
RUN find "${SEED}/usr/lib" -mindepth 1 -maxdepth 1 \
      \( -type d -o -name 'libapk*' -o \( ! -name '*.so' ! -name '*.so.*' \) \) -exec rm -rf {} + \
 && bun apps/server/src/simc/bake-seed-cli.ts /seed "${SIMC_TAG}"

FROM oven/bun:1-slim
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY packages/simc/package.json packages/simc/
RUN bun install --frozen-lockfile --production
COPY apps/server apps/server
COPY packages packages
COPY --from=build /app/apps/client/dist apps/client/dist
COPY --from=bake /seed /app/seed

# Any uid/gid can run it (`user:` in compose): /data is world-writable, so a fresh named volume
# takes the running user's ownership for everything the app creates.
RUN mkdir /data && chmod 0777 /data
ENV NODE_ENV=production \
    HOME=/tmp \
    PORT=3000 \
    SIMBOT_DATA_DIR=/data \
    SIMBOT_SEED_DIR=/app/seed
USER 1000:1000
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "apps/server/src/main.ts"]
