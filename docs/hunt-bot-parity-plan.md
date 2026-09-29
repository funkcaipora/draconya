# Paridade do bot de hunt com o Huntera — plano

**Data:** 2026-09-22
**Fonte da especificação:** `docs/reference/huntera-observed.md`, Parte IV (§23–§30) — onze
minutos de socket e a barra de ações do `Funkcaipora` (RP 360) numa party de quatro na Issavi
Steppe, mais duas notas do dono do projeto no mesmo dia (referência de distância e prioridade
da referência) — e `docs/reference/opentibia-engine-reference.md` §10–§11 para o que o Tibia
faz (TFS/Canary).
**Objetivo:** o bot do Draconya se **mover, escolher alvo, atacar e seguir** exatamente como
o observado, dentro dos onze invariantes e do ADR 0019 (seguir o design, nunca copiar código).

**Escopo fechado: movimento, alvo, ataque e follow.** Nenhuma magia, runa, item, condição ou
efeito novo — o catálogo e a barra atuais ficam como estão. Três fases, cada uma uma issue
pelo `/spec`; o inventário do que já existe está na §1 com arquivo e linha para o `/spec` não
repetir a auditoria.

---

## 1. Onde o Draconya está hoje (auditado em 2026-09-22)

A cadência de ataque e o alvo pegajoso já são iguais. O que difere está todo no movimento:
distância medida só do monstro, follow que só sabe "adjacente", passo guloso sem pathfinding
onde o Tibia usa A*.

| Capacidade | Onde | Estado |
|------------|------|--------|
| Relógio da arma independente do grupo `attack` (2.000 ms); disparo imediato ao entrar no alcance | `packages/sim/src/rulesets/hunt.ts:2594-2629`, `hunt.ts:3877` | ✔ igual (§27) |
| Alvo pegajoso: só muda quando morre ou sai da tela; retarget no mesmo evento | `hunt.ts:5236-5260` | ✔ igual (§25) |
| Políticas `nearest`, `lowest-hp`, `highest-hp` (absolutas), `follow` (clique) + priorizar/ignorar | `packages/sim/src/targeting.ts:71-118`, `packages/content/src/schemas.ts:1752` | parcial |
| Follow de membro/líder: passo guloso até ficar adjacente (distância 1) | `hunt.ts:2409-2450` | parcial (§26) |
| Postura `stand`/`follow`/`keep-distance{tiles}`, distância medida **só do monstro** | `hunt.ts:2369-2395`, `schemas.ts:1765` | parcial (§26) |
| Passo guloso, sem A* (ADR 0009); o TFS tem A* no `Map` com `FindPathParams` | `docs/adr/0009`, referência OpenTibia §11.1 | ✘ diverge do Tibia |
| Duração de passo por chão e speed, diagonal ×3 | `docs/product/hunt.md` | conferir arredondamento `ceil50` |
| Seguidor ignora a rota; só o líder anda a rota | `hunt.ts:2281` | ✔ igual |

O que **não existe** e o Huntera e o Tibia têm:

1. Distância de referência com prioridade **boss > monstro > knight da party** (se
   configurado) — nota do dono, §26.
2. `follow-member` como **estratégia de alvo**: o alvo é o monstro que o membro seguido
   segura (§25).
3. Políticas `lowest-health-percent`, `highest-health-percent` e `boss` (§25).
4. Perseguição e follow por **pathfinding**, como o `goToFollowCreature` do TFS (A* com
   `FindPathParams`), e manutenção de distância como o `getDistanceStep` do TFS para ranged.
5. Reação ao passo da referência **no mesmo evento** (0–200 ms no Huntera).
6. Distância 1 = **ao lado** do knight, nunca no mesmo tile.

---

## 2. O que "exatamente igual" significa — os oráculos

Os números da Parte IV viram **critérios de aceite mensuráveis** num teste de paridade em
`packages/sim` (cenário sintético: knight + RP a distância 3 + 24 monstros num campo aberto,
igual ao pull observado). O teste nasce em F1 e ganha uma linha por fase.

