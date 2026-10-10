FROM node:20-alpine

WORKDIR /app

COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

WORKDIR /app
RUN npm ci

WORKDIR /app
COPY apps/web ./apps/web
COPY packages/shared ./packages/shared

WORKDIR /app/apps/web
RUN npm run build
RUN mkdir -p .next/standalone/apps/web/.next \
    && cp -R .next/static .next/standalone/apps/web/.next/static \
    && cp -R public .next/standalone/apps/web/public

EXPOSE 3000

ENV HOSTNAME=0.0.0.0
ENV PORT=3000

CMD ["node", ".next/standalone/apps/web/server.js"]
