/**
 * Testes do card de indicador e da formatação que o alimenta.
 *
 * O foco é o que o usuário efetivamente percebe: o número certo, a data certa,
 * a direção da variação legível sem depender de cor, e o botão de favorito
 * anunciado corretamente para leitor de tela.
 */

import type { IndicatorSummary } from '@pulse-fx/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { formatDate, formatMonth, formatValue, formatVariation } from '../lib/format';
import { IndicatorCard } from './IndicatorCard';

const base: IndicatorSummary = {
  id: 'usd-brl',
  name: 'Dólar americano (venda)',
  source: 'bcb_sgs',
  kind: 'fx_daily',
  unit: 'BRL',
  frequency: 'daily',
  latestValue: 5.2005,
  referenceDate: '2026-08-28',
  variation: {
    change: 0.7029,
    unit: 'percent',
    label: 'vs. pregão anterior',
    baselineDate: '2026-08-27',
    unavailableReason: null,
  },
  stale: false,
  isFavorite: false,
};

function renderCard(overrides: Partial<IndicatorSummary> = {}, onToggle = vi.fn()) {
  const indicator = { ...base, ...overrides };

  render(
    <MemoryRouter>
      <ul>
        <IndicatorCard indicator={indicator} index={0} onToggleFavorite={onToggle} />
      </ul>
    </MemoryRouter>,
  );

  return { indicator, onToggle };
}

describe('IndicatorCard · apresentação do valor', () => {
  it('mostra o valor no padrão brasileiro, com vírgula decimal', () => {
    renderCard();

    // "5.2005" seria lido como erro por um usuário brasileiro.
    expect(screen.getByText('5,2005')).toBeInTheDocument();
  });

  it('mostra a data de referência da observação, não a data de hoje', () => {
    renderCard();

    expect(screen.getByText(/28\/08\/2026/)).toBeInTheDocument();
  });

  it('usa mês por extenso em série mensal, sem fingir precisão de dia', () => {
    renderCard({
      id: 'ipca-mensal',
      name: 'IPCA',
      kind: 'macro_monthly_rate',
      frequency: 'monthly',
      unit: 'porcento no mês',
      latestValue: 0.07,
      referenceDate: '2026-07-01',
    });

    expect(screen.getByText(/julho de 2026/)).toBeInTheDocument();
  });

  it('exibe traço quando não há valor, em vez de zero', () => {
    renderCard({ latestValue: null, referenceDate: null });

    // Série sem dado mostra traço no valor e na data. Exibir "0,0000" seria
    // pior que não exibir nada: zero é um preço, ausência não é.
    const traços = screen.getAllByText('—');
    expect(traços).toHaveLength(2);
    expect(screen.queryByText(/^0,0+$/)).not.toBeInTheDocument();
  });
});

describe('IndicatorCard · variação sem depender de cor', () => {
  it('mostra alta com sinal de mais', () => {
    renderCard();

    expect(screen.getByText('+0,70%')).toBeInTheDocument();
  });

  it('mostra queda com sinal de menos', () => {
    renderCard({
      variation: { ...base.variation, change: -1.25 },
    });

    // Sinal de subtração tipográfico, não hífen: alinha melhor em fonte tabular.
    expect(screen.getByText('−1,25%')).toBeInTheDocument();
  });

  it('descreve a variação por extenso para leitor de tela', () => {
    renderCard();

    // Um leitor de tela anunciando só "+0,70%" perderia direção e referência.
    expect(screen.getByText('alta de 0,70% vs. pregão anterior')).toBeInTheDocument();
  });

  it('usa pontos percentuais em série de taxa, não porcentagem', () => {
    renderCard({
      id: 'selic-meta',
      kind: 'policy_rate',
      variation: {
        change: -0.25,
        unit: 'percentage_points',
        label: 'vs. patamar anterior',
        baselineDate: '2026-08-24',
        unavailableReason: null,
      },
    });

    expect(screen.getByText('−0,25 p.p.')).toBeInTheDocument();
  });

  it('explica a ausência de variação em vez de mostrar zero', () => {
    renderCard({
      variation: {
        change: null,
        unit: 'percent',
        label: 'vs. pregão anterior',
        baselineDate: null,
        unavailableReason: 'no_baseline',
      },
    });

    expect(screen.getByText(/histórico suficiente/i)).toBeInTheDocument();
  });
});

