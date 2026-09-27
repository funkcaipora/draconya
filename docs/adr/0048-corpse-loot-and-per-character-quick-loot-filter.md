# 0048 — O cadáver carrega o loot, e o que sai dele é decidido por um filtro de Quick Loot por personagem

**Status:** proposto — reverte a parte "sem loot" da decisão 8 do [ADR 0025](0025-real-map-from-otbm.md)
e a linha "cadáver como container" da tabela §3 do `docs/tibia-parity-plan.md`; emenda o
[ADR 0032](0032-the-rendered-hud-is-the-game-contract.md) d.12 (a Caixa de Loot é
retirada de fato, não só aposentada no texto) e o [ADR 0035](0035-party-v2-runtime-settings-shared-bag-and-live-join.md)
d.2 ("item fora da lista fica no cadáver" passa a ser literal e recuperável)
**Data:** 2026-09-26
**Contexto técnico:** `packages/sim` (`rulesets/hunt.ts` — `CorpseState`, `#deliverLoot`,
`#deliverToBag`, `#onCorpseDecay`; `inventory.ts`), `packages/content` (`botConfigSchema`, `party/`),
`packages/protocol` (três opcodes C2S, dois S2C, um campo em `ground-item-appear`),
`packages/server` (`host.ts` — `lootBox`, `LootBoxStore`; `jobs` — instâncias vendidas/destruídas no
extrato), `packages/client` (janela de cadáver, aba Loot da barra)
**Issues:** novas — ver `PLAN.md` W2–W5

## Contexto

O dono pediu, literalmente: *"selecionar quais itens pegar do loot"*. Hoje isso não existe por
decisão registrada três vezes: o ADR 0025 d.8 pôs o cadáver no chão **só visual, sem loot**; o
`docs/product/items.md` §"Regras" diz *"sem itens físicos no chão"*; e o `docs/tibia-parity-plan.md`
§3 rejeita *"cadáver como container com dono e decadência em estágios de loot"* citando as
Alternativas do ADR 0037. O loot cai direto na mochila (`#deliverLoot`, `hunt.ts:7204`), o que não
cabe vai para a `lootBox` do personagem e, no fim da sessão, para o Redis (`LootBoxStore`, TTL de 30
min) — que ninguém lê, resgata nem mostra (auditoria de 2026-09-26, §1). Em party com `splitLoot`
existe um filtro `collect` do líder, e o que fica fora "fica no cadáver" — expressão de um
cadáver que não guarda nada, ou seja, o item some.

A tensão de arquitetura é o **invariante 3**: o resultado da simulação não pode depender de haver
alguém assistindo. Uma "janela de loot" pura — o jogador abre o cadáver e escolhe — resolve o
pedido só para quem está olhando, e a hunt desanexada, que é o modo padrão do jogo, ficaria sem
loot nenhum ou com loot decidido por outra regra. O que resolve os dois lados ao mesmo tempo é
uma coisa que **o próprio Tibia 13 já tem**, e que o ADR 0037 manda copiar: o **Quick Loot**.

No Canary (`src/game/game.cpp:3596-3700`, `6428-6600`; `src/creatures/players/player.cpp:1379`):

- o cadáver é um container com **dono** (`CORPSEOWNER`, `monster.cpp:3310`); só o dono ou a party
  dele abre (`Player::canOpenCorpse`);
- cada jogador tem um **filtro** (`quickLootFilter`: `ACCEPTEDLOOT` ou `SKIPPEDLOOT`) e uma lista de
  ids (`quickLootListItemIds`); `playerQuickLootCorpse` percorre o cadáver e leva só o que o filtro
  aceita, avisando "You looted X gold and all dropped items" (uma mensagem a cada 15 s);
- o uso manual exige distância `areInRange<1,1,0>` (mesmo andar, adjacente — `Actions::canUse`,
  `actions.cpp:186`) e anda até o cadáver antes; a variante `autoLoot` **não exige distância nem
  ação** e roda no abate;
