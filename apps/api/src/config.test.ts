import { describe, expect, it } from 'vitest';

import { loadConfig } from './config';

const valid = {
  DATABASE_URL: 'postgresql://pulsefx:secret@localhost:5432/pulsefx',
  ADMIN_SYNC_TOKEN: 'a'.repeat(48),
  FRED_API_KEY: 'chave-de-teste',
};

describe('loadConfig', () => {
  it('aplica os padrões quando só o obrigatório é informado', () => {
    const config = loadConfig(valid);

    expect(config.port).toBe(3333);
    expect(config.nodeEnv).toBe('development');
    expect(config.bcbTimeoutMs).toBe(25_000);
    expect(config.fredTimeoutMs).toBe(8_000);
  });

  it('falha no boot quando a URL do banco está ausente', () => {
    expect(() => loadConfig({ ...valid, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it('falha no boot quando a chave do FRED está ausente', () => {
    expect(() => loadConfig({ ...valid, FRED_API_KEY: undefined })).toThrow(/FRED_API_KEY/);
  });

  it('recusa token administrativo curto demais', () => {
    // Token curto é adivinhável por força bruta, e esse endpoint dispara
    // chamadas às fontes externas.
    expect(() => loadConfig({ ...valid, ADMIN_SYNC_TOKEN: 'curto' })).toThrow(/32 caracteres/);
  });

  it('não inclui o valor recebido na mensagem de erro', () => {
    // A mensagem de erro de configuração é lugar clássico de vazamento em log.
    try {
      loadConfig({ ...valid, ADMIN_SYNC_TOKEN: 'segredo-que-nao-pode-vazar' });
      expect.unreachable('deveria ter lançado');
    } catch (error) {
      expect((error as Error).message).not.toContain('segredo-que-nao-pode-vazar');
    }
  });

  it('divide as origens de CORS em allowlist, ignorando espaços', () => {
    const config = loadConfig({
      ...valid,
      CORS_ORIGINS: 'http://localhost:5173, https://pulsefx.example ,',
    });

    expect(config.corsOrigins).toEqual(['http://localhost:5173', 'https://pulsefx.example']);
  });

  it('converte números vindos do ambiente como texto', () => {
    const config = loadConfig({ ...valid, PORT: '8080', SYNC_INTERVAL_MINUTES: '30' });

    expect(config.port).toBe(8080);
    expect(config.syncIntervalMinutes).toBe(30);
  });

  it('recusa porta inválida em vez de cair para um padrão silencioso', () => {
    expect(() => loadConfig({ ...valid, PORT: 'oitenta' })).toThrow(/PORT/);
  });
});

describe('loadConfig · trustProxy', () => {
  /**
   * Regressão de vulnerabilidade encontrada em revisão: `trustProxy` era
   * derivado de `NODE_ENV`, então o container de produção confiava em
   * `X-Forwarded-For` sem proxy à frente. Como o rate limit é contado por
   * `request.ip`, qualquer cliente contornava o limite rotacionando o
   * cabeçalho — inclusive no endpoint administrativo, cujo limite existe para
   * a API não virar amplificador de tráfego contra o BCB e o FRED.
   */
  it('não confia em proxy por padrão', () => {
    expect(loadConfig(valid).trustProxy).toBe(false);
  });

  it('não passa a confiar só porque o ambiente é produção', () => {
    expect(loadConfig({ ...valid, NODE_ENV: 'production' }).trustProxy).toBe(false);
  });

  it('aceita ativação explícita', () => {
    expect(loadConfig({ ...valid, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
  });

  it('aceita faixa CIDR, que é mais seguro que confiar em qualquer origem', () => {
    expect(loadConfig({ ...valid, TRUST_PROXY: '10.0.0.0/8' }).trustProxy).toBe('10.0.0.0/8');
  });
});
