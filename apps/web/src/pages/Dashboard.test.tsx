/**
 * Testes do dashboard.
 *
 * Cobrem o que o usuário percebe em cada estado — carregando, erro, vazio,
 * carregado — e a parte mais delicada da tela: a atualização otimista do
 * favorito. Sem a reversão em caso de falha, a interface passaria a mentir
 * sobre o que foi de fato persistido, que é pior do que recusar o clique.
 */

import type { IndicatorSummary } from '@pulse-fx/contracts';
import { render, screen, waitFor, waitForElementToBeRemoved, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiModule from '../lib/api';
import { ApiError, api } from '../lib/api';
import { Dashboard } from './Dashboard';

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

const card = (over: Partial<IndicatorSummary> = {}): IndicatorSummary => ({
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
  ...over,
});

const selic = card({
  id: 'selic-meta',
  name: 'Selic meta',
  kind: 'policy_rate',
  unit: 'porcento ao ano',
  latestValue: 14,
});

function montar() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
}

/** Espera o esqueleto de carregamento sair da tela. */
const aguardarCarga = () =>
  waitForElementToBeRemoved(() => screen.queryByLabelText(/carregando indicadores/i));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Dashboard · estados de carga', () => {
  it('mostra esqueleto enquanto busca, sem exibir número algum', () => {
    mocked.listIndicators.mockReturnValue(new Promise(() => undefined));
    const { container } = montar();

    expect(screen.getByLabelText(/carregando indicadores/i)).toHaveAttribute('aria-busy', 'true');
    // Nada de valor na tela: um número velho durante a carga seria pior que nada.
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
    expect(screen.queryByText(/5,2005/)).not.toBeInTheDocument();
  });

  it('exibe os indicadores quando a carga termina', async () => {
    mocked.listIndicators.mockResolvedValue([card(), selic]);
    montar();
    await aguardarCarga();

    expect(screen.getByText('5,2005')).toBeInTheDocument();
    expect(screen.getByText('14,00')).toBeInTheDocument();
  });

  it('anuncia a contagem para leitor de tela', async () => {
    mocked.listIndicators.mockResolvedValue([card(), selic]);
    montar();
    await aguardarCarga();

    expect(screen.getByRole('status')).toHaveTextContent('2 indicadores carregados');
  });

  it('explica o catálogo vazio em vez de mostrar tela em branco', async () => {
    mocked.listIndicators.mockResolvedValue([]);
    montar();
    await aguardarCarga();

    expect(screen.getByText(/nenhum indicador disponível/i)).toBeInTheDocument();
    expect(screen.getByText(/sincronização ainda não terminou/i)).toBeInTheDocument();
  });
});

describe('Dashboard · falha de carga', () => {
  it('mostra a mensagem do servidor num alerta, não um erro genérico', async () => {
    mocked.listIndicators.mockRejectedValue(new ApiError('O servidor recusou a requisição.', 500));
    montar();
    await aguardarCarga();

    const alerta = screen.getByRole('alert');
    expect(within(alerta).getByText(/o servidor recusou a requisição/i)).toBeInTheDocument();
  });

  it('usa texto próprio quando o erro não vem da API', async () => {
    mocked.listIndicators.mockRejectedValue(new TypeError('boom'));
    montar();
    await aguardarCarga();

    expect(screen.getByRole('alert')).toHaveTextContent(/falha inesperada/i);
  });

  it('oferece nova tentativa, e ela busca de novo de verdade', async () => {
    const user = userEvent.setup();
    mocked.listIndicators.mockRejectedValueOnce(new ApiError('Sem conexão.', 0));
    montar();
    await aguardarCarga();

    mocked.listIndicators.mockResolvedValue([card()]);
    await user.click(screen.getByRole('button', { name: /tentar de novo/i }));

    await waitFor(() => {
      expect(screen.getByText('5,2005')).toBeInTheDocument();
    });
    expect(mocked.listIndicators).toHaveBeenCalledTimes(2);
  });
});

describe('Dashboard · separação de favoritos', () => {
  it('não mostra a seção "Meus indicadores" quando não há nenhum', async () => {
    mocked.listIndicators.mockResolvedValue([card(), selic]);
    montar();
    await aguardarCarga();

    expect(screen.queryByText(/meus indicadores/i)).not.toBeInTheDocument();
    expect(screen.getByText('Indicadores')).toBeInTheDocument();
  });

  it('separa favoritos dos demais quando existe algum', async () => {
    mocked.listIndicators.mockResolvedValue([card({ isFavorite: true }), selic]);
    montar();
    await aguardarCarga();

    expect(screen.getByText(/meus indicadores/i)).toBeInTheDocument();
    expect(screen.getByText(/demais indicadores/i)).toBeInTheDocument();
  });
});

