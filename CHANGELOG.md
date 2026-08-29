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

- **Cliente web em React 19 + TypeScript**
  Dashboard com cards, tela de detalhe com série histórica e seletor de janela,
  favoritos com atualização otimista revertida em caso de falha. As respostas
  da API são validadas pelos mesmos schemas Zod do servidor.

- **Gráfico de série em SVG puro**
  Sem biblioteca de gráficos: para uma linha única, a dependência traria mais
  superfície de manutenção e de segurança que valor. Acompanhado de tabela de
  dados completa, para que leitor de tela receba os números e não apenas a
  palavra "gráfico".

- **PWA instalável**
  Manifest, ícones e service worker que faz cache apenas da casca do
  aplicativo. `/api` nunca é interceptado — ver seção Segurança.

- **Acessibilidade (WCAG 2.2 AA)**
  Variação comunicada por três canais independentes (cor, seta e sinal
  numérico), foco sempre visível, alvos de toque de 44 px, link para pular ao
  conteúdo, `aria-pressed` no favorito e `prefers-reduced-motion` respeitado.

- **Agendador de sincronização**
  Intervalo configurável, com `unref()` para não segurar o processo, e
  encerramento gracioso que fecha o servidor antes do pool de conexões.

- **Pipeline de CI com gates de segurança**
  Cinco jobs paralelos que falham por motivos distintos: qualidade estática,
  testes, segurança, imagem e subida do ambiente. Inclui `npm audit` a partir de
  severidade moderada, varredura de segredos no histórico completo do Git, scan
  de imagem com Trivy em `HIGH` e `CRITICAL`, e verificação de que a imagem não
  roda como root nem carrega `.env`. O job de Compose valida a promessa dos 15
  minutos do briefing a cada mudança, em vez de confiar que o README continua
  verdadeiro.

- **ESLint e Prettier configurados**
  O script `lint` existia no `package.json` mas quebrava, porque não havia
  configuração. Flat config do ESLint 9 com regras que exigem informação de
  tipo (`recommendedTypeChecked`), que pegam promise não aguardada em rota
  HTTP e `any` vazando de resposta externa.

- **README raiz**
  Subida do ambiente, variáveis, séries escolhidas com justificativa, regra de
  variação, política de sincronização, arquitetura, segurança, acessibilidade,
  trade-offs e limitações conhecidas.

### Corrigido

- **Resposta malformada tratada como falha de rede** (revisão de código)
  O SGS devolve HTML de erro com status 200. O `JSON.parse` falhava, caía no
  tratamento genérico e o erro era rotulado como falha de rede — e portanto
  **retentado três vezes**, gastando mais de um minuto com o timeout de 25 s do
  BCB numa resposta que nunca melhoraria. Nova classificação `invalid_payload`,
  não retentável.

- **Validação de favorito carregava o detalhe completo** (revisão de código)
  Para responder "esta série existe?", a rota montava o detalhe inteiro: até 120
  observações lidas e duas variações calculadas. Passa a consultar apenas o
  catálogo.

- **`setState` síncrono dentro de efeito no frontend** (`4764def`)
  Presente nas duas páginas, causava renderização em cascata. A correção não foi
  silenciar a regra: o estado de carregamento passou a ser **derivado** de um
  carimbo na resposta, comparando o resultado guardado com a requisição atual.
  Some a variável duplicada e some a cascata.

- **Variação do IPCA calculada como se fosse índice** (`3e8e4c5`)
  O card exibia "−73,08%", comparando 0,07% de julho/2026 com 0,26% de
  julho/2025 — a variação percentual de uma taxa percentual. O tipo
  `macro_monthly` foi separado em `macro_monthly_index` (US CPI, número-índice,
  porcentagem) e `macro_monthly_rate` (IPCA, taxa, pontos percentuais).

- **Falso alarme de defasagem em séries mensais** (`3e8e4c5`)
  O limiar de 45 dias marcava IPCA e CPI como defasados em operação normal,
  ignorando que a série é datada no primeiro dia do mês e a publicação leva mais
  duas a três semanas. Passa a 70 dias.

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

- **Rate limit contornável por cabeçalho forjado** (revisão de código)
  `trustProxy` era derivado de `NODE_ENV`, então o container de produção
  confiava em `X-Forwarded-For` sem proxy à frente. Como o limite é contado por
  `request.ip`, qualquer cliente o contornava rotacionando o cabeçalho —
  inclusive no endpoint administrativo, cuja proteção existe para a API não
  virar amplificador de tráfego contra o BCB e o FRED. Passa a ser controlado
  pela variável `TRUST_PROXY`, `false` por padrão, que aceita faixa CIDR do
  proxy confiável em vez de um `true` genérico.

- **Vulnerabilidades de dependência zeradas** (`8bcdd97`)
  Cinco achados do `npm audit`, um deles crítico, na cadeia
  `vitest 2.x → vite → esbuild`. Atualização para Vitest 4.1.11 sem alteração
  de código de teste. `npm audit` passa a reportar zero.

- **Service worker não faz cache de dados**
  Num painel financeiro, servir cotação de cache é pior do que não servir nada:
  transforma uma falha de rede visível numa informação errada silenciosa. O
  service worker ignora `/api` por completo — se a rede cair, a interface mostra
  o estado de erro, que é honesto. O cache cobre apenas HTML, JS, CSS e ícones.

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
