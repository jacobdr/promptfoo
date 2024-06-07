# https://github.com/vercel/next.js/blob/canary/examples/with-docker/Dockerfile
FROM node:22-alpine AS base

RUN apk add tini

ENV NEXT_TELEMETRY_DISABLED 1
WORKDIR /app

RUN npm set cache /usr/src/app/.npm

FROM base as package-jsons

COPY package*.json ./
COPY site/package*.json site/
COPY src/web/nextui/package*.json src/web/nextui/

FROM base as all-source-files
COPY . .

# ---- Build ----
FROM base AS builder

# Necessary for node-gyp deps
RUN apk update && apk add python3 build-base --no-cache

ARG NEXT_PUBLIC_PROMPTFOO_BASE_URL
ENV NEXT_PUBLIC_PROMPTFOO_BASE_URL=${NEXT_PUBLIC_PROMPTFOO_BASE_URL}

# TODO(ian): Backwards compatibility, 2024-04-01
ARG NEXT_PUBLIC_PROMPTFOO_REMOTE_API_BASE_URL
ENV NEXT_PUBLIC_PROMPTFOO_REMOTE_API_BASE_URL=${NEXT_PUBLIC_PROMPTFOO_REMOTE_API_BASE_URL}

# Supabase opt-in
ARG NEXT_PUBLIC_PROMPTFOO_USE_SUPABASE
ENV NEXT_PUBLIC_PROMPTFOO_USE_SUPABASE=${NEXT_PUBLIC_PROMPTFOO_USE_SUPABASE}

# These envars are not necessarily used, but must be set to prevent the build process from erroring.
ENV NEXT_PUBLIC_SUPABASE_URL=http://placeholder.promptfoo.dev
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder

# Envars are read in from src/web/nextui/.env.production
RUN echo "*** Building with env vars from .env.production"

COPY --from=package-jsons /app /app

RUN --mount=type=cache,target=/usr/src/app/.npm \
    npm ci

COPY . .

RUN npm run build && \
    # Remove the cache to keep the docker size as small as possible
    rm -rf /app/dist/build/web/nextui/.next/cache

RUN npm prune --production

FROM package-jsons as cli

# This loads the ash profile
ENV ENV="/root/.profile"
RUN echo 'alias promptfoo="node /app/dist/build/main.cjs"' > /root/.profile

COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json /app/dist/package.json

ENTRYPOINT ["tini",  "--", "node", "/app/dist/build/main.cjs"]


# ---- Final Stage ----
FROM cli as site

RUN mkdir -p /root/.promptfoo/output

EXPOSE 15500

ENV PORT 15500
ENV HOSTNAME "0.0.0.0"

CMD ["view",  "--yes"]