| # | Oráculo | Valor observado | Como medir no teste |
|---|---------|-----------------|---------------------|
| 1 | Retarget depois da morte do alvo | 0–100 ms (mesmo tick ou seguinte) | `player-target` novo no mesmo `advanceBy` do `creature-disappear` |
| 2 | Alvo com `follow-member` | sempre a 1 tile do membro seguido quando existe um | 100 % das trocas |
| 3 | Troca com o alvo vivo | 0 | contador |
| 4 | Distância RP→knight (distância 3) | moda 3, 90 % em 2–5 | histograma por passo |
| 5 | Mesmo tile que o knight | 1 em 3.000 passos (≈ 0) | contador |
| 6 | Reação ao passo do knight | 0–200 ms | `t(passo seguidor) − t(passo knight)` |
| 7 | Passo do jogador | `ceil50(1000 × chão / speed)`: 150 e 200 ms a speed 868 | duração por passo |
| 8 | Diagonal | `ceil50(3×)`: 550 ms a speed 868, 1.250 a speed 366 | duração por passo diagonal |
| 9 | Flecha | a cada 2.000 ms | intervalos de `shot` |
| 10 | Runa de ataque | a cada 2.000 ms, **defasada** da flecha, nunca esperando por ela | intervalos e fase |
| 11 | Alcance de projétil | 1–7 tiles, alvo a 2–6 | distância no disparo |

---

## 3. Fases (cada uma é uma issue; ordem = dependência)

### F1 · Alvo — políticas que faltam e `follow-member` como estratégia (`sim`, `content`, `protocol`, `client`)

- **Políticas:** acrescentar `lowest-hp-percent`, `highest-hp-percent` e `boss` em
  `targeting.ts` e no schema (`schemas.ts:1752`). `boss` = monstro com flag `boss` no
  conteúdo, senão cai em `nearest` (o Huntera não mostra o fallback; assumir nearest e marcar
  `[ABERTO]` em `docs/product/bot.md`).
- **`follow-member-<id>` como política de alvo:** o alvo passa a ser **o monstro adjacente ao
  membro seguido** (desempate: o que o próprio membro está atacando, se o runner dele expõe o
  alvo; senão o de menor HP% entre os adjacentes — `[ABERTO]`, §30 não separa). Sem monstro
  adjacente, o alvo é o alvo atual do membro seguido (§25, início do pull). Continua pegajoso
  e o retarget continua no mesmo evento de morte (já é assim em `hunt.ts:5236`).
- **Contrato:** `bot-config.targeting.policy` ganha os três valores e
  `{ kind: 'follow-member', characterId }`; `bot-config.follow` (movimento) continua
  separado, mas a UI liga os dois quando o jogador escolhe "Seguir <membro>" (F2 usa a mesma
  referência).
- **Cliente:** `LureTargetingModal.tsx:20-24` e `action-bar.ts:137` listam as novas opções
  com os rótulos do Huntera ("Menor % de vida", "Boss", "Seguir <nome>").
- **Aceite:** oráculos 1–3; `docs/product/bot.md` atualizado; a §6 da referência (que ainda
  fala em `advancedOnly.targetPolicies`) recebe uma nota de que está obsoleta.

### F2 · Movimento e follow como no Tibia, distância com referência (`sim`, `content`, `protocol`, `client`)

É o coração do plano e a única fase com ADR: **emenda o ADR 0009** (passo guloso) para a
perseguição e o follow de jogador.

- **Navegação como o TFS** (referência OpenTibia §11.3): uma `NavigationPolicy` por
  situação. `ChasePolicy` = A* com os parâmetros do `goToFollowCreature` do TFS (busca
  completa, linha de visão, diagonal permitida, distância-alvo mínima e máxima, raio de busca
  12), usada para seguir membro e perseguir alvo. `KeepDistancePolicy` = o `getDistanceStep`
  do TFS para ranged: escolhe o vizinho que mantém distância ≥ N com linha de visão, recua
  quando < N. **Monstros e a rota da hunt continuam gulosos** (o ADR 0009 segue valendo para
  eles).
