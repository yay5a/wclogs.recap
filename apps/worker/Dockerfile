FROM node:lts-alpine
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @wcl/worker build
CMD ["pnpm", "--filter", "@wcl/worker", "start"]
