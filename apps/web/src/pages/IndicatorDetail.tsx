import { type HistoryWindow, type IndicatorDetail as Detail } from '@pulse-fx/contracts';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { SeriesChart } from '../components/SeriesChart';
import { VariationBadge } from '../components/VariationBadge';
import { ApiError, api } from '../lib/api';
import { formatDate, formatMonth, formatValue } from '../lib/format';

const WINDOWS: ReadonlyArray<{ value: HistoryWindow; label: string }> = [
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
  { value: '1y', label: '1 ano' },
  { value: '5y', label: '5 anos' },
];

/**
 * Resultado carimbado com a chave da requisição que o produziu.
 *
 * Como no dashboard, o carimbo permite derivar o estado de carregamento em vez
 * de mantê-lo em variável separada. Aqui a chave combina indicador e janela:
 * trocar qualquer um dos dois já marca o resultado atual como obsoleto, e a
 * interface volta ao esqueleto sem `setState` síncrono dentro do efeito.
 */
interface LoadResult {
  readonly key: string;
  readonly detail?: Detail;
  readonly errorMessage?: string;
}

export function IndicatorDetail(): React.JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const [window, setWindow] = useState<HistoryWindow>('90d');
  const [result, setResult] = useState<LoadResult | null>(null);

  const key = `${id}|${window}`;

  useEffect(() => {
    const controller = new AbortController();

    api
      .getIndicator(id, window, controller.signal)
      .then((detail) => {
        setResult({ key, detail });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          key,
          errorMessage: error instanceof ApiError ? error.message : 'Falha inesperada.',
        });
      });

    return () => {
      controller.abort();
    };
  }, [id, window, key]);

  const loading = result?.key !== key;

  if (loading) {
    return (
      <div aria-busy="true" aria-label="Carregando indicador">
        <div className="skeleton" style={{ height: 34, width: '45%', marginBottom: 14 }} />
        <div className="skeleton" style={{ height: 56, width: '30%', marginBottom: 22 }} />
        <div className="skeleton" style={{ height: 240 }} />
      </div>
    );
  }

  if (result.errorMessage !== undefined || !result.detail) {
    return (
      <div className="state" role="alert">
        <h2>Não foi possível carregar este indicador</h2>
        <p>{result.errorMessage ?? 'Indicador não encontrado.'}</p>
        <p style={{ marginTop: 18 }}>
          <Link className="button" to="/">
            Voltar ao painel
          </Link>
        </p>
      </div>
    );
  }

  const detail = result.detail;

  const referenceLabel =
    detail.frequency === 'monthly'
      ? formatMonth(detail.referenceDate)
      : formatDate(detail.referenceDate);

  return (
    <article>
      <Link className="back" to="/">
        <span aria-hidden="true">←</span> Voltar ao painel
      </Link>

      <div className="detail-head">
        <div>
          <h1>{detail.name}</h1>
          <p className="card-source" style={{ marginTop: 4 }}>
            {detail.source === 'bcb_sgs' ? 'Banco Central do Brasil' : 'FRED · St. Louis Fed'}
          </p>
        </div>
      </div>

      <div className="detail-value">
        {formatValue(detail.latestValue, detail.kind)}
        <span className="card-unit">{detail.unit}</span>
      </div>

      <p className="card-date" style={{ marginBottom: 14 }}>
        Data de referência: {referenceLabel}
        {detail.stale && (
          <>
            {' '}
            <span className="badge-stale">
              <span aria-hidden="true">⚠</span> aguardando nova publicação
            </span>
          </>
        )}
      </p>

      <div className="detail-variations">
        <span>
          <VariationBadge variation={detail.variation} />{' '}
          <span className="variation-label">{detail.variation.label}</span>
        </span>
        <span>
          <VariationBadge variation={detail.mediumTermVariation} />{' '}
          <span className="variation-label">{detail.mediumTermVariation.label}</span>
        </span>
      </div>

      <section className="panel" aria-labelledby="serie-titulo">
        <h2 id="serie-titulo">Série histórica</h2>

        <div
          className="windows"
          role="group"
          aria-label="Janela de histórico"
          style={{ marginBottom: 18 }}
        >
          {WINDOWS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="window-btn"
              aria-pressed={window === option.value}
              onClick={() => {
                setWindow(option.value);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>

        <SeriesChart observations={detail.history} kind={detail.kind} unit={detail.unit} />
      </section>

      <section className="panel" aria-labelledby="porque-titulo">
        <h2 id="porque-titulo">Por que este indicador</h2>
        <p>{detail.rationale}</p>
      </section>

      <section className="panel" aria-labelledby="limites-titulo">
        <h2 id="limites-titulo">Limitações dos dados</h2>
        <p>{detail.limitations}</p>
        <p>
          Como a variação é calculada: {detail.variation.label}
          {detail.variation.baselineDate
            ? `, tomando como base a observação de ${formatDate(detail.variation.baselineDate)}.`
            : '.'}{' '}
          Lacunas de calendário — fim de semana, feriado ou atraso de publicação — são resolvidas
          pelo último dado conhecido, sem interpolação.
        </p>
        <p>
          <a href={detail.docUrl} target="_blank" rel="noreferrer noopener">
            Documentação oficial da fonte
          </a>
        </p>
      </section>
    </article>
  );
}