- o que não foi pego fica no cadáver até ele decair pela cadeia `decayTo` (670 s para dragões — ADR
  0039, #585), e aí é destruído.

Ou seja: **filtro por personagem + cadáver com loot** é fidelidade, não invenção; e o bot aplicando o
filtro sem ninguém olhar é a nossa automação (ADR 0037 d.2), legítima pelo invariante 11.

## Decisão

1. **O cadáver carrega o loot.** `CorpseState` (`hunt.ts:738`) ganha `items: CarriedItem[]`,
   `gold: number`, `ownerId: string | null` (o `recipient` de `#lootRecipient` — em `splitLoot`,
   `null` e a bolsa é a dona) e `eligible: string[]` (os presentes no abate, o mesmo conjunto que
   `#deliverToBag` já registra). `rollLoot` continua rodando no abate, na mesma ordem (o contrato de
   semente da FUN-63 não muda); o que muda é o **destino**: o resultado vai para o cadáver, e sai de
   lá pelas decisões 3 e 4. Supply e munição (`supplyId`/`ammunitionId`, #520) continuam creditando
   o estoque abstrato no abate — não são item, não têm cadáver. Hunt sem `corpseTtlMs` passa a ser
   erro de conteúdo: sem cadáver não há onde o loot esperar.

2. **Cada personagem tem um filtro de Quick Loot**, persistido em `botConfig.loot` (vocabulário v2,
   campo novo com default — como `follow`/`target` entraram sem subir a versão):
   `{ filter: 'accept' | 'skip', itemIds: string[], autoSell: string[] }`. Default: `skip` com lista
   vazia (pega tudo — o comportamento de hoje). `autoSell` é a autovenda **individual** do PRD §22.1
   que `items.md` marca como não implementada: ao coletar, o item da lista é vendido ao `value` do
   catálogo e vira `goldDelta`/`goldGained` na hora (o mesmo caminho da autovenda de party, #395),
   com o limite `party.autoSellItemTypes { free: 5, premium: 20 }` lido do Premium do próprio
   personagem. O filtro é escrito pelo mesmo `bot-config` (C2S 11) e viaja pelo write-behind do ADR
   0028 — nenhum opcode novo para configurá-lo.

3. **O bot coleta no abate, com o filtro do dono — o `autoLoot` do Canary, sem a trava de Premium.**
   No mesmo evento de morte, depois de `rollLoot`, o ruleset move do cadáver para a mochila do dono
   tudo que o filtro aceita e cabe pela capacidade (`inventory.add`); vende o que está em `autoSell`;
   o resto **fica no cadáver**. Nada aqui consome RNG novo, e o resultado é função só do filtro e da
   capacidade — o invariante 3 fica intacto: a hunt desanexada rende exatamente o que a anexada
   rende. Em party: `splitLoot` ligado → o filtro é o `collect` do líder (ADR 0035 d.2) e o destino
   é a bolsa, como hoje; `splitLoot` desligado → o dono sorteado do cadáver coleta com o próprio
   filtro. No Canary o `autoLoot` é Premium; aqui é para todos, porque o modo default do jogo é
   ninguém estar olhando (invariante 11) — divergência registrada em `docs/product/items.md`.

4. **Quem está olhando pode pegar o que o filtro deixou.** Três intenções novas (invariante 4):
   `open-corpse { groundItemId }` → S2C `corpse-contents { groundItemId, gold, items[] }`;
   `take-loot { groundItemId, instanceId | null }` (`null` = Quick Loot manual: aplica o filtro,
   como o clique do Tibia; `instanceId` = este item, ignorando o filtro, como arrastar da janela do
   cadáver); e `take-loot` sobre a bolsa de party segue as regras da bolsa. O servidor confere dono
   (`ownerId === characterId` ou `eligible` contém o personagem — o `canOpenCorpse` da party),
   distância ≤ 1 no mesmo andar (o `canUse` do Canary; o cliente manda `walk-to` antes, o servidor
   recusa `too-far-away` sem andar por ele) e capacidade. Sucesso é `inventory` + `corpse-contents`
   atualizados e um `system-message` com o texto do Tibia ("You looted 1 item"); recusa é
   `system-message` em palavras (FUN-73). `ground-item-appear` ganha `lootable: boolean` (o destaque
   de loot do cliente) — opcional, um nó anterior manda sem.

5. **O que não foi pego some com o cadáver, destruído.** `#onCorpseDecay` descarta `items`; nenhuma
   linha de ledger ou `item_instance` é criada — o item no cadáver **ainda não é instância no banco**,
   pela mesma razão que a Caixa de Loot nunca foi (expirar precisa significar que nunca existiu). O
   `instanceId` determinístico (`sessionId:n`, `lootSeq`) continua sendo gasto no sorteio, e um id
   queimado por item nunca pego é aceitável: a idempotência do invariante 10 vem da identidade
   previsível, não da contagem contígua. `aggregates.itemsLooted` passa a contar o que **entrou na
   mochila ou foi vendido**, não o que caiu — o analisador deixa de contar item que apodreceu.

6. **A vida do loot é a vida do cadáver.** `corpseTtlMs` da hunt hoje; a cadeia `decayTo` por monstro
   quando #585 pousar. Não existe "prazo do loot" separado — é um número só, o do Tibia.

7. **A Caixa de Loot é retirada.** `CharacterRuntime.lootBox`, `LootBoxStore`, a chave
   `lootbox:{sessionId}` e a métrica `draconya_loot_boxes_pending` saem. O caso que ela cobria —
   loot que não cabe pela capacidade — passa a ser "fica no cadáver" (é o que o Canary faz:
   `RETURNVALUE_NOTENOUGHCAPACITY` deixa o item onde estava). O registro `backpack-full` do extrato
   continua, uma linha por sessão. Nada a migrar: as chaves em Redis expiram sozinhas em 30 min.

8. **Descartar é destruir; vender é ledger; nada vai ao chão.** O único container no chão é o
   cadáver, e ele só recebe o que o monstro deixou. Duas intenções para o que o jogador não quer:
   `sell-items { instanceIds[] }` — vende ao `value` pelo ledger (é o "Despachar loot" do ADR 0032
   d.12, generalizado para N itens; `value: 0` é recusado com "ninguém compra isto") — e
   `discard-item { instanceId }` — destrói, sem valor, com a confirmação no cliente. As duas rodam
   dentro da sessão dona (hunt ou Cidade; invariante 9) e o extrato ganha `removedInstances:
   string[]` para o `jobs` apagar as linhas na mesma transação do ledger. É a primeira vez que um
   item muda de existência dentro de uma sessão — `items.md` §"Como o item vai e volta do banco"
   ("item não muda de dono dentro da sessão") ganha a exceção nomeada.

## Alternativas

- **Janela de loot só, sem filtro (o jogador escolhe a cada cadáver).** Descartada pelo
  invariante 3: a hunt desanexada não teria como escolher, e "loot só quando alguém olha" é o
  oposto de idle-first.
- **Filtro só, sem cadáver (o bot descarta o que o filtro recusa no abate).** É o que a party faz
  hoje. Descartada porque não entrega o pedido — o jogador que está olhando não consegue pegar o que
  o filtro recusou —, e porque o Tibia real dá ao cadáver exatamente esse papel de "segunda
  chance".
- **Item não pego vai para uma Caixa de Loot resgatável na Cidade.** Descartada: é mais
  infraestrutura (leitura, resgate, UI, TTL) para reproduzir o que o cadáver já faz com um prazo
  igual ao do Tibia, e a caixa atual prova que "guardar para depois" sem tela vira dado morto.
- **Cadáver com loot também para monstro sem dono (qualquer um pega).** Descartada: o
  `CORPSEOWNER` do Canary existe para party e PvE justo; sem dono, um membro fora da elegibilidade
  pegaria loot que a bolsa reservou.
- **Manter a Caixa de Loot como transbordo por capacidade.** Descartada: duas filas de "não coube"
  (cadáver e caixa) com prazos diferentes seriam duas regras para explicar; o Canary tem uma.
- **Largar item no chão (`drop-item`) como no Tibia.** Descartada: na hunt instanciada o chão morre
  com a sessão; na Cidade compartilhada (ADR 0023) vira lixo no shard. Destruir e vender cobrem o
  que o jogador precisa, e `items.md` continua com "sem item solto no chão" — agora com a exceção
  única, o cadáver.

## Consequências

- `CorpseState` cresce (itens por cadáver) e entra no snapshot como hoje (`corpses?`), campos
  opcionais — sem bump de `SNAPSHOT_FORMAT_VERSION`. Snapshot anterior lê cadáveres vazios.
- O caminho quente do abate ganha um laço pelo filtro (lista pequena) e a venda automática — custo
  proporcional ao loot, não à população.
- O cliente ganha a **janela de cadáver** (reaproveitando `ContainerWindow`) e a **aba Loot** da barra
  (aceitar/ignorar por item do catálogo, autovenda com o limite do Premium). O clique no cadáver e a
  intenção de andar até ele são do `shell`, como `select-target`.
- `docs/product/items.md` reescreve §"Loot de item e a Caixa de Loot da Sessão" e as regras "sem
  itens físicos no chão"/"Caixa de Loot"; `hunt.md` §"Divergências" troca "cadáver só visual" por
  "cadáver com loot e dono"; `party.md` ganha a leitura literal de "fica no cadáver"; `bot.md` ganha
  o bloco `loot` do vocabulário; `economy.md` ganha a autovenda individual.
- `docs/tibia-parity-plan.md` §3: a linha "cadáver como container" sai da tabela de fora do escopo
  com referência a este ADR. O ADR 0025 d.8 e o ADR 0019 (emenda do cadáver) ganham a nota.
- O que piora: mais uma superfície em que capacidade e peso são conferidos (o take manual); e a
  primeira operação de "apagar `item_instance`" pelo `jobs`, que precisa do mesmo cuidado de
  idempotência do resto do extrato.

## Invariantes afetados

Nenhum muda de texto. **3** é quem impõe a decisão 3 (o filtro coleta no abate, sem plateia).
**4** — `open-corpse`, `take-loot`, `sell-items`, `discard-item` são intenções; dono, distância,
capacidade e preço são do servidor. **9** — só a sessão dona toca cadáver, mochila e filtro; o
`api` continua sem escrever nada. **10** — venda (automática ou manual) entra em `goldGained` e
`removedInstances` viaja no extrato com `(session_id, seq)`; item apodrecido nunca existiu no
banco. **11** — o `autoLoot` sem trava de Premium é a automação legítima.
