/**
 * Testes do gráfico de série.
 *
 * O foco é a geometria e a alternativa acessível — não o pixel. Um SVG
 * desenhado a mão tem casos-limite silenciosos: série achatada divide por zero,
 * série de um ponto não tem linha, valor mínimo cai fora da área útil. Nenhum
 * deles quebra a página de forma visível; todos produzem um gráfico errado.
 */

import type { Observation } from '@pulse-fx/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { SeriesChart } from './SeriesChart';

const obs = (referenceDate: string, value: number): Observation => ({ referenceDate, value });

/** Série de câmbio com valores reais da PTAX. */
const ptax = [
  obs('2026-08-24', 5.1402),
  obs('2026-08-25', 5.1587),
  obs('2026-08-26', 5.1604),
  obs('2026-08-27', 5.1642),
  obs('2026-08-28', 5.2005),
];

/** Lê os pontos da polyline como pares numéricos. */
function pontosDaLinha(container: HTMLElement): Array<{ x: number; y: number }> {
  const linha = container.querySelector('polyline');
  const bruto = linha?.getAttribute('points') ?? '';

  return bruto
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((par) => {
      const [x, y] = par.split(',').map(Number);
      return { x: x ?? 0, y: y ?? 0 };
    });
}

describe('SeriesChart · casos-limite', () => {
  it('não tenta desenhar com menos de dois pontos', () => {
    render(<SeriesChart observations={[obs('2026-08-28', 5.2)]} kind="fx_daily" unit="BRL" />);

    // Uma linha precisa de dois pontos. Melhor dizer isso do que desenhar um
    // gráfico vazio que o usuário leria como ausência de variação.
    expect(screen.getByRole('status')).toHaveTextContent(/pontos suficientes/i);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('não tenta desenhar com série vazia', () => {
    render(<SeriesChart observations={[]} kind="fx_daily" unit="BRL" />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('série totalmente achatada não divide por zero nem some do gráfico', () => {
    // Cenário real: a Selic repete o mesmo valor entre reuniões do Copom.
    // Sem a margem mínima, (value - min) / 0 daria NaN e a linha sumiria.
    const { container } = render(
      <SeriesChart
        observations={[obs('2026-08-26', 14), obs('2026-08-27', 14), obs('2026-08-28', 14)]}
        kind="policy_rate"
        unit="porcento ao ano"
      />,
    );

    const pontos = pontosDaLinha(container);

    expect(pontos).toHaveLength(3);
    expect(pontos.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    // Todos na mesma altura, e essa altura não pode ser a borda superior.
    expect(new Set(pontos.map((p) => p.y)).size).toBe(1);
    expect(pontos[0]?.y).toBeGreaterThan(16);
  });

  it('série achatada em zero também é finita', () => {
    // Inflação de 0,00% em meses seguidos é leitura legítima.
    const { container } = render(
      <SeriesChart
        observations={[obs('2026-07-01', 0), obs('2026-08-01', 0)]}
        kind="macro_monthly_rate"
        unit="porcento no mês"
      />,
    );

    expect(pontosDaLinha(container).every((p) => Number.isFinite(p.y))).toBe(true);
  });
});

describe('SeriesChart · geometria', () => {
  it('desenha um ponto por observação, na ordem recebida', () => {
    const { container } = render(<SeriesChart observations={ptax} kind="fx_daily" unit="BRL" />);

    const pontos = pontosDaLinha(container);

    expect(pontos).toHaveLength(5);
    // X sempre crescente: o tempo anda para a direita.
    for (let i = 1; i < pontos.length; i += 1) {
      expect(pontos[i]!.x).toBeGreaterThan(pontos[i - 1]!.x);
    }
  });

  it('inverte o eixo vertical: valor maior fica mais alto na tela', () => {
    const { container } = render(<SeriesChart observations={ptax} kind="fx_daily" unit="BRL" />);

    const pontos = pontosDaLinha(container);
    const menor = pontos[0]!; // 5,1402 — o mínimo da série
    const maior = pontos[4]!; // 5,2005 — o máximo

    // Em SVG o Y cresce para baixo, então o maior valor tem o menor Y.
    expect(maior.y).toBeLessThan(menor.y);
  });

  it('mantém todos os pontos dentro da área de desenho', () => {
    const { container } = render(<SeriesChart observations={ptax} kind="fx_daily" unit="BRL" />);

    // viewBox 720x240, com 16 de padding no topo e 26 embaixo.
    for (const ponto of pontosDaLinha(container)) {
      expect(ponto.y).toBeGreaterThanOrEqual(16);
      expect(ponto.y).toBeLessThanOrEqual(240 - 26);
      expect(ponto.x).toBeGreaterThanOrEqual(0);
      expect(ponto.x).toBeLessThanOrEqual(720);
    }
  });

  it('destaca o último ponto, que é o número que o usuário veio ver', () => {
    const { container } = render(<SeriesChart observations={ptax} kind="fx_daily" unit="BRL" />);

    const marcador = container.querySelector('circle.chart-end');
    const pontos = pontosDaLinha(container);

    expect(marcador).toBeInTheDocument();
    expect(Number(marcador?.getAttribute('cx'))).toBeCloseTo(pontos[4]!.x, 5);
    expect(Number(marcador?.getAttribute('cy'))).toBeCloseTo(pontos[4]!.y, 5);
  });

  it('fecha a área preenchida na base, sem deixar o polígono aberto', () => {
    const { container } = render(<SeriesChart observations={ptax} kind="fx_daily" unit="BRL" />);

    const area = container.querySelector('polygon')?.getAttribute('points') ?? '';
    const pares = area.trim().split(/\s+/);

    // Primeiro e último ponto na linha de base: 240 - 26 = 214.
    expect(pares[0]).toContain(',214');
    expect(pares[pares.length - 1]).toContain(',214');
    expect(pares).toHaveLength(pontosDaLinha(container).length + 2);
  });

  it('rotula as linhas de referência com mínimo e máximo formatados', () => {
    render(<SeriesChart observations={ptax} kind="fx_daily" unit="BRL" />);

    // Escopado ao SVG: os mesmos valores também aparecem na tabela de dados,
    // que fica no DOM mesmo com o `details` recolhido.
    const marcas = [...screen.getByRole('img').querySelectorAll('text.chart-tick')].map(
      (no) => no.textContent,
    );

    // Padrão brasileiro, com as 4 casas que câmbio exige.
    expect(marcas).toContain('5,2005');
    expect(marcas).toContain('5,1402');
  });
});

describe('SeriesChart · acessibilidade', () => {
  it('o SVG é uma imagem com descrição completa, não um elemento mudo', () => {
    render(<SeriesChart observations={ptax} kind="fx_daily" unit="BRL" />);

    const grafico = screen.getByRole('img');
    const descricao = grafico.getAttribute('aria-label') ?? '';

    // Quem não enxerga o gráfico recebe os números que ele representa.
    expect(descricao).toContain('5 observações');
    expect(descricao).toContain('24/08/2026');
    expect(descricao).toContain('28/08/2026');
    expect(descricao).toContain('5,1402');
    expect(descricao).toContain('5,2005');
    expect(descricao).toContain('BRL');
  });

  it('oferece a tabela de dados completa como alternativa ao desenho', async () => {
    const user = userEvent.setup();
    render(<SeriesChart observations={ptax} kind="fx_daily" unit="BRL" />);

    await user.click(screen.getByText(/ver os dados em tabela/i));

    const tabela = screen.getByRole('table');
    // Cabeçalho + 5 observações.
    expect(within(tabela).getAllByRole('row')).toHaveLength(6);
    expect(within(tabela).getByText('28/08/2026')).toBeInTheDocument();
  });

  it('a tabela vai da observação mais recente para a mais antiga', async () => {
    const user = userEvent.setup();
    render(<SeriesChart observations={ptax} kind="fx_daily" unit="BRL" />);

    await user.click(screen.getByText(/ver os dados em tabela/i));

    const linhas = within(screen.getByRole('table')).getAllByRole('row');
    expect(linhas[1]).toHaveTextContent('28/08/2026');
    expect(linhas[5]).toHaveTextContent('24/08/2026');
  });

  it('anuncia quantas observações a tabela contém', () => {
    render(<SeriesChart observations={ptax} kind="fx_daily" unit="BRL" />);

    expect(screen.getByText(/5 observações/)).toBeInTheDocument();
  });

  it('usa as casas decimais do tipo da série também na tabela', async () => {
    const user = userEvent.setup();
    render(
      <SeriesChart
        observations={[obs('2026-08-27', 14), obs('2026-08-28', 14.25)]}
        kind="policy_rate"
        unit="porcento ao ano"
      />,
    );

    await user.click(screen.getByText(/ver os dados em tabela/i));

    // Taxa de juros com 2 casas; 4 seria falsa precisão.
    expect(within(screen.getByRole('table')).getByText('14,25')).toBeInTheDocument();
  });
});