describe('Dashboard · favorito com atualização otimista', () => {
  it('marca antes da resposta do servidor, para o clique parecer instantâneo', async () => {
    const user = userEvent.setup();
    mocked.listIndicators.mockResolvedValue([card()]);
    // Promessa que nunca resolve: prende o estado durante a gravação.
    mocked.addFavorite.mockReturnValue(new Promise(() => undefined));
    montar();
    await aguardarCarga();

    await user.click(screen.getByRole('button', { name: /adicionar/i }));

    expect(screen.getByRole('button', { pressed: true })).toBeInTheDocument();
  });

  it('desabilita o botão enquanto a gravação está em voo', async () => {
    const user = userEvent.setup();
    mocked.listIndicators.mockResolvedValue([card()]);
    mocked.addFavorite.mockReturnValue(new Promise(() => undefined));
    montar();
    await aguardarCarga();

    await user.click(screen.getByRole('button', { name: /adicionar/i }));

    // Evita clique duplo enviando duas requisições para o mesmo estado.
    expect(screen.getByRole('button', { pressed: true })).toBeDisabled();
  });

  it('reconcilia com a lista que o servidor devolve, não com o palpite local', async () => {
    const user = userEvent.setup();
    mocked.listIndicators.mockResolvedValue([card(), selic]);
    // O servidor devolve o estado real: só a Selic é favorita.
    mocked.addFavorite.mockResolvedValue({ seriesIds: ['selic-meta'] });
    montar();
    await aguardarCarga();

    await user.click(screen.getByRole('button', { name: /adicionar dólar/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /remover selic meta/i })).toBeInTheDocument();
    });
    // O dólar volta a não ser favorito, porque o servidor mandou assim.
    expect(screen.getByRole('button', { name: /adicionar dólar/i })).toBeInTheDocument();
  });

  it('reverte a marcação quando o servidor recusa', async () => {
    const user = userEvent.setup();
    mocked.listIndicators.mockResolvedValue([card()]);
    mocked.addFavorite.mockRejectedValue(new ApiError('Indisponível.', 503));
    montar();
    await aguardarCarga();

    await user.click(screen.getByRole('button', { name: /adicionar/i }));

    // Sem a reversão, a estrela ficaria acesa sem nada persistido no banco.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /adicionar/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument();
  });

  it('reabilita o botão depois da falha, permitindo nova tentativa', async () => {
    const user = userEvent.setup();
    mocked.listIndicators.mockResolvedValue([card()]);
    mocked.addFavorite.mockRejectedValue(new ApiError('Indisponível.', 503));
    montar();
    await aguardarCarga();

    await user.click(screen.getByRole('button', { name: /adicionar/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /adicionar/i })).toBeEnabled();
    });
  });

  it('desmarcar chama a remoção, e não a adição', async () => {
    const user = userEvent.setup();
    mocked.listIndicators.mockResolvedValue([card({ isFavorite: true })]);
    mocked.removeFavorite.mockResolvedValue({ seriesIds: [] });
    montar();
    await aguardarCarga();

    await user.click(screen.getByRole('button', { name: /remover/i }));

    await waitFor(() => {
      expect(mocked.removeFavorite).toHaveBeenCalledWith('usd-brl');
    });
    expect(mocked.addFavorite).not.toHaveBeenCalled();
  });

  it('reverte a desmarcação quando a remoção falha', async () => {
    const user = userEvent.setup();
    mocked.listIndicators.mockResolvedValue([card({ isFavorite: true })]);
    mocked.removeFavorite.mockRejectedValue(new ApiError('Indisponível.', 503));
    montar();
    await aguardarCarga();

    await user.click(screen.getByRole('button', { name: /remover/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { pressed: true })).toBeInTheDocument();
    });
  });
});

describe('Dashboard · ciclo de vida', () => {
  it('aborta a requisição ao desmontar, evitando atualizar componente morto', async () => {
    let sinal: AbortSignal | undefined;
    mocked.listIndicators.mockImplementation((s?: AbortSignal) => {
      sinal = s;
      return new Promise(() => undefined);
    });

    const { unmount } = montar();
    expect(sinal?.aborted).toBe(false);

    unmount();
    expect(sinal?.aborted).toBe(true);
  });

  it('não exibe erro quando a falha vem de um abort', async () => {
    mocked.listIndicators.mockImplementation(
      (s?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          s?.addEventListener('abort', () => {
            reject(new Error('AbortError'));
          });
        }),
    );

    const { unmount } = montar();
    unmount();

    // Sem tela para atualizar, e sem alerta de erro espúrio.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
