# review-service. Three images from one file:
#   build    (internal) compiles the app and the Prisma client
#   migrate  runs `prisma migrate deploy` once and exits, BEFORE the app starts
#   runtime  the app, production dependencies only
#
# Migrations never run inside the app at boot: two replicas starting together
# would race, and a failed migration would crash-loop the service instead of
# failing one job someone can read.

FROM node:22-alpine AS deps
WORKDIR /app
# Prisma's schema engine (used by migrate) links against OpenSSL.
RUN apk add --no-cache openssl && corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

FROM deps AS build
COPY . .
RUN yarn prisma generate && yarn build

FROM deps AS migrate
COPY prisma ./prisma
COPY prisma.config.ts ./
USER node
CMD ["yarn", "prisma", "migrate", "deploy"]

FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn workspaces focus --production && yarn cache clean --all
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3352
HEALTHCHECK --interval=10s --timeout=3s --retries=6 \
  CMD wget -qO- http://127.0.0.1:3352/health >/dev/null || exit 1
CMD ["node", "dist/main.js"]
