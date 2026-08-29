import type { IndicatorSummary } from '@pulse-fx/contracts';
import { useCallback, useEffect, useState } from 'react';

import { IndicatorCard } from '../components/IndicatorCard';
import { ApiError, api } from '../lib/api';

type LoadState = 'loading' | 'ready' | 'error';

export function Dashboard(): React.JSX.Element {
  const [indicators, setIndicators] = useState<IndicatorSummary[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    setState('loading');

    api
      .listIndicators(signal)
      .then((data) => {
        setIndicators(data);
        setState('ready');
      })
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        setErrorMessage(error instanceof ApiError ? error.message : 'Falha inesperada.');
        setState('error');
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => {
      controller.abort();
    };
  }, [load]);

  /**
   * Alterna o favorito de forma otimista, revertendo se o servidor recusar.
   *
   * O estado real continua sendo o do servidor: a atualização otimista é
   * apenas para que o clique pareça instantâneo. Sem a reversão, um erro de
   * rede deixaria a interface mentindo sobre o que foi persistido.
   */
  const toggleFavorite = useCallback((seriesId: string, next: boolean) => {
    setPendingId(seriesId);
    setIndicators((current) =>
      current.map((item) => (item.id === seriesId ? { ...item, isFavorite: next } : item)),
    );

    const action = next ? api.addFavorite(seriesId) : api.removeFavorite(seriesId);

    action
      .then(({ seriesIds }) => {
        const favorites = new Set(seriesIds);
        setIndicators((current) =>
          current.map((item) => ({ ...item, isFavorite: favorites.has(item.id) })),
        );
      })
      .catch(() => {
        setIndicators((current) =>
          current.map((item) => (item.id === seriesId ? { ...item, isFavorite: !next } : item)),
        );
      })
      .finally(() => {
        setPendingId(null);
      });
  }, []);

  if (state === 'loading') {
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

  if (state === 'error') {
    return (
      <div className="state" role="alert">
        <h2>Não foi possível carregar os indicadores</h2>
        <p>{errorMessage}</p>
        <p style={{ marginTop: 18 }}>
          <button type="button" className="button" onClick={() => load()}>
            Tentar de novo
          </button>
        </p>
      </div>
    );
  }

  if (indicators.length === 0) {
    return (
      <div className="state">
        <h2>Nenhum indicador disponível</h2>
        <p>
          O catálogo está vazio ou a primeira sincronização ainda não terminou. Atualize a
          página em alguns instantes.
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
