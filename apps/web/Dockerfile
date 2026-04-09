FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @wcl/web build
EXPOSE 3000
CMD ["pnpm", "--filter", "@wcl/web", "start"]

