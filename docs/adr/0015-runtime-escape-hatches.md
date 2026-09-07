# 0015 — Rotas de fuga de runtime: Rust no núcleo, Bun no resto

**Status:** aceito
**Data:** 2026-09-07
**Contexto técnico:** `sim`, `server`, e a medição da FUN-46

## Contexto

A pergunta "não vale mudar tudo para Bun?" apareceu, e vai aparecer de novo. Junto com ela
vem a outra, já registrada no [ADR 0005](0005-three-process-modular-monolith.md): levar o
núcleo de simulação para uma linguagem mais rápida.

As duas são legítimas, e nenhuma deve ser decidida por entusiasmo nem re-litigada a cada
mês. Este ADR registra que ambas continuam **disponíveis**, sob que condição cada uma vale, e
por que nenhuma vale hoje.

O contexto que importa: o `game` segura milhares de sessões em memória e precisa rodar por
dias **sem ninguém olhando** ([ADR 0001](0001-session-decoupled-from-connection.md)). Trocar
runtime nesse processo é apostar maturidade exatamente onde o produto não pode apostar.

## Decisão

**Manter Node + uWebSockets.js e a stack do [ADR 0011](0011-library-stack.md).** As duas
rotas de fuga ficam registradas, com gatilho explícito:

### Rota 1 — núcleo de `sim` em Rust ou Go

**Gatilho:** a medição da FUN-46 mostrar custo de tick por instância muito acima da projeção
(50–200 µs), a ponto de o número de máquinas inviabilizar a conta.

**Por que continua disponível:** `sim` é puro por decisão de arquitetura (invariante 1) — sem
I/O, sem framework, sem dependência, sem relógio global. Ele não conhece nem o protocolo nem
o cliente, então pode ser reescrito sem tocar em nenhum dos dois.

**Ordem de tentativas antes de chegar aqui**, da mais barata para a mais cara: baixar mais o
tick desanexado; apertar stamina e sessões por conta; só então trocar de linguagem.

### Rota 2 — Bun no lugar do Node

**Gatilho:** o `uWebSockets.js` virar problema de manutenção — binário faltando para uma
versão de Node, build multi-arquitetura quebrando, ou o projeto parando de ser mantido.

**O que se ganha:** install e teste mais rápidos, TypeScript nativo sem `tsx`, runner
embutido. E o ganho de arquitetura: `Bun.serve` tem WebSocket nativo, o que **eliminaria a
única dependência nativa do projeto** e tornaria o [ADR 0013](0013-multi-architecture-images.md)
quase irrelevante. Na prática a migração seria trocar uWS por `Bun.serve`, não portar o uWS —
o suporte a addon nativo desse porte no Bun é justamente a área frágil.

## Alternativas

- **Migrar para Bun agora** — descartada. O ganho é de conforto de desenvolvimento; o risco
  está em processo stateful de vida longa, comportamento de memória sob carga sustentada e
  camada de compatibilidade. É o eixo exato em que este projeto não pode arriscar.
- **Começar em Rust** — descartada no ADR 0005: velocidade de desenvolvimento errada para a
  fase de descobrir o jogo.
- **Não registrar nada e decidir quando aparecer** — descartada porque a pergunta já se
  repetiu. Sem registro, ela volta como discussão nova a cada vez.

## Consequências

- **Bun não resolve o que a gente teme, e isso é o argumento central.** A projeção diz que o
  gargalo é banda e número de conexões, e o risco de CPU é o custo de tick. Bun é rápido em
  I/O e em startup — nenhum dos dois. Confundir "runtime mais rápido" com "resolve o gargalo"
  é o erro que este ADR existe para evitar.
- As duas rotas ficam abertas **de graça**, porque o preço delas já foi pago pela pureza de
  `sim` e pelo protocolo compartilhado. Nenhum trabalho extra é necessário para mantê-las.
- Toda dependência nova entra com uma pergunta a mais: ela existiria em Bun? Não é veto —
  é para a rota 2 não fechar sozinha sem ninguém decidir.
- **Quem reabrir precisa citar o gatilho.** "Seria mais rápido" não é gatilho; medição da
  FUN-46 e manutenção do uWS são.

## Invariantes afetados

Nenhum. Reforça o 1: `sim/` ser puro é o que mantém a rota 1 aberta, e é o mesmo motivo pelo
qual trocar o runtime do `server` não tocaria na lógica de jogo.
