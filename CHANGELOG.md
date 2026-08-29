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

- **Chave de API protegida desde o primeiro commit** (`a5de79f`)
  `.gitignore` cobre `.env` antes de o arquivo existir. A mensagem de erro de
  rede é reescrita porque o texto original do `fetch` carrega a URL completa, e
  a URL do FRED contém a chave.

### Infraestrutura

- **Monorepo inicializado** (`a5de79f`)
  npm workspaces com `apps/*` e `packages/*`. TypeScript estrito com
  `noUncheckedIndexedAccess` e `exactOptionalPropertyTypes`.
