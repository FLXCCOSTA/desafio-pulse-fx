/**
 * Leitura do catálogo de séries e persistência de favoritos.
 *
 * O catálogo vive no banco, e não num arquivo de constantes, porque a
 * justificativa e as limitações de cada indicador são conteúdo de produto:
 * aparecem na tela de detalhe e precisam ser versionados por migration, com o
 * mesmo rigor do resto do esquema.
 */

import type { SeriesKind } from '../../domain/series';
import type { QueryExecutor } from './observationsRepository';

export interface SeriesRecord {
  readonly id: string;
  readonly source: 'bcb_sgs' | 'fred';
  readonly externalId: string;
  readonly name: string;
  readonly kind: SeriesKind;
  readonly unit: string;
  readonly frequency: 'daily' | 'monthly';
  readonly rationale: string;
  readonly limitations: string;
  readonly docUrl: string;
}

interface SeriesRow extends Record<string, unknown> {
  id: string;
  source: 'bcb_sgs' | 'fred';
  external_id: string;
  name: string;
  kind: SeriesKind;
  unit: string;
  frequency: 'daily' | 'monthly';
  rationale: string;
  limitations: string;
  doc_url: string;
}

const toRecord = (row: SeriesRow): SeriesRecord => ({
  id: row.id,
  source: row.source,
  externalId: row.external_id,
  name: row.name,
  kind: row.kind,
  unit: row.unit,
  frequency: row.frequency,
  rationale: row.rationale,
  limitations: row.limitations,
  docUrl: row.doc_url,
});

const SELECT_COLUMNS = `id, source, external_id, name, kind, unit, frequency,
                        rationale, limitations, doc_url`;

export class SeriesRepository {
  constructor(private readonly db: QueryExecutor) {}

  async findActive(): Promise<SeriesRecord[]> {
    const result = await this.db.query<SeriesRow>(
      `SELECT ${SELECT_COLUMNS} FROM series WHERE active ORDER BY source, id`,
    );

    return result.rows.map(toRecord);
  }

  async findById(id: string): Promise<SeriesRecord | null> {
    const result = await this.db.query<SeriesRow>(
      `SELECT ${SELECT_COLUMNS} FROM series WHERE id = $1 AND active`,
      [id],
    );

    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }
}

export class FavoritesRepository {
  constructor(private readonly db: QueryExecutor) {}

  async listBySession(sessionId: string): Promise<string[]> {
    const result = await this.db.query<{ series_id: string }>(
      `SELECT series_id FROM favorites WHERE session_id = $1 ORDER BY created_at`,
      [sessionId],
    );

    return result.rows.map((row) => row.series_id);
  }

  /**
   * Marcar favorito é idempotente: clicar duas vezes não é erro, é só o mesmo
   * estado desejado. `DO NOTHING` preserva o `created_at` original, que é o que
   * ordena a lista.
   */
  async add(sessionId: string, seriesId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO favorites (session_id, series_id)
       VALUES ($1, $2)
       ON CONFLICT (session_id, series_id) DO NOTHING`,
      [sessionId, seriesId],
    );
  }

  async remove(sessionId: string, seriesId: string): Promise<void> {
    await this.db.query(`DELETE FROM favorites WHERE session_id = $1 AND series_id = $2`, [
      sessionId,
      seriesId,
    ]);
  }
}

export class SyncRunsRepository {
  constructor(private readonly db: QueryExecutor) {}

  async record(
    seriesId: string,
    trigger: 'schedule' | 'startup' | 'admin',
    outcome: string,
    rowsUpserted: number,
    errorMessage?: string,
  ): Promise<void> {
    const status = outcome === 'success' ? 'success' : outcome === 'failed' ? 'failed' : 'skipped';

    await this.db.query(
      `INSERT INTO sync_runs
         (series_id, finished_at, status, rows_upserted, error_message, trigger_source)
       VALUES ($1, now(), $2, $3, $4, $5)`,
      [seriesId, status, rowsUpserted, errorMessage ?? null, trigger],
    );
  }
}
