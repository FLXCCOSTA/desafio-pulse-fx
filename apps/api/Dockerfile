# syntax=docker/dockerfile:1

# ─── Estágio de build ─────────────────────────────────────────────
# O toolchain de build (TypeScript, esbuild, dependências de teste) fica só
# aqui. Nada disso chega à imagem final: menos superfície, menos CVE herdada.
FROM node:22-alpine AS builder

WORKDIR /app

# Copiar apenas os manifestos antes do código aproveita o cache de camada:
# alterar código-fonte não invalida a instalação de dependências.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/

# npm ci respeita o lockfile exatamente. Build reprodutível não é preferência
# de estilo: é o que permite auditar o que foi de fato para produção.
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api

# Falha o build se os tipos não fecharem — erro de tipo não deve virar imagem.
RUN npx tsc --noEmit -p apps/api/tsconfig.json

# Empacota em arquivo único. Os imports do projeto são extensionless, e o Node
# em ESM exige extensão em runtime; o bundler resolve isso e ainda dispensa
# node_modules na imagem final.
RUN cd apps/api && npx esbuild src/index.ts \
      --bundle \
      --platform=node \
      --target=node22 \
      --format=esm \
      --outfile=dist/index.js \
      --banner:js="import{createRequire}from'node:module';const require=createRequire(import.meta.url);"

# ─── Estágio de execução ──────────────────────────────────────────
FROM node:22-alpine AS runtime

# CIS Docker Benchmark: processo da aplicação nunca roda como root. A imagem do
# Node já traz o usuário 'node' sem privilégio.
WORKDIR /app

ENV NODE_ENV=production

# Aplica as correções de segurança do Alpine sobre a imagem base.
#
# A tag `node:22-alpine` é reconstruída periodicamente, mas entre uma
# reconstrução e outra ela acumula pacotes com CVE já corrigido no repositório
# da distribuição — foi o caso do OpenSSL aqui. Um `apk upgrade` no build
# fecha essa janela sem depender do calendário de quem publica a imagem base.
RUN apk --no-cache upgrade

# Remove o npm da imagem de execução.
#
# O runtime executa um único arquivo JavaScript já empacotado: não instala
# nada, não resolve dependência, não precisa de gerenciador de pacotes. O npm
# que vem na imagem base carrega as próprias dependências — tar, sigstore e
# picomatch, entre outras — e eram elas, não o nosso código, que apareciam no
# scan do Trivy como HIGH e CRITICAL.
#
# Suprimir o alerta seria o caminho fácil e errado. Remover o npm elimina a
# causa: menos superfície de ataque, imagem menor, e o gate passa por mérito.
# De quebra, quem conseguisse execução de comando dentro do container não
# encontraria um instalador de pacotes à disposição.
RUN rm -rf /usr/local/lib/node_modules/npm \
  /usr/local/bin/npm \
  /usr/local/bin/npx \
  /opt/yarn-*

# Apenas o artefato compilado. Sem node_modules, sem código-fonte, sem
# ferramenta de build — e, principalmente, sem .env: segredo entra por
# variável de ambiente em tempo de execução, nunca em camada de imagem.
COPY --from=builder --chown=node:node /app/apps/api/dist/index.js ./index.js

USER node

EXPOSE 3333

# Healthcheck consultando a própria rota de saúde, que por sua vez verifica o
# banco. Sem isso o Compose consideraria 'de pé' um processo que subiu mas não
# consegue responder.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3333/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Forma exec, não shell: o processo recebe PID 1 e enxerga SIGTERM, o que faz o
# encerramento gracioso realmente acontecer.
CMD ["node", "index.js"]
