/**
 * Configuração da aplicação, validada na inicialização.
 *
 * Princípio 12-Factor: configuração vive no ambiente, nunca no código. E a
 * validação acontece uma vez, no boot, para que o processo morra imediatamente
 * com mensagem clara em vez de falhar de forma obscura na primeira requisição
 * — um `undefined` virando string 'undefined' dentro de uma URL é o tipo de
 * erro que custa uma hora para diagnosticar em produção.
 */

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),

  /** Origens autorizadas, separadas por vírgula. Allowlist, nunca curinga. */
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  /**
   * Token do endpoint administrativo de sincronização.
   * Mínimo de 32 caracteres: um token curto é adivinhável por força bruta, e
   * esse endpoint dispara chamadas às fontes externas.
   */
  ADMIN_SYNC_TOKEN: z.string().min(32, 'ADMIN_SYNC_TOKEN deve ter ao menos 32 caracteres'),

  FRED_API_KEY: z.string().min(1, 'FRED_API_KEY é obrigatória'),

  BCB_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000),
  FRED_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),

  SYNC_ON_STARTUP: z
    .string()
    .default('true')
    .transform((value) => value === 'true'),
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(120),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(1),
});

export type AppConfig = Readonly<{
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  adminSyncToken: string;
  fredApiKey: string;
  bcbTimeoutMs: number;
  fredTimeoutMs: number;
  syncOnStartup: boolean;
  syncIntervalMinutes: number;
  rateLimitMax: number;
  rateLimitWindowMinutes: number;
}>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    // Lista o que falta sem jamais imprimir o valor recebido: a mensagem de
    // erro de configuração é um lugar clássico de vazamento de segredo em log.
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(`Configuração inválida:\n${problems}`);
  }

  const env = parsed.data;

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    adminSyncToken: env.ADMIN_SYNC_TOKEN,
    fredApiKey: env.FRED_API_KEY,
    bcbTimeoutMs: env.BCB_TIMEOUT_MS,
    fredTimeoutMs: env.FRED_TIMEOUT_MS,
    syncOnStartup: env.SYNC_ON_STARTUP,
    syncIntervalMinutes: env.SYNC_INTERVAL_MINUTES,
    rateLimitMax: env.RATE_LIMIT_MAX,
    rateLimitWindowMinutes: env.RATE_LIMIT_WINDOW_MINUTES,
  };
}
