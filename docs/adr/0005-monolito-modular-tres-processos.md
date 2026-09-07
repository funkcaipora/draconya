# 0005 — Monólito modular com três processos

**Status:** aceito
**Data:** 2026-09-07
**Contexto técnico:** `server` (`api`, `game`, `jobs`), Postgres, Redis

## Contexto

O jogo precisa de três naturezas de processo muito diferentes: HTTP sem estado (auth, contas,
personagens, tickets, market, pagamentos, admin), simulação com estado quente de sessão (a
caçada e os demais rulesets) e tarefas agendadas (Guild War diária, expirações, matchmaking,
reconciliação de pagamento). Microserviços por domínio, nesta fase, adicionariam latência de rede
entre componentes e overhead operacional sem resolver nenhum problema real que o projeto já
tenha.

O cenário de referência revisado com os números do PRD — 20 mil contas ativas, até 40 mil
personagens em sessão, 12 mil conexões simultâneas — projeta um total de 10 a 20 cores de
simulação, cabendo em duas ou três máquinas de aplicação mais Postgres e Redis gerenciados. Não
há, hoje, escala que justifique a complexidade operacional de serviços distribuídos.

## Decisão

Adotar monólito modular com três tipos de processo, separados por fronteira de código, não por
serviço de rede: `api` (stateless, N réplicas), `game` (stateful, N réplicas — hospeda sessões via
WebSocket, é onde a simulação roda) e `jobs` (singleton com lock). Postgres para verdade durável,
Redis para diretório de sessões, leases, filas e snapshots quentes. O cliente pede um ticket de
vida curta e uso único ao `api`, que consulta o diretório e devolve `{ticket, wsUrl}` do nó
`game` correto.

## Alternativas

- Microserviços por domínio — descartada nesta fase pelo custo de latência e operação sem
  benefício correspondente; a separação por fronteira de código já permite migrar para serviços
  depois, se necessário.
- Go como linguagem de servidor — descartada por perder o maior ganho prático identificado: o
  protocolo compartilhado em TypeScript entre cliente e servidor.
- Elixir/BEAM, cujo modelo de processos isolados combina naturalmente com "milhares de instâncias
  independentes" — descartada por simulação numérica mais lenta, comunidade menor e nenhum tipo
  compartilhado com o cliente.
- Rust, pelo teto de desempenho sem GC — descartada por velocidade de desenvolvimento muito
  menor, inadequada para a fase de descobrir o jogo.

## Consequências

- `api` sem estado escala horizontalmente de forma trivial; `game` com estado exige diretório de
  sessões em Redis para saber qual nó tem qual personagem; `jobs` como singleton exige lock
  distribuído para não duplicar agendamento.
- O roteamento fica mais indireto: toda conexão passa por pedir um ticket antes de abrir o
  WebSocket, uma etapa a mais do que conectar direto.
- Migrar um módulo para serviço próprio no futuro depende inteiramente de as fronteiras de código
  terem sido respeitadas desde o início — se `game` e `api` compartilharem estado por atalho, a
  divisão vira só cosmética.
- O processo `game` concentra risco de desempenho: cada processo roda essencialmente numa thread,
  então simulação pesada ainda exige dividir em vários processos `game`, não apenas subir
  réplicas ingenuamente.
- Se o custo de CPU virar gargalo medido, o núcleo de simulação pode ser reescrito em linguagem
  diferente sem tocar no protocolo nem no cliente — mas só porque a simulação é mantida pura e
  isolada de I/O desde o início.

## Invariantes afetados

9 (estado quente só é escrito pela sessão dona — a separação de processos torna isso também uma
fronteira física, já que `api` não tem acesso ao estado quente do `game`).
