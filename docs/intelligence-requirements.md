# Draconya --- Requisitos da Camada de Inteligência e Analytics

> Status: documento inicial consolidado a partir das decisões
> confirmadas na descoberta.\
> Regra: itens não confirmados permanecem explicitamente marcados como
> pendentes ou sugestões e não devem ser tratados como decisões de
> implementação.

## 1. Visão geral

O Draconya é um jogo online de idle desenvolvido em um monorepo
TypeScript existente.

Será adicionada ao ecossistema uma camada de inteligência baseada em IA
para permitir análise do conhecimento técnico do projeto e análise dos
dados gerados pelo jogo.

Essa camada deverá permanecer dentro do monorepo existente e utilizar
Mastra como framework de agentes/orquestração em TypeScript.

## 2. Objetivo

Permitir que IA consulte e analise diferentes fontes de conhecimento do
Draconya para responder perguntas fundamentadas sobre:

-   código e arquitetura do projeto;
-   documentação técnica;
-   ADRs;
-   regras e documentação do jogo;
-   code review;
-   logs;
-   métricas operacionais;
-   login e performance;
-   economia do jogo;
-   itens vendidos;
-   dano por classe/vocação;
-   impacto observado após mudanças de balanceamento;
-   demais dados do jogo que forem disponibilizados à camada analítica.

## 3. Problema de negócio

Atualmente, conhecimento técnico e dados operacionais do jogo estão
distribuídos entre código, documentação, banco operacional, logs e
métricas.

O objetivo da nova camada é permitir consultas assistidas por IA sobre
essas informações sem exigir análise manual de cada fonte.

Também existe a necessidade de analisar historicamente o comportamento
do jogo e comparar resultados antes e depois de alterações.

## 4. Escopo confirmado

### 4.1 Repository Intelligence

Criar capacidade de IA para consultar conhecimento existente no
repositório.

Fontes atualmente existentes incluem:

-   código-fonte;
-   `CLAUDE.md`;
-   `AGENTS.md`;
-   documentação de arquitetura;
-   ADRs;
-   documentação de produto e regras do jogo.

A solução deverá permitir retrieval/indexação desse conhecimento para
uso por agentes.

Um dos casos de uso confirmados é code review assistido por IA
considerando o contexto e as decisões existentes no projeto.

### 4.2 Game Intelligence

Criar capacidade de IA para consultar e interpretar dados do jogo.

Casos de uso confirmados incluem:

-   análise de logs;
-   análise de tempo de login;
-   análise de itens mais vendidos;
-   análise de dano;
-   comparação por classe/vocação;
-   comparação de resultados antes e depois de alterações;
-   análise de economia;
-   perguntas gerais sobre dados disponibilizados pelo jogo.

### 4.3 Ingestão orientada a eventos

Foi definida a preferência por uma arquitetura orientada a eventos para
alimentar a camada analítica, evitando depender primariamente de ETLs
pesados executados periodicamente contra o banco operacional.

A aplicação do jogo poderá produzir eventos relevantes e esses eventos
poderão alimentar a camada analítica.

Deverá existir uma forma de determinar quais eventos são destinados à
análise, evitando enviar indiscriminadamente todos os eventos/logs.

O mecanismo exato de mensageria ainda não foi escolhido.

## 5. Fora de escopo

### 5.1 Simulação automática de balanceamento

Não faz parte do escopo inicial permitir que o agente execute
automaticamente o `sim` para realizar experimentos de balanceamento.

Quando necessário, dados sintéticos poderão ser gerados a partir de
dados históricos e utilizados em staging.

## 6. Usuários e atores envolvidos

### Confirmado

Ainda não foram definidos formalmente os diferentes perfis de usuário da
nova aplicação.

### Pendente

Definir quem poderá utilizar:

-   consultas sobre código;
-   code review;
-   consultas analíticas;
-   dados de produção;
-   dados de staging.

## 7. Stack e tecnologias confirmadas

### Nova camada

-   TypeScript;
-   Node.js;
-   Mastra;
-   monorepo existente do Draconya.

### Tecnologias já existentes no projeto analisado

-   pnpm workspaces;
-   PostgreSQL;
-   Drizzle ORM;
-   Redis / ioredis;
-   Pino;
-   Prometheus;
-   Fastify;
-   uWebSockets.js;
-   Zod;
-   Vitest;
-   React;
-   PixiJS.

A existência dessas tecnologias no projeto não implica automaticamente
que todas serão utilizadas pela nova camada.

## 8. Arquitetura proposta

### Conceito confirmado

A solução será mantida no mesmo monorepo.

