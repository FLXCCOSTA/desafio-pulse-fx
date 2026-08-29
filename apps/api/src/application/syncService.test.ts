import { describe, expect, it, vi } from 'vitest';

import type { Observation } from '../domain/series';
import { CircuitBreaker } from './circuitBreaker';
import {
  type SeriesToSync,
  type SyncDependencies,
  SyncService,
  TTL_BY_FREQUENCY,
  shiftDays,
} from './syncService';

const usdBrl: SeriesToSync = {
  id: 'usd-brl',
  source: 'bcb_sgs',
  externalId: '1',
  frequency: 'daily',
};

const ipca: SeriesToSync = {
  id: 'ipca-mensal',
  source: 'bcb_sgs',
  externalId: '433',
  frequency: 'monthly',
};

interface Harness {
  service: SyncService;
  deps: SyncDependencies;
  fetchCalls: Array<{ seriesId: string; from: string; to: string }>;
  runs: Array<{ seriesId: string; outcome: string; rows: number }>;
  setClock: (iso: string) => void;
}

function makeHarness(overrides: Partial<SyncDependencies> = {}): Harness {
  const fetchCalls: Harness['fetchCalls'] = [];
  const runs: Harness['runs'] = [];
  let clock = new Date('2026-08-28T12:00:00Z');

  const observations: Observation[] = [
    { referenceDate: '2026-08-27', value: 5.1642 },
    { referenceDate: '2026-08-28', value: 5.2005 },
  ];

  const breaker = new CircuitBreaker('bcb_sgs', { failureThreshold: 3, cooldownMs: 60_000 });

  const deps: SyncDependencies = {
    fetchObservations: async (series, from, to) => {
      fetchCalls.push({ seriesId: series.id, from, to });
      return observations;
    },
    upsertObservations: async (_id, rows) => rows.length,
    findLatestDate: async () => null,
    recordRun: async (seriesId, _trigger, outcome, rows) => {
      runs.push({ seriesId, outcome, rows });
    },
    breakerFor: () => breaker,
    now: () => clock,
    lastSyncAt: new Map<string, number>(),
    ...overrides,
  };

  return {
    service: new SyncService(deps),
    deps,
    fetchCalls,
    runs,
    setClock: (iso: string) => {
      clock = new Date(iso);
    },
  };
}

describe('shiftDays', () => {
  it('retrocede atravessando a virada de mês', () => {
    expect(shiftDays('2026-09-02', -5)).toBe('2026-08-28');
  });

  it('retrocede atravessando a virada de ano', () => {
    expect(shiftDays('2026-01-03', -5)).toBe('2025-12-29');
  });

  it('lida com ano bissexto', () => {
    expect(shiftDays('2028-03-01', -1)).toBe('2028-02-29');
  });
});

describe('SyncService · primeira carga', () => {
  it('busca histórico longo quando a série está vazia', async () => {
    const h = makeHarness();

    await h.service.syncSeries(usdBrl, 'startup');

    expect(h.fetchCalls).toHaveLength(1);
    expect(h.fetchCalls[0]?.to).toBe('2026-08-28');
    // 5 anos de backfill para série diária.
    expect(h.fetchCalls[0]?.from).toBe('2021-08-29');
  });

  it('busca histórico ainda mais longo para série mensal', async () => {
    const h = makeHarness();

    await h.service.syncSeries(ipca, 'startup');

    // 10 anos = 3650 dias; os bissextos de 2020 e 2024 explicam o dia 30, não 31.
    expect(h.fetchCalls[0]?.from).toBe('2016-08-30');
  });

  it('registra o resultado e a contagem de linhas', async () => {
    const h = makeHarness();

    const result = await h.service.syncSeries(usdBrl, 'startup');

    expect(result).toMatchObject({ outcome: 'success', rowsUpserted: 2 });
    expect(h.runs).toEqual([{ seriesId: 'usd-brl', outcome: 'success', rows: 2 }]);
  });
});

describe('SyncService · janela incremental', () => {
  it('pede apenas desde a última observação, com sobreposição para revisões', async () => {
    const h = makeHarness({ findLatestDate: async () => '2026-08-27' });

    await h.service.syncSeries(usdBrl, 'schedule');

    // 5 dias de sobreposição: sem isso, revisão da fonte passaria despercebida.
    expect(h.fetchCalls[0]?.from).toBe('2026-08-22');
    expect(h.fetchCalls[0]?.to).toBe('2026-08-28');
  });
});

describe('SyncService · TTL', () => {
  it('pula a série quando o dado ainda está fresco', async () => {
    const h = makeHarness();

    await h.service.syncSeries(usdBrl, 'schedule');
    expect(h.fetchCalls).toHaveLength(1);

    const result = await h.service.syncSeries(usdBrl, 'schedule');

    expect(result.outcome).toBe('skipped_fresh');
    expect(h.fetchCalls).toHaveLength(1);
  });

  it('volta a buscar depois que o TTL expira', async () => {
    const h = makeHarness();

    await h.service.syncSeries(usdBrl, 'schedule');
    h.setClock(new Date(Date.parse('2026-08-28T12:00:00Z') + TTL_BY_FREQUENCY.daily + 1).toISOString());

    const result = await h.service.syncSeries(usdBrl, 'schedule');

    expect(result.outcome).toBe('success');
    expect(h.fetchCalls).toHaveLength(2);
  });

  it('série mensal tem TTL mais longo que série diária', () => {
    expect(TTL_BY_FREQUENCY.monthly).toBeGreaterThan(TTL_BY_FREQUENCY.daily);
  });

  it('o disparo admin ignora o TTL de propósito', async () => {
    const h = makeHarness();

    await h.service.syncSeries(usdBrl, 'schedule');
    const result = await h.service.syncSeries(usdBrl, 'admin');

    expect(result.outcome).toBe('success');
    expect(h.fetchCalls).toHaveLength(2);
  });
});

describe('SyncService · falha da fonte', () => {
  it('não propaga exceção: registra a falha e devolve resultado', async () => {
    const h = makeHarness({
      fetchObservations: async () => {
        throw new Error('502 do BCB');
      },
    });

    const result = await h.service.syncSeries(usdBrl, 'schedule');

    expect(result.outcome).toBe('failed');
    expect(result.errorMessage).toContain('502');
    expect(h.runs[0]?.outcome).toBe('failed');
  });

  it('uma série falhando não interrompe as demais', async () => {
    let calls = 0;
    const h = makeHarness({
      fetchObservations: async () => {
        calls += 1;
        if (calls === 1) throw new Error('502 do BCB');
        return [{ referenceDate: '2026-08-28', value: 1 }];
      },
    });

    const results = await h.service.syncAll([usdBrl, ipca], 'schedule');

    expect(results.map((r) => r.outcome)).toEqual(['failed', 'success']);
  });

  it('para de consultar a fonte depois que o circuito abre', async () => {
    const breaker = new CircuitBreaker('bcb_sgs', { failureThreshold: 2, cooldownMs: 60_000 });
    const fetchObservations = vi.fn(async () => {
      throw new Error('fonte fora do ar');
    });

    const h = makeHarness({ fetchObservations, breakerFor: () => breaker });

    await h.service.syncSeries(usdBrl, 'admin');
    await h.service.syncSeries(usdBrl, 'admin');
    const terceira = await h.service.syncSeries(usdBrl, 'admin');

    // Duas chamadas reais; a terceira nem sai, barrada pelo circuito.
    expect(fetchObservations).toHaveBeenCalledTimes(2);
    expect(terceira.outcome).toBe('skipped_circuit_open');
  });
});
