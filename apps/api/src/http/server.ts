/**
 * Servidor HTTP.
 *
 * Recebe as dependências prontas por injeção, em vez de construí-las. Isso
 * mantém a camada HTTP ignorante sobre banco e rede, e permite que o teste de
 * rota use `inject()` sem subir socket nem container.
 */

import { randomUUID } from 'node:crypto';

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import {
  favoriteMutationSchema,
  historyWindowSchema,
  type ErrorResponse,
} from '@pulse-fx/contracts';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

import type { IndicatorsService } from '../application/indicatorsService';
import type { SyncResult, SyncTrigger } from '../application/syncService';
import type { FavoritesRepository } from '../infra/db/seriesRepository';

/**
 * Nome do cookie de sessão anônima.
 *
 * O prefixo `__Host-` é uma instrução ao navegador, não um enfeite: ele só
 * aceita o cookie se vier com Secure, Path=/ e sem Domain — o que impede um
 * subdomínio comprometido de sobrescrever a sessão. Fora de produção o prefixo
 * é abandonado, porque `__Host-` exige HTTPS e o desenvolvimento roda em HTTP.
 */
export const SESSION_COOKIE_PRODUCTION = '__Host-pulsefx_session';
export const SESSION_COOKIE_DEVELOPMENT = 'pulsefx_session';

export interface ServerDependencies {
  readonly indicators: IndicatorsService;
  readonly favorites: FavoritesRepository;
  readonly runSync: (trigger: SyncTrigger) => Promise<SyncResult[]>;
  readonly checkDatabase: () => Promise<boolean>;
  readonly config: {
    readonly nodeEnv: 'development' | 'test' | 'production';
    readonly corsOrigins: readonly string[];
    readonly adminSyncToken: string;
    readonly rateLimitMax: number;
    readonly rateLimitWindowMinutes: number;
  };
}

