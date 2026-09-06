# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
RUN addgroup -S gameon && adduser -S gameon -G gameon
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/client/package.json ./client/package.json
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/config ./config
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/assets ./assets
RUN mkdir -p /app/data && chown -R gameon:gameon /app
USER gameon
EXPOSE 3001
VOLUME ["/app/data"]
CMD ["node", "server/dist/index.js"]
