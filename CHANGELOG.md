# Changelog

Registro das mudanças do Pulse FX, no formato [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Datas em horário de Brasília.

Este arquivo registra **o que mudou e por quê**. As decisões de arquitetura com
o raciocínio completo ficam no README; os achados de investigação ficam no
histórico de acompanhamento do projeto.

## [Não publicado]

### Adicionado

- **Regra de variação percentual por tipo de série** (`15031f7`)
  Função pura de domínio, sem dependência de banco ou HTTP, consumida
  igualmente pelo dashboard e pela tela de detalhe. Três tratamentos: câmbio
  diário contra o pregão anterior, taxa de política em pontos percentuais e
  macro mensal com âncora de calendário interanual.

- **Esquema PostgreSQL e catálogo de séries** (`f1b77d3`)
  Tabelas `series`, `observations`, `favorites` e `sync_runs`. Sete séries com
  identificadores confirmados contra as APIs reais em 28/08/2026, cada uma com
  justificativa e limitações em texto no próprio banco.

- **Contratos compartilhados** (`072b0b7`)
  Pacote `@pulse-fx/contracts` com schemas Zod. O mesmo schema valida a entrada
  no servidor e gera os tipos do cliente web.

- **Clientes de BCB e FRED com defesas de SSRF** (`072b0b7`)
  Allowlist exata de host, somente HTTPS, redirect recusado, teto de tamanho de
  resposta e backoff exponencial com jitter apenas em falha transitória.

- **Repositório de observações** (`e0c9a3b`)
  Upsert em lote idempotente, recorte de histórico por janela de calendário e
  consulta agregada de datas mais recentes, evitando N+1 no dashboard.

- **Circuit breaker por fonte** (`e0c9a3b`)
  Estados `closed`, `open` e `half_open`, com relógio injetável.

- **Serviço de sincronização com política de atualização em camadas**
  TTL derivado da periodicidade da série (2 h para diária, 12 h para mensal),
  janela incremental com 5 dias de sobreposição para capturar revisões da
  fonte, circuit breaker por fonte e execução sequencial. O disparo
  administrativo ignora o TTL, mas não o circuit breaker: nem o operador deve
  martelar uma fonte fora do ar. Falha de uma série não interrompe as demais.

- **API HTTP com Fastify 5**
  Rotas de indicadores, detalhe com janela de histórico, favoritos e
  sincronização administrativa. Health check devolve 503 quando o banco está
  fora, para que um orquestrador tire a instância do balanceador.

- **Sessão anônima para favoritos**
  Identificador opaco gerado no servidor, em cookie `httpOnly` com `SameSite`
  e prefixo `__Host-` em produção. Sem cadastro, e-mail ou rastreio — persiste
  favoritos de verdade coletando o mínimo possível.

- **Configuração validada no boot**
  Schema Zod sobre as variáveis de ambiente. O processo morre imediatamente com
  mensagem clara em vez de falhar de forma obscura na primeira requisição.

- **Agendador de sincronização**
  Intervalo configurável, com `unref()` para não segurar o processo, e
  encerramento gracioso que fecha o servidor antes do pool de conexões.

### Corrigido

- **Taxa de política comparava dias, não patamares** (`e70ad10`)
  A Selic meta é publicada todos os dias, inclusive fins de semana, repetindo o
  valor entre reuniões do Copom. A regra original exibiria variação zero em
  quase todo dia do ano. Passa a comparar com o patamar anterior.

- **Timeout insuficiente para o BCB** (`072b0b7`)
  Medição real mostrou 14,4 s numa consulta de 20 observações ao SGS. O teto de
  8 s reprovaria chamadas legítimas e abriria o circuit breaker sem a fonte
  estar fora do ar. BCB passa a 25 s; FRED permanece em 8 s.

- **Data deslocada por fuso horário na leitura** (`e0c9a3b`)
  O driver devolve `DATE` à meia-noite UTC; formatar em horário local jogaria a
  observação para o dia anterior no Brasil. Formatação passa a usar componentes
  UTC, com teste dedicado.

- **Precisão decimal perdida na conversão de `NUMERIC`** (`e0c9a3b`)
  O `pg` entrega `NUMERIC` como string de propósito, porque o tipo tem alcance
  maior que o `double` do JavaScript. A conversão passa a ocorrer na fronteira,
  com validação de finitude.

### Segurança

- **Vulnerabilidades de dependência zeradas** (`8bcdd97`)
  Cinco achados do `npm audit`, um deles crítico, na cadeia
  `vitest 2.x → vite → esbuild`. Atualização para Vitest 4.1.11 sem alteração
  de código de teste. `npm audit` passa a reportar zero.

- **Endurecimento da camada HTTP**
  Helmet com CSP `default-src 'none'` (a API só devolve JSON), CORS por
  allowlist explícita, rate limit global e um bem mais apertado no endpoint
  administrativo — cada chamada dele dispara requisições às fontes externas, e
  deixá-lo aberto transformaria a API num amplificador de tráfego contra o BCB
  e o FRED.

- **Token administrativo comparado em tempo constante**
  Comparar segredo com `===` vaza informação por tempo de execução, porque a
  igualdade de strings termina no primeiro caractere diferente. Token ausente e
  token errado devolvem a mesma resposta.

- **Cookie de sessão validado como UUID**
  Sem essa checagem, conteúdo arbitrário enviado pelo cliente viraria chave de
  consulta ao banco.

- **Erros não vazam detalhe interno**
  O cliente recebe código e mensagem genéricos com `requestId`; stack trace e
  mensagem do driver ficam apenas no log. Cabeçalhos de cookie e de token são
  removidos do log por redação explícita.

- **Chave de API protegida desde o primeiro commit** (`a5de79f`)
  `.gitignore` cobre `.env` antes de o arquivo existir. A mensagem de erro de
  rede é reescrita porque o texto original do `fetch` carrega a URL completa, e
  a URL do FRED contém a chave.

### Infraestrutura

- **Monorepo inicializado** (`a5de79f`)
  npm workspaces com `apps/*` e `packages/*`. TypeScript estrito com
  `noUncheckedIndexedAccess` e `exactOptionalPropertyTypes`.
