FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/

RUN npm ci --workspace=packages/shared --workspace=apps/web --include-workspace-root

COPY packages/shared packages/shared
COPY apps/web apps/web

RUN npm run build --workspace=packages/shared && npm run build --workspace=apps/web

FROM nginxinc/nginx-unprivileged:alpine AS runner
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 8080
