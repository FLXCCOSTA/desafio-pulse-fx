/**
 * Testes da tela de detalhe.
 *
 * O ponto mais sensível aqui é a troca de janela: o resultado guardado é
 * carimbado com a chave da requisição que o produziu, e o estado de carregamento
 * é **derivado** dessa comparação. Sem isso, seria preciso chamar `setState`
 * dentro do efeito — o que dispara renderização em cascata e mantém duas fontes
 * de verdade que podem divergir.
 */

import type { IndicatorDetail as Detail } from '@pulse-fx/contracts';
import { render, screen, waitFor, waitForElementToBeRemoved, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiModule from '../lib/api';
import { ApiError, api } from '../lib/api';
import { IndicatorDetail } from './IndicatorDetail';

vi.mock('../lib/api', async () => {
  const real = await vi.importActual<typeof ApiModule>('../lib/api');
  return {
    ApiError: real.ApiError,
    api: {
      listIndicators: vi.fn(),
      addFavorite: vi.fn(),
      removeFavorite: vi.fn(),
      getIndicator: vi.fn(),
    },
  };
});

const mocked = vi.mocked(api);

const detalhe = (over: Partial<Detail> = {}): Detail => ({
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
  mediumTermVariation: {
    change: 2.5,
    unit: 'percent',
    label: 'vs. 21 pregões atrás',
    baselineDate: '2026-07-29',
    unavailableReason: null,
  },
  stale: false,
  isFavorite: false,
  rationale: 'Taxa de referência oficial do Banco Central para o dólar.',
  limitations: 'Publicada apenas em dias úteis e sujeita a revisão do BCB.',
  docUrl: 'https://dadosabertos.bcb.gov.br/',
  history: [
    { referenceDate: '2026-08-26', value: 5.1604 },
    { referenceDate: '2026-08-27', value: 5.1642 },
    { referenceDate: '2026-08-28', value: 5.2005 },
  ],
  ...over,
});

function montar(id = 'usd-brl') {
  return render(
    <MemoryRouter initialEntries={[`/indicador/${id}`]}>
      <Routes>
        <Route path="/indicador/:id" element={<IndicatorDetail />} />
        <Route path="/" element={<p>painel</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const aguardarCarga = () =>
  waitForElementToBeRemoved(() => screen.queryByLabelText(/carregando indicador/i));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('IndicatorDetail · carga', () => {
  it('mostra esqueleto enquanto busca', () => {
    mocked.getIndicator.mockReturnValue(new Promise(() => undefined));
    montar();

    expect(screen.getByLabelText(/carregando indicador/i)).toHaveAttribute('aria-busy', 'true');
  });

  it('busca pelo id da rota, com a janela padrão de 90 dias', async () => {
    mocked.getIndicator.mockResolvedValue(detalhe());
    montar('selic-meta');
    await aguardarCarga();

    expect(mocked.getIndicator).toHaveBeenCalledWith('selic-meta', '90d', expect.anything());
  });

  it('exibe valor, unidade e data de referência', async () => {
    mocked.getIndicator.mockResolvedValue(detalhe());
    montar();
    await aguardarCarga();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Dólar americano (venda)');
    expect(screen.getByText(/data de referência: 28\/08\/2026/i)).toBeInTheDocument();

    // O mesmo número aparece na tabela do gráfico, então a asserção precisa
    // apontar para o destaque — que é onde o usuário olha primeiro.
    const destaque = document.querySelector('.detail-value');
    expect(destaque).toHaveTextContent('5,2005');
    expect(destaque).toHaveTextContent('BRL');
  });

  it('usa mês por extenso em série mensal', async () => {
    mocked.getIndicator.mockResolvedValue(
      detalhe({ frequency: 'monthly', referenceDate: '2026-07-01', kind: 'macro_monthly_rate' }),
    );
    montar();
    await aguardarCarga();

    // "01/07/2026" sugeriria precisão de dia que o dado mensal não tem.
    expect(screen.getByText(/julho de 2026/)).toBeInTheDocument();
  });

  it('mostra as duas variações, de curto e médio prazo', async () => {
    mocked.getIndicator.mockResolvedValue(detalhe());
    montar();
    await aguardarCarga();

    expect(screen.getByText('+0,70%')).toBeInTheDocument();
    expect(screen.getByText('+2,50%')).toBeInTheDocument();
    expect(screen.getByText('vs. 21 pregões atrás')).toBeInTheDocument();
  });

  it('sinaliza dado aguardando nova publicação', async () => {
    mocked.getIndicator.mockResolvedValue(detalhe({ stale: true }));
    montar();
    await aguardarCarga();

    expect(screen.getByText(/aguardando nova publicação/i)).toBeInTheDocument();
  });
});

describe('IndicatorDetail · conteúdo explicativo', () => {
  it('exibe a justificativa e as limitações vindas do catálogo', async () => {
    mocked.getIndicator.mockResolvedValue(detalhe());
    montar();
    await aguardarCarga();

    expect(screen.getByText(/taxa de referência oficial do banco central/i)).toBeInTheDocument();
    expect(screen.getByText(/sujeita a revisão do bcb/i)).toBeInTheDocument();
  });

  it('explica como a variação foi calculada, citando a data base', async () => {
    mocked.getIndicator.mockResolvedValue(detalhe());
    montar();
    await aguardarCarga();

    expect(screen.getByText(/tomando como base a observação de 27\/08\/2026/i)).toBeInTheDocument();
    expect(screen.getByText(/sem interpolação/i)).toBeInTheDocument();
  });

  it('omite a data base quando não há comparação possível', async () => {
    mocked.getIndicator.mockResolvedValue(
      detalhe({
        variation: {
          change: null,
          unit: 'percent',
          label: 'vs. pregão anterior',
          baselineDate: null,
          unavailableReason: 'no_baseline',
        },
      }),
    );
    montar();
    await aguardarCarga();

    expect(screen.queryByText(/tomando como base/i)).not.toBeInTheDocument();
    expect(screen.getByText(/histórico suficiente/i)).toBeInTheDocument();
  });

  it('link para a fonte abre em nova aba com rel seguro', async () => {
    mocked.getIndicator.mockResolvedValue(detalhe());
    montar();
    await aguardarCarga();

    const link = screen.getByRole('link', { name: /documentação oficial/i });
    expect(link).toHaveAttribute('href', 'https://dadosabertos.bcb.gov.br/');
    // noopener impede a página aberta de manipular a nossa via window.opener.
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});

describe('IndicatorDetail · janela de histórico', () => {
  it('marca 90 dias como janela ativa por padrão', async () => {
    mocked.getIndicator.mockResolvedValue(detalhe());
    montar();
    await aguardarCarga();

    expect(screen.getByRole('button', { name: '90 dias', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 ano', pressed: false })).toBeInTheDocument();
  });

  it('trocar a janela busca de novo com o novo valor', async () => {
    const user = userEvent.setup();
    mocked.getIndicator.mockResolvedValue(detalhe());
    montar();
    await aguardarCarga();

    await user.click(screen.getByRole('button', { name: '1 ano' }));

    await waitFor(() => {
      expect(mocked.getIndicator).toHaveBeenLastCalledWith('usd-brl', '1y', expect.anything());
    });
  });

  it('volta ao esqueleto durante a troca, sem exibir a série antiga', async () => {
    const user = userEvent.setup();
    mocked.getIndicator.mockResolvedValue(detalhe());
    montar();
    await aguardarCarga();

    mocked.getIndicator.mockReturnValue(new Promise(() => undefined));
    await user.click(screen.getByRole('button', { name: '5 anos' }));

    // O carimbo da resposta guardada não bate com a chave atual, então o estado
    // de carregamento é derivado — sem setState dentro do efeito.
    expect(await screen.findByLabelText(/carregando indicador/i)).toBeInTheDocument();
  });

  it('oferece as quatro janelas do contrato', async () => {
    mocked.getIndicator.mockResolvedValue(detalhe());
    montar();
    await aguardarCarga();

    const grupo = screen.getByRole('group', { name: /janela de histórico/i });
    expect(within(grupo).getAllByRole('button')).toHaveLength(4);
  });
});

describe('IndicatorDetail · falhas', () => {
  it('mostra a mensagem do servidor quando o indicador não existe', async () => {
    mocked.getIndicator.mockRejectedValue(new ApiError('Indicador não encontrado.', 404));
    montar('nao-existe');
    await aguardarCarga();

    expect(screen.getByRole('alert')).toHaveTextContent(/indicador não encontrado/i);
  });

  it('oferece caminho de volta ao painel no erro', async () => {
    mocked.getIndicator.mockRejectedValue(new ApiError('Indisponível.', 503));
    montar();
    await aguardarCarga();

    expect(screen.getByRole('link', { name: /voltar ao painel/i })).toBeInTheDocument();
  });

  it('usa texto próprio quando o erro não vem da API', async () => {
    mocked.getIndicator.mockRejectedValue(new TypeError('boom'));
    montar();
    await aguardarCarga();

    expect(screen.getByRole('alert')).toHaveTextContent(/falha inesperada/i);
  });

  it('aborta a requisição ao desmontar', async () => {
    let sinal: AbortSignal | undefined;
    mocked.getIndicator.mockImplementation((_id, _w, s?: AbortSignal) => {
      sinal = s;
      return new Promise(() => undefined);
    });

    const { unmount } = montar();
    expect(sinal?.aborted).toBe(false);

    unmount();
    expect(sinal?.aborted).toBe(true);
  });
});
