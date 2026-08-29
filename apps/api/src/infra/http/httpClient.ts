/**
 * Cliente HTTP para as fontes externas.
 *
 * A API do Pulse FX consome URLs externas, o que a coloca na superfície de
 * SSRF (OWASP API Security Top 10). As defesas aqui são deliberadas:
 *
 * 1. **Allowlist de host.** Só os domínios do BCB e do FRED são alcançáveis.
 *    Nenhuma URL vinda de configuração, de parâmetro de rota ou de resposta de
 *    terceiro consegue apontar o servidor para outro destino.
 * 2. **Redirect não é seguido.** Um 302 para `169.254.169.254` — endpoint de
 *    metadados de instância em nuvem — é o caminho clássico de escalada.
 *    Aqui o redirect vira erro.
 * 3. **Timeout obrigatório.** Fonte lenta não pode segurar conexão da API.
 * 4. **Teto de tamanho de resposta.** Impede que uma resposta anômala consuma
 *    a memória do processo.
 * 5. **Backoff exponencial com jitter**, e apenas em falha transitória. Erro
 *    4xx não é retentado: repetir requisição inválida só queima cota.
 */

export class HttpClientError extends Error {
  constructor(
    message: string,
    readonly kind:
      | 'blocked_host'
      | 'timeout'
      | 'http_status'
      | 'too_large'
      | 'network'
      | 'redirect'
      /** Resposta chegou, mas não é JSON. Não adianta retentar. */
      | 'invalid_payload',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HttpClientError';
  }
}

export interface HttpClientOptions {
  /** Hosts alcançáveis. Comparação exata, sem sufixo curinga. */
  readonly allowedHosts: readonly string[];
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly maxResponseBytes: number;
  /** Injetável para que o teste não durma de verdade. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injetável para tornar o backoff determinístico no teste. */
  readonly random?: () => number;
}

/**
 * Padrões por fonte.
 *
 * O timeout do BCB é deliberadamente alto: medido em 14,4s numa consulta de 20
 * observações contra a API real em 29/08/2026. Um teto de 8s — que parece
 * generoso no papel — reprovaria chamadas perfeitamente legítimas e faria o
 * circuit breaker abrir sem que a fonte estivesse fora do ar.
 */
export const DEFAULT_HTTP_OPTIONS = {
  bcbTimeoutMs: 25_000,
  fredTimeoutMs: 8_000,
  maxAttempts: 3,
  maxResponseBytes: 8 * 1024 * 1024,
} as const;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Falha transitória: vale a pena tentar de novo. */
function isRetryable(error: unknown): boolean {
  if (error instanceof HttpClientError) {
    if (error.kind === 'network' || error.kind === 'timeout') return true;
    // 429 e 5xx são transitórios; demais 4xx são erro nosso e não melhoram com repetição.
    if (error.kind === 'http_status') {
      return error.status === 429 || (error.status !== undefined && error.status >= 500);
    }
  }
  return false;
}

export class HttpClient {
  private readonly allowedHosts: ReadonlySet<string>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly options: HttpClientOptions) {
    this.allowedHosts = new Set(options.allowedHosts.map((host) => host.toLowerCase()));
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  /** Rejeita qualquer destino fora da allowlist, antes de abrir conexão. */
  assertAllowed(url: string): URL {
    let parsed: URL;

    try {
      parsed = new URL(url);
    } catch {
      throw new HttpClientError(`URL inválida: ${url}`, 'blocked_host');
    }

    if (parsed.protocol !== 'https:') {
      throw new HttpClientError(`Somente HTTPS é permitido: ${parsed.protocol}`, 'blocked_host');
    }

    if (!this.allowedHosts.has(parsed.hostname.toLowerCase())) {
      throw new HttpClientError(`Host fora da allowlist: ${parsed.hostname}`, 'blocked_host');
    }

    return parsed;
  }

  async getJson<T = unknown>(url: string): Promise<T> {
    const target = this.assertAllowed(url);
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      try {
        return await this.attempt<T>(target);
      } catch (error) {
        lastError = error;

        if (!isRetryable(error) || attempt === this.options.maxAttempts) break;

        // Backoff exponencial com jitter: 250ms, 500ms, 1s... mais ruído, para
        // que várias séries falhando juntas não voltem em avalanche sincronizada.
        const base = 250 * 2 ** (attempt - 1);
        await this.sleep(base + Math.floor(this.random() * base));
      }
    }

    throw lastError;
  }

  private async attempt<T>(target: URL): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.options.timeoutMs);

    try {
      const response = await fetch(target, {
        signal: controller.signal,
        // Um 302 para endpoint de metadados de nuvem é o vetor clássico de SSRF.
        redirect: 'error',
        headers: {
          accept: 'application/json',
          'user-agent': 'PulseFX/0.1 (desafio técnico)',
        },
      });

      if (!response.ok) {
        throw new HttpClientError(
          `Resposta ${response.status} de ${target.hostname}`,
          'http_status',
          response.status,
        );
      }

      const declared = Number(response.headers.get('content-length') ?? '0');
      if (declared > this.options.maxResponseBytes) {
        throw new HttpClientError(
          `Resposta maior que o teto de ${this.options.maxResponseBytes} bytes`,
          'too_large',
        );
      }

      const text = await response.text();
      if (text.length > this.options.maxResponseBytes) {
        throw new HttpClientError(
          `Resposta maior que o teto de ${this.options.maxResponseBytes} bytes`,
          'too_large',
        );
      }

      try {
        return JSON.parse(text) as T;
      } catch {
        // O SGS devolve uma página HTML de "Requisição inválida" quando o
        // caminho não bate — com status 200. Sem esta distinção, o erro de
        // parsing cairia no catch genérico abaixo, seria rotulado como falha
        // de rede e, pior, **retentado três vezes**: com o timeout de 25s do
        // BCB, mais de um minuto gasto numa resposta que nunca vai melhorar.
        throw new HttpClientError(
          `Resposta de ${target.hostname} não é JSON válido`,
          'invalid_payload',
        );
      }
    } catch (error) {
      if (error instanceof HttpClientError) throw error;

      if (error instanceof Error && error.name === 'AbortError') {
        throw new HttpClientError(
          `Tempo esgotado após ${this.options.timeoutMs}ms em ${target.hostname}`,
          'timeout',
        );
      }

      if (error instanceof TypeError && error.message.toLowerCase().includes('redirect')) {
        throw new HttpClientError(`Redirect recusado em ${target.hostname}`, 'redirect');
      }

      // Mensagem própria: o texto do erro de rede pode carregar a URL completa,
      // e a URL do FRED contém a chave de API.
      throw new HttpClientError(`Falha de rede ao consultar ${target.hostname}`, 'network');
    } finally {
      clearTimeout(timer);
    }
  }
}
