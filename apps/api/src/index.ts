/**
 * Composition root.
 *
 * É o único lugar do backend que sabe montar tudo. Todas as outras camadas
 * recebem colaboradores por injeção, o que é o que permite testar domínio sem
 * banco, aplicação sem rede e HTTP sem container.
 */

import { Pool } from 'pg';

import { CircuitBreaker } from './application/circuitBreaker';
import { IndicatorsService } from './application/indicatorsService';
import {
  SyncService,
  type SeriesToSync,
  type SyncResult,
  type SyncTrigger,
} from './application/syncService';
import { startupSync } from './application/startup';
import { loadConfig } from './config';
import { ObservationsRepository } from './infra/db/observationsRepository';
import {
  FavoritesRepository,
  SeriesRepository,
  SyncRunsRepository,
} from './infra/db/seriesRepository';
import { HttpClient } from './infra/http/httpClient';
import { BCB_HOST, BcbSgsClient } from './infra/sources/bcbSgs';
import { FRED_HOST, FredClient } from './infra/sources/fred';
import { buildServer } from './http/server';

async function main(): Promise<void> {
  const config = loadConfig();

  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    // Conexão ociosa devolvida ao sistema; evita segurar recurso do Postgres.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  const observationsRepository = new ObservationsRepository(pool);
  const seriesRepository = new SeriesRepository(pool);
  const favoritesRepository = new FavoritesRepository(pool);
  const syncRunsRepository = new SyncRunsRepository(pool);

  // Um cliente HTTP por fonte: o timeout do BCB é muito maior, porque o SGS é
  // comprovadamente lento, e aplicar esse teto ao FRED mascararia problema real.
  const bcbHttp = new HttpClient({
    allowedHosts: [BCB_HOST],
    timeoutMs: config.bcbTimeoutMs,
    maxAttempts: 3,
    maxResponseBytes: 8 * 1024 * 1024,
  });

  const fredHttp = new HttpClient({
    allowedHosts: [FRED_HOST],
    timeoutMs: config.fredTimeoutMs,
    maxAttempts: 3,
    maxResponseBytes: 8 * 1024 * 1024,
  });

  const bcbClient = new BcbSgsClient(bcbHttp);
  const fredClient = new FredClient(fredHttp, config.fredApiKey);

  // Um breaker por fonte: o BCB fora do ar não pode impedir a leitura do FRED.
  const breakers = {
    bcb_sgs: new CircuitBreaker('bcb_sgs', { failureThreshold: 3, cooldownMs: 5 * 60_000 }),
    fred: new CircuitBreaker('fred', { failureThreshold: 3, cooldownMs: 5 * 60_000 }),
  } as const;

  const syncService = new SyncService({
    fetchObservations: (series, from, to) =>
      series.source === 'bcb_sgs'
        ? bcbClient.fetchSeries(series.externalId, from, to)
        : fredClient.fetchSeries(series.externalId, from, to),
    upsertObservations: (seriesId, rows) => observationsRepository.upsertMany(seriesId, rows),
    findLatestDate: async (seriesId) =>
      (await observationsRepository.findLatest(seriesId))?.referenceDate ?? null,
    recordRun: (seriesId, trigger, outcome, rows, error) =>
      syncRunsRepository.record(seriesId, trigger, outcome, rows, error),
    breakerFor: (source) => breakers[source],
    now: () => new Date(),
    lastSyncAt: new Map<string, number>(),
  });

  const runSync = async (trigger: SyncTrigger): Promise<SyncResult[]> => {
    const catalog = await seriesRepository.findActive();
    const toSync: SeriesToSync[] = catalog.map((series) => ({
      id: series.id,
      source: series.source,
      externalId: series.externalId,
      frequency: series.frequency,
    }));

    return syncService.syncAll(toSync, trigger);
  };

  const app = await buildServer({
    indicators: new IndicatorsService(seriesRepository, observationsRepository),
    favorites: favoritesRepository,
    seriesExists: async (seriesId) => (await seriesRepository.findById(seriesId)) !== null,
    runSync,
    checkDatabase: async () => {
      try {
        await pool.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },
    config,
  });

  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`Pulse FX API ouvindo na porta ${config.port}`);

  /**
   * Agendador simples com setInterval, em vez de uma biblioteca de cron.
   *
   * A necessidade é "a cada N minutos", não uma expressão de calendário — e
   * cada dependência a mais é superfície de ataque e mais uma linha no relatório
   * de audit. O TTL do próprio SyncService já protege contra execução redundante,
   * então o intervalo pode ser generoso sem risco de martelar as fontes.
   */
  const intervalMs = config.syncIntervalMinutes * 60_000;
  const timer = setInterval(() => {
    void runSync('schedule').catch((error: unknown) => {
      app.log.error({ err: error }, 'ciclo de sincronização falhou');
    });
  }, intervalMs);

  // Não segura o processo vivo só por causa do agendador.
  timer.unref();

  if (config.syncOnStartup) {
    // Não bloqueia o boot: a API sobe e serve o que já está persistido enquanto
    // a primeira carga acontece em segundo plano.
    void startupSync(pool, runSync, app.log).catch((error: unknown) => {
      app.log.error({ err: error }, 'sincronização inicial falhou');
    });
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`recebido ${signal}, encerrando`);
    clearInterval(timer);
    // Fecha o servidor antes do pool: requisição em voo ainda precisa do banco.
    await app.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  // Falha de boot é fatal e precisa ser visível: sem isso o container reinicia
  // em laço sem nunca dizer o motivo.
  console.error('Falha ao iniciar a API:', error instanceof Error ? error.message : error);
  process.exit(1);
});
