FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci --workspace=packages/shared --workspace=apps/api --include-workspace-root

COPY packages/shared packages/shared
COPY apps/api apps/api

RUN npm run build --workspace=packages/shared && npm run build --workspace=apps/api

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S frame && adduser -S frame -G frame

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
RUN rm -rf /app/node_modules/@frame/shared
COPY --from=builder /app/packages/shared/package.json ./node_modules/@frame/shared/package.json
COPY --from=builder /app/packages/shared/dist ./node_modules/@frame/shared/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/drizzle ./apps/api/drizzle

RUN mkdir -p /app/uploads && chmod -R a+rX /app && chown -R frame:frame /app/uploads

USER frame
EXPOSE 3001

CMD ["node", "apps/api/dist/server.js"]
