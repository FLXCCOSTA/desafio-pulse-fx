# Pulse FX

Painel de **câmbio e indicadores macro** do Brasil e dos Estados Unidos, montado
sobre fontes públicas oficiais — o Banco Central do Brasil e o FRED, do Federal
Reserve Bank de St. Louis.

> **Conteúdo educacional.** Os dados são exibidos para fins informativos. Isto
> **não** é recomendação de investimento, nem cotação para operação de câmbio.

---

## Sumário

- [Subir o ambiente](#subir-o-ambiente)
  - [Se o build falhar por credenciais (Windows)](#se-o-build-falhar-por-credenciais-windows)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Rodar testes e lint](#rodar-testes-e-lint)
- [Rodar o frontend em desenvolvimento](#rodar-o-frontend-em-desenvolvimento)
- [Indicadores escolhidos e por quê](#indicadores-escolhidos-e-por-quê)
- [Regra de variação percentual](#regra-de-variação-percentual)
- [Janela de histórico](#janela-de-histórico)
- [Política de sincronização](#política-de-sincronização)
- [Arquitetura](#arquitetura)
- [Segurança](#segurança)
- [Acessibilidade](#acessibilidade)
- [Decisões e trade-offs](#decisões-e-trade-offs)
- [O que aprendemos rodando com dados reais](#o-que-aprendemos-rodando-com-dados-reais)
- [Rotas da API](#rotas-da-api)
- [Limitações conhecidas](#limitações-conhecidas)

---

## Subir o ambiente

**Pré-requisitos:** Docker e Docker Compose. Nada mais — Node, PostgreSQL e o
toolchain de build ficam dentro dos containers.

```bash
git clone <url-do-repositorio> pulse-fx
cd pulse-fx
cp .env.example .env
```

Preencha três valores no `.env`:

```bash
# Senha do banco local (qualquer valor)
POSTGRES_PASSWORD=escolha-uma-senha

# Token do endpoint administrativo — mínimo de 32 caracteres
# Gere com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ADMIN_SYNC_TOKEN=

# Chave gratuita do FRED: https://fredaccount.stlouisfed.org/apikeys
FRED_API_KEY=
```

Suba tudo:

```bash
docker compose up -d --build
```

Pronto. O **painel abre em http://localhost:5173** e a API responde em
http://localhost:3333. A primeira sincronização começa sozinha, trazendo cerca
de 7.600 observações reais das duas fontes — leva alguns minutos, e a interface
já funciona enquanto isso, exibindo o que foi persistido até o momento.

Confira:

```bash
curl http://localhost:3333/health
```

> **Tempo medido:** 23 segundos do `up` até a API responder saudável, numa
> máquina com as imagens já baixadas. O primeiro build, incluindo download das
> imagens base, fica em poucos minutos — bem dentro dos 15 exigidos. O pipeline
> de CI verifica essa promessa a cada mudança, em vez de confiar que este
> README continua verdadeiro.

Para derrubar, preservando os dados:

```bash
docker compose down
```

Para derrubar apagando o volume do banco:

```bash
docker compose down -v
```

### Se o build falhar por credenciais (Windows)

Num terminal cujo `PATH` está incompleto, o build morre com uma mensagem que não
diz qual é a causa real:

```
error getting credentials - err: exec: "docker-credential-desktop":
executable file not found in %PATH%
```

O Docker Desktop consulta esse auxiliar antes de resolver **qualquer** imagem,
mesmo as públicas, porque `~/.docker/config.json` traz `"credsStore": "desktop"`.
Se o terminal não enxerga o executável, nada é baixado. O sintoma costuma vir
acompanhado de `git.exe not found`, que é a mesma causa.

Abrir um terminal novo resolve. Para corrigir na sessão atual:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
```

Não é um problema do projeto — é o ambiente. Está aqui porque a mensagem do
Docker não indica a causa, e o tempo perdido procurando no lugar errado é real.

---

## Variáveis de ambiente

Todas documentadas em [`.env.example`](.env.example), que é versionado **sem
valores**. O `.env` real nunca entra no Git nem na imagem Docker.

| Variável | Obrigatória | Padrão | Para que serve |
|---|:---:|---|---|
| `POSTGRES_USER` | | `pulsefx` | Usuário do banco |
| `POSTGRES_PASSWORD` | ✔ | — | Senha do banco |
| `POSTGRES_DB` | | `pulsefx` | Nome do banco |
| `DATABASE_URL` | ✔ | — | Cadeia de conexão (o Compose monta sozinho) |
| `NODE_ENV` | | `development` | Em `production`, ativa o prefixo `__Host-` e o atributo `Secure` no cookie de sessão |
| `PORT` | | `3333` | Porta da API |
| `CORS_ORIGINS` | | `http://localhost:5173` | Allowlist de origens, separadas por vírgula |
| `ADMIN_SYNC_TOKEN` | ✔ | — | Token do endpoint de sync. Mínimo de 32 caracteres |
| `FRED_API_KEY` | ✔ | — | Chave do FRED |
| `BCB_TIMEOUT_MS` | | `25000` | Timeout do BCB. Alto de propósito — veja abaixo |
| `FRED_TIMEOUT_MS` | | `8000` | Timeout do FRED |
| `SYNC_ON_STARTUP` | | `true` | Sincroniza ao subir |
| `SYNC_INTERVAL_MINUTES` | | `120` | Intervalo do agendador |
| `RATE_LIMIT_MAX` | | `120` | Requisições por janela, por IP |
| `RATE_LIMIT_WINDOW_MINUTES` | | `1` | Tamanho da janela do rate limit |
| `WEB_PORT` | | `5173` | Porta em que o painel é publicado |
| `TRUST_PROXY` | | `false` | Confiar em `X-Forwarded-For`. Só ative com proxy confiável à frente |

A configuração é validada por schema Zod **no boot**. Se algo faltar ou estiver
malformado, o processo morre imediatamente listando o que está errado — sem
jamais imprimir o valor recebido, porque mensagem de erro de configuração é um
lugar clássico de vazamento de segredo em log.

---

## Rodar testes e lint

Precisa de Node 22+ e Docker (o teste de persistência sobe um PostgreSQL real).

```bash
npm ci
```

```bash
npm test
```

```bash
npm run lint
```

```bash
npm run typecheck
```

```bash
npm run format
```

**199 testes em 12 arquivos.** O briefing pede no mínimo 5:

| # | Arquivo | O que verifica |
|---|---|---|
| 1 | `apps/api/src/domain/variation.test.ts` | Regra de domínio: variação por tipo de série, feriado, fim de semana, virada de ano, série curta, base zero |
| 2 | `apps/api/src/infra/db/observationsRepository.test.ts` | Persistência **contra PostgreSQL real** em container, aplicando as migrations de verdade |
| 3 | `apps/api/src/http/server.test.ts` | HTTP: contrato de resposta, validação, códigos de erro, isolamento de sessão, autenticação administrativa |
| 4 | `apps/web/src/components/IndicatorCard.test.tsx` | Frontend: formatação, direção da variação sem cor, rótulos de acessibilidade, teclado |
| 5 | `apps/api/src/infra/sources/sources.test.ts` | Integração com as fontes: parsing das respostas reais e defesas contra SSRF |

E mais sete além do exigido: `circuitBreaker.test.ts`, `syncService.test.ts`,
`config.test.ts`, `startup.test.ts`, `SeriesChart.test.tsx`, `Dashboard.test.tsx`
e `IndicatorDetail.test.tsx`.

O teste de persistência usa Testcontainers e roda as **migrations reais**, não
um schema paralelo escrito para o teste — assim ele também protege contra
migration quebrada. Optamos por não usar dublê do driver: idempotência de
upsert, precisão de `NUMERIC` e recorte por janela são comportamento do banco,
e um dublê provaria apenas que escrevemos a string SQL que imaginamos escrever.

---

## Rodar o frontend em desenvolvimento

O Compose já publica o painel em http://localhost:5173, servido por nginx. Esta
seção é para desenvolver com recarga automática.

Com a API já no ar pelo Compose:

```bash
npm run dev --workspace @pulse-fx/web
```

Abre em **http://localhost:5174** (o Vite escolhe outra porta se a 5173 estiver
ocupada pelo container). O Vite faz proxy de `/api` para a porta 3333,
mantendo a mesma origem no navegador — o que faz o cookie de sessão funcionar
sem afrouxar `SameSite`. Afrouxar seria trocar segurança por conveniência de
desenvolvimento.

---

## Indicadores escolhidos e por quê

Os identificadores foram **confirmados contra as APIs reais** em 28/08/2026, não
copiados de documentação de terceiros.

A tese que amarra a seleção: **o real se move pelo diferencial de juros e
inflação entre Brasil e Estados Unidos.** Cada indicador existe para sustentar
essa leitura; nenhum está no painel por ser fácil de buscar.

### Câmbio

**Dólar americano, venda** — BCB/SGS série `1`
Taxa de referência oficial do Banco Central. É o primeiro número que o usuário
brasileiro procura e a âncora de todo o resto do painel: viagem, importação e
preço de combustível passam por ela. Serve de base para ler o diferencial de
juros como causa, e não como curiosidade.

**Euro, venda** — BCB/SGS série `21619`
Segunda moeda mais relevante para quem viaja ou importa. Existe no painel para
mostrar que a variação do real nem sempre é um fenômeno do dólar: quando as duas
se movem juntas, a origem é o real; quando divergem, a origem está no exterior.

### Juros

**Selic meta** — BCB/SGS série `432`
Preço do dinheiro no Brasil, definido pelo Copom. Junto com a taxa americana
forma o diferencial de juros que explica boa parte do fluxo cambial: juro maior
aqui tende a atrair capital e valorizar o real.

**Federal Funds Effective Rate** — FRED `DFF`
Contraparte americana da Selic. O diferencial entre as duas é a leitura macro
central do produto: quando o Fed sobe juros, ativos em dólar ficam mais
atraentes e moedas emergentes tendem a sofrer pressão.

**Treasury 10 anos** — FRED `DGS10`
Juro longo dos Estados Unidos e termômetro de apetite global a risco. Alta
sustentada costuma coincidir com saída de capital de mercados emergentes e
pressão sobre o real, mesmo sem qualquer mudança no Brasil.

### Inflação

**IPCA** — BCB/SGS série `433`
Inflação oficial ao consumidor no Brasil. Contextualiza a Selic — juro alto
costuma ser resposta a inflação alta — e traduz câmbio em poder de compra, que é
o que o usuário sente no orçamento.

**Índice de preços ao consumidor dos EUA** — FRED `CPIAUCSL`
Inflação americana, que orienta a trajetória do Fed e, por consequência, a
pressão sobre o real. Fecha o quadrilátero do produto: inflação e juro de cada
lado do câmbio.

### Documentação das fontes

- [BCB — Dados Abertos](https://dadosabertos.bcb.gov.br/)
- [BCB — SGS, séries temporais](https://www3.bcb.gov.br/sgspub/)
- [FRED — documentação da API](https://fred.stlouisfed.org/docs/api/fred/)

---

## Regra de variação percentual

Esta é a decisão de negócio central do produto, e o briefing pede que seja
definida, implementada e documentada. A regra vive numa **única função pura de
domínio** (`apps/api/src/domain/variation.ts`), sem dependência de banco ou HTTP,
consumida igualmente pelo dashboard e pela tela de detalhe. O cálculo acontece
sempre no servidor: se o frontend recalculasse, as duas telas poderiam divergir
por arredondamento ou por versão diferente do bundle.

| Tipo de série | Indicadores | Comparação | Unidade |
|---|---|---|---|
| `fx_daily` | Dólar, Euro | Pregão anterior disponível | Porcentagem |
| `policy_rate` | Selic, Fed Funds | **Patamar** anterior | Pontos percentuais |
| `yield_daily` | Treasury 10 anos | Pregão anterior disponível | Pontos percentuais |
| `macro_monthly_index` | US CPI | Mesmo mês do ano anterior | Porcentagem |
| `macro_monthly_rate` | IPCA | Mesmo mês do ano anterior | Pontos percentuais |

### Por que cinco tipos, e não um

**Câmbio varia em porcentagem; juro varia em pontos percentuais.** Dizer que uma
Selic de 10% a.a. que sobe para 11% a.a. "subiu 10%" é enganoso — o mercado lê
essa mudança como +1 p.p. Este é o erro mais comum em painéis financeiros
amadores.

**A Selic compara patamares, não dias.** O BCB publica a série `432` todos os
dias, inclusive sábado e domingo, repetindo o mesmo valor entre reuniões do
Copom. Comparar com "a observação anterior" devolveria variação zero em quase
todo dia do ano — tecnicamente correto e completamente inútil. A estratégia
`last-distinct-value` anda para trás pulando repetições e devolve a última
observação do patamar anterior.

**O Treasury não é patamar, mas também não é preço.** Muda todo pregão, então
compara com o dia anterior — mas é taxa, logo varia em pontos percentuais. Não
cabia em nenhum dos dois tipos anteriores.

**IPCA e US CPI têm naturezas opostas, apesar de ambos serem inflação mensal.**
O `CPIAUCSL` é um número-índice (332,813): a variação interanual em porcentagem
é exatamente a inflação acumulada em 12 meses, que é a leitura certa. A série
`433` do SGS **já é a variação percentual do mês** (0,07%): calcular a variação
percentual de uma taxa percentual produz um número sem significado. Veja
[O que aprendemos rodando com dados reais](#o-que-aprendemos-rodando-com-dados-reais).

### Tratamento de fins de semana, feriados e lacunas

**Sem interpolação.** Interpolar série financeira inventa um preço que nunca
existiu, e num produto que se propõe informativo isso é pior que admitir a
lacuna.

Séries diárias andam **N observações para trás**, não N dias de calendário. Como
as fontes só publicam em dia útil, andar por observações resolve fim de semana,
feriado e atraso de publicação sem depender de calendário de feriados — que
difere entre Brasil e Estados Unidos e seria uma fonte silenciosa de erro.

Séries mensais **ancoram no calendário**, procurando a observação de N meses
antes. A posição no array não garantiria a distância temporal se houvesse mês
sem publicação.

Quando não existe base de comparação na janela, a resposta devolve o **motivo**
(`no_observations`, `no_baseline` ou `zero_baseline`) e a interface explica em
texto, em vez de exibir um zero que o usuário leria como estabilidade.

### Data de referência e defasagem

A interface mostra sempre a **data da observação**, nunca a hora da consulta.
Quando a observação mais recente fica mais velha do que o esperado para a
periodicidade da série, o card sinaliza defasagem: 4 dias para séries diárias,
70 dias para mensais.

O limiar mensal é generoso por um motivo aritmético: a série é datada no
primeiro dia do mês, então já nasce com até 31 dias de idade quando o mês fecha,
e a publicação leva mais duas a três semanas. Um alarme que dispara em operação
normal deixa de ser informação e vira ruído que o usuário aprende a ignorar.

---

## Janela de histórico

A tela de detalhe aceita `30d`, `90d` (padrão), `1y` e `5y`.

O servidor busca o **maior** valor entre a janela pedida e o mínimo que o
cálculo exige — 120 dias para séries diárias, 500 para mensais. Sem isso, pedir
30 dias numa série mensal deixaria a variação interanual indisponível apenas por
efeito da escolha de visualização. O gráfico exibe só a janela pedida; o cálculo
enxerga o que precisa.

---

## Política de sincronização

O briefing pede uma política clara que evite chamadas descontroladas ou
redundantes às APIs externas. São quatro camadas, da mais barata para a mais
cara:

**1. TTL por periodicidade.** Duas horas para séries diárias, doze para mensais.
O TTL sai da frequência declarada da série, não de um número mágico global:
buscar o IPCA de dois em dois minutos seria desperdício puro.

**2. Circuit breaker por fonte.** Três falhas consecutivas abrem o circuito por
cinco minutos. O estado `half_open` deixa passar uma única tentativa de prova,
para que a volta do serviço não traga todas as séries em avalanche. Um breaker
por fonte: o BCB fora do ar não impede a leitura do FRED.

**3. Janela incremental com sobreposição.** Depois da primeira carga, apenas o
intervalo desde a última observação conhecida é pedido — com **5 dias de
sobreposição**. Sem ela, uma revisão da fonte sobre dado já baixado nunca seria
percebida, e o IPCA passa por revisão. Reprocessar é barato porque o upsert é
idempotente.

**4. Backoff exponencial com jitter** no cliente HTTP, apenas em falha
transitória (429, 5xx e erro de rede). Erro 4xx não é retentado: repetir
requisição inválida só queima cota.

A sincronização é **sequencial, não paralela**. Sete séries disparadas de uma vez
contra duas fontes é exatamente o comportamento que o enunciado manda evitar.

Nada disso depende de o usuário abrir a página: a requisição do usuário sempre
lê do banco, o que mantém a latência previsível e desacopla o tempo de resposta
da saúde das fontes externas.

Cada execução fica registrada em `sync_runs`, com origem, contagem de linhas e
erro — o que permite responder "quando este número entrou e de onde veio" sem
depender de log volátil.

Sincronização manual, ignorando o TTL mas **não** o circuit breaker:

```bash
curl -X POST -H "x-admin-token: $ADMIN_SYNC_TOKEN" http://localhost:3333/api/admin/sync
```

---

## Arquitetura

Monorepo com npm workspaces.

```
pulse-fx/
├── apps/
│   ├── api/                  Node 22 + TypeScript + Fastify 5
│   │   └── src/
│   │       ├── domain/       Regra de variação — puro, sem I/O
│   │       ├── application/  Casos de uso, sincronização, circuit breaker
│   │       ├── infra/        Repositórios PostgreSQL, clientes BCB/FRED
│   │       ├── http/         Rotas, sessão, middlewares de segurança
│   │       ├── config.ts     Validação do ambiente
│   │       └── index.ts      Composition root
│   └── web/                  React 19 + TypeScript + Vite + PWA, servido por nginx
│       └── src/
│           ├── components/   Card, badge de variação, gráfico
│           ├── pages/        Dashboard e detalhe
│           └── lib/          Cliente de API e formatação pt-BR
├── packages/
│   └── contracts/            Schemas Zod compartilhados API ↔ web
├── db/
│   ├── migrations/           SQL versionado
│   └── migrate.sh            Aplicador com tabela schema_migrations
├── .github/workflows/ci.yml
└── docker-compose.yml
```

**As dependências apontam para dentro.** O domínio não conhece banco, HTTP nem
framework; a aplicação conhece o domínio; a infraestrutura implementa portas que
a aplicação define. É o que permite testar a regra de variação sem banco, o
serviço de sincronização sem rede e as rotas sem container.

**O pacote `contracts` impede divergência entre API e web.** Um só schema Zod
gera a validação de entrada no servidor e os tipos do cliente. Quebra de
contrato vira erro de compilação, não bug descoberto pelo usuário.

### Modelo de dados

| Tabela | Papel |
|---|---|
| `series` | Catálogo: identificador externo, tipo, unidade, justificativa e limitações |
| `observations` | Série temporal. PK composta `(series_id, reference_date)` |
| `favorites` | Favoritos por sessão anônima |
| `sync_runs` | Auditoria de cada execução de sincronização |
| `schema_migrations` | Controle de migrations aplicadas |

Duas escolhas de tipo que importam:

`value` é **`NUMERIC(20,8)`**, nunca `double precision`. Ponto flutuante binário
não representa `5,1017` exatamente, e erro de arredondamento em dado financeiro
não é aceitável nem num MVP educacional.

`reference_date` é **`DATE`**, não `TIMESTAMP`. A observação pertence a um dia do
calendário civil; carregar fuso horário junto só criaria a chance de a mesma
cotação aparecer em dois dias diferentes.

---

## Segurança

O produto lê dados públicos e não guarda dado pessoal, mas a superfície de
ataque existe e foi tratada. Referências: **OWASP ASVS 5.0**, **OWASP API
Security Top 10**, **CIS Docker Benchmark** e **NIST SSDF**.

### SSRF — a superfície mais relevante aqui

A API consome URLs externas, o que a coloca diretamente nessa classe de risco.
O cliente HTTP (`apps/api/src/infra/http/httpClient.ts`):

- **allowlist de host com comparação exata.** Recusa `api.bcb.gov.br.evil.example`
  e também subdomínio não declarado;
- **somente HTTPS**, bloqueando `file://` e `http://`;
- **`redirect: 'error'`** — um 302 para `169.254.169.254`, endpoint de metadados
  de instância em nuvem, é o caminho clássico de escalada para credenciais
  temporárias da role;
- **teto de tamanho de resposta** e timeout obrigatório;
- **mensagem de erro de rede reescrita**, porque o texto original do `fetch`
  carrega a URL completa — e a URL do FRED contém a chave de API.

### Camada HTTP

- Helmet com CSP `default-src 'none'`: a API só devolve JSON, nada ali deve ser
  executado como página;
- CORS por allowlist explícita, nunca curinga;
- rate limit global e um **bem mais apertado** no endpoint administrativo, porque
  cada chamada dele dispara requisições às fontes externas — deixá-lo aberto
  transformaria a API num amplificador de tráfego contra o BCB e o FRED;
- token administrativo comparado em **tempo constante**: `===` vaza informação
  por tempo de execução, já que a comparação de strings termina no primeiro
  caractere diferente;
- token ausente e token errado devolvem a mesma resposta, sem confirmar sequer
  a existência do header;
- erro interno devolve código genérico com `requestId`; stack trace e mensagem
  do driver ficam apenas no log, com cookie e token redigidos;
- **`TRUST_PROXY` é `false` por padrão e não é derivado de `NODE_ENV`.** Confiar
  em `X-Forwarded-For` sem um proxy confiável à frente permite que qualquer
  cliente forje o próprio IP — e, como o rate limit é contado por IP, ele deixa
  de existir. Esta foi uma vulnerabilidade real encontrada na revisão do código
  e corrigida: veja a seção de correções no
  [CHANGELOG](CHANGELOG.md).

### Sessão e privacidade

Favoritos são persistidos contra um **identificador opaco de sessão**, gerado no
servidor, em cookie `httpOnly` com `SameSite=Lax` e prefixo `__Host-` em
produção — que é instrução ao navegador, não convenção de nome: ele só aceita o
cookie com `Secure`, `Path=/` e sem `Domain`, o que impede um subdomínio
comprometido de sobrescrever a sessão.

Não há cadastro, e-mail ou rastreio. **O que não se coleta não vaza** — princípio
de minimização da LGPD, e coerente com o briefing, que coloca KYC fora de
escopo. O cookie recebido é validado como UUID: sem isso, conteúdo arbitrário do
cliente viraria chave de consulta ao banco.

### Container

Build multi-stage, imagem final sem `node_modules`, sem código-fonte e sem
ferramenta de build. Processo roda como usuário `node`, com `cap_drop: ALL`,
`no-new-privileges`, sistema de arquivos somente leitura e `tmpfs` em `/tmp`. A
porta do PostgreSQL não é exposta ao host. O `.dockerignore` mantém o `.env`
fora do contexto de build.

### Pipeline

O CI falha em: lint, tipos, formatação, testes, `npm audit` a partir de
severidade moderada, varredura de segredos no **histórico completo** do Git
(um segredo removido no último commit continua recuperável nos anteriores),
scan da imagem com Trivy em `HIGH` e `CRITICAL`, verificação de que a imagem não
roda como root e de que não carrega `.env`.

O gate de audit não é decorativo: durante o desenvolvimento ele acusou uma
vulnerabilidade **crítica** na cadeia `vitest → vite → esbuild`, corrigida no
commit `8bcdd97`.

---

## Acessibilidade

Meta: **WCAG 2.2 nível AA**, tratada como requisito e não como acabamento.

- **Variação nunca depende de cor.** Três canais independentes comunicam a mesma
  informação: cor, seta e sinal numérico. Nenhum é indispensável, então alguém
  com deuteranopia lê o painel sem esforço.
- **Leitor de tela recebe a frase inteira** — "alta de 0,70% vs. pregão anterior"
  — e não o número solto, que perderia direção e referência.
- **O gráfico tem alternativa textual real:** a tabela completa de observações,
  não apenas um rótulo dizendo "gráfico".
- Foco sempre visível, alvos de toque de 44 px, link para pular ao conteúdo,
  `aria-pressed` no botão de favorito, marcos semânticos e contraste mínimo de
  4,5:1 nos dois temas.
- `prefers-reduced-motion` desliga o movimento **por completo**, não pela metade.

---

## Decisões e trade-offs

**Cálculo no servidor, não no cliente.** Custa uma ida ao servidor a cada
mudança de janela, mas garante que dashboard e detalhe nunca divirjam — que é
exatamente o que o briefing pede.

**Gráfico em SVG próprio, sem biblioteca.** Para uma linha única, uma dependência
de centenas de kilobytes traria mais superfície de manutenção e de segurança do
que valor. O custo é não ter tooltip interativo nem zoom, o que é aceitável no
escopo de um MVP.

**Agendador com `setInterval`, não biblioteca de cron.** A necessidade é "a cada
N minutos", não expressão de calendário. Cada dependência a mais é superfície de
ataque e uma linha a mais no relatório de audit. O trade-off é não suportar
agendamento por horário fixo, o que não é requisito.

**Empacotamento com esbuild em vez de `tsc` para produção.** Os imports do
projeto são extensionless e o Node em ESM exige extensão em runtime; o bundler
resolve isso e ainda dispensa `node_modules` na imagem final. O `tsc` continua
rodando com `--noEmit` como gate de tipos no build.

**Service worker não faz cache de dados.** Decisão de domínio, não técnica: num
painel financeiro, servir cotação de cache é pior do que não servir nada, porque
transforma uma falha de rede *visível* numa informação errada *silenciosa*.
`/api` nunca é interceptado. O cache cobre só a casca do aplicativo.

**Sessão anônima em vez de login.** O briefing coloca KYC fora de escopo e não
pede autenticação. Um login completo adicionaria dado pessoal, superfície de
ataque e tempo, sem servir a nenhum requisito. O trade-off é que os favoritos
vivem no navegador: limpar cookies perde a lista, e não há sincronização entre
dispositivos.

**Migrations em serviço próprio do Compose, não no boot da API.** Aplicar schema
no boot da aplicação significa que N réplicas tentam migrar ao mesmo tempo.

**Sincronização sequencial.** Mais lenta que paralela, mas é o que evita
martelar duas APIs públicas com sete requisições simultâneas.

---

## O que aprendemos rodando com dados reais

Vale registrar, porque explica decisões que de outro modo pareceriam arbitrárias.
**Todos os problemas abaixo passaram despercebidos por uma suíte de testes que
estava correta e verde** — os testes usavam dados construídos por nós, e a
realidade tinha outra forma.

**O caminho `/dados/ultimos/N` do SGS não existe.** Devolve uma página HTML de
"Requisição inválida", não JSON. Só o intervalo de datas funciona, e as datas
vão e voltam em `dd/MM/yyyy`.

**A Selic meta é publicada todos os dias**, inclusive fim de semana. A regra
original de comparação teria exibido variação zero em quase todo dia do ano.

**O FRED devolve `"."` no lugar do valor em feriado americano.** Lido como
número, viraria zero — um Treasury de 0% e uma variação absurda no painel.

**O SGS levou 14,4 segundos** numa consulta de 20 observações. O timeout de 8
segundos, que parecia generoso no papel, teria reprovado chamadas legítimas e
aberto o circuit breaker sem a fonte estar fora do ar.

**O card do IPCA exibia "−73,08%"**, comparando 0,07% de julho/2026 com 0,26% de
julho/2025 — a variação percentual de uma taxa percentual. Foi o que motivou
separar `macro_monthly` em índice e taxa.

**IPCA e CPI apareciam marcados como defasados em operação normal**, porque o
limiar de 45 dias ignorava que a série é datada no dia 1º e a publicação leva
semanas.

**O driver `pg` entrega `NUMERIC` como string**, de propósito, porque o tipo tem
alcance maior que o `double` do JavaScript — e devolve `DATE` à meia-noite UTC,
o que, formatado em horário local, jogaria a cotação de 28/08 para 27/08 no
Brasil.

---

## Rotas da API

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Saúde do serviço. **503** quando o banco está fora |
| `GET` | `/api/indicators` | Lista para o dashboard, com variação já calculada |
| `GET` | `/api/indicators/:id` | Detalhe com histórico. Query `window`: `30d`, `90d`, `1y`, `5y` |
| `GET` | `/api/favorites` | Favoritos da sessão |
| `POST` | `/api/favorites` | Adiciona favorito. Corpo: `{ "seriesId": "usd-brl" }` |
| `DELETE` | `/api/favorites/:id` | Remove favorito |
| `POST` | `/api/admin/sync` | Sincronização manual. Header `x-admin-token` |

IDs válidos: `usd-brl`, `eur-brl`, `selic-meta`, `ipca-mensal`, `fed-funds`,
`us-cpi`, `ust-10y`.

As rotas de favoritos dependem do cookie de sessão. Ao testar com `curl`, use
`-c` e `-b` — sem isso cada chamada vira uma sessão nova e a lista sempre volta
vazia:

```bash
curl -s -c cookies.txt -b cookies.txt -X POST -H "content-type: application/json" -d '{"seriesId":"usd-brl"}' http://localhost:3333/api/favorites
```

---

## Limitações conhecidas

Honestidade sobre o que **não** está resolvido:

- **Favoritos vivem no navegador.** Limpar cookies perde a lista, e não há
  sincronização entre dispositivos. É a consequência aceita de não ter cadastro.
- **O TTL de sincronização é mantido em memória do processo.** Com mais de uma
  réplica, cada uma teria seu próprio controle e a fonte receberia mais chamadas
  do que o previsto. Em produção com escala horizontal, isso migraria para o
  banco ou um cache compartilhado.
- **Sem paginação no histórico.** A janela de 5 anos numa série diária traz cerca
  de 1.250 pontos num único payload. Funciona bem nessa ordem de grandeza, mas
  não escalaria para séries intradiárias.
- **O gráfico não tem interação.** Sem tooltip por ponto nem zoom.
- **O `index.ts` não tem teste próprio.** É o composition root: monta as peças
  e sobe o processo. A lógica que valeria testar foi movida para
  `application/startup.ts`, que tem cobertura. O que resta ali é fiação,
  exercitada de ponta a ponta pelo job de Compose no CI.
- **Sem deploy real.** O pipeline constrói, testa e escaneia a imagem, mas não
  publica em registro nem provisiona infraestrutura.
- **Uma única instância, sem observabilidade além de log estruturado.** Sem
  métricas, tracing distribuído ou alertas.

---

## Licença e uso

Projeto criado para um desafio técnico. **Pulse FX** é nome de uso exclusivo
neste contexto, sem finalidade comercial. Os dados pertencem ao Banco Central do
Brasil e ao Federal Reserve Bank de St. Louis, e estão sujeitos aos termos de uso
de cada fonte.