Conceitualmente existem dois tipos diferentes de conhecimento:

``` text
                         Mastra
                           |
              +------------+------------+
              |                         |
    Repository Intelligence      Game Intelligence
              |                         |
       código / docs / ADRs       dados estruturados
              |                         |
         retrieval / RAG        consultas / analytics
```

### Pendente de confirmação

Ainda precisa ser definido:

-   nome do novo package;
-   boundaries de imports;
-   se haverá um ou mais processos/runtime;
-   mecanismo de mensageria;
-   banco analítico;
-   banco vetorial;
-   estratégia de embeddings;
-   modelo/LLM;
-   provider de IA.

## 9. Possibilidades AI native consideradas

### Confirmadas

#### Agente de conhecimento do repositório

O agente deverá recuperar contexto relevante do repositório para
responder perguntas fundamentadas sobre código, documentação e
arquitetura.

#### Code review contextual

A IA poderá analisar mudanças considerando conhecimento recuperado do
projeto, incluindo ADRs e documentação técnica.

#### Agente analítico

A IA deverá interpretar perguntas em linguagem natural e utilizar
ferramentas para consultar dados reais antes de responder.

### Fora do escopo inicial

Execução automática do simulador para experimentação de balanceamento.

## 10. Decisões arquiteturais confirmadas

1.  A solução será implementada em TypeScript.
2.  Mastra será utilizado para agentes/orquestração.
3.  A solução permanecerá no monorepo do Draconya.
4.  Conhecimento documental/código será disponibilizado aos agentes
    através de mecanismo de retrieval/RAG.
5.  Dados do jogo deverão ser analisados a partir de fontes estruturadas
    e/ou observabilidade, não apenas por RAG.
6.  A ingestão analítica deverá privilegiar propagação orientada a
    eventos em vez de consultas batch pesadas recorrentes contra o banco
    operacional.
7.  Nem todo evento/log precisa ser enviado para analytics; deverá
    existir seleção/categorização.
8.  Simulação automática de balanceamento pelo agente está fora do
    escopo inicial.
9.  A solução deverá poder ser containerizada com Docker.
10. A infraestrutura deverá ser compatível com deploy no ambiente
    atualmente operado via Coolify.

## 11. Componentes e responsabilidades

### Componentes conceituais confirmados

#### Repository Knowledge

Responsável por disponibilizar conhecimento do repositório para
retrieval.

#### Game Analytics

Responsável por disponibilizar dados estruturados do jogo para análise.

#### Mastra

Responsável pela camada de agentes/orquestração e uso das ferramentas
disponibilizadas pela aplicação.

### Componentes ainda não escolhidos

-   event broker;
-   vector store;
-   armazenamento analítico;
-   scheduler;
-   serviço de embeddings;
-   provider/modelo de IA.

## 12. Fluxos principais

### 12.1 Pergunta sobre o repositório

``` text
Usuário
  |
  v
Agente Mastra
  |
  v
Retrieval de contexto
  |
  +--> código
  +--> documentação
  +--> ADRs
  +--> regras do projeto
  |
  v
LLM
  |
  v
Resposta fundamentada
```

### 12.2 Pergunta analítica

``` text
Usuário
  |
  v
Agente Mastra
  |
  v
Identificação da intenção
  |
  v
Tool de consulta
  |
  v
Base analítica / métricas / dados disponíveis
  |
  v
Resultado estruturado
  |
  v
LLM interpreta
  |
  v
Resposta
```

### 12.3 Ingestão de eventos

``` text
Aplicação do jogo
      |
      v
Evento
      |
      v
Seleção / classificação
      |
      +------> fluxo operacional existente
      |
      +------> pipeline analítico
                    |
                    v
             armazenamento analítico
```

O desenho acima é conceitual. O broker e a implementação exata ainda não
estão definidos.

## 13. Modelo de dados

### Existente

O projeto atual possui PostgreSQL e entidades operacionais já
implementadas, incluindo dados relacionados a contas, personagens, itens
e ledger.

### Pendente

O modelo analítico ainda precisa ser projetado.

Não está definido se será utilizado:

-   schema separado;
-   database PostgreSQL separado;
-   instância PostgreSQL separada;
-   Supabase;
-   outro armazenamento.

Também não foi definido o schema dos eventos analíticos.

## 14. Integrações externas

### Confirmadas

Nenhuma nova integração externa foi definitivamente escolhida.

### Consideradas, mas não confirmadas

-   Supabase;
-   Railway;
-   VPS;
-   infraestrutura gerenciada por Coolify.

