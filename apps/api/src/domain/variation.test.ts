import { describe, expect, it } from 'vitest';

import { MEDIUM_TERM_POLICY, type Observation } from './series';
import { calculateVariation, normalizeSeries, shiftMonths } from './variation';

/** Açúcar para manter os casos legíveis. */
const obs = (referenceDate: string, value: number): Observation => ({ referenceDate, value });

describe('calculateVariation · câmbio diário', () => {
  it('compara o último fechamento com o pregão anterior', () => {
    const result = calculateVariation([obs('2026-08-26', 5.0), obs('2026-08-27', 5.1)], 'fx_daily');

    expect(result.latest?.referenceDate).toBe('2026-08-27');
    expect(result.baseline?.referenceDate).toBe('2026-08-26');
    expect(result.change).toBeCloseTo(2, 10);
    expect(result.unit).toBe('percent');
    expect(result.unavailableReason).toBeNull();
  });

  it('atravessa o fim de semana sem calendário de feriados', () => {
    // Sexta 28/08 e segunda 31/08: não há observação de sábado ou domingo.
    const result = calculateVariation(
      [obs('2026-08-27', 5.4), obs('2026-08-28', 5.5), obs('2026-08-31', 5.61)],
      'fx_daily',
    );

    expect(result.baseline?.referenceDate).toBe('2026-08-28');
    expect(result.change).toBeCloseTo(2, 10);
  });

  it('ignora feriado sem publicação, usando o último dado conhecido', () => {
    // 07/09 é feriado nacional: a série simplesmente não tem o dia.
    const result = calculateVariation([obs('2026-09-04', 5.0), obs('2026-09-08', 5.25)], 'fx_daily');

    expect(result.baseline?.referenceDate).toBe('2026-09-04');
    expect(result.change).toBeCloseTo(5, 10);
  });

  it('aceita janela de médio prazo de 21 pregões', () => {
    // 22 observações: o índice 0 é a base de 21 pregões atrás.
    const series = Array.from({ length: 22 }, (_, index) =>
      obs('2026-08-' + String(index + 1).padStart(2, '0'), 100 + index),
    );

    const result = calculateVariation(series, 'fx_daily', {
      policy: MEDIUM_TERM_POLICY.fx_daily,
    });

    expect(result.baseline?.value).toBe(100);
    expect(result.latest?.value).toBe(121);
    expect(result.change).toBeCloseTo(21, 10);
  });

  it('registra queda com sinal negativo', () => {
    const result = calculateVariation([obs('2026-08-26', 5.0), obs('2026-08-27', 4.9)], 'fx_daily');

    expect(result.change).toBeCloseTo(-2, 10);
  });
});

describe('calculateVariation · taxa de política monetária', () => {
  it('usa pontos percentuais, não variação percentual', () => {
    // Selic de 10% para 11% é +1 p.p. Reportar "+10%" seria enganoso.
    const result = calculateVariation([obs('2026-06-18', 10), obs('2026-08-06', 11)], 'policy_rate');

    expect(result.unit).toBe('percentage_points');
    expect(result.change).toBeCloseTo(1, 10);
  });

  it('reporta corte de juros como variação negativa em p.p.', () => {
    const result = calculateVariation(
      [obs('2026-06-18', 15), obs('2026-08-06', 14.25)],
      'policy_rate',
    );

    expect(result.change).toBeCloseTo(-0.75, 10);
  });

  it('não trata base zero como erro, porque a subtração é definida', () => {
    const result = calculateVariation([obs('2026-01-01', 0), obs('2026-02-01', 0.5)], 'policy_rate');

    expect(result.change).toBeCloseTo(0.5, 10);
    expect(result.unavailableReason).toBeNull();
  });
});

describe('calculateVariation · macro mensal', () => {
  it('ancora no calendário para comparar com o mesmo mês do ano anterior', () => {
    const series = Array.from({ length: 13 }, (_, index) => {
      const month = String((index % 12) + 1).padStart(2, '0');
      const year = index < 12 ? '2025' : '2026';
      return obs(year + '-' + month + '-01', 100 + index);
    });

    const result = calculateVariation(series, 'macro_monthly');

    expect(result.latest?.referenceDate).toBe('2026-01-01');
    expect(result.baseline?.referenceDate).toBe('2025-01-01');
    expect(result.change).toBeCloseTo(12, 10);
  });

  it('não usa posição no array quando falta um mês na série', () => {
    // Sem o mês alvo (2025-03), a comparação interanual fica indisponível —
    // preferimos admitir a lacuna a comparar com o mês errado.
    const result = calculateVariation(
      [obs('2025-04-01', 100), obs('2025-05-01', 101), obs('2026-03-01', 110)],
      'macro_monthly',
    );

    expect(result.latest?.referenceDate).toBe('2026-03-01');
    expect(result.baseline).toBeNull();
    expect(result.unavailableReason).toBe('no_baseline');
  });

  it('sinaliza base zero em série percentual', () => {
    const result = calculateVariation([obs('2025-05-01', 0), obs('2026-05-01', 3)], 'macro_monthly');

    expect(result.change).toBeNull();
    expect(result.unavailableReason).toBe('zero_baseline');
  });
});

describe('calculateVariation · séries incompletas', () => {
  it('informa ausência de observações em série vazia', () => {
    const result = calculateVariation([], 'fx_daily');

    expect(result.latest).toBeNull();
    expect(result.change).toBeNull();
    expect(result.unavailableReason).toBe('no_observations');
  });

  it('informa ausência de base quando há apenas uma observação', () => {
    const result = calculateVariation([obs('2026-08-27', 5.1)], 'fx_daily');

    expect(result.latest?.referenceDate).toBe('2026-08-27');
    expect(result.baseline).toBeNull();
    expect(result.unavailableReason).toBe('no_baseline');
  });

  it('descarta valores não finitos antes de calcular', () => {
    const result = calculateVariation(
      [obs('2026-08-25', 5.0), obs('2026-08-26', Number.NaN), obs('2026-08-27', 5.1)],
      'fx_daily',
    );

    // A observação inválida sai da série: a base passa a ser 25/08.
    expect(result.baseline?.referenceDate).toBe('2026-08-25');
    expect(result.change).toBeCloseTo(2, 10);
  });
});

describe('normalizeSeries', () => {
  it('ordena entrada fora de ordem', () => {
    const sorted = normalizeSeries([
      obs('2026-08-27', 3),
      obs('2026-08-25', 1),
      obs('2026-08-26', 2),
    ]);

    expect(sorted.map((item) => item.referenceDate)).toEqual([
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
    ]);
  });

  it('mantém a última revisão quando a fonte reenvia a mesma data', () => {
    const sorted = normalizeSeries([obs('2026-08-27', 5.0), obs('2026-08-27', 5.05)]);

    expect(sorted).toHaveLength(1);
    expect(sorted[0]?.value).toBe(5.05);
  });

  it('rejeita datas fora do formato ISO', () => {
    expect(normalizeSeries([obs('27/08/2026', 5.0)])).toHaveLength(0);
  });
});

describe('shiftMonths', () => {
  it('retrocede dentro do mesmo ano', () => {
    expect(shiftMonths('2026-08-27', 3)).toBe('2026-05');
  });

  it('atravessa a virada de ano', () => {
    expect(shiftMonths('2026-02-15', 12)).toBe('2025-02');
    expect(shiftMonths('2026-01-31', 1)).toBe('2025-12');
  });

  it('retrocede mais de um ano inteiro', () => {
    expect(shiftMonths('2026-03-01', 26)).toBe('2024-01');
  });
});
