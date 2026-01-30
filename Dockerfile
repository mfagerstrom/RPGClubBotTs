## Builder stage: install deps + compile TypeScript
FROM node:20-bullseye-slim AS build-runner
WORKDIR /app

# Install dependencies (uses lockfile for reproducibility)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

## Runtime stage: smaller image with only production deps + compiled output
FROM node:20-bullseye-slim AS prod-runner
WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled code
COPY --from=build-runner /app/build ./build

# Start bot (expects env vars like BOT_TOKEN provided at runtime)
CMD ["node", "build/RPGClub_GameDB.js"]
