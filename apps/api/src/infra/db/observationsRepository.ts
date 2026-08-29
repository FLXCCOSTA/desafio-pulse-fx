/**
 * Persistência de observações.
 *
 * Detalhe do driver que merece atenção: o `pg` entrega colunas NUMERIC como
 * **string**, não como number. É proposital — NUMERIC do Postgres tem alcance
 * maior que o double do JavaScript, então converter automaticamente perderia
 * precisão em silêncio. A conversão acontece aqui, na fronteira, com validação:
 * o domínio recebe apenas números finitos.
 */

import type { Observation } from '../../domain/series';

/** Contrato mínimo de execução, para que o repositório aceite pool ou transação. */
export interface QueryExecutor {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

interface ObservationRow extends Record<string, unknown> {
  reference_date: Date | string;
  value: string;
}

/** `Date` do driver ou string ISO → `YYYY-MM-DD`. */
function toIsoDate(raw: Date | string): string {
  if (raw instanceof Date) {
    // Usa os componentes UTC: o driver devolve a DATE à meia-noite UTC, e
    // formatar em horário local jogaria a data para o dia anterior no Brasil.
    const year = raw.getUTCFullYear();
    const month = String(raw.getUTCMonth() + 1).padStart(2, '0');
    const day = String(raw.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return raw.slice(0, 10);
}

function toObservation(row: ObservationRow): Observation | null {
  const value = Number(row.value);
  if (!Number.isFinite(value)) return null;

  return { referenceDate: toIsoDate(row.reference_date), value };
}

export class ObservationsRepository {
  constructor(private readonly db: QueryExecutor) {}

  /**
   * Grava observações de uma série.
   *
   * Idempotente por construção: a chave primária composta (series_id,
   * reference_date) faz o reprocessamento do mesmo intervalo atualizar a linha
   * em vez de duplicá-la. O `DO UPDATE` é necessário, e não apenas
   * `DO NOTHING`, porque as fontes revisam valores já publicados — o IPCA
   * passa por revisão, e a revisão é que deve valer.
   *
   * Devolve quantas linhas foram inseridas ou atualizadas.
   */
  async upsertMany(seriesId: string, observations: readonly Observation[]): Promise<number> {
    if (observations.length === 0) return 0;

    const dates = observations.map((item) => item.referenceDate);
    // Valor viaja como texto e é convertido para NUMERIC pelo Postgres, para
    // não passar pelo double do driver e perder precisão no caminho.
    const values = observations.map((item) => String(item.value));

    const result = await this.db.query(
      `INSERT INTO observations (series_id, reference_date, value)
       SELECT $1, d::date, v::numeric
         FROM unnest($2::text[], $3::text[]) AS t(d, v)
       ON CONFLICT (series_id, reference_date)
       DO UPDATE SET value = EXCLUDED.value, ingested_at = now()`,
      [seriesId, dates, values],
    );

    return result.rowCount ?? 0;
  }

  /**
   * Histórico de uma série, do mais antigo para o mais recente — a ordem que o
   * cálculo de variação e o gráfico esperam.
   *
   * O recorte é por quantidade de dias de calendário, não por quantidade de
   * linhas: pedir "90 dias" numa série mensal precisa devolver ~3 pontos, e
   * numa série diária ~62.
   */
  async findWindow(seriesId: string, days: number): Promise<Observation[]> {
    const result = await this.db.query<ObservationRow>(
      `SELECT reference_date, value
         FROM observations
        WHERE series_id = $1
          AND reference_date >= (
                SELECT max(reference_date) FROM observations WHERE series_id = $1
              ) - ($2::int * INTERVAL '1 day')
        ORDER BY reference_date ASC`,
      [seriesId, days],
    );

    return result.rows.map(toObservation).filter((item): item is Observation => item !== null);
  }

  /** Observação mais recente já persistida, ou `null` se a série estiver vazia. */
  async findLatest(seriesId: string): Promise<Observation | null> {
    const result = await this.db.query<ObservationRow>(
      `SELECT reference_date, value
         FROM observations
        WHERE series_id = $1
        ORDER BY reference_date DESC
        LIMIT 1`,
      [seriesId],
    );

    const row = result.rows[0];
    return row ? toObservation(row) : null;
  }

  /**
   * Data da observação mais recente por série, numa consulta só.
   * O dashboard precisa disso para todas as séries: fazer uma query por card
   * seria o clássico N+1.
   */
  async findLatestDates(): Promise<Map<string, string>> {
    const result = await this.db.query<{ series_id: string; reference_date: Date | string }>(
      `SELECT series_id, max(reference_date) AS reference_date
         FROM observations
        GROUP BY series_id`,
    );

    return new Map(result.rows.map((row) => [row.series_id, toIsoDate(row.reference_date)]));
  }
}
