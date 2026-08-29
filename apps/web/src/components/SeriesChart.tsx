import type { Observation, SeriesKind } from '@pulse-fx/contracts';

import { formatDate, formatValue } from '../lib/format';

/**
 * Gráfico de série temporal em SVG puro.
 *
 * Sem biblioteca de gráficos: para uma linha única, uma dependência de algumas
 * centenas de kilobytes traria mais superfície de manutenção e de segurança do
 * que valor. O desenho é geometria simples, e o controle total sobre o SVG é o
 * que permite herdar as cores do tema e marcar o ponto final.
 *
 * Acessibilidade: o SVG é `img` com rótulo descritivo, e a tabela de dados
 * completa fica logo abaixo, dentro de um `details`. Quem usa leitor de tela
 * não recebe "gráfico" e ponto final — recebe os números.
 */

interface Props {
  readonly observations: readonly Observation[];
  readonly kind: SeriesKind;
  readonly unit: string;
}

const WIDTH = 720;
const HEIGHT = 240;
const PADDING = { top: 16, right: 52, bottom: 26, left: 8 };

export function SeriesChart({ observations, kind, unit }: Props): React.JSX.Element {
  if (observations.length < 2) {
    return (
      <p className="state" role="status">
        Ainda não há pontos suficientes nesta janela para desenhar a série.
      </p>
    );
  }

  const values = observations.map((item) => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Série achatada (uma Selic estável, por exemplo) dividiria por zero e
  // desenharia uma linha no topo; a margem mínima mantém a linha centralizada.
  const span = max - min || Math.abs(max) * 0.02 || 1;

  const plotW = WIDTH - PADDING.left - PADDING.right;
  const plotH = HEIGHT - PADDING.top - PADDING.bottom;

  const x = (index: number): number => PADDING.left + (index / (observations.length - 1)) * plotW;
  const y = (value: number): number => PADDING.top + plotH - ((value - min) / span) * plotH;

  const line = observations.map((item, i) => `${x(i)},${y(item.value)}`).join(' ');
  const area = `${PADDING.left},${PADDING.top + plotH} ${line} ${PADDING.left + plotW},${PADDING.top + plotH}`;

  const first = observations[0];
  const last = observations[observations.length - 1];
  const lastX = x(observations.length - 1);
  const lastY = last ? y(last.value) : 0;

  const description =
    `Série de ${observations.length} observações, de ${formatDate(first?.referenceDate ?? null)} ` +
    `a ${formatDate(last?.referenceDate ?? null)}. Mínimo ${formatValue(min, kind)}, ` +
    `máximo ${formatValue(max, kind)}, último valor ${formatValue(last?.value ?? null, kind)} ${unit}.`;

  return (
    <>
      <svg
        className="chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={description}
      >
        {/* Linhas de referência de mínimo e máximo, discretas. */}
        {[max, min].map((value) => (
          <g key={value}>
            <line
              className="chart-grid"
              x1={PADDING.left}
              x2={PADDING.left + plotW}
              y1={y(value)}
              y2={y(value)}
              strokeDasharray="3 4"
            />
            <text className="chart-tick" x={PADDING.left + plotW + 8} y={y(value) + 3.5}>
              {formatValue(value, kind)}
            </text>
          </g>
        ))}

        <polygon className="chart-area" points={area} />
        <polyline className="chart-line" points={line} />

        {/* O ponto final é o número que o usuário veio ver: merece ênfase. */}
        <circle className="chart-end" cx={lastX} cy={lastY} r="4" />
      </svg>

      <details className="disclosure">
        <summary>Ver os dados em tabela ({observations.length} observações)</summary>
        <div className="table-scroll">
          <table className="data-table">
            <caption className="sr-only">
              Observações da série, da mais recente para a mais antiga
            </caption>
            <thead>
              <tr>
                <th scope="col">Data de referência</th>
                <th scope="col">Valor ({unit})</th>
              </tr>
            </thead>
            <tbody>
              {[...observations].reverse().map((item) => (
                <tr key={item.referenceDate}>
                  <td>{formatDate(item.referenceDate)}</td>
                  <td>{formatValue(item.value, kind)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
