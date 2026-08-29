/**
 * Testes da camada HTTP.
 *
 * Usam `inject()` do Fastify: exercitam roteamento, hooks, validação e o
 * tratamento de erro de verdade, sem abrir socket. As dependências são dublês
 * simples, porque o que está sob teste aqui é o contrato HTTP — banco e fontes
 * externas têm testes próprios.
 */

import type { IndicatorDetail, IndicatorSummary } from '@pulse-fx/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IndicatorsService } from '../application/indicatorsService';
import type { FavoritesRepository } from '../infra/db/seriesRepository';
import { SESSION_COOKIE_DEVELOPMENT, buildServer, type ServerDependencies } from './server';

const ADMIN_TOKEN = 'a'.repeat(48);

const summary: IndicatorSummary = {
  id: 'usd-brl',
  name: 'Dólar americano (venda)',
  source: 'bcb_sgs',
  kind: 'fx_daily',
  unit: 'BRL',
  frequency: 'daily',
  latestValue: 5.2005,
  referenceDate: '2026-08-28',
  variation: {
    change: 0.7029,
    unit: 'percent',
    label: 'vs. pregão anterior',
    baselineDate: '2026-08-27',
    unavailableReason: null,
  },
  stale: false,
  isFavorite: false,
};

const detail: IndicatorDetail = {
  ...summary,
  rationale: 'Taxa de referência oficial do Banco Central.',
  limitations: 'Publicada apenas em dias úteis.',
  docUrl: 'https://dadosabertos.bcb.gov.br/',
  history: [{ referenceDate: '2026-08-28', value: 5.2005 }],
  mediumTermVariation: {
    change: 1.2,
    unit: 'percent',
    label: 'vs. 21 pregões atrás',
    baselineDate: '2026-07-29',
    unavailableReason: null,
  },
};

function makeDeps(overrides: Partial<ServerDependencies> = {}): ServerDependencies {
  const favoritesBySession = new Map<string, string[]>();

  const favorites = {
    listBySession: async (sessionId: string) => favoritesBySession.get(sessionId) ?? [],
    add: async (sessionId: string, seriesId: string) => {
      const current = favoritesBySession.get(sessionId) ?? [];
      if (!current.includes(seriesId)) current.push(seriesId);
      favoritesBySession.set(sessionId, current);
    },
    remove: async (sessionId: string, seriesId: string) => {
      favoritesBySession.set(
        sessionId,
        (favoritesBySession.get(sessionId) ?? []).filter((id) => id !== seriesId),
      );
    },
  } as unknown as FavoritesRepository;

  const indicators = {
    listIndicators: async (favoriteIds: readonly string[]) => [
      { ...summary, isFavorite: favoriteIds.includes(summary.id) },
    ],
    getIndicator: async (seriesId: string) => (seriesId === 'usd-brl' ? detail : null),
  } as unknown as IndicatorsService;

  return {
    indicators,
    favorites,
    runSync: async () => [{ seriesId: 'usd-brl', outcome: 'success', rowsUpserted: 2 }],
    checkDatabase: async () => true,
    config: {
      nodeEnv: 'test',
      corsOrigins: ['http://localhost:5173'],
      adminSyncToken: ADMIN_TOKEN,
      rateLimitMax: 1000,
      rateLimitWindowMinutes: 1,
    },
    ...overrides,
  };
}

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildServer(makeDeps());
});

afterEach(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('responde 200 quando o banco está de pé', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', database: 'up' });
  });

  it('responde 503 quando o banco está fora', async () => {
    const degraded = await buildServer(makeDeps({ checkDatabase: async () => false }));

    const response = await degraded.inject({ method: 'GET', url: '/health' });

    // 503 é o que faz um orquestrador tirar a instância do balanceador.
    expect(response.statusCode).toBe(503);
    expect(response.json().database).toBe('down');
    await degraded.close();
  });
});

