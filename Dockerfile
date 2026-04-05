# ─── Stage 1: builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies (including devDependencies needed for the build)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# ─── Stage 2: runner ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Copy only what's needed to run
COPY --from=builder /app/dist ./dist
COPY package.json package-lock.json ./

# Production dependencies only
RUN npm ci --omit=dev

# Run as non-root
USER node

EXPOSE 3847

CMD ["node", "dist/cli.js", "predict-serve", "--port", "3847", "--bootstrap"]
