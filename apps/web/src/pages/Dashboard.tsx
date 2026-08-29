import type { IndicatorSummary } from '@pulse-fx/contracts';
import { useCallback, useEffect, useState } from 'react';

import { IndicatorCard } from '../components/IndicatorCard';
import { ApiError, api } from '../lib/api';

/**
 * Resultado de uma tentativa de carga, carimbado com o número da tentativa.
 *
 * O carimbo é o que permite **derivar** o estado de carregamento em vez de
 * mantê-lo numa variável própria: se o resultado guardado não corresponde à
 * tentativa atual, ainda estamos carregando. Sem isso, seria preciso chamar
 * `setState('loading')` dentro do efeito, o que dispara renderização em cascata
 * e mantém duas fontes de verdade que podem divergir.
 */
interface LoadResult {
  readonly attempt: number;
  readonly indicators?: IndicatorSummary[];
  readonly errorMessage?: string;
}

export function Dashboard(): React.JSX.Element {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<LoadResult | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    api
      .listIndicators(controller.signal)
      .then((indicators) => {
        setResult({ attempt, indicators });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          attempt,
          errorMessage: error instanceof ApiError ? error.message : 'Falha inesperada.',
        });
      });

    return () => {
      controller.abort();
    };
  }, [attempt]);

  /**
   * Alterna o favorito de forma otimista, revertendo se o servidor recusar.
   *
   * O estado real continua sendo o do servidor: a atualização otimista existe
   * só para que o clique pareça instantâneo. Sem a reversão, um erro de rede
   * deixaria a interface mentindo sobre o que foi persistido.
   */
  const toggleFavorite = useCallback((seriesId: string, next: boolean) => {
    const applyFavorite = (id: string, value: boolean) => {
      setResult((current) =>
        current?.indicators
          ? {
              ...current,
              indicators: current.indicators.map((item) =>
                item.id === id ? { ...item, isFavorite: value } : item,
              ),
            }
          : current,
      );
    };

    setPendingId(seriesId);
    applyFavorite(seriesId, next);

    const action = next ? api.addFavorite(seriesId) : api.removeFavorite(seriesId);

    action
      .then(({ seriesIds }) => {
        const favorites = new Set(seriesIds);
        setResult((current) =>
          current?.indicators
            ? {
                ...current,
                indicators: current.indicators.map((item) => ({
                  ...item,
                  isFavorite: favorites.has(item.id),
                })),
              }
            : current,
        );
      })
      .catch(() => {
        applyFavorite(seriesId, !next);
      })
      .finally(() => {
        setPendingId(null);
      });
  }, []);

  // Estado derivado: o resultado guardado ainda não é o desta tentativa.
  const loading = result?.attempt !== attempt;

  if (loading) {
    return (
      <ul className="grid" aria-busy="true" aria-label="Carregando indicadores">
        {Array.from({ length: 7 }, (_, index) => (
          <li className="card" key={index} style={{ '--stagger': index } as React.CSSProperties}>
            <div className="skeleton" style={{ height: 18, width: '70%' }} />
            <div className="skeleton" style={{ height: 34, width: '55%' }} />
            <div className="skeleton" style={{ height: 14, width: '40%' }} />
          </li>
        ))}
      </ul>
    );
  }

  if (result.errorMessage !== undefined) {
    return (
      <div className="state" role="alert">
        <h2>Não foi possível carregar os indicadores</h2>
        <p>{result.errorMessage}</p>
        <p style={{ marginTop: 18 }}>
          <button
            type="button"
            className="button"
            onClick={() => {
              setAttempt((value) => value + 1);
            }}
          >
            Tentar de novo
          </button>
        </p>
      </div>
    );
  }

  const indicators = result.indicators ?? [];

  if (indicators.length === 0) {
    return (
      <div className="state">
        <h2>Nenhum indicador disponível</h2>
        <p>
          O catálogo está vazio ou a primeira sincronização ainda não terminou. Atualize a página em
          alguns instantes.
        </p>
      </div>
    );
  }

  const favorites = indicators.filter((item) => item.isFavorite);
  const others = indicators.filter((item) => !item.isFavorite);

  return (
    <>
      {/* Anúncio para leitor de tela quando a lista termina de carregar. */}
      <p className="sr-only" role="status">
        {indicators.length} indicadores carregados.
      </p>

      {favorites.length > 0 && (
        <>
          <h2 className="section-title">Meus indicadores</h2>
          <ul className="grid">
            {favorites.map((indicator, index) => (
              <IndicatorCard
                key={indicator.id}
                indicator={indicator}
                index={index}
                pending={pendingId === indicator.id}
                onToggleFavorite={toggleFavorite}
              />
            ))}
          </ul>
        </>
      )}

      <h2 className="section-title">
        {favorites.length > 0 ? 'Demais indicadores' : 'Indicadores'}
      </h2>
      <ul className="grid">
        {others.map((indicator, index) => (
          <IndicatorCard
            key={indicator.id}
            indicator={indicator}
            index={index}
            pending={pendingId === indicator.id}
            onToggleFavorite={toggleFavorite}
          />
        ))}
      </ul>
    </>
  );
}
