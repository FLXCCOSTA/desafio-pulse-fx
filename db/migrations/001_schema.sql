-- 001 · Esquema inicial do Pulse FX.
--
-- Decisões registradas aqui, porque schema é documentação:
--
-- * `observations` tem chave primária composta (series_id, reference_date).
--   É o que torna a sincronização idempotente: reprocessar o mesmo intervalo
--   atualiza a linha em vez de duplicá-la. Fontes revisam valores publicados
--   (o IPCA passa por revisão), então o upsert precisa aceitar novo valor
--   para uma data já conhecida.
--
-- * `value` é NUMERIC, nunca DOUBLE PRECISION. Ponto flutuante binário não
--   representa 5.1017 exatamente, e erro de arredondamento em dado financeiro
--   é inaceitável mesmo num MVP educacional.
--
-- * `reference_date` é DATE, não TIMESTAMP. A observação pertence a um dia do
--   calendário civil; carregar fuso horário junto só criaria a chance de a
--   mesma cotação aparecer em dois dias diferentes.

BEGIN;

CREATE TABLE IF NOT EXISTS series (
    id              TEXT        PRIMARY KEY,
    source          TEXT        NOT NULL CHECK (source IN ('bcb_sgs', 'fred')),
    external_id     TEXT        NOT NULL,
    name            TEXT        NOT NULL,
    kind            TEXT        NOT NULL CHECK (
                                  kind IN ('fx_daily', 'policy_rate', 'yield_daily', 'macro_monthly')
                                ),
    unit            TEXT        NOT NULL,
    frequency       TEXT        NOT NULL CHECK (frequency IN ('daily', 'monthly')),
    -- Justificativa exigida pelo briefing: por que este indicador existe no produto.
    rationale       TEXT        NOT NULL,
    -- Limitações do dado, exibidas na tela de detalhe.
    limitations     TEXT        NOT NULL,
    doc_url         TEXT        NOT NULL,
    active          BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT series_source_external_id_key UNIQUE (source, external_id)
);

CREATE TABLE IF NOT EXISTS observations (
    series_id       TEXT        NOT NULL REFERENCES series (id) ON DELETE CASCADE,
    reference_date  DATE        NOT NULL,
    value           NUMERIC(20, 8) NOT NULL,
    -- Quando o Pulse FX gravou o dado. Nunca confundir com reference_date:
    -- a interface mostra a data da observação, não a hora da consulta.
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (series_id, reference_date)
);

-- Leitura dominante: "últimas N observações de uma série, mais recentes primeiro".
CREATE INDEX IF NOT EXISTS observations_series_date_desc_idx
    ON observations (series_id, reference_date DESC);

CREATE TABLE IF NOT EXISTS favorites (
    -- Identificador opaco de sessão anônima. Sem cadastro e sem dado pessoal:
    -- o briefing coloca KYC fora de escopo e a LGPD recompensa minimização.
    session_id      TEXT        NOT NULL,
    series_id       TEXT        NOT NULL REFERENCES series (id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (session_id, series_id)
);

CREATE INDEX IF NOT EXISTS favorites_session_idx ON favorites (session_id);

-- Auditoria da sincronização: permite responder "quando este número entrou e
-- de onde veio" sem depender de log volátil.
CREATE TABLE IF NOT EXISTS sync_runs (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    series_id       TEXT        NOT NULL REFERENCES series (id) ON DELETE CASCADE,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ,
    status          TEXT        NOT NULL CHECK (status IN ('running', 'success', 'failed', 'skipped')),
    rows_upserted   INTEGER     NOT NULL DEFAULT 0,
    -- Mensagem de erro para diagnóstico. Nunca recebe corpo de resposta cru
    -- nem valor de segredo.
    error_message   TEXT,
    trigger_source  TEXT        NOT NULL CHECK (trigger_source IN ('schedule', 'startup', 'admin'))
);

CREATE INDEX IF NOT EXISTS sync_runs_series_started_idx
    ON sync_runs (series_id, started_at DESC);

COMMIT;
