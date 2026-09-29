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

## Emenda — 2026-09-25 (#527): o FOLLOW do bot pode path-find, limitado — a rota autorada e o
passo guloso de monstro continuam intocados

Uma QA ao vivo com a party de dragões (Knight, Paladin, Sorcerer, Druid, level 200, seguindo o
líder) achou um corredor em U na Darashia Dragon Lair onde o passo guloso do FOLLOW (não da rota
autorada — o seguidor tentando alcançar o líder) nunca resolvia: os três candidatos do guloso
(direção + dois vizinhos, ADR 0009 acima) eram todos parede, mas havia caminho livre saindo pelo
lado OPOSTO, a alguns tiles de distância. O seguidor ficava visivelmente perto do líder (oito
tiles) e nunca andava — só a válvula de reagrupamento do líder (#527, `hunt.ts`) o soltava,
minutos depois.

A decisão original trata pathfinding como desnecessário porque a ROTA já é dado conhecido de
antemão. Isso continua verdade — mas o FOLLOW não segue uma rota autorada: ele persegue um alvo
que se move (o líder, ou outro membro), e não existe lista de tiles nenhuma para consultar. É
mais parecido com a perseguição de monstro (que também usa passo guloso) do que com o percurso da
hunt — só que a analogia quebra num ponto: um monstro empacado numa concavidade é o comportamento
CERTO do Tibia, e "não conserte" continua valendo para ele. Um SEGUIDOR de party empacado do
mesmo jeito é só um defeito — Tibia não tem o conceito de bot seguindo automaticamente, então não
há comportamento de referência a preservar, e travar a party inteira por um detalhe de geometria
do corredor não serve a ninguém.

**Decisão da emenda:** o FOLLOW do bot (`#holdFollow`/`#followStep`, `hunt.ts`) tenta o passo
guloso primeiro — continua sendo o caminho comum, O(1), sem estado — e só depois de
`FOLLOW_PATHFIND_DELAY_MS` (alguns segundos) de bloqueio SEGUIDO recorre a um BFS limitado
(`packages/sim/src/route/pathfind.ts`, raio ~30 tiles a partir de quem segue, ordem de vizinho
fixa para determinismo, resultado cacheado por alvo até ele se mover). O atraso existe porque a
maioria dos bloqueios do guloso é passageira — um monstro ou companheiro momentaneamente no
caminho —, e path-find nesses casos produzia desvios inúteis pela masmorra em vez de uma espera
curta (achado varrendo o bot config real: a coesão da party PIOROU com o BFS entrando na primeira
falha). Path-find continua NÃO se aplicando a:

- **A rota autorada da hunt** (`RouteWalker`/`walker.step()`) — continua só passo guloso, sem
  cache de caminho, exatamente como a decisão original descreve. Quem puxa a rota (o líder,
  `follow: 'none'`) nunca usa o BFS.
- **O monstro perseguindo alvo** (`packages/sim/src/monster/step.ts`) — continua só passo guloso.
  Empacar numa concavidade continua sendo o comportamento certo para ele.

Isto é legítimo porque o BOT é automação PRÓPRIA de Draconya, não uma mecânica de jogo com
fidelidade ao Tibia a preservar (ADR 0037: tudo segue TFS/Canary exceto a barra de ações e a
automação, que são nossas). Path-find limitado no follow não move a simulação para mais perto ou
mais longe da fidelidade que ADR 0037 promete — ele só torna o bot menos burro num corredor que
um jogador humano, seguindo manualmente, contornaria sem pensar.

### Consequências da emenda

- `packages/sim/src/route/pathfind.ts` é um módulo novo, puro (invariante 1), sem I/O — só grafo
  e busca em memória.
- O follow ganha dois campos de estado por personagem em `Runner` (`followPath`, o cache do
  caminho; `followStuckSinceMs`, o atraso antes do BFS) — nenhum dos dois persiste no snapshot:
  são cache de desempenho/decisão, recalculáveis a qualquer momento sem mudar o resultado, não
  estado de jogo.
- O raio limitado (30 tiles) e o cache por alvo mantêm o custo baixo — nunca "path-finding de
  verdade" sobre o mapa inteiro, nunca recalculado a cada vencimento enquanto o alvo não se move.
- A ordem de vizinho fixa do BFS (a mesma garantia de determinismo do passo guloso) é o que
  mantém a simulação reproduzível — dois nós que empatam em distância sempre resolvem para o
  mesmo caminho, nunca dependem de ordem de iteração de `Map`/`Set`.