- **Referência da distância por prioridade**, a cada avaliação: boss na tela → monstro mais
  próximo → membro seguido (só se `follow-member` está configurado). N = "Distância dos
  inimigos". Ranged e caster medem do knight; **o knight mede do monstro** (o líder observado
  ficou colado no alvo: `exori gran`/`exori min` são corpo a corpo).
- **Follow deixa de ser "adjacente":** o seguidor mantém `distance ≤ N` da referência e só
  anda quando `distance > N` **ou** quando a referência anda.
- **Distância 1 = ao lado, nunca no mesmo tile:** o tile do knight entra como bloqueado e o
  destino é um dos oito vizinhos.
- **Reação:** o passo da referência re-planeja o seguidor no mesmo evento, como o
  `onCreatureMove` do TFS marca o caminho para atualizar. Hoje `#armBot` roda só no passo do
  próprio jogador (`hunt.ts:2270`).
- **Duração de passo** numa função só para humano, bot e monstro (referência §10.1):
  `ceil50(1000 × chão / speed)`, diagonal `ceil50(3×)`. Conferir o arredondamento atual
  contra os oráculos 7 e 8.
- **Contrato:** `bot-config.posture` vira `{ kind: 'keep-distance', tiles, reference:
  'auto' }`; `'auto'` é a prioridade acima. Sem campo para o jogador escolher a referência:
  o Huntera não expõe isso.
- **ADR:** "perseguição e follow por A* orçado, distância de referência por prioridade" —
  emenda o 0009 e registra o custo (raio de busca 12, só para jogadores, nunca para monstro).
- **Aceite:** oráculos 4–8; knight andando 20 tiles com o RP mantendo moda 3; distância 1
  sem nunca ocupar o tile do knight; seguidor contornando uma parede em L sem travar.

### F3 · Ataque — conferir e fechar as diferenças (`sim`, `content`)

- Conferir contra os oráculos 9–11: arma a 2.000 ms independente do grupo `attack`; disparo
  imediato ao entrar no alcance; ataca enquanto anda; alvo fora do alcance não trava a
  política.
- **Linha de visão** para ataque à distância, como o `isSightClear` do TFS: conferir se o
  `#strike` (`hunt.ts:4308`) exige e, se não, exigir.
- **Alcance:** o Huntera dispara a até 7 tiles; o bow do Draconya tem 6
  (`packages/content/data/items/bow.json:13`). Ajustar o número — é conteúdo existente, não
  item novo.
- Sem munição em área nem runa nova nesta rodada.

### Fora do plano, de propósito

- **Magias, runas, itens e efeitos novos** (challenge do knight, Sharpshooter, diamond arrow
  em área): o catálogo fica como está.
- **Editor de condições** (sujeitos, Preso, Paralisado, `==`), **fight mode** e **presets
  como código**: estão descritos na Parte IV (§24) para quando entrarem.
- "Jogador pelo nome…" como alvo de cura fora da party — não faz sentido com a party como
  sessão única (ADR 0027).
- Lure com dois limiares: o Draconya tem e o Huntera não; fica.

---

## 4. Sequência, tamanho e o que cada fase entrega ao jogador

| Ordem | Fase | Tamanho | O jogador vê |
|-------|------|---------|--------------|
| 1 | F1 Alvo | M | "Seguir <membro>" ataca o que o knight segura; "Menor % de vida"; "Boss" |
| 2 | F2 Movimento + ADR | G | RP/ED/MS param a N do knight, nunca em cima dele, reagem no passo dele e contornam parede |
| 3 | F3 Ataque | P | alcance 7 e linha de visão; cadência confirmada por teste |

## 5. Como fechar cada fase

`/spec` na issue com o trecho desta seção como premissa; `pnpm check`; `/compliance` no
diff (as três tocam `sim/`); `/product` em `docs/product/bot.md` e `hunt.md`; `/adr` só em
F2. A Parte IV e a referência OpenTibia são as fontes — se a implementação decidir diferente
do observado, a divergência é marcada lá e em `docs/product/bot.md`, não apagada.
