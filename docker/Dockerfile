FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY project/package.json project/package-lock.json ./
RUN npm ci --ignore-scripts
COPY project/tsconfig.json ./
COPY project/src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:26-bookworm-slim AS runtime
WORKDIR /app
RUN mkdir /data && chown node:node /data
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 CMD node -e "const h=JSON.parse(require('node:fs').readFileSync('/tmp/bot-health.json','utf8'));if(Date.now()-h.checkedAt>90000)process.exit(1)"
CMD ["node", "dist/main.js"]
