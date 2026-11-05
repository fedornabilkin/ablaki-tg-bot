FROM node:26-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY project ./project
RUN npm run build && npm prune --omit=dev --ignore-scripts && npm cache clean --force

FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production \
    BOT_DATA_DIR=/data \
    BOT_HEALTH_FILE=/tmp/bot-health.json
WORKDIR /app
RUN groupadd --system bot && useradd --system --gid bot --home-dir /app --no-create-home bot \
    && mkdir -p /data && chown bot:bot /data
COPY --from=build --chown=bot:bot /app/package.json /app/package-lock.json ./
COPY --from=build --chown=bot:bot /app/node_modules ./node_modules
COPY --from=build --chown=bot:bot /app/project/dist ./project/dist
USER bot
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "const f=require('node:fs');const h=JSON.parse(f.readFileSync(process.env.BOT_HEALTH_FILE,'utf8'));if(Date.now()-h.checkedAt>90000)process.exit(1)" || exit 1
CMD ["node", "project/dist/main.js"]
