# 0033 — Cena espacial por andar: parede, objeto alto e criatura no mesmo container, ordenados por `zIndex`

**Status:** aceito
**Data:** 2026-09-19
**Contexto técnico:** `packages/client` (`src/world/viewport.ts`, `depth.ts`, `camera.ts`; as
issues #386 e #387 do M23 implementam D3 e D6/D7 sobre este desenho)

## Contexto

O viewport desenhava em cinco containers fixos — `terrain`, `creatures`, `above`, `effects`,
`overlay` — e a parede vivia em `terrain` enquanto a criatura vivia em `creatures`: o personagem
era SEMPRE desenhado por cima da parede, esteja ao norte ou ao sul dela. A ordem entre criaturas
era refeita a cada troca de tile por uma assinatura de posições inteiras e `setChildIndex`, que
só comparava criaturas entre si; a parede, noutro container, nunca entrava na comparação. O
`packages/client/AGENTS.md` registrava isso como dois invariantes locais — "o `top` num container
ACIMA das criaturas" e "a ordem só é recalculada quando alguém troca de tile" —, e os dois
estavam no caminho da correção.

O PRD de renderização de 2026-09-16 (§4.2, §6, §7, §17, §41) diz o que se quer: `ground` /
`spatialScene` / `top` / `effects` / `overlay`; `spatialOrder(x, y)`; criaturas dentro do spatial
scene; e explicitamente "não manter parede sempre em layer inferior às criaturas; não decidir
profundidade apenas por tile final". O brief do M23 (`docs/spatial-world-plan.md`) fixou as
decisões que atravessam as nove issues do marco, e o `MapView` do OTClient é a referência de
comportamento — em números, nunca em código (ADR 0019). A #384 já entregou a classificação
(`layer: 'ground' | 'scene' | 'top'` e `sceneSlot`) em `tile-stack.ts`; faltava o container que a
consome.

## Decisão

**D1 — três containers por ANDAR: `ground` → `scene` → `top`; andares do fundo ao topo.** Cada
andar desenhado tem um `FloorLayers` próprio (`ground`, `scene`, `top` e o `Graphics` de reserva
como filho 0 de `ground`), anexado a `floorsRoot` na ordem de `floorsBelow`, do mais fundo ao do
jogador. `effects` e `overlay` continuam globais, por cima de todos os andares. `FloorLayers` são
pool por `z` (`Map<number, FloorLayers>`): subir e descer escada re-anexa; nunca destrói.

**D2 — `scene` com `sortableChildren`; `zIndex = sceneZIndex(x, y, slot)`, profundidade
`(x + y) * ROW_MULTIPLIER + x`; itens do tile nos slots 0–62, criatura no 63; criatura no `scene`
do andar dela.** A profundidade de um tile é a anti-diagonal `x + y` e, dentro dela, `x` — o
RESULTADO da varredura diagonal do `MapView` do OTClient como função, não o laço. Não é
`y * M + x`: por linha, o vizinho a NORDESTE é desenhado antes, e o OTClient o desenha depois — a
parede a sudoeste de um dragão cortaria a metade esquerda dele. Sul > norte e leste > oeste valem
nas duas; o par NE/SW é o único em que divergem, e `depth.test.ts` prende exatamente esse par. O
`zIndex` é preso a 64 vagas por tile: um tile lotado empilha os excedentes no slot 63, em ordem
de inserção, e nunca invade o tile seguinte. O Pixi ordena o `scene` uma vez por render quando
algum `zIndex` mudou (`sortDirty`), nunca por quadro sem mudança.

**D3 — o tile da criatura é o walking tile do OTClient** (canto inferior direito do corpo
desenhado, com displacement e walk offset) — implementado em #386. Nesta issue o tile é
`Math.round` da posição interpolada, e é assim de propósito: é a UMA linha que #386 troca.

**D6 — culling pela janela de render:** fora dela o sprite fica invisível no pool, nunca
destruído, e volta ao entrar sem `addChild` nem textura nova.

**D7 — andares visíveis, cobertos e o véu por andar decididos fora do renderer** (`visibility.ts`,
puro) — implementado em #387; o renderer só desenha. Até lá, os andares desenhados continuam
sendo `floorsBelow` e o véu continua `veilTint(below)` por sprite, com o ambiente no `tint` da
raiz (o tint do container multiplica o dos filhos, então `ambiente × véu` sai igual ao de hoje).

## Alternativas

- **A varredura diagonal do OTClient como LAÇO (ordem de inserção)** — descartada: obriga a
  reinserir toda criatura a cada quadro ou a manter a assinatura de posições de hoje; o `zIndex`
  é o mesmo resultado como número, e `depth.test.ts` prova a equivalência para as 8 direções.
- **`setChildIndex` como hoje** — descartada: só ordena criaturas entre si; a parede fica noutro
  container e nunca entra na comparação, que é o defeito que a issue existe para corrigir.
- **Um container só, com o andar dentro do `zIndex`** — descartada: o véu e o deslocamento por
  andar são propriedades do container, e um `zIndex` de três chaves não tem onde pôr o `tint`.
- **`y * ROW_MULTIPLIER + x` (PRD §7.1)** — descartada: diverge do OTClient no par NE/SW, pelo
  motivo de D2.
- **Véu como `tint` do container do andar** — descartada nesta issue: os placeholders já usam
  `shade(color, below)`, e o tint no container os escureceria duas vezes — mudança de
  comportamento sem ganho; fica para quando #387 precisar de opacidade por andar.
- **Placeholder sempre no `Graphics` do `ground`** — descartada: parede em voo sob a criatura já
  mostraria a criatura "na frente" por um quadro — o que a issue existe para eliminar. O
  placeholder vai para a camada do PRIMEIRO objeto da pilha.

## Consequências

O que fica mais fácil: o walking tile (#386) é trocar UMA linha — o `zIndex` da criatura —; a
visibilidade de andares (#387) é decidir quais `FloorLayers` anexar e com que `alpha`. O que fica
mais difícil: um objeto de `scene` mal classificado agora COBRE a criatura, então a classificação
de #384 passa a ter efeito visível — a ordem de desenho deixa de ser silenciosa. O que precisa
mudar: `packages/client/AGENTS.md`, dois bullets; `docs/spatial-world-plan.md` (o ADR passa de
"a criar" a aceito); `docs/adr/README.md` ganha a linha 0033. `camera.ts` perde
`compareDrawOrder`, que ninguém mais usa.

## Invariantes afetados

Nenhum dos onze. O invariante 3 (o resultado da simulação não depende de haver alguém assistindo)
é reforçado: o renderer LÊ `world` e escreve só em objetos do Pixi — nenhuma linha desta issue
atribui a `world.*` ou a `creature.*`. O invariante 4 (o cliente só manda intenção) é reforçado:
`depth.ts` e `viewport.ts` não importam `net/` e nada aqui chama `send`. O invariante 6
(`content/` nunca contém arte) não muda: a ordem de desenho é função de `(x, y, slot)` e da flag
que #384 lê do pacote; `content` continua entregando `appearanceId`.
