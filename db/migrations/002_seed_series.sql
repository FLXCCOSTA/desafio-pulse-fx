-- 002 · Catálogo de séries do Pulse FX.
--
-- Todos os identificadores externos abaixo foram confirmados contra as APIs
-- reais em 28/08/2026, como o briefing exige. Nenhum código foi copiado de
-- memória ou de exemplo de terceiros.
--
-- Tese do produto: o real se move pelo diferencial de juros e inflação entre
-- Brasil e Estados Unidos. Cada indicador existe para sustentar essa leitura;
-- nenhum está aqui por ser fácil de buscar.

BEGIN;

INSERT INTO series (id, source, external_id, name, kind, unit, frequency, rationale, limitations, doc_url)
VALUES
    ('usd-brl', 'bcb_sgs', '1',
     'Dólar americano (venda)', 'fx_daily', 'BRL', 'daily',
     'Taxa de referência oficial do Banco Central para o dólar. É o primeiro número que o usuário brasileiro procura e a âncora de todo o resto do painel: viagem, importação e preço de combustível passam por ela. Serve de base para ler o diferencial de juros como causa, e não como curiosidade.',
     'Publicada apenas em dias úteis e sujeita a revisão do BCB. Não é a cotação de casa de câmbio nem de cartão: a taxa que o consumidor paga inclui spread e IOF, e será sempre maior.',
     'https://dadosabertos.bcb.gov.br/dataset/taxas-de-cambio-todos-os-boletins-diarios'),

    ('eur-brl', 'bcb_sgs', '21619',
     'Euro (venda)', 'fx_daily', 'BRL', 'daily',
     'Segunda moeda mais relevante para quem viaja ou importa. Existe no painel para mostrar que a variação do real nem sempre é um fenômeno do dólar: quando as duas se movem juntas, a origem é o real; quando divergem, a origem está no exterior.',
     'Mesmas limitações do dólar: apenas dias úteis, sujeita a revisão e distinta da taxa praticada no varejo.',
     'https://dadosabertos.bcb.gov.br/dataset/taxas-de-cambio-todos-os-boletins-diarios'),

    ('selic-meta', 'bcb_sgs', '432',
     'Selic meta', 'policy_rate', 'porcento ao ano', 'daily',
     'Preço do dinheiro no Brasil, definido pelo Copom. Junto com a taxa americana forma o diferencial de juros que explica boa parte do fluxo cambial: juro maior aqui tende a atrair capital e valorizar o real.',
     'A série é publicada todos os dias, inclusive fins de semana, repetindo o valor entre reuniões do Copom. Por isso a variação exibida compara patamares, não dias consecutivos. Meta definida pelo Copom, que pode diferir da Selic efetiva negociada no mercado.',
     'https://www3.bcb.gov.br/sgspub/'),

    ('ipca-mensal', 'bcb_sgs', '433',
     'IPCA', 'macro_monthly', 'porcento no mês', 'monthly',
     'Inflação oficial ao consumidor no Brasil. Contextualiza a Selic — juro alto costuma ser resposta a inflação alta — e traduz câmbio em poder de compra, que é o que o usuário efetivamente sente no orçamento.',
     'Divulgado uma vez por mês, com defasagem de algumas semanas em relação ao mês de referência. Mede uma cesta média nacional que pode não corresponder ao consumo de nenhuma família específica.',
     'https://www3.bcb.gov.br/sgspub/'),

    ('fed-funds', 'fred', 'DFF',
     'Federal Funds Effective Rate', 'policy_rate', 'porcento ao ano', 'daily',
     'Contraparte americana da Selic. O diferencial entre as duas taxas é a leitura macro central do Pulse FX: quando o Fed sobe juros, ativos em dólar ficam mais atraentes e moedas emergentes tendem a sofrer pressão.',
     'É a taxa efetiva negociada, que oscila dentro da banda-alvo do Fed em vez de repeti-la exatamente. Publicada em dias úteis americanos, cujo calendário de feriados difere do brasileiro.',
     'https://fred.stlouisfed.org/docs/api/fred/series_observations.html'),

    ('us-cpi', 'fred', 'CPIAUCSL',
     'Índice de preços ao consumidor (EUA)', 'macro_monthly', 'índice 1982-84=100', 'monthly',
     'Inflação americana, que orienta a trajetória do Fed e, por consequência, a pressão sobre o real. Fecha o quadrilátero do produto: inflação e juro de cada lado do câmbio.',
     'É um número-índice, não uma taxa: a leitura útil é a variação interanual, que é justamente a que o Pulse FX exibe. Série com ajuste sazonal e sujeita a revisão pelo BLS.',
     'https://fred.stlouisfed.org/series/CPIAUCSL'),

    ('ust-10y', 'fred', 'DGS10',
     'Treasury 10 anos', 'yield_daily', 'porcento ao ano', 'daily',
     'Juro longo dos Estados Unidos e termômetro de apetite global a risco. Alta sustentada costuma coincidir com saída de capital de mercados emergentes e pressão sobre o real, mesmo sem qualquer mudança no Brasil.',
     'Não é publicada em feriados americanos, e nesses dias a fonte devolve ponto no lugar do valor — o Pulse FX descarta essas leituras em vez de tratá-las como zero. Reflete expectativa de mercado, não decisão de política.',
     'https://fred.stlouisfed.org/series/DGS10')

ON CONFLICT (id) DO UPDATE SET
    name        = EXCLUDED.name,
    kind        = EXCLUDED.kind,
    unit        = EXCLUDED.unit,
    frequency   = EXCLUDED.frequency,
    rationale   = EXCLUDED.rationale,
    limitations = EXCLUDED.limitations,
    doc_url     = EXCLUDED.doc_url;

COMMIT;
