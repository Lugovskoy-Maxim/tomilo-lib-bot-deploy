# syntax=docker/dockerfile:1
# Сборка canvas отдельно: в итоговом образе остаются только runtime-библиотеки.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential python3 pkg-config libcairo2-dev libpango1.0-dev \
      libjpeg-dev libgif-dev librsvg2-dev \
    && npm ci --omit=dev \
    && apt-get purge -y --auto-remove build-essential python3 pkg-config \
      libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    STATE_PATH=/data/bot-state.json
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      tini wireguard-tools iproute2 iptables procps openresolv \
      libcairo2 libpango-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data /etc/wireguard
COPY --from=build /app/node_modules ./node_modules
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY . .
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "index.js"]