Coolify já faz parte do contexto atual de infraestrutura
informado/analisado e a nova solução deverá ser compatível com esse
modelo de deploy.

## 15. Requisitos não funcionais

### Confirmado

A ingestão analítica não deve depender de consultas pesadas recorrentes
que possam causar carga desnecessária no banco operacional.

### Pendente

Definir:

-   volume esperado de eventos;
-   retenção;
-   latência aceitável;
-   disponibilidade;
-   SLA;
-   limites de custo;
-   escalabilidade;
-   política de retry;
-   idempotência;
-   tratamento de eventos duplicados;
-   disaster recovery.

## 16. Segurança e permissões

Pendente de definição.

Será necessário decidir posteriormente:

-   autenticação;
-   autorização;
-   acesso a dados de produção;
-   segregação entre staging e produção;
-   acesso dos agentes às ferramentas;
-   proteção contra execução de consultas indevidas;
-   tratamento de informações sensíveis.

Nenhuma tecnologia de autenticação/autorização foi escolhida para essa
camada.

## 17. Observabilidade e monitoramento

### Existente no projeto

O projeto já utiliza:

-   Pino para logs estruturados;
-   Prometheus para métricas.

### Pendente

Definir como a nova camada será observada, incluindo:

-   execução de agentes;
-   tool calls;
-   erros de retrieval;
-   ingestão de eventos;
-   falhas do pipeline;
-   custo de modelos;
-   tokens;
-   latência;
-   qualidade das respostas.

Nenhuma solução adicional foi confirmada.

## 18. Estratégia de testes

Pendente de definição.

Deverão ser discutidos separadamente testes para:

-   pipeline;
-   eventos;
-   retrieval;
-   tools;
-   agentes;
-   respostas analíticas;
-   code review.

Nenhuma estratégia foi confirmada ainda.

## 19. Estratégia de deploy

### Confirmado

A solução deverá poder rodar utilizando Docker e ser compatível com a
infraestrutura baseada em Coolify já utilizada pela aplicação.

### Pendente

Definir:

-   quantidade de containers;
-   processos independentes;
-   recursos de CPU/RAM;
-   banco analítico;
-   event broker;
-   ambientes;
-   estratégia de migrations;
-   CI/CD.

## 20. Riscos

### Identificados, ainda não transformados em decisões

-   aumento do volume de eventos;
-   armazenamento analítico crescente;
-   respostas incorretas do LLM;
-   retrieval de contexto incorreto;
-   consultas analíticas potencialmente caras;
-   acesso indevido a dados;
-   duplicação/perda de eventos;
-   acoplamento da camada de analytics ao runtime do jogo.

As estratégias de mitigação ainda precisam ser definidas.

## 21. Pontos em aberto

-   nome e localização exata do package;
-   event broker;
-   formato/schema dos eventos;
-   quais eventos serão enviados;
-   banco analítico;
-   vector store;
-   embeddings;
-   estratégia de chunking;
-   modelo de IA;
-   provider de IA;
-   autenticação;
-   autorização;
-   interface da aplicação;
-   execução automática de code review;
-   integração com Git;
-   frequência/latência da ingestão;
-   retenção dos dados;
-   observabilidade da IA;
-   limites de custo.

## 22. Decisões pendentes de confirmação

### Event broker

Ainda não escolhido.

Possíveis alternativas só deverão ser avaliadas antes da decisão final.

### Banco analítico

Ainda não escolhido.

Foi discutida a possibilidade de PostgreSQL/Supabase, mas ela não foi
registrada como decisão.

### Vector store

Ainda não escolhido.

A possibilidade de utilizar PostgreSQL com extensão vetorial foi
levantada, mas não está confirmada.

### Infraestrutura

Docker + compatibilidade com Coolify estão confirmados.

Railway, Supabase ou VPS dedicada foram discutidos como possibilidades,
mas não foram definidos como destino obrigatório.

## 23. Próximos passos para implementação no Cursor

Antes de gerar instruções de implementação, devem ser fechadas as
decisões pendentes.

A próxima etapa de descoberta deve definir, nesta ordem:

1.  contrato dos eventos analíticos;
2.  mecanismo de mensageria;
3.  armazenamento analítico;
4.  estratégia de RAG e vector store;
5.  provider/modelo de IA;
6.  boundaries do novo package no monorepo;
7.  tools disponíveis aos agentes;
8.  autenticação e permissões;
9.  observabilidade;
10. deploy dos componentes.

Somente após essas decisões serem explicitamente confirmadas este
documento deve ser transformado em plano de implementação para Cursor.