describe('IndicatorCard · dado defasado', () => {
  it('sinaliza defasagem visualmente e em texto', () => {
    renderCard({ stale: true });

    expect(screen.getByText(/defasado/i)).toBeInTheDocument();
  });

  it('não sinaliza nada quando o dado está em dia', () => {
    renderCard({ stale: false });

    expect(screen.queryByText(/defasado/i)).not.toBeInTheDocument();
  });
});

describe('IndicatorCard · favorito', () => {
  it('anuncia o estado com aria-pressed, e não apenas por cor do ícone', () => {
    renderCard({ isFavorite: true });

    expect(screen.getByRole('button', { pressed: true })).toBeInTheDocument();
  });

  it('descreve a ação que o clique vai executar', () => {
    renderCard({ isFavorite: false });

    expect(
      screen.getByRole('button', { name: /adicionar dólar americano \(venda\) aos meus indicadores/i }),
    ).toBeInTheDocument();
  });

  it('descreve a ação inversa quando já é favorito', () => {
    renderCard({ isFavorite: true });

    expect(
      screen.getByRole('button', { name: /remover dólar americano \(venda\) dos meus indicadores/i }),
    ).toBeInTheDocument();
  });

  it('avisa o pai com o próximo estado desejado', async () => {
    const user = userEvent.setup();
    const { onToggle } = renderCard({ isFavorite: false });

    await user.click(screen.getByRole('button'));

    expect(onToggle).toHaveBeenCalledWith('usd-brl', true);
  });

  it('é alcançável e acionável só pelo teclado', async () => {
    const user = userEvent.setup();
    const { onToggle } = renderCard({ isFavorite: false });

    await user.tab();
    await user.tab();
    await user.keyboard('{Enter}');

    expect(onToggle).toHaveBeenCalledWith('usd-brl', true);
  });

  it('fica desabilitado enquanto a gravação está em voo', () => {
    render(
      <MemoryRouter>
        <ul>
          <IndicatorCard indicator={base} index={0} onToggleFavorite={vi.fn()} pending />
        </ul>
      </MemoryRouter>,
    );

    expect(screen.getByRole('button')).toBeDisabled();
  });
});

describe('IndicatorCard · navegação', () => {
  it('o título é um link de verdade para o detalhe', () => {
    renderCard();

    const link = screen.getByRole('link', { name: /dólar americano/i });
    expect(link).toHaveAttribute('href', '/indicador/usd-brl');
  });

  it('identifica a fonte do dado', () => {
    renderCard({ source: 'fred', name: 'Treasury 10 anos' });

    const item = screen.getByRole('listitem');
    expect(within(item).getByText(/FRED/)).toBeInTheDocument();
  });
});

describe('formatação', () => {
  it('usa casas decimais compatíveis com a natureza da série', () => {
    // Câmbio precisa de 4 casas; taxa de juros com 4 casas seria falsa precisão.
    expect(formatValue(5.2005, 'fx_daily')).toBe('5,2005');
    expect(formatValue(14, 'policy_rate')).toBe('14,00');
    expect(formatValue(332.813, 'macro_monthly_index')).toBe('332,813');
  });

  it('converte data ISO sem passar por Date, evitando deslocamento de fuso', () => {
    expect(formatDate('2026-08-28')).toBe('28/08/2026');
    expect(formatMonth('2026-07-01')).toBe('julho de 2026');
  });

  it('sempre inclui o sinal, que é o que comunica a direção sem cor', () => {
    const percent = { unit: 'percent' as const, label: '', baselineDate: null, unavailableReason: null };

    expect(formatVariation({ ...percent, change: 1.5 })).toMatch(/^\+/);
    expect(formatVariation({ ...percent, change: -1.5 })).toMatch(/^−/);
  });
});
