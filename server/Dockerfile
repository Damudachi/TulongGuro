# TulongGuro API.
#
# Run as ONE container. The AI-check job registry, the login rate-limit
# buckets and the per-model daily AI quota counters all live in process memory
# (see the numInstances comment in render.yaml) — two replicas behind a load
# balancer would lose jobs and double-spend the Gemini budget.
#
# Secrets are NOT baked in. Pass server/.env at run time
# (`docker run --env-file server/.env ...` or the compose file at the repo
# root); .dockerignore keeps the file itself out of the build context.

FROM node:22-bookworm-slim

# Prisma's query engine links against OpenSSL, which the slim image omits —
# without it the client fails at the first query, not at boot.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Generate inside the image so the engine matches this OS, then drop the dev
# dependencies. The generated client lives in node_modules/.prisma, which
# prune leaves alone.
RUN npx prisma generate && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Migrations are deliberately not run here: every environment shares one
# Supabase database, and Render's build already applies them with
# `prisma migrate deploy`. A container booting should never reshape it.
CMD ["node", "server.js"]
