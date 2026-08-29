/**
 * Teste de persistência contra um Postgres real, em container efêmero.
 *
 * Deliberadamente não usa mock do driver: as afirmações que interessam aqui —
 * idempotência do upsert, precisão de NUMERIC, recorte por janela de datas —
 * são comportamento do banco, não do nosso código. Um mock provaria apenas que
 * escrevemos a string SQL que imaginamos escrever.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { calculateVariation } from '../../domain/variation';
import { ObservationsRepository } from './observationsRepository';

const migrationsDir = fileURLToPath(new URL('../../../../../db/migrations/', import.meta.url));

let container: StartedPostgreSqlContainer;
let pool: Pool;
let repository: ObservationsRepository;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });

  // As migrations reais, não um schema paralelo escrito para o teste: assim o
  // teste também protege contra migration quebrada.
  for (const file of ['001_schema.sql', '002_seed_series.sql']) {
    await pool.query(readFileSync(migrationsDir + file, 'utf8'));
  }

  repository = new ObservationsRepository(pool);
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

beforeEach(async () => {
  await pool.query('TRUNCATE observations');
});

describe('ObservationsRepository · gravação', () => {
  it('grava observações e devolve a contagem', async () => {
    const written = await repository.upsertMany('usd-brl', [
      { referenceDate: '2026-08-27', value: 5.1642 },
      { referenceDate: '2026-08-28', value: 5.2005 },
    ]);

    expect(written).toBe(2);
    expect(await repository.findWindow('usd-brl', 30)).toHaveLength(2);
  });

  it('reprocessar o mesmo intervalo não duplica linhas', async () => {
    const payload = [
      { referenceDate: '2026-08-27', value: 5.1642 },
      { referenceDate: '2026-08-28', value: 5.2005 },
    ];

    await repository.upsertMany('usd-brl', payload);
    await repository.upsertMany('usd-brl', payload);
    await repository.upsertMany('usd-brl', payload);

    expect(await repository.findWindow('usd-brl', 30)).toHaveLength(2);
  });

  it('aceita revisão de valor para uma data já conhecida', async () => {
    // As fontes revisam dado publicado; o IPCA passa por revisão. A revisão
    // mais recente é a que vale, então DO NOTHING seria errado.
    await repository.upsertMany('usd-brl', [{ referenceDate: '2026-08-28', value: 5.1999 }]);
    await repository.upsertMany('usd-brl', [{ referenceDate: '2026-08-28', value: 5.2005 }]);

    const latest = await repository.findLatest('usd-brl');

    expect(latest).toEqual({ referenceDate: '2026-08-28', value: 5.2005 });
  });

  it('não faz consulta quando a lista chega vazia', async () => {
    expect(await repository.upsertMany('usd-brl', [])).toBe(0);
  });

  it('preserva a precisão decimal do câmbio', async () => {
    // NUMERIC existe justamente para isso: 5.1642 tem de voltar exato.
    await repository.upsertMany('usd-brl', [{ referenceDate: '2026-08-27', value: 5.1642 }]);

    const latest = await repository.findLatest('usd-brl');

    expect(latest?.value).toBe(5.1642);
  });

  it('isola séries diferentes', async () => {
    await repository.upsertMany('usd-brl', [{ referenceDate: '2026-08-28', value: 5.2005 }]);
    await repository.upsertMany('eur-brl', [{ referenceDate: '2026-08-28', value: 6.0315 }]);

    expect((await repository.findLatest('usd-brl'))?.value).toBe(5.2005);
    expect((await repository.findLatest('eur-brl'))?.value).toBe(6.0315);
  });
});

describe('ObservationsRepository · leitura', () => {
  beforeEach(async () => {
    await repository.upsertMany('usd-brl', [
      { referenceDate: '2026-05-01', value: 5.0 },
      { referenceDate: '2026-08-01', value: 5.1 },
      { referenceDate: '2026-08-27', value: 5.1642 },
      { referenceDate: '2026-08-28', value: 5.2005 },
    ]);
  });

  it('devolve o histórico em ordem crescente de data', async () => {
    const history = await repository.findWindow('usd-brl', 3650);

    expect(history.map((item) => item.referenceDate)).toEqual([
      '2026-05-01',
      '2026-08-01',
      '2026-08-27',
      '2026-08-28',
    ]);
  });

  it('recorta a janela por dias de calendário a partir da observação mais recente', async () => {
    // 30 dias antes de 28/08 é 29/07: entram apenas as três de agosto.
    const history = await repository.findWindow('usd-brl', 30);

    expect(history).toHaveLength(3);
    expect(history[0]?.referenceDate).toBe('2026-08-01');
  });

  it('devolve lista vazia para série sem observação', async () => {
    expect(await repository.findWindow('ipca-mensal', 90)).toEqual([]);
    expect(await repository.findLatest('ipca-mensal')).toBeNull();
  });

  it('não desloca a data por fuso horário', async () => {
    // O driver devolve DATE à meia-noite UTC. Formatar em horário local jogaria
    // a data para o dia anterior no Brasil (UTC-3) — bug clássico e silencioso.
    const latest = await repository.findLatest('usd-brl');

    expect(latest?.referenceDate).toBe('2026-08-28');
  });

  it('traz a data mais recente de todas as séries numa consulta só', async () => {
    await repository.upsertMany('eur-brl', [{ referenceDate: '2026-08-26', value: 6.0129 }]);

    const dates = await repository.findLatestDates();

    expect(dates.get('usd-brl')).toBe('2026-08-28');
    expect(dates.get('eur-brl')).toBe('2026-08-26');
    expect(dates.has('ipca-mensal')).toBe(false);
  });
});

describe('integração persistência + domínio', () => {
  it('a variação calculada sobre o dado persistido bate com o esperado', async () => {
    // Valores reais da PTAX, obtidos da API do BCB em 28/08/2026.
    await repository.upsertMany('usd-brl', [
      { referenceDate: '2026-08-26', value: 5.1604 },
      { referenceDate: '2026-08-27', value: 5.1642 },
      { referenceDate: '2026-08-28', value: 5.2005 },
    ]);

    const history = await repository.findWindow('usd-brl', 30);
    const variation = calculateVariation(history, 'fx_daily');

    expect(variation.latest?.referenceDate).toBe('2026-08-28');
    expect(variation.baseline?.referenceDate).toBe('2026-08-27');
    // (5.2005 - 5.1642) / 5.1642 = 0.70292...%
    expect(variation.change).toBeCloseTo(0.7029, 3);
  });

  it('a Selic persistida compara patamares, não dias repetidos', async () => {
    // Cenário real: a série 432 repete o valor todos os dias entre reuniões.
    await repository.upsertMany('selic-meta', [
      { referenceDate: '2026-08-24', value: 14.0 },
      { referenceDate: '2026-08-25', value: 14.25 },
      { referenceDate: '2026-08-26', value: 14.25 },
      { referenceDate: '2026-08-27', value: 14.25 },
      { referenceDate: '2026-08-28', value: 14.25 },
    ]);

    const history = await repository.findWindow('selic-meta', 30);
    const variation = calculateVariation(history, 'policy_rate');

    expect(variation.change).toBeCloseTo(0.25, 10);
    expect(variation.unit).toBe('percentage_points');
  });
});
