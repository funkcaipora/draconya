# 0009 — Rota fixa sem pathfinding na hunt

**Status:** aceito
**Data:** 2026-09-07
**Contexto técnico:** `sim/`, `content/hunts/`

## Contexto

Pathfinding recalculado em massa é uma preocupação natural em jogos de grade quando algo bloqueia
caminho, como um campo mágico: a princípio, isso invalidaria os caminhos calculados de todas as
entidades que perseguem. O PRD (§14.4) decide que cada hunt tem uma rota fixa e predeterminada, o
que é registrado como uma das decisões de produto que eliminam subsistemas inteiros: a hunt não
precisa de pathfinding, porque a rota já é dado — uma lista ordenada de tiles — e não um problema
de busca.

Isso só resolve o percurso da hunt em si; falta o movimento dos monstros perseguindo alvos dentro
dela. A resposta usada é o mesmo comportamento do Tibia: passo guloso, O(1) por monstro por tick,
sem A*.

## Decisão

Cada hunt executa uma rota fixa e predeterminada — lista ordenada de tiles com pontos de spawn
associados. Monstros dentro da hunt se movem por passo guloso: tentam o tile que aproxima do
alvo, se bloqueado tentam um adjacente, senão esperam. Nenhum dos dois usa A*.

## Alternativas

- Pathfinding real (A*) para o percurso da hunt, recalculado conforme o mapa muda — descartada: a
  rota é dado conhecido de antemão, não um problema de busca a resolver em tempo real.
- A* também para os monstros perseguindo alvos — descartada em favor do passo guloso, que é o
  comportamento reconhecido do gênero e custa O(1) por monstro por tick, contra o custo maior (e
  a necessidade de invalidação) de manter um caminho calculado.
- Recalcular caminhos de todas as entidades quando um campo bloqueante aparece — não se aplica:
  como o monstro de passo guloso nunca guarda caminho, não existe nada para invalidar.

## Consequências

- O custo de pathfinding na hunt cai a praticamente zero, e campos mágicos bloqueantes têm custo
  de invalidação zero — o monstro reavalia o próximo tile a cada passo de qualquer forma, a
  parede é só mais um tile bloqueado.
- O custo de perseguição em geral fica proporcional ao número de entidades que perseguem, não ao
  número de obstáculos — o que barateia campos bloqueantes como mecânica em qualquer instância,
  não só na hunt.
- Em troca, a hunt perde flexibilidade de percurso: não há exploração livre, desvio dinâmico de
  rota ou hunts com layout gerado — mudar o trajeto de uma hunt é tarefa de conteúdo (editar a
  lista de tiles), não capacidade do motor.
- O motor de simulação precisa manter duas abordagens de movimento em paralelo: rota fixa mais
  passo guloso para hunt e monstros, e A* pontual para o clique-para-andar do jogador em quest e
  na cidade — não existe um único sistema de pathfinding genérico cobrindo tudo.
- Rota dinâmica ou perseguição mais sofisticada de monstro, se vierem a ser pedidas, não são
  ajuste de parâmetro: exigem revisitar esta decisão.

## Invariantes afetados

Nenhum. Os onze invariantes de `harness-plan.md` não tratam de pathfinding ou movimento de
monstro; esta decisão opera inteiramente dentro deles (a lógica permanece em `sim/`, os dados de
rota vêm de `content/`), sem alterar nenhum.
