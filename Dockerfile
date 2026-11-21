FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.ts tsconfig.json postcss.config.cjs tailwind.config.cjs ./
COPY src ./src
COPY public ./public
COPY server ./server
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4310 DATA_DIR=/app/data PLAYWRIGHT_BROWSERS_PATH=/opt/releasegate-browsers
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server/migrations ./server/migrations
COPY --from=build /app/server/seed ./server/seed
RUN ./node_modules/.bin/playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 4310
CMD ["node", "dist/server/index.js"]