/**
 * Comparação de token em tempo constante.
 *
 * Comparar segredo com `===` vaza informação por tempo de execução: a igualdade
 * de strings sai no primeiro caractere diferente, e medir isso permite
 * descobrir o token caractere a caractere. O custo de evitar é irrisório.
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}

export async function buildServer(deps: ServerDependencies): Promise<FastifyInstance> {
  const isProduction = deps.config.nodeEnv === 'production';
  const sessionCookie = isProduction ? SESSION_COOKIE_PRODUCTION : SESSION_COOKIE_DEVELOPMENT;

  const app = Fastify({
    // Correlaciona log e resposta de erro sem expor detalhe interno ao cliente.
    genReqId: () => randomUUID(),
    logger: {
      level: deps.config.nodeEnv === 'test' ? 'silent' : 'info',
      redact: {
        // Nunca registrar credencial nem token administrativo em log.
        paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-admin-token"]'],
        remove: true,
      },
    },
    // Corpo de requisição pequeno: nenhuma rota recebe payload grande.
    bodyLimit: 16 * 1024,
    trustProxy: isProduction,
  });

  await app.register(helmet, {
    // A API só devolve JSON: nada aqui deve ser executado como página.
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  await app.register(cors, {
    // Allowlist explícita. Curinga com credentials é recusado pelo navegador,
    // e seria errado mesmo se não fosse.
    origin: deps.config.corsOrigins as string[],
    credentials: true,
    methods: ['GET', 'POST', 'DELETE'],
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    max: deps.config.rateLimitMax,
    timeWindow: deps.config.rateLimitWindowMinutes * 60_000,
    // A resposta de limite não revela a política interna além do necessário.
    errorResponseBuilder: (request, context) => ({
      code: 'rate_limited',
      message: `Muitas requisições. Tente novamente em ${context.after}.`,
      requestId: request.id,
    }),
  });

  /**
   * Sessão anônima.
   *
   * Identificador opaco gerado no servidor, sem qualquer dado pessoal: não há
   * cadastro, e-mail ou rastreio. É o suficiente para persistir favoritos de
   * verdade no banco, e é o mínimo que a LGPD recompensa — o que não se coleta
   * não vaza.
   */
  app.decorateRequest('sessionId', '');

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const existing = request.cookies[sessionCookie];
    // Aceita apenas UUID: cookie forjado com conteúdo arbitrário não vira
    // chave de banco.
    const valid =
      typeof existing === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existing);

    const sessionId = valid ? existing : randomUUID();
    (request as FastifyRequest & { sessionId: string }).sessionId = sessionId;

    if (!valid) {
      reply.setCookie(sessionCookie, sessionId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
      });
    }
  });

  const sessionOf = (request: FastifyRequest): string =>
    (request as FastifyRequest & { sessionId: string }).sessionId;

  const fail = (reply: FastifyReply, status: number, code: string, message: string): FastifyReply => {
    const body: ErrorResponse = { code, message, requestId: reply.request.id };
    return reply.status(status).send(body);
  };

  // ─── Rotas ──────────────────────────────────────────────────────────────

  app.get('/health', async (_request, reply) => {
    const databaseUp = await deps.checkDatabase();
    return reply.status(databaseUp ? 200 : 503).send({
      status: databaseUp ? 'ok' : 'degraded',
      database: databaseUp ? 'up' : 'down',
    });
  });

  app.get('/api/indicators', async (request, reply) => {
    const favorites = await deps.favorites.listBySession(sessionOf(request));
    const indicators = await deps.indicators.listIndicators(favorites);

    return reply.send({ indicators });
  });

  app.get('/api/indicators/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = historyWindowSchema.safeParse(
      (request.query as { window?: string }).window ?? '90d',
    );

    if (!parsed.success) {
      return fail(reply, 400, 'invalid_window', 'Janela inválida. Use 30d, 90d, 1y ou 5y.');
    }

    const favorites = await deps.favorites.listBySession(sessionOf(request));
    const detail = await deps.indicators.getIndicator(id, parsed.data, favorites);

    if (!detail) {
      return fail(reply, 404, 'indicator_not_found', 'Indicador não encontrado.');
    }

    return reply.send(detail);
  });

  app.get('/api/favorites', async (request, reply) => {
    const seriesIds = await deps.favorites.listBySession(sessionOf(request));
    return reply.send({ seriesIds });
  });

  app.post('/api/favorites', async (request, reply) => {
    const parsed = favoriteMutationSchema.safeParse(request.body);

    if (!parsed.success) {
      return fail(reply, 400, 'invalid_body', 'Informe o campo seriesId.');
    }

    // Só séries do catálogo entram: sem isso, a tabela viraria depósito de
    // qualquer string enviada pelo cliente.
    const detail = await deps.indicators.getIndicator(parsed.data.seriesId, '30d', []);
    if (!detail) {
      return fail(reply, 404, 'indicator_not_found', 'Indicador não encontrado.');
    }

    await deps.favorites.add(sessionOf(request), parsed.data.seriesId);
    const seriesIds = await deps.favorites.listBySession(sessionOf(request));

    return reply.status(201).send({ seriesIds });
  });

  app.delete('/api/favorites/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    await deps.favorites.remove(sessionOf(request), id);
    const seriesIds = await deps.favorites.listBySession(sessionOf(request));

    return reply.send({ seriesIds });
  });

  /**
   * Sincronização manual.
   *
   * Protegida por token comparado em tempo constante, com rate limit próprio e
   * bem mais apertado: cada chamada dispara requisições às fontes externas, e
   * deixar isso aberto seria transformar a API num amplificador de tráfego
   * contra o BCB e o FRED.
   */
  app.post(
    '/api/admin/sync',
    {
      config: { rateLimit: { max: 5, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const provided = request.headers['x-admin-token'];

      if (typeof provided !== 'string' || !safeCompare(provided, deps.config.adminSyncToken)) {
        // 401 genérico: não distingue token ausente de token errado.
        return fail(reply, 401, 'unauthorized', 'Credencial administrativa inválida.');
      }

      const results = await deps.runSync('admin');
      return reply.send({ results });
    },
  );

  // ─── Erros ──────────────────────────────────────────────────────────────

  app.setNotFoundHandler((request, reply) =>
    fail(reply, 404, 'not_found', 'Recurso não encontrado.'),
  );

  /**
   * O detalhe do erro fica no log, correlacionado por requestId; o cliente
   * recebe uma mensagem genérica. Devolver stack trace ou mensagem do driver
   * entrega estrutura de tabela e caminho de arquivo a quem estiver sondando.
   */
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, requestId: request.id }, 'erro não tratado');

    if (reply.statusCode === 429) return reply;

    return fail(reply, 500, 'internal_error', 'Erro interno. Tente novamente em instantes.');
  });

  return app;
}
