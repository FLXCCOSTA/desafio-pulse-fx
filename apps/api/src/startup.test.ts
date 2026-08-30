/**
 * Testes da carga inicial.
 *
 * Regressão de defeito observado em produção local em 30/08/2026: o container
 * da API subiu antes do PostgreSQL terminar de inicializar, a carga inicial
 * morreu com `57P03 — the database system is starting up`, e **não foi
 * retentada**. O dado ficaria parado até o ciclo seguinte do agendador, até
 * duas horas depois.
 *
 * O `depends_on: condition: service_healthy` do Compose não cobre esse caso:
 * ele só vale no `docker compose up`, e não quando o daemon do Docker restaura
 * containers pela política de restart.
 */

import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { SyncResult } from './application/syncService';
import { startupSync, waitForDatabase } from './application/startup';

/** Logger silencioso que registra o que foi chamado. */
function makeLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** Pool que falha nas primeiras `failures` consultas e depois responde. */
function makePool(failures: number) {
  const calls = { count: 0 };

  const pool = {
    query: async () => {
      calls.count += 1;
      if (calls.count <= failures) {
        const error = new Error('the database system is starting up');
        (error as Error & { code: string }).code = '57P03';
        throw error;
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;

  return { pool, calls };
}

const ok = (seriesId: string): SyncResult => ({ seriesId, outcome: 'success', rowsUpserted: 1 });
const fail = (seriesId: string): SyncResult => ({
  seriesId,
  outcome: 'failed',
  rowsUpserted: 0,
  errorMessage: 'fonte fora do ar',
});

describe('waitForDatabase', () => {
  it('segue adiante quando o banco já responde', async () => {
    const { pool, calls } = makePool(0);
    const log = makeLog();

    expect(await waitForDatabase(pool, log)).toBe(true);
    expect(calls.count).toBe(1);
    // Sucesso de primeira não precisa poluir o log.
    expect(log.info).not.toHaveBeenCalled();
  });

  it('insiste enquanto o banco ainda está inicializando', async () => {
    // Cenário exato do 57P03 observado em produção local.
    const { pool, calls } = makePool(3);
    const log = makeLog();

    expect(await waitForDatabase(pool, log, { attempts: 10, delayMs: 0 })).toBe(true);
    expect(calls.count).toBe(4);
    expect(log.info).toHaveBeenCalledWith({ attempt: 4 }, expect.stringContaining('disponível'));
  });

  it('desiste depois do limite, sem travar o processo para sempre', async () => {
    const { pool, calls } = makePool(999);
    const log = makeLog();

    expect(await waitForDatabase(pool, log, { attempts: 5, delayMs: 0 })).toBe(false);
    expect(calls.count).toBe(5);
    expect(log.error).toHaveBeenCalled();
  });
});

describe('startupSync', () => {
  it('não sincroniza se o banco nunca ficar disponível', async () => {
    const { pool } = makePool(999);
    const runSync = vi.fn(async () => []);

    await startupSync(pool, runSync, makeLog(), {
      attempts: 3,
      delayMs: 0,
      wait: { attempts: 3, delayMs: 0 },
    });

    // Bater na fonte externa sem banco para gravar seria desperdício puro.
    expect(runSync).not.toHaveBeenCalled();
  });

  it('sincroniza uma vez quando tudo dá certo', async () => {
    const { pool } = makePool(0);
    const runSync = vi.fn(async () => [ok('usd-brl'), ok('eur-brl')]);
    const log = makeLog();

    await startupSync(pool, runSync, log, { attempts: 3, delayMs: 0 });

    expect(runSync).toHaveBeenCalledTimes(1);
    expect(runSync).toHaveBeenCalledWith('startup');
    expect(log.info).toHaveBeenCalledWith({ series: 2 }, expect.stringContaining('concluída'));
  });

  it('espera o banco subir antes de sincronizar', async () => {
    const { pool, calls } = makePool(2);
    const runSync = vi.fn(async () => [ok('usd-brl')]);

    await startupSync(pool, runSync, makeLog(), {
      attempts: 3,
      delayMs: 0,
      wait: { attempts: 10, delayMs: 0 },
    });

    // Três consultas: duas falham com o banco inicializando, a terceira passa.
    expect(calls.count).toBe(3);
    expect(runSync).toHaveBeenCalledTimes(1);
  });

  it('tenta de novo quando uma série falha', async () => {
    const { pool } = makePool(0);
    let round = 0;
    const runSync = vi.fn(async () => {
      round += 1;
      return round === 1 ? [ok('usd-brl'), fail('ust-10y')] : [ok('usd-brl'), ok('ust-10y')];
    });

    await startupSync(pool, runSync, makeLog(), { attempts: 3, delayMs: 0 });

    expect(runSync).toHaveBeenCalledTimes(2);
  });

  it('para na primeira rodada totalmente bem-sucedida', async () => {
    const { pool } = makePool(0);
    const runSync = vi.fn(async () => [ok('usd-brl')]);

    await startupSync(pool, runSync, makeLog(), { attempts: 5, delayMs: 0 });

    expect(runSync).toHaveBeenCalledTimes(1);
  });

  it('desiste após o limite e deixa o restante para o agendador', async () => {
    const { pool } = makePool(0);
    const runSync = vi.fn(async () => [ok('usd-brl'), fail('ust-10y')]);
    const log = makeLog();

    await startupSync(pool, runSync, log, { attempts: 3, delayMs: 0 });

    expect(runSync).toHaveBeenCalledTimes(3);
    // Avisa, mas não derruba o processo: a API segue servindo o que já existe.
    expect(log.warn).toHaveBeenCalledWith(
      { failed: ['ust-10y'] },
      expect.stringContaining('agendador'),
    );
  });

  it('série pulada por TTL ou circuito aberto não conta como falha', async () => {
    const { pool } = makePool(0);
    const runSync = vi.fn(async (): Promise<SyncResult[]> => [
      { seriesId: 'usd-brl', outcome: 'skipped_fresh', rowsUpserted: 0 },
      { seriesId: 'ust-10y', outcome: 'skipped_circuit_open', rowsUpserted: 0 },
    ]);

    await startupSync(pool, runSync, makeLog(), { attempts: 3, delayMs: 0 });

    // Insistir numa fonte com o circuito aberto é exatamente o que o breaker
    // existe para impedir.
    expect(runSync).toHaveBeenCalledTimes(1);
  });
});
