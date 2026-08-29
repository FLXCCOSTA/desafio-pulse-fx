import { describe, expect, it } from 'vitest';

import { HttpClient, HttpClientError } from '../http/httpClient';
import { BCB_HOST, parseBcbDate, parseSgsResponse, toBcbDate } from './bcbSgs';
import { FRED_HOST, parseFredResponse } from './fred';

describe('parser do SGS (BCB)', () => {
  it('converte a resposta real do dólar de venda', () => {
    // Payload copiado da chamada real feita em 28/08/2026.
    const payload = [
      { data: '03/08/2026', valor: '5.0723' },
      { data: '04/08/2026', valor: '5.1053' },
      { data: '05/08/2026', valor: '5.1154' },
    ];

    const observations = parseSgsResponse(payload);

    expect(observations).toEqual([
      { referenceDate: '2026-08-03', value: 5.0723 },
      { referenceDate: '2026-08-04', value: 5.1053 },
      { referenceDate: '2026-08-05', value: 5.1154 },
    ]);
  });

  it('descarta linha com data em formato inesperado, sem derrubar a série', () => {
    const observations = parseSgsResponse([
      { data: '2026-08-03', valor: '5.0723' },
      { data: '04/08/2026', valor: '5.1053' },
    ]);

    expect(observations).toHaveLength(1);
    expect(observations[0]?.referenceDate).toBe('2026-08-04');
  });

  it('descarta valor não numérico em vez de convertê-lo em zero', () => {
    const observations = parseSgsResponse([
      { data: '03/08/2026', valor: 'indisponível' },
      { data: '04/08/2026', valor: '5.1053' },
    ]);

    expect(observations).toHaveLength(1);
    expect(observations[0]?.value).toBe(5.1053);
  });

  it('devolve lista vazia quando a fonte responde algo que não é array', () => {
    // O SGS devolve HTML de erro em caminho inválido: não pode virar exceção
    // não tratada no meio do job de sincronização.
    expect(parseSgsResponse('<html>Requisição inválida!</html>')).toEqual([]);
    expect(parseSgsResponse(null)).toEqual([]);
  });

  it('converte datas nos dois sentidos', () => {
    expect(parseBcbDate('28/08/2026')).toBe('2026-08-28');
    expect(parseBcbDate('28-08-2026')).toBeNull();
    expect(toBcbDate('2026-08-28')).toBe('28/08/2026');
  });
});

describe('parser do FRED', () => {
  it('converte a resposta real de observações', () => {
    const payload = {
      observations: [
        { date: '2026-08-26', value: '4.19' },
        { date: '2026-08-27', value: '4.21' },
      ],
    };

    expect(parseFredResponse(payload)).toEqual([
      { referenceDate: '2026-08-26', value: 4.19 },
      { referenceDate: '2026-08-27', value: 4.21 },
    ]);
  });

  it('descarta o marcador de dado ausente em feriado americano', () => {
    // Comportamento real do FRED: "." em vez de omitir a linha. Lido como
    // número viraria zero — um Treasury de 0% e uma variação absurda.
    const payload = {
      observations: [
        { date: '2026-07-03', value: '4.18' },
        { date: '2026-07-04', value: '.' },
        { date: '2026-07-07', value: '4.22' },
      ],
    };

    const observations = parseFredResponse(payload);

    expect(observations).toHaveLength(2);
    expect(observations.map((item) => item.referenceDate)).toEqual(['2026-07-03', '2026-07-07']);
    expect(observations.some((item) => item.value === 0)).toBe(false);
  });

  it('tolera payload sem o campo observations', () => {
    expect(parseFredResponse({})).toEqual([]);
    expect(parseFredResponse({ observations: 'erro' })).toEqual([]);
    expect(parseFredResponse(null)).toEqual([]);
  });
});

describe('HttpClient · defesas contra SSRF', () => {
  const client = new HttpClient({
    allowedHosts: [BCB_HOST, FRED_HOST],
    timeoutMs: 1_000,
    maxAttempts: 1,
    maxResponseBytes: 1024,
  });

  it('aceita os hosts das fontes declaradas', () => {
    expect(() => client.assertAllowed(`https://${BCB_HOST}/dados/serie`)).not.toThrow();
    expect(() => client.assertAllowed(`https://${FRED_HOST}/fred/series`)).not.toThrow();
  });

  it('recusa o endpoint de metadados de instância em nuvem', () => {
    // Alvo clássico de SSRF: credenciais temporárias da role da instância.
    expect(() => client.assertAllowed('https://169.254.169.254/latest/meta-data/')).toThrow(
      HttpClientError,
    );
  });

  it('recusa host de aparência parecida com o permitido', () => {
    expect(() => client.assertAllowed('https://api.bcb.gov.br.evil.example/dados')).toThrow(
      /fora da allowlist/,
    );
  });

  it('recusa subdomínio não declarado, porque a comparação é exata', () => {
    expect(() => client.assertAllowed('https://interno.api.bcb.gov.br/dados')).toThrow(
      /fora da allowlist/,
    );
  });

  it('recusa esquema não-HTTPS, incluindo acesso a arquivo local', () => {
    expect(() => client.assertAllowed('http://api.bcb.gov.br/dados')).toThrow(/Somente HTTPS/);
    expect(() => client.assertAllowed('file:///etc/passwd')).toThrow(HttpClientError);
  });

  it('recusa URL malformada', () => {
    expect(() => client.assertAllowed('nao-e-uma-url')).toThrow(HttpClientError);
  });
});
