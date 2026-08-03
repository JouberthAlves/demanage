###############################
# THIS IS A BASIC DOCKERFILE USED IN OTHER APPS
# YOU CAN CHANGE ADDING ROWS OR REMOVING AS NEEDED
###############################

# Uses Node.js 22 LTS as builder
FROM node:22 AS builder

# Set the workdir as /app in the builder
WORKDIR /app

# Copies the source code to the builder
COPY . .

# Install pnpm and all dependencies
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Generate prisma client and build typescript
RUN pnpm prisma generate
RUN pnpm build

# Uses Node.js 22 LTS in the runtime as well
FROM node:22

# Set the workdir as /app in the runtime
WORKDIR /app

# Copies only main files from the builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src/generated ./dist/generated
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/pnpm-lock.yaml .
COPY --from=builder /app/package.json .
COPY --from=builder /app/.env .
COPY entrypoint.sh .

# Seting entrypoint permissions
RUN chmod +x ./entrypoint.sh

# Install pnpm in the runtime
RUN npm i -g pnpm

# Exposes the api port
EXPOSE 8000

# Runs the entrypoint script
ENTRYPOINT ["./entrypoint.sh"]