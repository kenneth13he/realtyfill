# Dockerfile
# RealtyFill needs both Node (Next.js) and Python (lib/pdfFill.ts shells out
# to scripts/fill_fillable_fields.py, which uses pypdf) at runtime — this is
# exactly the constraint TESTING_READINESS.md flags as ruling out Vercel's
# default serverless functions. A single Docker image with both runtimes
# works on Render, Railway, Fly.io, or a plain VM without further code
# changes to lib/pdfFill.ts's own Python-candidate probing.

# Pinned by digest, not just by tag. A bare "node:24-slim" resolves to
# different content on every rebuild, so the image that passed testing is not
# necessarily the image that ships. The digest below is node:24-slim as of
# 2026-09-15; bump it deliberately, and re-run `npm run build` plus
# `npm run test:py` against the new image when you do.
#
# Was node:20-slim. Node 20 reached end-of-life on 2026-04-30 (per the Node
# release schedule), so it no longer receives security patches — neither the
# runtime nor the Debian base layer underneath it. Node 24 is the current LTS
# and is supported until 2028-04-30. Next 16 requires >=20.9.0, so this is
# comfortably inside what the framework asks for.
FROM node:26-slim@sha256:14bf3eac4bf209d906d3c41256597d3ab1f926b2e93a79e9bdfe1efd32454239

# python3-pip on Debian bookworm+ marks the system Python as "externally
# managed" (PEP 668) and refuses a bare `pip install`. This container is
# single-purpose and disposable, so --break-system-packages is the
# pragmatic choice here rather than adding a venv for one package.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

COPY . .

# Next inlines NEXT_PUBLIC_* at build time, and lib/env.ts throws on a missing
# one — so `npm run build` cannot run without these present. They were absent
# entirely, which meant this image had never built and could not have: the
# Render fallback was broken, not merely untested.
#
# Present, not correct. The real values are supplied at runtime by the host's
# environment; only the NEXT_PUBLIC_* ones are baked in, so a deployment that
# needs real inlined values must pass them here as --build-arg. Anything
# secret (the service-role key, the Anthropic key) is read at runtime and must
# never be a build arg — build args are visible in the image history.
ARG NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key
ARG NEXT_PUBLIC_SITE_URL=https://example.invalid
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL     NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY     NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
