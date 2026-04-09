FROM node:24-alpine
WORKDIR /app

ENV CI=true

RUN corepack enable
RUN pnpm config set confirmModulesPurge false

COPY . .

RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @wcl/web build

EXPOSE 3000

CMD ["pnpm", "--filter", "@wcl/web", "start"]
