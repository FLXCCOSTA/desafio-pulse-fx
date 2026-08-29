-- 003 · Separa série macro mensal em número-índice e taxa.
--
-- Motivação: erro observado ao rodar o sistema com dados reais em 29/08/2026.
-- O card do IPCA exibia "-73,08%", comparando 0,07% de julho/2026 com 0,26% de
-- julho/2025.
--
-- A causa é que a série 433 do SGS **não é um índice**: já é a variação
-- percentual do mês. Calcular a variação percentual de uma taxa percentual
-- produz um número sem significado para o leitor — o mesmo erro conceitual que
-- levaria a dizer que uma Selic de 10% indo a 11% "subiu 10%".
--
-- O contraste com o US CPI deixa a distinção clara: CPIAUCSL é um número-índice
-- (332,813), e nele a variação interanual em porcentagem é exatamente a leitura
-- correta — a inflação acumulada em 12 meses.
--
-- Duas naturezas opostas que estavam no mesmo tipo. Agora:
--   macro_monthly_index -> variação em porcentagem  (US CPI)
--   macro_monthly_rate  -> variação em pontos percentuais (IPCA)

BEGIN;

ALTER TABLE series DROP CONSTRAINT IF EXISTS series_kind_check;

UPDATE series SET kind = 'macro_monthly_index' WHERE kind = 'macro_monthly';
UPDATE series SET kind = 'macro_monthly_rate'  WHERE id = 'ipca-mensal';

ALTER TABLE series ADD CONSTRAINT series_kind_check CHECK (
  kind IN ('fx_daily', 'policy_rate', 'yield_daily',
           'macro_monthly_index', 'macro_monthly_rate')
);

-- A unidade exibida também estava imprecisa: deixa explícito que o número é
-- uma taxa mensal, para que ninguém o leia como nível de preço.
UPDATE series
   SET unit = 'porcento no mês',
       limitations = limitations || ' O valor publicado já é a variação percentual do mês, '
                     || 'não um número-índice: por isso a comparação interanual aparece em '
                     || 'pontos percentuais, e não em porcentagem.'
 WHERE id = 'ipca-mensal';

COMMIT;
