FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/api-e2e/package.json ./apps/api-e2e/
COPY apps/web-e2e/package.json ./apps/web-e2e/
COPY packages/shared/package.json ./packages/shared/

# The schema has to be here before the install, not after. `npm install` fires
# the postinstall hook, which runs `prisma generate`, which needs it — and the
# source copy below is deliberately later so a dependency-only change can reuse
# the cached install layer.
COPY prisma ./prisma

RUN npm install

COPY . .

RUN npx prisma generate && npx nx build api --prod

EXPOSE 3000

CMD ["node", "apps/api/dist/main.js"]
