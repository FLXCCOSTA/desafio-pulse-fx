/**
 * Rotina de carga inicial da API.
 *
 * Vive na camada de aplicação, e não no composition root, por uma razão
 * concreta: o `index.ts` executa `main()` ao ser importado, então qualquer
 * lógica exportada de lá seria impossível de testar sem subir o processo
 * inteiro. Foi exatamente o que o primeiro teste desta funcionalidade
 * denunciou.
 */

import type { Pool } from 'pg';

import type { SyncResult, SyncTrigger } from './syncService';

/** Registrador mínimo, para não acoplar este módulo ao tipo do logger do Fastify. */
interface Logger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

/**
 * Aguarda o banco aceitar consultas antes da primeira sincronização.
 *
 * Existe por causa de uma corrida real, observada em 30/08/2026: o container da
 * API subiu antes do PostgreSQL terminar a inicialização, e a carga inicial
 * morreu com `57P03 — the database system is starting up`.
 *
 * O `depends_on: condition: service_healthy` do Compose **não** protege desse
 * caso. Ele só vale no `docker compose up`. Quando o daemon do Docker reinicia
 * e restaura os containers pela política `restart: unless-stopped` — reboot da
 * máquina, atualização do Docker Desktop, recuperação de falha — todos sobem em
 * paralelo, e a ordem declarada é ignorada.
 *
 * Sem esta espera, a falha não era retentada: a próxima tentativa só viria no
 * ciclo seguinte do agendador, até duas horas depois. Numa segunda-feira de
 * manhã isso significa exibir a cotação de sexta como se fosse a atual, em
 * silêncio — o pior tipo de defeito num painel de dados.
 */
export async function waitForDatabase(
  pool: Pool,
  log: Logger,
  { attempts = 30, delayMs = 2_000 }: { attempts?: number; delayMs?: number } = {},
): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      if (attempt > 1) {
        log.info({ attempt }, 'banco disponível; prosseguindo com a carga inicial');
      }
      return true;
    } catch (error) {
      if (attempt === attempts) {
        log.error({ err: error, attempts }, 'banco não respondeu; carga inicial abortada');
        return false;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return false;
}

export interface StartupSyncOptions {
  /** Quantas rodadas de sincronização tentar quando alguma série falha. */
  readonly attempts?: number;
  /** Espera entre rodadas. */
  readonly delayMs?: number;
  /** Repassado a `waitForDatabase`; separado para que o teste não durma. */
  readonly wait?: { attempts?: number; delayMs?: number };
}

/**
 * Carga inicial: espera o banco, sincroniza e insiste se a fonte falhar.
 *
 * A retentativa cobre o outro cenário de reinício: a máquina volta com a rede
 * ainda instável, a chamada à fonte externa falha, e o dado ficaria parado até
 * o próximo ciclo do agendador. O circuit breaker continua valendo — se a fonte
 * estiver realmente fora, ele abre e as tentativas seguintes nem saem, que é
 * exatamente o comportamento desejado.
 *
 * Série pulada por TTL ou por circuito aberto não conta como falha: não há o
 * que retentar nesses casos.
 */
export async function startupSync(
  pool: Pool,
  runSync: (trigger: SyncTrigger) => Promise<SyncResult[]>,
  log: Logger,
  { attempts = 3, delayMs = 30_000, wait }: StartupSyncOptions = {},
): Promise<void> {
  if (!(await waitForDatabase(pool, log, wait))) return;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const results = await runSync('startup');
    const failed = results.filter((item) => item.outcome === 'failed');

    if (failed.length === 0) {
      log.info({ series: results.length }, 'carga inicial concluída');
      return;
    }

    if (attempt === attempts) {
      log.warn(
        { failed: failed.map((item) => item.seriesId) },
        'carga inicial terminou com séries pendentes; o agendador tentará de novo',
      );
      return;
    }

    log.warn(
      { failed: failed.map((item) => item.seriesId), attempt },
      'séries falharam na carga inicial; nova tentativa em instantes',
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
