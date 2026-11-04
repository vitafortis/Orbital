# syntax=docker/dockerfile:1
# Build once on the runner's native platform: the output is plain JS and the
# production dependencies have no native code, so every target arch can reuse it.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
# The release version shown in the sidebar (the image workflow passes it; local builds say -dev).
ARG ORB_VERSION=
ENV ORB_VERSION=$ORB_VERSION
RUN pnpm build && pnpm prune --prod

FROM node:24-alpine
LABEL org.opencontainers.image.source=https://github.com/vitafortis/Orbital
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    ORB_DATA_DIR=/data \
    ORB_SESSIONS_DIR=/sessions \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    ORB_RUN_AS=node
# Attachments are up to 25 MB; adapter-node allows 512 KB by default.
ENV BODY_SIZE_LIMIT=26M
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY package.json server.js ./
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/
RUN mkdir -p /data /sessions && chown node:node /data /sessions
VOLUME ["/data", "/sessions"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
