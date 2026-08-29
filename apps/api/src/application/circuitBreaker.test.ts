import { beforeEach, describe, expect, it } from 'vitest';

import { CircuitBreaker, CircuitOpenError } from './circuitBreaker';

/** Relógio controlado: o teste não espera tempo real passar. */
function fakeClock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

const boom = () => Promise.reject(new Error('fonte fora do ar'));
const ok = () => Promise.resolve('dado');

describe('CircuitBreaker', () => {
  let clock: ReturnType<typeof fakeClock>;
  let breaker: CircuitBreaker;

  beforeEach(() => {
    clock = fakeClock();
    breaker = new CircuitBreaker('bcb_sgs', {
      failureThreshold: 3,
      cooldownMs: 60_000,
      now: clock.now,
    });
  });

  it('começa fechado e deixa passar', async () => {
    await expect(breaker.execute(ok)).resolves.toBe('dado');
    expect(breaker.currentState).toBe('closed');
  });

  it('permanece fechado enquanto as falhas não atingem o limiar', async () => {
    await expect(breaker.execute(boom)).rejects.toThrow('fonte fora do ar');
    await expect(breaker.execute(boom)).rejects.toThrow('fonte fora do ar');

    expect(breaker.currentState).toBe('closed');
  });

  it('abre ao atingir o limiar de falhas consecutivas', async () => {
    for (let i = 0; i < 3; i += 1) {
      await expect(breaker.execute(boom)).rejects.toThrow();
    }

    expect(breaker.currentState).toBe('open');
  });

  it('sucesso zera a contagem, então falhas alternadas não abrem o circuito', async () => {
    await expect(breaker.execute(boom)).rejects.toThrow();
    await expect(breaker.execute(boom)).rejects.toThrow();
    await expect(breaker.execute(ok)).resolves.toBe('dado');
    await expect(breaker.execute(boom)).rejects.toThrow();
    await expect(breaker.execute(boom)).rejects.toThrow();

    expect(breaker.currentState).toBe('closed');
  });

  it('com o circuito aberto, nem chega a chamar a fonte', async () => {
    for (let i = 0; i < 3; i += 1) {
      await expect(breaker.execute(boom)).rejects.toThrow();
    }

    let chamou = false;
    const operacao = async () => {
      chamou = true;
      return 'nunca';
    };

    await expect(breaker.execute(operacao)).rejects.toThrow(CircuitOpenError);
    expect(chamou).toBe(false);
  });

  it('informa quanto falta para a próxima tentativa', async () => {
    for (let i = 0; i < 3; i += 1) {
      await expect(breaker.execute(boom)).rejects.toThrow();
    }

    clock.advance(20_000);

    await expect(breaker.execute(ok)).rejects.toMatchObject({
      name: 'CircuitOpenError',
      retryAfterMs: 40_000,
    });
  });

  it('passa a half_open depois do cooldown e fecha com um sucesso', async () => {
    for (let i = 0; i < 3; i += 1) {
      await expect(breaker.execute(boom)).rejects.toThrow();
    }

    clock.advance(60_000);

    await expect(breaker.execute(ok)).resolves.toBe('dado');
    expect(breaker.currentState).toBe('closed');
  });

  it('falha na tentativa de prova reabre o circuito de imediato', async () => {
    for (let i = 0; i < 3; i += 1) {
      await expect(breaker.execute(boom)).rejects.toThrow();
    }

    clock.advance(60_000);

    // A prova falha: não deve exigir de novo o limiar completo para reabrir.
    await expect(breaker.execute(boom)).rejects.toThrow('fonte fora do ar');
    expect(breaker.currentState).toBe('open');

    await expect(breaker.execute(ok)).rejects.toThrow(CircuitOpenError);
  });

  it('reinicia o cooldown a partir da falha da prova, não da falha original', async () => {
    for (let i = 0; i < 3; i += 1) {
      await expect(breaker.execute(boom)).rejects.toThrow();
    }

    clock.advance(60_000);
    await expect(breaker.execute(boom)).rejects.toThrow('fonte fora do ar');

    // Já se passaram 60s desde a abertura original, mas zero desde a prova.
    clock.advance(59_999);
    await expect(breaker.execute(ok)).rejects.toThrow(CircuitOpenError);

    clock.advance(1);
    await expect(breaker.execute(ok)).resolves.toBe('dado');
  });
});
