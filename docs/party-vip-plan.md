# Party v2 e Premium — plano de implementação (M20)

**Status:** desenho aprovado pelo PRD "Party e VIP" (2026-09-16); decisões no ADR 0033; as issues
do milestone [M20 · Party e VIP](https://github.com/funkcaipora/draconya/milestone/11) apontam
para cá.
**PRD:** `~/Downloads/draconya-prd-party-vip.md` (2026-09-16) — §1–§43; o PRD v0.9 (§15, §22.1,
§34) continua valendo onde o novo não fala.
**Constrói sobre:** ADR 0027 e `docs/party-hunt-plan.md` (M13 — a party como uma sessão com N
donos), M15 (#339 vocação/level/mana no `party-state`, #354 `party-spending` (opcode 29), #358
`kick` e nomes, #359 `shareCosts?`/`splitLoot?` fixos na proposta — tudo mesclado pelo PR #366
em 2026-09-18), M17 (#316 janela Party loot, #318 painel da party, #320 modal Gerenciar party,
#325 Detalhes da caçada — mesclados). O que esses já entregam **não se repete aqui**. O ADR 0032
(contrato do HUD) acrescenta ao M20 a decisão 14 (§7).
**Emenda:** ADR 0027 decisões 5 (modo fixo), 8 (a party some no `start`) e 9 (nenhum opcode
C2S); ADR 0026 decisão 5 (Exura Sio excluída).

---

## 1. O que o PRD novo muda, em uma frase cada

| # | PRD | Hoje (M13) | M20 |
|---|---|---|---|
| 1 | 8 jogadores (§2.1) | `maxMembers: 4` | 8; tabela de XP até "8" |
| 2 | Rateio e Dividir lucro como dois interruptores do líder, **em tempo de hunt** (§4, §5, §33) | `shareCosts?`/`splitLoot?` em `PartyOptions`, fixos na proposta (#359) | os mesmos dois eixos, **mutáveis** pelo líder por um opcode C2S |
| 3 | Lista de coleta e lista de venda automática, limite 5 free / 20 Premium **pelo líder** (§6–§8, §42) | a bolsa vende tudo no settlement | `collect` (sem limite) e `autoSell` (limitada) no estado da party; venda no drop |
| 4 | Bolsa reserva capacidade **proporcional** de cada membro; OVERWEIGHT; rebalanceamento (§11–§15) | cap = Σ capacidades totais, sem reserva | `R_i = W × B_i / ΣB` sobre a capacidade **disponível**; `overweight`; recalculado a cada gatilho |
| 5 | Receita de cada loot pertence a quem estava presente no drop (§16.1) | settlement divide entre os presentes na venda | cada entrada da bolsa leva `eligible[]`; a venda divide só entre eles |
| 6 | Encontrar Party: sala pública com hunt e faixa de level (§17–§20) | fila cega de matchmaking (#199) | `publish`/`rooms`/`join` com validação de level e lotação |
| 7 | Convite direto pela Social (§21) | convite por id, sem notificação | Amigos mínimo + convites visíveis em `/mine` + Aceitar/Recusar |
| 8 | Entrar na instância **em curso** do líder (§22) | a party some no `start`; sessão nasce com os N | a party sobrevive ao `start` (`hunting`); ticket de entrada; `session.enter` na sessão viva |
| 9 | Liderança por tempo de party + recálculo do limite (§23) | `participants[0]` só para exibir | `leaderId` mutável no ruleset; limite recalculado |
| 10 | Follow de membro pelo bot (§24–§25) | `follow` é postura contra o monstro | `botConfig.follow` (nenhum / líder / membro) + `follow-state` |
| 11 | Cura/suporte com alvo: eu / menor HP % / membro (§26–§30) | cura só o lançador | `rule.target`; magia e poção com `target: 'friend'` e alcance |
| 12 | Seção PARTY nos Detalhes da caçada (§32) | analisador por personagem; `party-spending` (#354) leva o gasto de cada um | `analyzer.party` + `session-state.partySummary` |

---

## 2. Decisões (o que o ADR 0033 fixa)

### D1 — Dois eixos, mutáveis, no estado da sessão

O #359 (M15) já gravou os eixos em `PartyOptions { leaderId, mode, shareCosts?, splitLoot? }`
(`packages/sim/src/rulesets/hunt.ts`), lidos por `shareCostsOf`/`splitLootOf`
(`packages/sim/src/party.ts`) e **fixados na proposta**. O M20 torna `PartyOptions` estado
mutável do ruleset (o nome fica — `PartyState` já é o evento S2C em `combat-events.ts`):

```ts
// packages/sim/src/rulesets/hunt.ts
export interface PartyOptions {
  leaderId: string;                      // mutável (D9)
  readonly mode: PartyMode;              // legado: snapshot/ticket antigos (shareCostsOf/splitLootOf)
  shareCosts: boolean;                   // "Ativar rateio"  (§4)
  splitLoot: boolean;                    // "Dividir lucro"  (§5)
  /** `null` = coletar tudo (o default ao ligar `splitLoot`); lista = só estes ids. */
  collect: readonly string[] | null;
  /** Ids na ORDEM configurada; só os `autoSellLimit` primeiros valem (§23.1). */
  autoSell: readonly string[];
  premiumByCharacter: Record<string, boolean>;
}
```

- `shareCosts` decide a purse (`#sharedPurse`) em `#useSupply` **e** na munição paga (`#strike`,
  `#ammoFor`) — hoje a munição fica fora, e o §4 a inclui.
- `splitLoot` decide bolsa vs. sorteio. Ligar cria a bolsa vazia; **desligar liquida** (D6) e
  descarta a bolsa. Nada se perde.
- Quem muda é o líder, por `configureParty(session, patch, byCharacterId)` no ruleset —
  recusa `not-leader`; o host chama entre avanços, como `configureBot`.
- Leitura de snapshot antigo: `shareCosts ?? mode === 'shared'`, `splitLoot ?? mode === 'shared'`
  (os helpers de hoje), `collect: null`, `autoSell: []`. Sem bump de `SNAPSHOT_FORMAT_VERSION`.
- A proposta (`/propose`) e o ticket já levam `mode`; passam a levar também `shareCosts` e
  `splitLoot` (o `api` hoje só grava `mode`); `mode` continua no fio como derivado.
- Isto completa o #359 (SV-23): ele gravou os dois eixos fixos; o PRD do dono é a confirmação que
  ele pedia para torná-los mutáveis.

### D2 — Coleta, venda automática e o limite do líder

- `collect: null` coleta tudo; lista filtra **depois** de `rollLoot` (FUN-63: zero RNG a mais).
  Item fora da lista **não é coletado**: fica no cadáver, não conta `itemsLooted`. Gold nunca é
  item: entra sempre.
- `autoSell` é subconjunto lógico da coleta: item na lista efetiva **não entra na bolsa** — vira
  `value × quantity` gold na hora, dividido entre os elegíveis (D5) com `splitEqually` (resto na
  ordem de entrada), creditado em `goldDelta`/`goldGained` de cada um. Emite `party-settlement`
  com `reason: 'auto-sell'` e `itemId`. Item com `value: 0` na lista de venda é ignorado
  (entra na bolsa como coletado).
- `autoSellLimit = premiumByCharacter[leaderId] ? premium : free`, números em
  `content/data/party/baseline.json` → `autoSellItemTypes: { free: 5, premium: 20 }`.
  A lista **guarda** mais que o limite (§23.1); só os `limit` primeiros valem.
- `configureParty` recusa lista de venda com id fora do catálogo ou com `value: 0`; aceita
  acima do limite (é o §23.1).

### D3 — Premium é do personagem líder (não da conta)

O PRD diz "status da conta do líder"; o schema tem `characters.premium_until` por personagem
desde a Fase 1 e `monetization.md` §34 diz que Premium é comprado **por personagem**. Renomear
contrato persistido é caso do ADR 0014, e não há por quê: "a conta do líder" vira "o personagem
líder". Divergência registrada em `party.md`.

- `InitialCharacter.premium?: boolean` derivado em `initialCharacterOf`
  (`premiumUntil !== null && premiumUntil > now`), validado em `parseInitialCharacter` como os
  outros campos (valor ruim → ausente, nunca ticket recusado).
- `premiumByCharacter` no estado da party (snapshot) e no `configureParty` de quem entra depois.
  **Também corrige a penalidade de morte**, que hoje usa um `premium` de sessão que nenhuma party
  preenche: passa a ler o do morto.
- Fluxo de compra de Premium continua fora (E13).

### D4 — Reserva proporcional e OVERWEIGHT

```ts
// packages/sim/src/party.ts (puro)
export interface MemberCapacity { readonly id: string; readonly available: number }
/** R_i = W × B_i / ΣB, em ponto flutuante (peso é float no conteúdo). Σ R = W quando ΣB ≥ W. */
export function reserveProportionally(weight: number, members: readonly MemberCapacity[]): Map<string, number>;
```

- `available_i = max(0, character.capacity − inventory.weight(catalog))` — a capacidade
  **disponível**, não a total. Hoje bolsa e mochila contam a mesma capacidade duas vezes; isto
  corrige, e reduz a cap efetiva da bolsa — balanceamento visível, aceito.
- `overweight = W > ΣB`. Em OVERWEIGHT: item com `weight > 0` não é coletado (fica no cadáver);
  autovenda continua (não pesa); gold continua.
- A reserva **morde a mochila**: `#deliverLoot` e `#settle` passam um `Wearer` derivado
  `{ ...character, capacity: character.capacity − reserved_i }`. `inventory.ts` não muda.
- `#rebalanceBag(session)` recalcula available/reservas/overweight e emite `party-bag-changed`.
  Gatilhos (§13): `onEnter`, `onLeave`, `#deliverToBag`, `#deliverLoot` (loot pessoal muda o
  disponível), level up que reescreve `capacity`, `#settle`, autovenda, `configureParty`.
  **Nunca por tick** (invariante 2).
- Transição para/de OVERWEIGHT → `session.record('party-overweight', 'on'|'off')` (uma linha por
  transição, lista curta).

### D5 — Elegibilidade por entrada da bolsa

```ts
export interface BagEntry { readonly item: CarriedItem; readonly eligible: readonly string[] }
export interface GoldEntry { readonly amount: number; readonly eligible: readonly string[] }
export interface PartyBagState { gold: GoldEntry[]; items: BagEntry[]; capacity: number }
```

- `eligible` = `session.participants` no instante do abate (os presentes — o mesmo conjunto
  que paga o rateio; XP continua usando "vivo e com stamina").
- **Settlement** (D6) vende entrada a entrada: cada uma dividida entre `eligible ∩ presentes`
  (com quem sai incluído). Quem entrou depois do drop não recebe daquela entrada. A interseção
  nunca é vazia: a bolsa é liquidada a cada saída, então toda entrada tem ao menos um elegível
  presente.
- Snapshot antigo sem `eligible` → elegíveis = presentes no settlement (a regra de hoje).

### D6 — Settlement: a cada saída, no fim e ao desligar `splitLoot`

Mantido do ADR 0027 (a bolsa é liquidada em toda saída, com quem sai incluído) — é o que
preserva o invariante 10 (um extrato por saída) e faz o §15 ("sair pode deixar a bolsa acima da
capacidade") nunca acontecer: a bolsa esvazia na saída. Divergência de mecanismo, não de
resultado (nada se perde). Acrescenta o terceiro momento: **desligar `splitLoot`**.

### D7 — Entrar na instância em curso

- `PartyStore.started()` **deixa de apagar** a party: grava `state: 'hunting'` e `sessionId`,
  TTL longo (`HUNTING_TTL_MS`, 24 h, renovado em cada ação). `DISBANDED` é lazy: quando o
  `directory` não conhece mais a sessão, `/mine` e `rooms` apagam o registro.
- Contagem viva de membros (lotação, listagem): `directory.lookup(memberId).sessionId ===
  party.sessionId` para cada membro em `party:{id}:members` (≤ 8 lookups). Quem saiu da hunt
  perdeu o lease e some da conta; o `api` poda o ZSET nessa hora.
- `POST /api/party/:id/join` com `state === 'hunting'`: valida convite ou sala pública (faixa
  de level), lotação viva, personagem na Cidade/repouso, liquida o progresso pendente dele
  (como o `start` faz), resolve o nó **da sessão** (`directory.lookup(leaderId).nodeId`) e emite
  um ticket com `party: { sessionId, leaderId, join: true, members: [ele] }`.
  `parsePartyTicket` aceita `join: true` com um membro só.
- No `game`: ticket cuja sessão está hospedada e cujo personagem **não é participante** →
  `hosted.session.enter(characterFromTicket(...))` no ciclo da sessão dona (invariante 9),
  `configureBot` com o `botConfig` do ticket, `configureParty` com o premium dele, lease
  registrado. Recusa (`party-full` / `content-version` / `session-not-here`) fecha o socket com
  motivo e o `api` devolve o erro no `join`. Sessão não hospedada neste nó = erro (o ticket
  foi emitido para o nó certo; um deploy no meio é a exceção que vira retry do cliente).
- No `sim`: `HuntRuleset.onEnter` recusa o `maxMembers + 1`-ésimo (`throw` tipado, como o de
  tile sem lugar); emite `party-state` e rebalanceia a bolsa; `Session` guarda `joinedAtMs`
  por participante e `#receiptFor` filtra `notableEvents` por `atMs >= joinedAtMs` (o extrato
  de quem entrou tarde não leva os level ups dos outros).
- `enter-hunt` (opcode 9) continua o caminho solo. Formação pré-hunt continua como está.

### D8 — Encontrar Party e Amigos

- Sala: `POST /api/party/:id/publish { minLevel, maxLevel }` (líder; exige `huntId` proposto;
  `minLevel ≤ maxLevel`), `POST /api/party/:id/unpublish`, `GET /api/party/rooms` →
  `[{ partyId, huntId, difficulty, leader: { characterId, name, level }, vocations: string[],
  members: n, maxMembers, minLevel, maxLevel, state }]`. Índice `party:rooms` (SET) + campos no
  hash. `join` sem convite só entra se a sala está publicada e `minLevel ≤ level ≤ maxLevel`.
  Publicada ou não, a party continua aceitando convite.
- A fila de matchmaking (#199) **continua como API** e como botão "Procurar party"; a sala é o
  segundo caminho. `matchmakingLevelRange` fica como está.
- Amigos (mínimo para o §21): tabela `friend (character_id, friend_character_id, created_at)`
  com par único, sem pedidos nem bloqueios (o kit desenha as abas; elas esperam o épico
  social). `POST /api/friends { name }`, `DELETE /api/friends/:characterId`, `GET /api/friends`
  → `[{ characterId, name, vocationId, level, online, where: 'city' | 'hunt' | null }]`
  (`online`/`where` pelo `directory`, que conhece o tipo da sessão, não a hunt). `getCharacterByName` no repositório (índice único já
  existe). Migration `0008_<n>-friends.sql`.
- Convite visível ao convidado: `party:invited:{characterId}` (SET de partyIds, TTL do
  convite) escrito junto com `invite()`; `GET /api/party/mine` passa a devolver
  `invites: [{ partyId, leaderId, leaderName, huntId, state }]`; `POST /api/party/:id/decline`.
  O cliente já pergunta `/mine` a cada 2 s — passa a fazê-lo em qualquer tela (Cidade ou
  hunt), e o diálogo "Convite para Party — Aceitar / Recusar" aparece onde o jogador estiver.
- Lotação também trava o convite: `/invite` recusa `party-full` (§20.1).

### D9 — Liderança por tempo de party

`participants` já é a ordem de entrada, e `leave` faz `splice`: `participants[0]` **é** o mais
antigo. O que muda: `leaderId` vira mutável em `PartyOptions`, reescrito em `#flushLoss` quando
o líder saiu; `configureParty` valida contra ele; ao mudar, `autoSellLimit` é recalculado e
`party-state` sai com `leaderId`, os eixos e `autoSellLimit`. `session.record('leader-changed',
id)`.

### D10 — Follow de membro

```ts
// packages/content/src/schemas.ts — botConfigSchema
follow: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('leader') }),
  z.object({ kind: z.literal('member'), characterId: z.string().min(1) }),
]).default({ kind: 'none' }),
```

- Campo **separado** da postura (`targeting.posture.follow` continua sendo "persegue o monstro").
  Não sobe `BOT_VOCABULARY_VERSION` (tem default).
- Com follow ativo o personagem **não anda a rota**: a cada evento de movimento dá `greedyStep`
  em direção ao membro até ficar adjacente (distância 1); parado quando adjacente. Combate
  continua: regras de ataque valem para monstros em alcance; a postura contra monstro fica
  suspensa enquanto o follow está ativo.
- Alvo indisponível (morto, ausente da sessão, sem caminho no raio de `targetSearchRadius`):
  o runner marca `followInterrupted = true`, volta a andar a rota, emite `follow-state
  { active: false, targetId, reason }` **uma vez**, e não escolhe outro (§25.1). Se o mesmo
  alvo voltar a ser válido ("temporariamente inacessível"), retoma e emite `active: true`.
  Morto e "saiu" nunca voltam numa hunt (morte é saída). "Desconectado"/"offline" **não
  existem** para o `sim` (invariante 3: a hunt roda sem socket) — o PRD §25.1/§30 os lista e
  aqui eles não são estado de simulação; registrado como divergência.
- `validateBotConfig` não conhece a party: aceita qualquer `characterId`; o `sim` espera (§30).

### D11 — Cura e suporte com alvo

```ts
// botRuleSchema
target: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('self') }),
  z.object({ kind: z.literal('lowest-hp-member') }),
  z.object({ kind: z.literal('member'), characterId: z.string().min(1) }),
]).default({ kind: 'self' }),
```

- Só em `heal`, `potion` e `support`; `validateBotConfig` recusa `target ≠ self` em `attack` e
  `rune`, e em ação cujo efeito não aceita amigo (abaixo).
- Com `target ≠ self`, a condição `hp` é avaliada sobre o **candidato** (§29: "encontra membros
  com HP < 50 %"); `mana` continua do lançador. `BotView` ganha `partyTarget: { health,
  maxHealth } | null`, preenchido por candidato durante a seleção.
- Seleção (`#resolveRuleTarget`): candidatos = `session.participants` vivos, distância ≤ alcance
  do efeito; `lowest-hp-member` ordena por `health / maxHealth` (**percentual**, §28; desempate
  pela ordem de entrada) e usa o primeiro que satisfaz a condição; `member` usa só ele e, se
  inválido, **não faz nada** (§30 — sem substituir). `self` é o de hoje, sem alcance.
- Conteúdo: `spell.effect.heal` e `supply.effect.heal|mana` ganham `target: 'self' | 'friend'`
  (default `self`) e `range` (obrigatório com `friend`, proibido com `self` — a mesma regra de
  `damage` em `buildContent`). Entram `heal-friend-druid.json` (Exura Sio) e a variante do
  Paladin se o TibiaWiki confirmar; saem da `EXCLUDED_SPELLS` (emenda ao ADR 0026 d.5). Poções
  de vida/mana ganham `target: 'friend'` com `range` provisório 1 (`_open`).
- `castSpell`/`useSupply` ganham `recipient` (default o lançador); pagamento continua do
  lançador (purse), benefício vai ao `recipient`; `#emitHealed` no `recipient`.
- `#armBot`: quando alguém leva dano, acorda também o bot de todo participante que tem regra
  com `target ≠ self` (só com party; custo N por golpe, aceito).
- `catalogue.bot.spells[]/supplies[]` expõem `targets: 'self' | 'friend'` para a UI só oferecer
  o seletor onde cabe.

### D12 — Protocolo

| Opcode | Direção | Mensagem | Conteúdo |
|---|---|---|---|
| **próximo C2S livre** (17 hoje) | C2S | `party-settings` | `{ shareCosts?, splitLoot?, collect?: string[] \| null, autoSell?: string[] }` — intenção; o servidor checa líder e catálogo |
| 24 | S2C | `party-state` (v2) | já tem `shareCosts`/`splitLoot` (#359) e `vocationId`/`level`/`manaPercent` (#339); `+ loot: { collect, autoSell, autoSellLimit, leaderPremium }, members[].joinedAtMs, members[].connected` — tudo opcional |
| 25 | S2C | `party-bag` (v2) | `+ value, overweight, reservations: [{ characterId, reserved, available }], items[].eligible` |
| 26 | S2C | `party-settlement` | `+ reason: 'leave' \| 'end' \| 'toggle' \| 'auto-sell', itemId?` |
| 20 / 3 | S2C | `analyzer` / `session-state` | `analyzer.party?` e `session-state.partySummary?` (o `party` do `session-state` já é o roster): `{ players, uniqueVocations, xpPercent, totalXp, totalSupplies, shareCosts, splitLoot, bagValue, bagWeight, autoSell: { used, limit } }` |
| **próximo S2C livre** (30 hoje) | S2C | `follow-state` | `{ active, targetId, reason?: 'dead' \| 'left' \| 'unreachable' }` — por personagem |

Opcodes 27–29 são do M15 (`active-conditions`, `player-count`, `party-spending`). O ADR 0032
também vai reservar opcodes (`use-slot`, `select-target`, `set-stance`, `dispatch-loot`,
`slot-state`, `slot-result`): quem pousar primeiro pega o número, e a spec da #393 diz "o
próximo livre", nunca um número fixo. Recusa de `party-settings` é `system-message`; sucesso é
o `party-state` novo — a tela reflete a verdade, não o eco. `PROTOCOL_VERSION` → `0.3.0`
(documental).

### D13 — Vocações e a tabela

`null` continua contando como vocação (ADR 0027 d.3); a tabela ganha `"5".."8": 200` — o teto é
200 %, e com 8 membros o máximo de únicas é 5 (4 vocações + "nenhuma"). `party.test.ts` e
`content.test.ts` passam a fixar 8.

---

## 3. Exemplos numéricos (viram testes de tabela)

**Reserva (§12.1):** A disponível 1 000, B 500, bolsa 300 → A 200, B 100 (20 % cada).
**Reserva com três:** 1 000 / 500 / 250, bolsa 700 → 400 / 200 / 100; percentuais 40 %.
**OVERWEIGHT:** disponível Σ 1 500, bolsa 1 500 e cai um item de 10 oz → não coletado,
`overweight: true`; alguém vende 300 oz de itens → volta, `overweight: false`.
**Autovenda:** 4 presentes, dragon ham `value 10`, cai 3 → 30 gold → 8/8/7/7 (resto aos
primeiros na ordem de entrada). Se o quinto entrou depois, não recebe deste drop.
**Elegibilidade no settlement:** A, B presentes → cai item X (`value 100`); C entra; B sai →
settlement: X vale 100 → A 50, B 50; C 0. Item Y caiu com A, B, C → 34/33/33.
**Rateio com munição:** shareCosts on, 4 presentes, tiro de 5 gold → 1 de cada + 2 do atirador
(resto do usuário, ADR 0027).
**Limite:** líder Premium, 18 ids em `autoSell` → 18 vendem; líder sai, novo líder free → os 5
primeiros vendem, 13 ficam salvos e inertes; `party-state.loot.autoSellLimit: 5`.
**Menor HP %:** knight 2 000/10 000 (20 %), mago 1 000/2 000 (50 %) → knight é o alvo.

---

## 4. Por pacote

### `packages/content`
`party/baseline.json` (`maxMembers: 8`, chaves 5–8, `autoSellItemTypes`); `spellSchema`/
`supplySchema` `heal|mana` com `target`/`range` + regra em `buildContent`; `heal-friend-*.json`;
`botConfigSchema.follow`; `botRuleSchema.target`; `validateBotConfig`; `catalogue` expõe
`targets` (é `protocol` + `server/catalogue.ts`).

### `packages/protocol`
D12. `messages.test.ts` ganha os testes de party que faltam (ida e volta, campo ausente decodifica).

### `packages/sim`
`party.ts`: `reserveProportionally`, `settleEntries` (por elegíveis), `BagEntry`/`GoldEntry`,
`autoSellLimit`. `rulesets/hunt.ts`: `PartyState` mutável + `configureParty` + migração do
snapshot; purse por `shareCosts` (munição incluída); `#deliverToBag` com coleta/autovenda/
elegibilidade/overweight; `#rebalanceBag`; `Wearer` derivado; `#settle` por entrada;
`onEnter` com cap, `party-state` e rebalanceamento; `joinedAtMs` e filtro do extrato em
`session.ts`; `leaderId` mutável; `premiumByCharacter` (penalidade de morte); follow de membro
(`#holdFollow`, `follow-state`); alvo de cura (`#resolveRuleTarget`, `BotView.partyTarget`);
`castSpell`/`useSupply` com `recipient`; `partySummary(session)` para o analisador.

### `packages/server`
`tickets.ts`: `InitialCharacter.premium`, `PartyTicket.join`, `shareCosts`/`splitLoot` ao lado
de `mode` (e `/propose` gravando os dois); `api/tickets.ts`: `initialCharacterOf` lê `premiumUntil`. `party-store.ts`:
`hunting`, `sessionId`, salas, convites reversos, `decline`, contagem viva; `api/party.ts`:
`publish/unpublish/rooms/decline`, `join` em curso, `/mine` com `invites`, `/invite` com
lotação; `api/friends.ts` + `db/schema.ts` + migration. `game/host.ts`: `party-settings` →
`configureParty` com checagem de líder; entrada em sessão em curso (`session.enter` no ciclo);
`party-state` v2, `party-bag` v2, `analyzer.party`, `follow-state`; `game/sessions.ts`:
`createBotConfigValidator` aceita os campos novos.

### `packages/client`
Sobre o M17 (janela Party loot, painel da party, modal Gerenciar party, Detalhes da caçada):
switches do líder no painel; aba **Encontrar Party** no modal (publicar, listar, entrar);
modal **Amigos** (adicionar por nome, convidar); diálogo de convite (poll global de `/mine`);
config de loot nos Detalhes da caçada (PEGAR / VENDER, `N / limite`, só o líder edita); Party
loot com valor, peso, "sua capacidade reservada" e %; seção PARTY do analisador; bot: Follow
(Nenhum / Líder / membros; "Follow interrompido — alvo indisponível."), alvo da cura no editor
de regra (Eu / menor vida / membro).

### `packages/tools` e teste de saída
`api/party-v2-exit.postgres.test.ts` (Redis db **16**): oito personagens de quatro vocações,
sala pública com faixa de level (um fora da faixa é recusado), um membro entra com a hunt em
curso, líder liga os dois eixos e configura coleta/venda, líder Premium × líder free (troca de
liderança), autovenda credita só os presentes no drop, bolsa reserva proporcional e entra em
OVERWEIGHT sem perder item, um segue outro, o druida cura o menor HP %, ledger com uma linha
por membro e Σ delta = Σ gold que caiu + vendas − supplies. `pnpm load --party 8`.

---

## 5. Issues do M20 (ordem de execução; cada PR empilhada na anterior)

| # | Escopo | Task | Bloqueada por |
|---|---|---|---|
| 1 · [#391](https://github.com/funkcaipora/draconya/issues/391) | docs | ADR 0033 + este plano; comentar #359 (completado pelo #394) e #385 | — |
| 2 · [#392](https://github.com/funkcaipora/draconya/issues/392) | content | 8 membros, tabela 5–8, `autoSellItemTypes`, `heal.target/range` + Exura Sio, poção em terceiro, `follow`, `rule.target`, `validateBotConfig` | #391 |
| 3 · [#393](https://github.com/funkcaipora/draconya/issues/393) | protocol | opcode 17 `party-settings`, 30 `follow-state`; `party-state`/`party-bag`/`party-settlement`/`analyzer` v2; `catalogue.targets`; testes de ida e volta | #392 |
| 4 · [#394](https://github.com/funkcaipora/draconya/issues/394) | sim | `PartyOptions` mutável: dois eixos em tempo de hunt (completa #359), `configureParty`, líder por tempo, `premiumByCharacter` e penalidade por membro, munição no rateio, migração do snapshot, `partySummary` | #392 |
| 5 · [#395](https://github.com/funkcaipora/draconya/issues/395) | sim | bolsa v2: coleta, autovenda com limite do líder, entradas com elegibilidade, settlement por entrada e ao desligar `splitLoot` | #394 |
| 6 · [#396](https://github.com/funkcaipora/draconya/issues/396) | sim | reserva proporcional, OVERWEIGHT, `#rebalanceBag`, `Wearer` derivado | #395 |
| 7 · [#397](https://github.com/funkcaipora/draconya/issues/397) | sim | entrada em sessão em curso: cap em `onEnter`, `party-state` na entrada, `joinedAtMs` e extrato filtrado, premium/bot de quem entra | #394 |
| 8 · [#398](https://github.com/funkcaipora/draconya/issues/398) | sim | Follow de membro + `follow-state` | #397 |
| 9 · [#399](https://github.com/funkcaipora/draconya/issues/399) | sim | cura/suporte com alvo, `hp` do candidato, `recipient` em `castSpell`/`useSupply`, alcance | #397 |
| 10 · [#400](https://github.com/funkcaipora/draconya/issues/400) | server | premium no ticket; `/propose` e ticket com os dois eixos; `party-settings` roteado (líder); `party-state`/`party-bag`/`analyzer.party`/`partySummary`/`party-settlement` v2 no fio; `createBotConfigValidator` | #393, #396, #397 |
| 11 · [#401](https://github.com/funkcaipora/draconya/issues/401) | server | `follow-state` no fio | #398, #399, #400 |
| 12 · [#402](https://github.com/funkcaipora/draconya/issues/402) | server | a party sobrevive ao `start`; entrada em curso (ticket `join`, `session.enter` no host, lotação viva); salas públicas; convites reversos, `/mine` com `invites`, `decline`, `/invite` com lotação | #397, #400 |
| 13 · [#403](https://github.com/funkcaipora/draconya/issues/403) | server | Amigos: tabela, migration, rotas, `getCharacterByName`, online/where | #391 |
| 14 · [#404](https://github.com/funkcaipora/draconya/issues/404) | client | Gerenciar party: Encontrar Party, Amigos, diálogo de convite (poll global) | #402, #403 |
| 15 · [#405](https://github.com/funkcaipora/draconya/issues/405) | client | switches do líder, config de loot nos Detalhes da caçada, Party loot v2, seção PARTY do analisador | #400 |
| 16 · [#406](https://github.com/funkcaipora/draconya/issues/406) | client | bot: Follow e alvo da cura | #401 |
| 17 · [#407](https://github.com/funkcaipora/draconya/issues/407) | server/tools | critério de saída do M20 (`party-v2-exit.postgres.test.ts`, db 16) + `pnpm load --party 8` | #404, #405, #406 |
| 18 · [#408](https://github.com/funkcaipora/draconya/issues/408) | docs | `docs/product/{party,bot,analyzer,monetization,items,economy,chat}.md` sincronizados; ADR 0027 e 0026 com a nota de emenda | #407 |
| 19 · PT-01 | sim/protocol/server/client | DPS/HPS por membro (ADR 0032 d.14): acumulador por evento de dano causado e cura feita com carimbo lógico, janela de 60 s aparada na leitura, totais da sessão; em `party-state.members[]` e no analisador; linha "DPS · HPS" do painel | #400, M19 (eventos de dano) |
| 20 · PT-02 | sim/protocol/server/client | Encerrar para todos exige o sim de todos (ADR 0032 d.14): proposta do líder, aprovação por membro em 60 s, encerramento com settlement; sair sozinho continua livre | #394 |

**Pronto quando:** ver a descrição do milestone. As linhas 19 e 20 vêm do ADR 0032 (decisão 14)
e entram no M20 como issues próprias, depois das 18 deste plano.

---

## 6. O que o ADR 0032 muda aqui

- **Decisão 11/12 (moedas físicas, loot na mochila, Despachar loot):** a bolsa da party continua
  como está ("Party: respeita `shareLoot` (bolsa da party) como hoje"); a Caixa de Loot em
  Redis é aposentada pelo M21 — o excedente que hoje vai para a caixa do líder não existe mais
  neste plano (D2/D4: item não coletado fica no cadáver). A reserva (D4) vale sobre a mochila,
  onde o loot pessoal passa a viver.
- **Decisão 14:** DPS/HPS por membro e "sim de todos" — linhas 19 e 20 do §5.
- **Opcodes:** o 0032 reserva `use-slot`, `select-target`, `set-stance`, `dispatch-loot`,
  `slot-state`, `slot-result`; o M20 reserva `party-settings` e `follow-state`. Nenhum número é
  fixo até pousar (D12).

## 7. Invariantes em jogo

| # | Como o plano os respeita |
|---|---|
| 1 | tudo de party continua em `sim/party.ts` e no ruleset; salas, amigos e convites são `api` (Redis/Postgres) |
| 2 | rateio, autovenda, reserva, settlement e follow rodam em eventos (abate, uso, saída, movimento, `configureParty`); `#rebalanceBag` só nos gatilhos |
| 3 | a party caça sem socket; "desconectado" não é estado do `sim` (D10) |
| 4 | `party-settings` e `bot-config` são intenção; quem valida líder, catálogo e limite é o servidor; valor, peso, reserva e cota chegam prontos |
| 5 | os dois opcodes novos nascem em `protocol/messages.ts`, com o próximo número livre |
| 7 | tabela, limites e `value` fixos na versão de conteúdo da sessão; ticket de entrada recusado se a versão difere |
| 8 | quem entra em curso sai da Cidade pelo mesmo ticket que o solo usa; um personagem, uma sessão |
| 9 | `configureParty` e `session.enter` são chamados pelo host **dentro do ciclo da sessão dona**; o `api` só lê o `directory` |
| 10 | autovenda credita `goldDelta` na hora e cada saída liquida a bolsa — um extrato por saída, `(session_id, seq)` único |
| 11 | follow e cura de aliado são funcionalidade do bot, não sinal de nada |

**Custo:** laços de até 8 por abate (elegíveis, `itemsLooted`), por supply (`plan` ×2) e por
golpe (`#armBot` dos curandeiros); `#rebalanceBag` é O(n × itens no inventário) por gatilho. O
`bench:hunts` ganha `PARTY=8` na issue 17.
