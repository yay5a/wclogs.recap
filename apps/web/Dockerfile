FROM node:24-alpine
    WORKDIR /app

    ENV CI=true

    RUN corepack enable
    RUN pnpm config set confirmModulesPurge false

    COPY . .

    RUN pnpm install --frozen-lockfile=false
    # Build all packages in the workspace, ensuring shared packages are compiled before starting the app.
    RUN pnpm -r build

    EXPOSE 3000

    CMD ["pnpm", "--filter", "@wcl/web", "start"]
