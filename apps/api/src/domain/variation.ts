/**
 * Cálculo da variação por tipo de série.
 *
 * Regras que o briefing exige documentar, resumidas:
 *
 * 1. "Último valor" é a observação válida mais recente já persistida.
 * 2. "Data de referência" é a data da observação, nunca a hora da consulta.
 * 3. Lacunas (fim de semana, feriado, atraso de publicação) resolvem por
 *    último dado conhecido. Não há interpolação: interpolar série financeira
 *    inventa um preço que nunca existiu.
 */

import {
  DEFAULT_VARIATION_POLICY,
  type Observation,
  type SeriesKind,
  type VariationPolicy,
  type VariationResult,
} from './series';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Uma observação só entra no cálculo se a data e o valor forem utilizáveis. */
export function isValidObservation(candidate: Observation): boolean {
  return (
    ISO_DATE.test(candidate.referenceDate) &&
    typeof candidate.value === 'number' &&
    Number.isFinite(candidate.value)
  );
}

/**
 * Normaliza a série: descarta observações inválidas, remove datas duplicadas
 * mantendo a última ocorrência e ordena da mais antiga para a mais recente.
 *
 * A deduplicação importa porque a mesma data pode chegar de uma re-sincronização
 * com valor revisado pela fonte — a revisão mais recente é a que vale.
 */
export function normalizeSeries(observations: readonly Observation[]): Observation[] {
  const byDate = new Map<string, Observation>();

  for (const observation of observations) {
    if (isValidObservation(observation)) {
      byDate.set(observation.referenceDate, observation);
    }
  }

  return [...byDate.values()].sort((a, b) => a.referenceDate.localeCompare(b.referenceDate));
}

/** Subtrai meses de um `YYYY-MM-DD`, devolvendo o prefixo `YYYY-MM` alvo. */
export function shiftMonths(referenceDate: string, months: number): string {
  const year = Number(referenceDate.slice(0, 4));
  const month = Number(referenceDate.slice(5, 7));
  const zeroBased = year * 12 + (month - 1) - months;
  const targetYear = Math.floor(zeroBased / 12);
  const targetMonth = (zeroBased % 12) + 1;

  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}`;
}

/**
 * Localiza a observação que serve de denominador, conforme a estratégia.
 * Devolve `null` quando a série é curta demais para a janela pedida — situação
 * legítima em série recém-sincronizada, que a interface comunica em vez de
 * esconder atrás de um número inventado.
 */
function findBaseline(sorted: readonly Observation[], policy: VariationPolicy): Observation | null {
  if (policy.strategy === 'observations') {
    const index = sorted.length - 1 - policy.lookback;
    return index >= 0 ? (sorted[index] ?? null) : null;
  }

  const latest = sorted.at(-1);
  if (!latest) return null;

  if (policy.strategy === 'last-distinct-value') {
    // Anda para trás pulando repetições. O resultado é a última observação do
    // patamar anterior — para a Selic meta, o dia anterior à decisão do Copom.
    let currentLevel = latest.value;
    let levelsFound = 0;

    for (let index = sorted.length - 2; index >= 0; index -= 1) {
      const candidate = sorted[index];
      if (!candidate || candidate.value === currentLevel) continue;

      levelsFound += 1;
      if (levelsFound === policy.lookback) return candidate;
      currentLevel = candidate.value;
    }

    return null;
  }

  const targetMonth = shiftMonths(latest.referenceDate, policy.lookback);

  // Série mensal pode ter mais de uma observação no mês alvo; vale a última.
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const candidate = sorted[index];
    if (candidate && candidate.referenceDate.startsWith(targetMonth)) {
      return candidate;
    }
  }

  return null;
}

export interface CalculateVariationOptions {
  /** Sobrescreve a política padrão do tipo de série (ex.: janela de 21 pregões). */
  readonly policy?: VariationPolicy;
}

/**
 * Calcula a variação de uma série. Função pura: mesma entrada, mesma saída,
 * sem relógio, sem banco e sem rede — por isso é testável de forma exaustiva.
 */
export function calculateVariation(
  observations: readonly Observation[],
  kind: SeriesKind,
  options: CalculateVariationOptions = {},
): VariationResult {
  const policy = options.policy ?? DEFAULT_VARIATION_POLICY[kind];
  const sorted = normalizeSeries(observations);
  const latest = sorted.at(-1) ?? null;

  if (!latest) {
    return {
      latest: null,
      baseline: null,
      change: null,
      unit: policy.unit,
      label: policy.label,
      unavailableReason: 'no_observations',
    };
  }

  const baseline = findBaseline(sorted, policy);

  if (!baseline) {
    return {
      latest,
      baseline: null,
      change: null,
      unit: policy.unit,
      label: policy.label,
      unavailableReason: 'no_baseline',
    };
  }

  // Taxa de juros varia em pontos percentuais, não em porcentagem.
  if (policy.unit === 'percentage_points') {
    return {
      latest,
      baseline,
      change: latest.value - baseline.value,
      unit: policy.unit,
      label: policy.label,
      unavailableReason: null,
    };
  }

  if (baseline.value === 0) {
    return {
      latest,
      baseline,
      change: null,
      unit: policy.unit,
      label: policy.label,
      unavailableReason: 'zero_baseline',
    };
  }

  return {
    latest,
    baseline,
    change: ((latest.value - baseline.value) / baseline.value) * 100,
    unit: policy.unit,
    label: policy.label,
    unavailableReason: null,
  };
}
