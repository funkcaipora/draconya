# Imagem multi-arquitetura: linux/amd64 e linux/arm64 (ADR 0013).
# Desenvolvimento é Apple Silicon, o Oracle Always Free é ARM e a VPS em São Paulo é x86 —
# uma imagem só serve aos três.
#
#   docker buildx build --platform linux/amd64,linux/arm64 -t draconya:local .
#
# A única dependência nativa é o uWebSockets.js, que publica binário para as duas.
#
# BASE: trixie (Debian 13, glibc 2.41), não bookworm. O binário do uWS exige GLIBC_2.38 e o
# bookworm tem 2.36. No macOS isso não aparece — o binário de lá não usa glibc —, então a
# falha só surge dentro do container, com uma mensagem que não menciona a versão do Debian.

# --- dependências ------------------------------------------------------------------------
FROM node:24-trixie-slim AS deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# git porque o uWebSockets.js é instalado a partir do GitHub, não do registro npm.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Manifestos primeiro: a camada de dependências só invalida quando eles mudam.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/protocol/package.json  packages/protocol/
COPY packages/content/package.json   packages/content/
COPY packages/sim/package.json       packages/sim/
COPY packages/server/package.json    packages/server/
COPY packages/tools/package.json     packages/tools/
COPY packages/client/package.json    packages/client/
RUN pnpm install --frozen-lockfile

# --- build -------------------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY packages/ packages/
RUN pnpm exec tsc -b

# Falha cedo e alto se o build não emitiu: sem isto, a imagem sobe e só quebra ao rodar.
RUN test -f packages/server/dist/main.js || (echo 'ERRO: tsc -b não emitiu dist/main.js' && exit 1)

# --- dependências de produção -------------------------------------------------------------
# Estágio NOVO, não derivado de `deps`: instalar --prod sobre um node_modules completo não
# limpa o que já está na store, e typescript, vitest, eslint e drizzle-kit continuariam na
# imagem. Partindo do zero, a store só tem produção.
#
# `pnpm deploy` seria mais direto, mas exige inject-workspace-packages=true, que mudaria a
# estratégia de instalação do workspace inteiro só para servir ao Docker.
FROM node:24-trixie-slim AS prod-deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/protocol/package.json  packages/protocol/
COPY packages/content/package.json   packages/content/
COPY packages/sim/package.json       packages/sim/
COPY packages/server/package.json    packages/server/
COPY packages/tools/package.json     packages/tools/
COPY packages/client/package.json    packages/client/
RUN pnpm install --frozen-lockfile --prod

# O uWS traz binário pré-compilado para todo sistema e toda ABI. Numa imagem Linux, o resto
# é peso morto — e é a maior dependência da árvore.
RUN find node_modules -name 'uws_darwin_*.node' -delete \
 && find node_modules -name 'uws_win32_*.node' -delete

# O cliente é servido como estático pelo Cloudflare Pages; pixi e react não têm o que fazer
# na imagem do servidor.
RUN rm -rf node_modules/.pnpm/pixi.js@* node_modules/.pnpm/react@* node_modules/.pnpm/react-dom@*

# --- runtime -----------------------------------------------------------------------------
FROM node:24-trixie-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# node_modules de produção e os manifestos (que carregam os symlinks do workspace)...
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/packages ./packages
COPY --from=prod-deps --chown=node:node /app/package.json ./package.json

# ...e por cima, só o compilado. Nenhum `src` entra na imagem.
COPY --from=build --chown=node:node /app/packages/protocol/dist ./packages/protocol/dist
COPY --from=build --chown=node:node /app/packages/content/dist  ./packages/content/dist
COPY --from=build --chown=node:node /app/packages/content/data  ./packages/content/data
COPY --from=build --chown=node:node /app/packages/sim/dist      ./packages/sim/dist
COPY --from=build --chown=node:node /app/packages/server/dist   ./packages/server/dist
USER node

# PROCESSES decide quais papéis sobem. Sem ele, modo solo — os três num processo.
ENV PROCESSES=api,game,jobs
EXPOSE 3000 7171

# O healthcheck bate no `api`. Num container que só roda `game`, aponte para a 7171
# no compose — o Dockerfile não sabe qual papel vai subir.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# node como PID 1, para o SIGTERM chegar direto ao handler de drenagem.
CMD ["node", "packages/server/dist/main.js"]