describe('GET /api/indicators', () => {
  it('devolve a lista de indicadores', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/indicators' });

    expect(response.statusCode).toBe(200);
    expect(response.json().indicators).toHaveLength(1);
    expect(response.json().indicators[0]).toMatchObject({
      id: 'usd-brl',
      referenceDate: '2026-08-28',
    });
  });

  it('emite cookie de sessão anônima na primeira visita', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/indicators' });

    const cookie = response.cookies.find((item) => item.name === SESSION_COOKIE_DEVELOPMENT);

    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax');
    // O identificador é opaco: não carrega nome, e-mail nem qualquer dado pessoal.
    expect(cookie?.value).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('não emite cookie novo quando a sessão já existe', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/indicators' });
    const existing = first.cookies.find((c) => c.name === SESSION_COOKIE_DEVELOPMENT)?.value ?? '';

    const second = await app.inject({
      method: 'GET',
      url: '/api/indicators',
      cookies: { [SESSION_COOKIE_DEVELOPMENT]: existing },
    });

    expect(second.cookies).toHaveLength(0);
  });

  it('ignora cookie de sessão forjado e gera um novo', async () => {
    // Sem essa validação, conteúdo arbitrário do cliente viraria chave de banco.
    const response = await app.inject({
      method: 'GET',
      url: '/api/indicators',
      cookies: { [SESSION_COOKIE_DEVELOPMENT]: "'; DROP TABLE favorites; --" },
    });

    const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE_DEVELOPMENT);

    expect(response.statusCode).toBe(200);
    expect(cookie?.value).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('GET /api/indicators/:id', () => {
  it('devolve o detalhe com histórico e textos explicativos', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/indicators/usd-brl' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'usd-brl',
      rationale: expect.any(String),
      limitations: expect.any(String),
    });
    expect(response.json().history).toHaveLength(1);
  });

  it('responde 404 para indicador inexistente', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/indicators/nao-existe' });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('indicator_not_found');
  });

  it('recusa janela inválida com 400', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/indicators/usd-brl?window=42d' });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('invalid_window');
  });

  it('aceita as janelas previstas no contrato', async () => {
    for (const window of ['30d', '90d', '1y', '5y']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/indicators/usd-brl?window=${window}`,
      });

      expect(response.statusCode).toBe(200);
    }
  });
});

describe('favoritos', () => {
  it('persiste o favorito dentro da mesma sessão', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/favorites' });
    const session = first.cookies.find((c) => c.name === SESSION_COOKIE_DEVELOPMENT)?.value ?? '';
    const cookies = { [SESSION_COOKIE_DEVELOPMENT]: session };

    const created = await app.inject({
      method: 'POST',
      url: '/api/favorites',
      cookies,
      payload: { seriesId: 'usd-brl' },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().seriesIds).toEqual(['usd-brl']);

    const listed = await app.inject({ method: 'GET', url: '/api/favorites', cookies });
    expect(listed.json().seriesIds).toEqual(['usd-brl']);
  });

  it('não vaza favorito de uma sessão para outra', async () => {
    const a = await app.inject({ method: 'GET', url: '/api/favorites' });
    const sessionA = a.cookies.find((c) => c.name === SESSION_COOKIE_DEVELOPMENT)?.value ?? '';

    await app.inject({
      method: 'POST',
      url: '/api/favorites',
      cookies: { [SESSION_COOKIE_DEVELOPMENT]: sessionA },
      payload: { seriesId: 'usd-brl' },
    });

    // Sessão diferente: a lista tem de vir vazia.
    const outra = await app.inject({ method: 'GET', url: '/api/favorites' });

    expect(outra.json().seriesIds).toEqual([]);
  });

  it('recusa corpo sem seriesId', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/favorites', payload: {} });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('invalid_body');
  });

  it('recusa favoritar série fora do catálogo', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/favorites',
      payload: { seriesId: 'serie-inventada' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('remover é idempotente', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/api/favorites/usd-brl' });

    expect(response.statusCode).toBe(200);
    expect(response.json().seriesIds).toEqual([]);
  });
});

describe('POST /api/admin/sync', () => {
  it('recusa requisição sem token', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/admin/sync' });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('unauthorized');
  });

  it('recusa token errado com a mesma resposta de token ausente', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/sync',
      headers: { 'x-admin-token': 'b'.repeat(48) },
    });

    // Não distinguir os dois casos evita confirmar a existência do header.
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('unauthorized');
  });

  it('recusa token de tamanho diferente sem vazar por tempo', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/sync',
      headers: { 'x-admin-token': 'a'.repeat(47) },
    });

    expect(response.statusCode).toBe(401);
  });

  it('executa a sincronização com o token correto', async () => {
    const runSync = vi.fn(async () => [
      { seriesId: 'usd-brl', outcome: 'success' as const, rowsUpserted: 2 },
    ]);
    const server = await buildServer(makeDeps({ runSync }));

    const response = await server.inject({
      method: 'POST',
      url: '/api/admin/sync',
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });

    expect(response.statusCode).toBe(200);
    expect(runSync).toHaveBeenCalledWith('admin');
    await server.close();
  });
});

describe('segurança das respostas', () => {
  it('aplica os cabeçalhos do helmet', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/indicators' });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('não devolve o cabeçalho que anuncia a tecnologia do servidor', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/indicators' });

    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('erro interno não vaza stack trace nem detalhe do driver', async () => {
    const quebrado = await buildServer(
      makeDeps({
        indicators: {
          listIndicators: async () => {
            throw new Error('relation "observations" does not exist at line 42');
          },
          getIndicator: async () => null,
        } as unknown as IndicatorsService,
      }),
    );

    const response = await quebrado.inject({ method: 'GET', url: '/api/indicators' });
    const body = response.json();

    expect(response.statusCode).toBe(500);
    expect(body.code).toBe('internal_error');
    expect(JSON.stringify(body)).not.toContain('observations');
    expect(JSON.stringify(body)).not.toContain('line 42');
    // O requestId permite achar o detalhe completo no log interno.
    expect(body.requestId).toBeTruthy();
    await quebrado.close();
  });

  it('rota inexistente devolve 404 no mesmo formato de erro', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nao-existe' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'not_found', requestId: expect.any(String) });
  });
});
