# Imagem do cliente web.
#
# O build de produção do Vite gera arquivos estáticos: HTML, JS, CSS e ícones.
# Servi-los com Node seria carregar um runtime inteiro para entregar arquivo —
# nginx faz isso com uma fração da memória e da superfície de ataque.

# ─── Estágio de build ─────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/

RUN npm ci

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/web apps/web

# `npm run build` roda tsc --noEmit antes do vite build: erro de tipo não vira
# imagem publicada.
RUN npm run build --workspace @pulse-fx/web

# ─── Estágio de execução ──────────────────────────────────────────
# Imagem nginx que já roda como usuário sem privilégio.
#
# A imagem oficial do nginx inicia como root e faz chown do diretório de cache
# antes de rebaixar o processo. Com 'cap_drop: ALL' no Compose — que é a postura
# correta — esse chown falha e o container reinicia em laço.
#
# A variante 'unprivileged' já vem com tudo pertencendo ao usuário nginx e
# escutando em 8080, sem precisar de chown nem de porta privilegiada. Devolver a
# capability CHOWN só para acomodar a imagem oficial seria enfraquecer a
# segurança para contornar um detalhe de empacotamento.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

USER root
RUN apk --no-cache upgrade
USER nginx

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=4s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
