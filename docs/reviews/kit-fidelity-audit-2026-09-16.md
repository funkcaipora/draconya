# Auditoria de fidelidade ao ui_kit — 2026-09-16

**O que é:** a evidência bruta por trás do ADR 0030 e de docs/kit-fidelity-plan.md. Nove regiões
do kit auditadas contra o cliente por agentes independentes, cada achado re-verificado por um
verificador adversarial (veredito confirmado/corrigido/refutado — nenhum refutado), mais o mapa de
capacidade do protocolo e o crítico de completude. 148 achados confirmados.

**Como ler:** os caminhos tmp-design-kit/handoff/... apontam para o handoff "Design System MMORPG
Medieval" (Claude Design, 2026-09-15), que não é versionado (ADR 0029 D9) — a estrutura interna
(ui_kits/draconya/*.jsx, components/core/, tokens/, guidelines/) é a do zip, que fica com o dono
do projeto. Os caminhos packages/... são o cliente real na data da auditoria (pós-M14, commit
3299eb5). As citações arquivo:linha foram conferidas linha a linha pelos verificadores.

---

## Mapa de capacidade do protocolo

## MAPA DE CAPACIDADE — protocolo → HUD do kit

Fonte de verdade lida: `packages/protocol/src/messages.ts` (opcodes), `packages/protocol/src/types.ts` (schemas), emissores em `packages/server/src/game/host.ts` e `packages/server/src/game/catalogue.ts`, e o que `packages/sim/src` calcula mas não necessariamente expõe. Cruzado com `docs/design-system-plan.md` §4 e `docs/adr/0029-*.md`. Cada `FALTA` diz se é **transporte** (o servidor já tem o número, só não manda) ou **mecânica inexistente** (o `sim`/`content` não calcula isso).

---

### Vitais (hp/mana/soul/stamina/speed/capacidade)

**TEM:**
- `health`, `maxHealth`, `mana`, `maxMana`, `level`, `xp`, `capacity`, `gold`, `staminaMs` — `player-stats` (opcode 9, `messages.ts:38`), schema em `types.ts:539-550`, montado em `playerStatsOf` (`host.ts:285-304`) e reenviado só quando muda (`sameStats`, `host.ts:319-331`, comparação por MINUTO na stamina).
- Os mesmos campos, no reattach, em `session-state.self` (`types.ts:223-231`).
- `gold` já é o SALDO (`gold + goldDelta`), não o valor de entrada — comentário em `host.ts:276-283`.

**FALTA:**
- `speed` — mecânica existe (`CharacterRuntime.speed`, `character.ts:179,217`; `speedScale()` via haste, `character.ts:232-233`), **transporte**: nenhum campo de `player-stats`/`session-state` carrega. Confirma `docs/design-system-plan.md:235`.
- `soul` (Soul Points) — **mecânica inexistente**: não há campo em `character.ts`, `progression` nem em nenhum schema de `content`. Nada para transportar.

---

### Skills + Magic Level + % para o próximo

**TEM (só no `sim`, nada trafega):**
- `Skills` por personagem, com `level` e `points` acumulados (`packages/sim/src/skills.ts:15-19,41+`); `pointsForLevel` dá o custo do próximo nível (`skills.ts:36-39`), o que permitiria calcular a % de progresso.
- "Magic Level" é a skill `magic` do catálogo de conteúdo (`packages/content/data/skills/magic.json`), usada em `casting.ts:133-176` para escalar magia (`scaling.skillLevel`).

**FALTA (transporte, 100%):**
- Nenhum opcode carrega `skills`, nível de magia ou pontos-para-o-próximo. Nem `player-stats` nem `session-state` têm o campo. É exatamente a lacuna SV-04 do plano (`design-system-plan.md:235`) — a tela teria que nascer do zero, mas a conta já existe no `sim`.

---

### XP total / level / XP para o próximo

**TEM:**
- `xp` e `level` em `player-stats`/`session-state.self` (mesmas fontes acima).

**FALTA:**
- "XP para o próximo level" — **mecânica existe** (curva de XP em `progression.ts`/`content`), **decisão de produto explícita de NÃO expor**: comentário em `types.ts:359-364` diz que a curva de XP não vai ao catálogo de propósito, para não virar métrica oficial comparável entre hunts. Fica de fora por design, não por falta de dado.

---

### Party (membros, vocação, level, mana, DPS/HPS, gasto por membro, bolsa, rateio)

**TEM:**
- `party-state` (opcode 24): `leaderId`, `mode` (`split`/`shared`), `members[]` com `characterId`, `name`, `alive`, `healthPercent` (`types.ts:169-179`, montado em `#partyBlock`, `host.ts:1804-1823`).
- `party-bag` (opcode 25): `gold`, `items[]` (instanceId/itemId/quantity), `weight`, `capacity` — capacidade é a SOMA dos presentes, recalculada a cada envio (`host.ts:1826-1830`).
- `party-settlement` (opcode 26): `total` + `shares[]` por `characterId` (o rateio final do gold da bolsa).
- Alvo/postura do bot (política de alvo, seguir/manter distância) — ver seção "Automações" abaixo, é o mesmo mecanismo.

**FALTA:**
- Vocação, level e mana de cada membro — **transporte**: `party-state.members` só tem nome/vivo/HP%; o servidor SABE (`hosted.session.participants` tem tudo), só não monta o campo. = SV-03 do plano.
- DPS/HPS — **mecânica inexistente**: não há acumulador de dano-por-segundo em lugar nenhum de `sim` (`grep dps/hps` vazio). Precisaria de janela deslizante nova, não só expor campo.
- Gasto de CADA membro — **mecânica existe só para o PRÓPRIO**: `Aggregates` é por participante (`session.ts:129,445`, `aggregatesOf`), mas `sentAnalyzer`/`analyzer` só é mandado a quem OLHA aquele personagem (`host.ts:1767-1770`, comentário "quem olha um membro vê os dele, não a soma"). Um membro não recebe o `analyzer` dos outros — não dá para montar "gasto de cada um" sem uma mensagem nova que agregue e mande a TODOS.
- "Rateio de custos" e "Dividir loot" como dois interruptores — **mecânica não bate**: o modo é UM campo (`split`/`shared`) fixado na proposta (`PartyState.mode`), não dois toggles independentes.
- Valor estimado da bolsa da party — **transporte**: `party-bag.items` não leva `value` (existe em `content/items/*.json`, campo obrigatório — `schemas.ts:319` —, mas `catalogue.items` não o repassa; ver seção Cyclopedia/Personagem abaixo).
- "Cap reservado" da bolsa — **mecânica inexistente**: não há conceito de reserva no `sim`.

---

### Analisador ao vivo

**TEM:**
- `analyzer` (opcode 20): `aggregates` + `notableEvents` NOVOS desde a última entrega, mandado quando muda (abate/loot/gasto/level/morte) — `types.ts:299-302`, gatilho em `sameAnalyzer` (`host.ts:352-364`).
- `Aggregates`: `durationMs`, `xpGained`, `goldGained`, `goldSpent`, `kills`, `deaths`, `itemsLooted`, `suppliesUsed`, `bestBasicHit`, `bestSpellHit` (`types.ts:52-69`).
- Por-hora — **decisão de produto**: propositalmente NÃO vai pela rede (comentário `types.ts:71-77`); é `valor / durationMs`, calculado no cliente. Já é assim no `Analyzer.tsx` atual (`perHour`).
- Tempo de sessão — `durationMs` dentro de `Aggregates`.

**FALTA:**
- Suprimentos usados COM contagem e custo por item — **mecânica inexistente**: `suppliesUsed` é um contador agregado único (`Aggregates.suppliesUsed: number`); não há breakdown por `supplyId`. Precisaria de estrutura nova no `sim` (`session.credit` grava só a chave agregada) e novo campo no protocolo.
- Loot recolhido com valor por item — mesma lacuna: `itemsLooted` é contador único; não há lista por item nem soma de `value`.
- Dano causado/recebido por fonte (criatura/magia/arma) — **mecânica inexistente**: não há acumulador por fonte em `combat-events.ts`/`session.ts`, só `bestBasicHit`/`bestSpellHit` (o MAIOR golpe, não o total por fonte).
- Tempo até o próximo level — mesma decisão de produto da seção XP acima (curva de XP não sai do servidor).

---

### Battle list (criaturas, hp%, alvo seguido/targetId)

**TEM:**
- `creature-appear`/`creature-move`/`creature-disappear`/`creature-health` dão a lista de criaturas visíveis, posição, `health`/`maxHealth`, `appearanceId`, nome (`types.ts:36-49,266-273,509`).

**FALTA:**
- `targetId` (qual criatura o bot está mirando agora) — **transporte parcial/inexistente**: o `sim` sabe (`selectTarget` em `targeting.ts:71`), mas nada em `messages.ts`/`types.ts` carrega o alvo atual do personagem para o cliente. Grep por `targetId` em `protocol/src` não retorna nada — teria que ser campo novo em `player-stats` ou mensagem própria.

---

### Equipamento + capacidade

**TEM:**
- `inventory.equipped` (`slot → CarriedItem`) e `inventory.capacity: {used, total}` (`types.ts:341-350`, montado em `host.ts:1205`: `used = inventory.weight(catalog)`, `total = character.capacity` — o MESMO número de `player-stats.capacity`).
- 10 slots do jogo vêm do CONTEÚDO (`ITEM_SLOTS`, `content/src/schemas.ts:229`), não do protocolo — o cliente já sabe quais existem.

**FALTA:**
- Nada de transporte crítico aqui; a superfície "Cap usado/total" já está pronta.

---

### Containers (bolsa, mochila, contadores por item)

**TEM:**
- `inventory.backpack[]` e `inventory.satchel[]`, cada posição `CarriedItem | null` com `instanceId`, `itemId`, `quantity` (`types.ts:332-339`). Tamanho do container é o comprimento do array (cresce com upgrades).

**FALTA:** nada — superfície coberta pelo protocolo hoje.

---

### Buffs ativos com duração (haste, utamo vita, magic shield)

**TEM (só no `sim`):**
- `Conditions` por personagem: `haste`, `buff`, `mana-shield`, `heal-over-time`, cada um com `expiresAtMs` LÓGICO (`packages/sim/src/conditions.ts:14,24-35`).

**FALTA (transporte, 100%):**
- Nenhuma mensagem carrega condições ativas. Nem `player-stats` nem `session-state.self` têm o campo. = SV-05 do plano (`design-system-plan.md:248`).

---

### Bênção, EXP boost/bônus

**TEM (parcial):**
- Bônus de XP do Bestiário: `catalogue.bestiary.{milestones, xpBonusPercentPerMilestone}` (`types.ts:405-408`) — é permanente e global, não um "boost" temporário.

**FALTA:**
- Bênção (blessing) e boost de EXP (temporário, tipo scroll) — **mecânica inexistente**: `grep -rl blessing` em `content`/`sim`/`server`/`protocol` não retorna nada.

---

### Área atual + dificuldade + criaturas no alcance

**TEM:**
- `instance-enter`: `instanceId` (= id da SESSÃO, não da hunt), `map` (= `mapId` do `sim`, `hunt.ts:584-586`), `ambience` (`surface`/`cavern`) — `types.ts:261-265`, enviado em `host.ts:1741-1753`.
- "Criaturas no alcance" = a lista de `creature-appear` da instância (ver Battle list).

**FALTA:**
- `huntId` e `difficulty` — **transporte**: ambos existem no `sim` (`HuntRuleset` guarda `this.#difficulty`, `hunt.ts:463,555`; `huntId` está em `options.hunt.id`), mas `instance-enter` só manda `map`, não `huntId`/`difficulty`. Hoje não há NENHUM opcode que devolva qual hunt/dificuldade está em curso — nem em `session-state`. Ver AVISOS.

---

### Jogadores online

**FALTA (mecânica + transporte):**
- Ninguém CONTA. `SessionHost.viewerCount` existe (`host.ts:589-593`) mas é uma métrica interna do processo, não agregada entre nós nem exposta por mensagem nenhuma. = SV-07 do plano; precisa de diretório de sessões + mensagem nova.

---

### Gems / loja / premium

**TEM (fora do protocolo de jogo):**
- `premiumUntil` existe na coluna do personagem e sai pela API HTTP (`GET /api/characters`, `packages/server/src/api/characters.ts:190`) — não pelo WebSocket.

**FALTA:**
- Moeda de loja (Draconya Coins/gems), catálogo de loja, leilão — **mecânica inexistente** por completo (E13/E7, `docs/product/` ainda não escrito).

---

### Posturas de combate (defensiva/balanceada/atacante)

**FALTA (mecânica inexistente):**
- Não existe "stance" de combate no `sim` — confirmado pelo ADR 0029 (D2, `Stance` ficou de fora do kit de primitivos por isso) e pelo design plan (`design-system-plan.md:243`). O que existe com nome parecido é `botPostureSchema` (`stand`/`follow`/`keep-distance`, `content/src/schemas.ts:873-877`), que é POSICIONAMENTO do bot, não uma stance de dano/defesa. As "stances reais" seriam magias de vocação com mana e cooldown — não modeladas ainda.

---

### Conjunto (set de ações) e alvo do bot

**TEM (opaco, avançado, gated por level):**
- Política de alvo do bot: `nearest`/`lowest-hp`/`highest-hp`, `prioritize[]`, `ignore[]`, postura `stand`/`follow`/`keep-distance` — schema `botTargetingSchema` (`content/src/schemas.ts:887-897`), transportado OPACO dentro de `bot-config` (C2S, `types.ts:132`) e devolvido em `session-state.botConfig` (opcional, `types.ts:251`). O que a tela pode OFERECER (não os valores atuais fora da configuração) vem em `catalogue.bot.advancedOnly.{conditions, targetPolicies, postures}` e `catalogue.bot.advancedFromLevel` (`types.ts:420-428`, montado em `catalogue.ts:39-47`).
- Isso cobre exatamente o modal "Lure e alvo" do kit (política, priorizar/ignorar, follow/postura) — é mecanismo pronto, só precisa de tela (M15 SV-09 no plano).

**FALTA:**
- "Conjunto" por elemento (Energia/Fogo/Gelo/Sagrado) — **mecânica inexistente**: não há sistema de elementos de dano no `sim`/`content` (ver Cyclopedia abaixo). Não dá para modelar "conjunto elemental" sem isso existir primeiro.
- Barra de ações manual em si — decisão de arquitetura (ADR 0029 D5): não há intenção C2S de "usar agora"; toda ação de combate é regra do bot avaliada no servidor. Fica para o E10.

---

### Automações (bot: renovar anel/colar, trocar munição por alvos, trocar arma/escudo por HP, comer)

**TEM (vocabulário genérico, não o específico do kit):**
- Regras do bot: UMA condição + UMA ação por linha, 4 condições (`hp`, `mana`, `targets`, `target-hp`, `content/src/schemas.ts:816-836`) × 3 tipos de ação (`spell`, `supply`, `item`, `schemas.ts:846-850`), organizadas em 5 categorias (`heal`, `potion`, `attack`, `rune`, `support`, `BOT_CATEGORIES`) com slots por categoria (`catalogue.bot.slots`).
- Regras de saída: `hp-below`, `out-of-gold`, `party-member-lost` (`botExitRuleSchema`, `schemas.ts:932-944`) — cobre exatamente o popover "Sair sozinho quando…" do kit, MENOS "acabar a capacidade".
- Ring swap: mecanismo completo e pronto (`botRingSwapSchema`: `itemId`, `equipBelow`, `removeAbove`, `manaFloor`, `restorePrevious` — `schemas.ts:977-990`), transportado opaco dentro de `bot-config`.
- Lure dinâmico: `botLureSchema` (`min`/`max` com histerese, `schemas.ts:962-968`).

**FALTA:**
- "Renovar anel/colar quando as cargas acabarem" — **mecânica inexistente**: `item.charges`/`item.durationMs` existem no SCHEMA (`content/src/schemas.ts:344-345`) mas "declarados e ainda não consumidos por ninguém" (comentário linha 338-342) — nada no `sim` decrementa carga ou expira por tempo. Não tem como "renovar quando acabar" o que nunca acaba.
- "Trocar munição/arma por condição composta" como uma automação nomeada — **mecânica não bate**: o vocabulário do bot é condição→ação simples (uma linha, um gatilho); o que o kit desenha ("Automações" com nome/resumo/liga-desliga por regra combinada) é um nível de abstração acima do que existe. Precisa de vocabulário novo (E4 no plano).
- Regra de saída "acabar a capacidade" — **mecânica inexistente**: não está em `botExitRuleSchema`; precisaria de `kind` novo em `content` + `sim` (SV-06 no plano).
- Nenhum item `ring`/`amulet` existe hoje em `packages/content/data/items` — o mecanismo de ring swap está pronto mas sem NENHUM anel no catálogo para apontar (`itemId` de `ringSwap` não resolveria).

---

### Ações/hotkeys/cooldowns/contagem de consumíveis

**FALTA (mecânica não bate com o desenho do kit):**
- Não há intenção C2S de "usar agora" — toda ação é avaliada pelo bot no servidor (ADR 0029 D5). Cooldowns existem no `sim` (`Cooldowns`, casting.ts) mas nunca saem por protocolo, porque não há ação manual para ter cooldown visível.
- **Achado importante**: "contagem de consumíveis" (quantas poções/runas restam) não é um dado que FALTA transportar — é uma mecânica que NÃO EXISTE assim. Supplies (poções, runas) não são item de inventário: não têm peso, slot nem instância — usar debita GOLD diretamente (`content/CLAUDE.md`, "Magia e supply"; `casting.ts`). O mesmo vale para munição (`ammunition/*.json`): é seleção por família, ilimitada, com preço por tiro, não um estoque contável. O kit desenha "Mana Potion c:160" como se fosse contagem de itens em estoque; o motor modela como consumo pago por gold a cada uso. Isso é incompatibilidade de MODELO, não lacuna de campo — mudar exigiria decisão de produto (virar supply em item empilhável) antes de qualquer trabalho de protocolo.

---

### Cyclopedia (Itens: Atq/Def, peso, descrição, dropado por; Bestiário; Bosstiary)

**TEM:**
- Bestiário: `bestiary.counts` (S2C, opcode 21, `id do monstro → abates`) e `catalogue.bestiary.{milestones, xpBonusPercentPerMilestone}` — cobre contagem e marcos, SEM "estágios ★" nomeados.
- `catalogue.items[]`: `id`, `name`, `appearanceId`, `weight`, `slot`, `twoHanded`, `weapon.{kind,range,ammoFamily}` (`catalogue.ts:79-99`).

**FALTA:**
- Atq/Def (attack/armor) do item — **transporte**: EXISTEM em `content/items/*.json` (`itemSchema.attack`, `.armor`, `schemas.ts:325-326`), mas `buildCatalogue` NÃO os copia para `catalogue.items` (comparar `catalogue.ts:79-99` — não há `attack`/`armor` no map). = SV-01 do plano.
- `value` (preço de venda) do item — mesma lacuna de transporte: campo obrigatório em `content` (`schemas.ts:319`), ausente em `catalogue.items`. É o que impede "valor estimado" da bolsa da party e "PEGAR/VENDER".
- Descrição e "dropado por" — **mecânica inexistente**: `itemSchema` não tem campo de descrição textual; "dropado por" exigiria varrer `loot` de todos os monstros (dá para DERIVAR no servidor, mas nada monta isso hoje).
- Bosstiary (ciclo, cooldown de boss) — **mecânica inexistente**: não há conceito de boss no `content`/`sim`.
- Resistências elementais / elementos que a criatura causa — **mecânica inexistente, não é só transporte**: `monsterSchema` (`content/src/schemas.ts:391-427`) não tem NENHUM campo de elemento ou resistência; `attack` é só um número/faixa genérico. Não existe sistema de dano elemental em lugar nenhum do `sim` (`grep -rn element` em `combat/damage.ts` e `schemas.ts` vazio). O quadro de resistências do kit (Físico/Fogo/Terra/Energia/Gelo/Sagrado/Morte) não tem onde nascer sem essa mecânica ser criada primeiro.

---

## AVISOS (pegadinhas)

1. **`instance-enter` não é a resposta de "qual hunt"**: `instanceId` é o id da SESSÃO (`hosted.session.id`), não o `huntId`. Só `map` (`hunt.ts:584-586`, o id do MAPA físico) sai. Se hoje `map === huntId` por convenção de nomeação de conteúdo, isso não é contrato — nada impede uma hunt futura reusar um mapa, e um agente que tentar "adivinhar a hunt pelo mapId" está pisando em relação implícita, não em dado.
2. **Difficulty não trafega em NENHUMA mensagem**, nem em `instance-enter` nem em `session-state`. O único jeito de o cliente saber a dificuldade hoje é lembrar do que ELE MESMO mandou em `enter-hunt` — e isso se perde num reload de página ou numa reconexão a uma sessão que outra aba (ou o próprio bot, sozinho) começou.
3. **`player-stats.capacity` e `inventory.capacity.total` são o MESMO número**, escrito no mesmo lugar (`host.ts:1205`, `character.capacity`). Não é inconsistência, mas quem for desenhar a tela de equipamento deve ler os dois de `inventory` (used+total juntos), não misturar a fonte de `total` com `player-stats` — são coincidentes hoje, não garantidamente sincronizados se algum dia um dos dois caminhos mudar independentemente.
4. **`analyzer`/`sentAnalyzer` é por PERSONAGEM, não por sessão** (`host.ts:1767-1770`, comentário explícito): numa party, cada jogador só recebe os PRÓPRIOS agregados. Se o dono do produto quer "gasto de cada membro" visível a todos, isso não é ligar um campo — é uma mensagem nova que agregue e distribua os N conjuntos de aggregates a TODOS os visualizadores da sessão, o que hoje não acontece (comparar com `party-bag`, que é da sessão inteira e vai a todos).
5. **`session-state.botConfig` é opcional e OPACO** (`z.unknown()`, `types.ts:251`): ausência não distingue "nunca configurou" de "nó `game` anterior sem o campo". Uma tela que espera ver as regras do bot ao entrar precisa tratar `undefined` como "sem regras", não como erro.
6. **Bestiário e stats "ao vivo" só são recomparados com visualizador presente** (`sentStats`/`sentBestiary`/`sentAnalyzer` só são atualizados em ciclo COM viewer, `host.ts` comentários nas linhas 429-440, 452-457): o `sim` sempre calcula certo (invariante 3), mas um campo novo que dependa desse mecanismo de "só manda quando muda" precisa lembrar que a comparação é responsabilidade de quem adiciona o campo — esquecer de incluí-lo em `sameStats`/`sameAnalyzer` faz a mudança existir no servidor e nunca chegar à tela.
7. **`charges`/`durationMs` de item estão no schema mas são mortos** — qualquer automação "renovar quando acabar" implica primeiro implementar o consumo de carga/duração no `sim` (que hoje não existe), não só expor o campo por protocolo.
8. **Nenhum item `ring`/`amulet` existe no catálogo de conteúdo hoje** — o modal "Ring swap" do kit não tem NENHUM anel real para escolher em produção, mesmo com o mecanismo (`botRingSwapSchema`) pronto e testado.
9. **Supplies e munição não são "estoque"** — antes de desenhar qualquer contador de consumível (poções, runas, flechas) na barra de ações, é preciso decidir se o modelo econômico muda (virar item empilhável) ou se a tela deve mostrar "custo por uso" em vez de "quantidade restante", porque hoje literalmente não existe uma quantidade a mostrar.
10. **Resistência elemental e elementos causados não existem em NENHUMA camada** (`content`, `sim`, `protocol`) — isso não é um "falta transportar campo", é ausência de sistema inteiro (dano é um número genérico, sem tipo). Qualquer tela que desenhe ícones de elemento/resistência hoje estaria inventando dado no cliente, o que o invariante 4/D8 proíbe.

---

## Arquivos consultados (evidência)

- `packages/protocol/src/messages.ts` — tabelas de opcode C2S/S2C completas.
- `packages/protocol/src/types.ts` — todos os schemas Zod C2S/S2C.
- `packages/server/src/game/host.ts` — `playerStatsOf`/`sameStats` (267-331), `SentAnalyzer`/`sameAnalyzer` (342-364), `bestiaryTotal` (377-381), `#sendState` (1741-1771), `#presentParty`/`#partyBlock` (1779-1834+), inventário (1205).
- `packages/server/src/game/catalogue.ts` — `buildCatalogue` completo (27-144), `lootDropsOf`/`monsterOutfitsOf` (158-185).
- `packages/sim/src/character.ts`, `skills.ts`, `casting.ts`, `conditions.ts`, `targeting.ts`, `session.ts`, `inventory.ts`, `stamina.ts` — o que o `sim` calcula sem expor.
- `packages/content/src/schemas.ts` — `itemSchema`, `monsterSchema`, vocabulário do bot (`botConditionSchema`, `botActionSchema`, `botExitRuleSchema`, `botLureSchema`, `botRingSwapSchema`, `botTargetingSchema`, `botPostureSchema`).
- `packages/server/src/api/characters.ts` — `premiumUntil` fora do socket, só HTTP.
- `docs/design-system-plan.md` §4, `docs/adr/0029-client-design-system-and-fixed-shell.md` — decisões vigentes confrontadas linha a linha com o código atual; nenhuma divergência relevante encontrada entre a tabela do §4 e o estado real do código, exceto os detalhes de nuance registrados acima (ex.: `attack`/`armor`/`value` existem em `content` mas não em `catalogue`, o que o §4 já registra corretamente como "só no conteúdo").
- `tmp-design-kit/handoff/ui_kits/draconya/{data.js,README.md}` — o que o kit desenha, usado como lista de superfícies a checar.

Nenhum arquivo foi modificado; nenhum comando de build/test/servidor foi executado, conforme escopo da tarefa.


---

# R0-fundacao

## Conformes
- Kicker (primitivo)
- Badge (primitivo, 10 tons)
- Select (primitivo, 3 tamanhos)
- StatRow (primitivo)
- Tabs (primitivo, variantes pill/underline)
- Switch (primitivo, tons gold/traffic)
- Input (primitivo, incl. resolução do NumField via size="sm" type="number")
- Modal (scrim, animação dsAppear/ui-appear, dimensionamento, fechar por clique-fora e X)
- Panel — estrutura base (fio dourado, header 34px, tipografia do título, footer, scroll do corpo)
- Slot — estilo visual base (cores, radius, hover, selected, dashed, rótulo de vazio)
- VitalBar — estrutura (grid, track, label, texto sobreposto)
- Checkbox — estilo visual base (marca, cores, hover)
- IconButton — estilo visual base (cores, hover, glifo 13px mono)
- Button — estrutura, variantes de cor e estados hover/active/disabled
- tokens/colors.css (paleta idêntica byte-a-byte)
- tokens/spacing.css — space-1..9 e radius-xs/sm/md/lg/pill
- tokens/effects.css — shadows/glows/gradientes/motion/blur (valores declarados)
- tokens/typography.css — famílias, tamanhos de fonte e tracking declarados
- Fonte Cinzel self-hosted (mesma origem, peso 400-900 idêntico ao kit)

## Achados

### [R0-01] Reset global de box-sizing — fidelidade (confirmado)
- kit: tmp-design-kit/handoff/ui_kits/draconya/index.html:4 — `*{box-sizing:border-box}` aplicado a todo o app; é o que faz um `<Slot size={36}>`/`<IconButton size={36}>` do kit renderizar exatamente 36×36 mesmo tendo border/padding somados.
- cliente: packages/client/index.html (sem reset) e packages/client/src/shell/shell.css (nenhuma regra `*{box-sizing:border-box}`); só 5 seletores isolados setam `box-sizing:border-box` à mão (ui.css:141 `.ui-input-field`; shell.css:62,119,460,719). `.topbar-icon-button` (shell.css:102-106, width:36px + padding:1px + border 1px) e `.ui-slot` (ui.css:437-451, width/height:var(--slot-size) + border 1px) ficam em content-box por padrão do navegador.
- proposta: Adicionar `*, *::before, *::after { box-sizing: border-box; }` no topo de shell.css (antes dos imports de tokens/ui, ou junto do `:root`). Sem isso, TODO primitivo com borda e tamanho fixo (Slot, IconButton, Panel, Switch, Badge, Select, VitalBar-track, Button) renderiza 2×(largura da borda) maior que o valor exato do kit — no ícone do topo (36px + 1px padding + 1px borda) o total vira 40px de conteúdo em vez de 36px totais.

### [R0-02] Chrome de janela (Panel) não aplicado a 7 seções reais do HUD — fidelidade (corrigido)
- kit: components/core/Panel.jsx:4-8 — toda janela do kit usa o mesmo header 34px, mono dourado maiúsculo, fio dourado no topo, fundo `--grad-panel`.
- cliente: packages/client/src/shell/shell.css:212-223 — comentário do próprio arquivo: `.analyzer-head` é "o 'Panel' informal de antes do design system", listado como usado por `ContainerWindow`, `Bestiary`, `PartyMembers`, `EquipmentPanel`, `AmmoPicker`, `PartyBag`, `PartyPanel`. Confirmado por leitura: PartyPanel.tsx:52, PartyMembers.tsx:48, BattlePanel.tsx:76, Bestiary.tsx:105/123, EquipmentPanel.tsx:56, ContainerWindow.tsx:45, AmmoPicker.tsx:33 renderizam `<header className="analyzer-head">` (padding 4px 6px, sem cor/tamanho de fonte próprios) dentro de `.windows > section > header` (shell.css:137-144: 12px branco `#fff`, fundo `var(--window-head)`) — nenhuma cor dourada, nenhuma tipografia mono, nenhum fio dourado. Só Analyzer.tsx, CharacterPanel.tsx, Chat.tsx, PartyBag.tsx e HuntsModal.tsx (via Modal) já usam `ui/Panel`.
- proposta: Migrar as 7 seções para `<Panel dock>`, encerrando a dívida já rastreada (DS-10 a DS-17 no comentário do próprio shell.css). Nota: a lista do comentário está desatualizada — PartyBag.tsx já usa `ui/Panel` (linha 14/32), então são 6 arquivos pendentes, não 7.
- CORREÇÃO do verificador: Achado procedente, mas a conta final está errada. `BattlePanel.tsx:76` TAMBÉM renderiza `<header className="analyzer-head">` (confirmado) e NÃO está nos sete nomes listados no comentário de shell.css:212-217 (`ContainerWindow, Bestiary, PartyMembers, EquipmentPanel, AmmoPicker, PartyBag, PartyPanel`) — ele é tratado como dívida separada, documentada à parte no mesmo arquivo (shell.css:634-637: "DÍVIDA CONHECIDA: quando o primitivo `Panel` de DS-04 chegar a esta seção, `.battle-panel`/`.battle-list` são substituídos por ele"). Como `PartyBag` já migrou (correto) mas `BattlePanel` precisa migrar e nunca esteve na lista original, o número real de arquivos ainda pendentes continua sendo SETE (`PartyPanel`, `PartyMembers`, `BattlePanel`, `Bestiary`, `EquipmentPanel`, `ContainerWindow`, `AmmoPicker`), não seis — `BattlePanel` só substitui `PartyBag` na lista, não a reduz.

### [R0-03] Fonte JetBrains Mono self-hosted num único peso — fidelidade (corrigido)
- kit: tokens/fonts.css:4 — `@import` do Google Fonts com `wght@400;500;600;700`. O design usa esses pesos constantemente: Panel.jsx:7 `font:"500 7.5px var(--font-mono)"`, VitalBar.jsx:10 `"500 7.5px"`, Slot.jsx:10 `"500 6.5px"`, Hud.jsx:29 `"700 9.5px"` (pílula de gold).
- cliente: packages/client/src/shell/fonts.css:22-28 — `@font-face` de JetBrains Mono declara só `font-weight: 400;` (valor único, não faixa). O arquivo `public/fonts/jetbrains-mono-latin.woff2` tem 92 KB — grande demais para um único peso estático, indício de fonte variável cuja faixa não foi exposta no `@font-face`. `ui.css:392` (`.ui-panel-title`), `:515` (`.ui-vital-text`), `:484` (`.ui-slot-count`) e `shell.css:89` (`.topbar-gold`) pedem peso 500/700 nessa família.
- proposta: Declarar a faixa de peso real do arquivo (ex.: `font-weight: 100 800;` se for variável, conferindo no próprio binário) em vez de `400` fixo — do contrário todo texto mono em 500/600/700 do HUD (títulos de painel, valores, pílula de gold) sai em negrito sintético do navegador em vez do peso real do arquivo, diferente do kit (que carrega os pesos exatos via CDN).
- CORREÇÃO do verificador: O binário foi inspecionado com fontTools: `packages/client/public/fonts/jetbrains-mono-latin.woff2` NÃO tem tabela `fvar` — não é fonte variável, é a instância estática Regular (nameID6 `JetBrainsMono-Regular`, `OS/2.usWeightClass=400`) e não contém glifos em nenhum outro peso. A proposta do achado ("declarar a faixa real, ex. `font-weight:100 800`, se for variável") portanto não se aplica, e executá-la sem trocar o arquivo pioraria o resultado: o navegador passaria a confiar na declaração falsa e deixaria de aplicar negrito sintético (que hoje pelo menos aproxima visualmente o peso 700), renderizando texto 500/600/700 com os traços finos do Regular. A correção real é self-hostar arquivos estáticos adicionais (500/600/700) da mesma família, ou trocar pela fonte variável verdadeira do JetBrains Mono (que tem eixo `wght` de fato) — não apenas editar o número em `fonts.css`.

### [R0-04] Button — variantes primary/gold/ghost/text sem font-size próprio — fidelidade (corrigido)
- kit: components/core/Button.jsx:7,10,12 — `fs: size==="lg"?14:12` para primary/gold; `fs:12` fixo para ghost e text.
- cliente: packages/client/src/shell/ui.css:26-34 (`.ui-button-primary`), :38-46 (`.ui-button-gold`), :62-67 (`.ui-button-ghost`), :81-86 (`.ui-button-text`) — nenhuma dessas quatro regras define `font-size`. Sem override, herdam o `font: 13px/1.4 var(--font-body)` do `body` (shell.css:33).
- proposta: Adicionar `font-size: 12px` a `.ui-button-primary`, `.ui-button-gold`, `.ui-button-ghost`, `.ui-button-text` e `font-size: 14px` ao par com `.ui-button-lg` (como já existe para secondary/danger em `.ui-button-secondary`/`.ui-button-danger`, que corretamente fixam 9px).
- CORREÇÃO do verificador: Achado e evidência corretos (nenhuma das quatro classes define `font-size`, herdam os 13px do `body`). A proposta, porém, é ambígua de um jeito que gera regressão se seguida ao pé da letra: em `Button.jsx` do kit só `primary`/`gold` variam por tamanho (`fs: size==="lg"?14:12`) — `ghost` e `text` são fixos em `fs:12` SEMPRE, sem condicional nenhum, mesmo em `size="lg"`. Se o par "font-size:14px ao par com `.ui-button-lg`" for aplicado às quatro classes (como o texto sugere ao agrupá-las), `ghost`/`text` passam a mostrar 14px em botões grandes — divergindo do kit. A correção precisa é: `font-size:12px` nas quatro (`primary`,`gold`,`ghost`,`text`), e o overlay de 14px restrito a `.ui-button-primary.ui-button-lg, .ui-button-gold.ui-button-lg` apenas — nunca em `.ui-button-ghost.ui-button-lg`/`.ui-button-text.ui-button-lg`.

### [R0-05] IconButton — sem variante para o uso mais visível do kit (nav do topo, 36px) — fidelidade (confirmado)
- kit: ui_kits/draconya/Hud.jsx:22 — `<IconButton key={k} size={36} ...><img .../></IconButton>` para os 6-7 ícones de navegação do topo (o uso mais visível do primitivo em toda a interface). components/core/IconButton.d.ts:5 — `size?: number` livre.
- cliente: packages/client/src/shell/ui/IconButton.tsx:9,19 — `size?: 'sm' | 'md'` (15px/19px), sem opção de 36px. O TopBar (packages/client/src/shell/TopBar.tsx:33-60) não usa `IconButton` para os ícones de navegação — implementa `NavIcon`/`topbar-icon-button` do zero (shell.css:102-113), que também não tem regra `:hover` nenhuma (só `.topbar-icon-button-open` para o estado ativo).
- proposta: Adicionar um tamanho `lg` (36px) ao `IconButton` e reescrever `TopBar.tsx` para usá-lo, herdando de graça o estado hover (borda `--gold-3`/cor `--gold-5`) que hoje só existe no ícone ATIVO, nunca no hover de um ícone não-selecionado.

### [R0-06] Slot — size restrito a 26|30|36, mas o kit usa outros valores em telas reais — fidelidade (corrigido)
- kit: ui_kits/draconya/Modals.jsx:76 — bolsa da party usa `<Slot size={38}>` (PartyModal); Modals.jsx:100 — Ring swap usa `<Slot size={39}>` (SwapRingModal).
- cliente: packages/client/src/shell/ui/Slot.tsx:18 — `size: 26 | 30 | 36` (união fechada; comentário na linha 2-3 cita só os 3 valores do design-system-plan.md §1).
- proposta: Se as telas de bolsa da party e ring swap (M15 SV-17) entrarem com fidelidade estrita ao kit, o tipo de `size` precisa aceitar 38 e 39 também (ou o design decide arredondar essas duas telas para 36, documentando a decisão) — hoje a união do TypeScript torna essas duas medidas irrepresentáveis.
- CORREÇÃO do verificador: O achado é procedente (a união `26|30|36` de fato não representa 38/39), mas a proposta ignora que o PRÓPRIO kit diverge de si mesmo nesse ponto: `Hud.jsx:202` (`PartyLootWindow`, a janela flutuante de "bolsa da party" que de fato aparece no HUD renderizado) usa `<Slot size={30}>`, enquanto `Modals.jsx:76` (`PartyModal`, uma tela de gestão de party inteiramente diferente e ainda não construída no cliente) usa `<Slot size={38}>` para o MESMO conceito. Além disso, o `size={39}` do `SwapRingModal` (`Modals.jsx:100`) é literalmente o default não setado de `Slot.jsx` (`size = 39`), não um valor escolhido deliberadamente pela tela — sinal mais fraco de intenção de design do que os 26/30/36 que `docs/design-system-plan.md` linhas 39-41 já registra terem sido conscientemente adotados no lugar dos defaults do próprio handoff (39/46/34). Antes de alargar o tipo para `26|30|36|38|39`, é preciso decidir qual das duas telas do kit é a fonte de verdade para "bolsa da party" — só alargar o `union` resolve o TypeScript, não a ambiguidade visual.

### [R0-07] Checkbox perdeu o prop size — fidelidade (confirmado)
- kit: components/core/Checkbox.jsx:1 — `size = 15` (prop numérico). Usos reais: Modals.jsx:58 `<Checkbox checked={pick} size={12} />` (HuntsModal, coluna Pegar/Vender) e Modals.jsx:133 `size={13}` (HuntDetailsModal).
- cliente: packages/client/src/shell/ui/Checkbox.tsx:6-12 — interface sem `size`; ui.css:216-228 `.ui-checkbox-box{width:15px;height:15px;...font-size:11px}` hardcoded, sem parametrização.
- proposta: Reintroduzir `size?: number` (ou uma união fechada 12|13|15) no Checkbox e usar uma custom property (`--checkbox-size`) como o Slot já faz, para as tabelas de loot (HuntsModal/HuntDetailsModal) poderem usar 12px/13px como o kit.

### [R0-08] VitalBar — preenchimento em cor sólida do token em vez do gradiente do kit — reversao-decisao (confirmado)
- kit: components/core/VitalBar.jsx:3 — `fill = { hp: "linear-gradient(180deg,#d95a55,#a52a2f)", mp: "linear-gradient(180deg,#6f86d8,#3d5ec8)", exp: "linear-gradient(180deg,#e2c47a,#a8823e)", stamina: "linear-gradient(180deg,#7dc78a,#4d9a5a)" }`.
- cliente: packages/client/src/shell/ui/VitalBar.tsx:3-4 (comentário) — "cor sólida, não o gradiente hexadecimal do protótipo (ADR 0029 D1...)"; ui.css:508-511 — `.ui-vital-fill[data-kind="hp"]{background:var(--vital-hp)}` etc., todas cores chapadas.
- decisão anterior: ADR 0029 D1 (tokens same-origin) foi estendida pelo próprio comentário do VitalBar.tsx para justificar substituir os gradientes literais do kit por cor sólida de token — mas D1 fala de ORIGEM da fonte/token, não da forma do preenchimento.
- proposta: Fidelidade estrita exige devolver o gradiente de dois tons exato de cada vital (hp/mp/exp/stamina), como constante literal (igual ao kit) ou como novos tokens `--grad-vital-hp` etc. em tokens.css — a cor sólida atual é visualmente mais chapada que o kit.

### [R0-09] Panel — sombra do caso não-dock/não-modal diverge do Panel.jsx real — fidelidade (confirmado)
- kit: components/core/Panel.jsx:4 — `boxShadow: dock ? "none" : "0 18px 45px rgba(0,0,0,.7), inset 0 0 0 1px #080505"` (usado pela única janela flutuante real do kit, o `FloatingWindow` de Hud.jsx:179, ex.: Analisador/Party loot).
- cliente: packages/client/src/shell/ui.css:358-368 `.ui-panel{...box-shadow:var(--shadow-panel)...}` e :375 `.ui-panel--modal{box-shadow:var(--shadow-modal)}` — o caso base (não-dock, não-modal) usa o token `--shadow-panel` (`0 8px 24px rgba(0,0,0,.65), 0 1px 0 rgba(201,162,77,.12) inset`, tokens.css:194), que não é nem o valor hardcoded do Panel.jsx nem o `--shadow-modal`.
- proposta: Adicionar o valor literal do kit (`0 18px 45px rgba(0,0,0,.7), inset 0 0 0 1px #080505`) para o caso Panel flutuante (nem dock, nem modal) — relevante sobretudo se o Chat (D5, janela flutuante) ou qualquer janela não-dockada futura usar `Panel` sem `dock`.

### [R0-10] Stance (primitivo) ausente no cliente — reversao-decisao (confirmado)
- kit: components/core/Stance.jsx e Stance.d.ts — terceiro de 15 primitivos do kit (defensiva/balanceada/atacante, 3 botões 40px de altura com cor por postura).
- cliente: packages/client/src/shell/ui/ — nenhum arquivo Stance.tsx; ui/Button.tsx:1-3 (comentário) confirma: "os NOVE primitivos de controle" migrados (Stance não está entre eles).
- decisão anterior: ADR 0029 D2 — "Stance fica de fora — não existe postura de combate no sim".
- proposta: Fidelidade estrita ao kit pede, no mínimo, o primitivo visual (Stance.tsx, puramente decorativo, sem consumidor) pixel-a-pixel — que não fere o invariante 4/D8 por não estar ligado a dado nenhum. Ligá-lo a comportamento real de combate (afetar dano/defesa) é sistema-servidor (mecânica de postura não existe no `sim`, épico E2), fora do que este achado cobre.

### [R0-11] Pílula de gold do topo — padding, sombra e brilho da moeda diferentes do kit — fidelidade (confirmado)
- kit: ui_kits/draconya/Hud.jsx:26-28 — `Currency`: `padding:"0 6px 0 9px"`, `boxShadow:"inset 0 1px rgba(255,255,255,.05), 0 1px 2px #000"`; ícone da moeda: `border:"1px solid #ffd66b"`, `boxShadow:"0 0 7px rgba(215,164,38,.4)"`.
- cliente: packages/client/src/shell/shell.css:85-94 — `.topbar-gold{...padding:0 9px;...}` (sem o padding assimétrico, sem box-shadow) e `.topbar-coin{width:11px;height:11px;border-radius:50%;background:...}` (sem `border` e sem `box-shadow`).
- proposta: Ajustar `.topbar-gold` para `padding: 0 9px 0 9px` → `0 6px 0 9px` e acrescentar `box-shadow: inset 0 1px rgba(255,255,255,.05), 0 1px 2px #000`; acrescentar a `.topbar-coin` `border: 1px solid #ffd66b` e `box-shadow: 0 0 7px rgba(215,164,38,.4)`.

### [R0-12] Wordmark do topo — falta a camada de brilho dourado no text-shadow — fidelidade (confirmado)
- kit: ui_kits/draconya/Hud.jsx:21 — `textShadow: "0 1px #000, 0 0 18px rgba(201,162,77,.25)"`.
- cliente: packages/client/src/shell/shell.css:96-99 — `.topbar-wordmark b { ...text-shadow: 0 1px #000; }` (só a sombra dura, sem o brilho `0 0 18px rgba(201,162,77,.25)`).
- proposta: Acrescentar `, 0 0 18px rgba(201,162,77,.25)` ao text-shadow de `.topbar-wordmark b`.

### [R0-13] IBM Plex Sans self-hosted com faixa de peso mais estreita que a do kit — fidelidade (confirmado)
- kit: tokens/fonts.css:3 — `font-weight:100 700` para IBM Plex Sans.
- cliente: packages/client/src/shell/fonts.css:14-20 — `font-weight: 400 700;` (faixa começa em 400, não 100).
- proposta: Ampliar a faixa declarada para `100 700` se o arquivo `.woff2` self-hosted realmente cobre esses pesos (conferir o binário); caso o arquivo só tenha 400-700, a divergência é no arquivo de fonte, não só na declaração — achado latente, sem uso confirmado de peso <400 nas telas hoje.

## O que o auditor deixou passar (verificador)
- Peso de fonte incorreto em 4 dos 6 variantes de Button: a classe base `.ui-button` fixa `font-weight:700` (packages/client/src/shell/ui.css, bloco `.ui-button` ~linha 15) e nenhum dos blocos `.ui-button-secondary` (linhas 50-58), `.ui-button-ghost` (62-68), `.ui-button-danger` (70-79) e `.ui-button-text` (81-87) sobrescreve isso — mas o kit (`components/core/Button.jsx`) define `fw:500` para secondary/danger e `fw:400` para ghost/text. Resultado: hoje esses quatro variantes renderizam em negrito (700) quando o kit pede peso normal ou médio; secondary/danger já acertam o font-size (9px) mas erram o peso, e ghost/text erram os dois.
- O outline global de foco por teclado do kit (`tmp-design-kit/handoff/ui_kits/draconya/index.html:4` — `button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--gold-4);outline-offset:2px}`, aplicado a TODO botão/input/select do protótipo) só foi reproduzido para `.ui-checkbox-box` (ui.css:232, e com `outline-offset:1px`, não 2px como o kit). `.ui-button`, `.ui-icon-button`, `.ui-select`, `.ui-slot`, `.ui-switch` e `.ui-tab` não têm nenhuma regra `:focus-visible` em ui.css — navegação por teclado perde o anel dourado de foco em quase todos os primitivos interativos.
- A premissa do próprio escopo desta análise ("primitivo do cliente sem equivalente no kit (Tabs, VitalBar — são extensões legítimas ou desvio?)") está incorreta: Tabs e VitalBar SÃO primitivos do kit (`components/core/Tabs.jsx`+`.d.ts`, `components/core/VitalBar.jsx`+`.d.ts`, entre os 15 originais) e foram portados fielmente — comparei `Tabs.jsx` com `ui.css` (`.ui-tabs-underline`/`.ui-tabs-pill`) valor a valor e bate 100%; não há extensão nem desvio a apontar aí além do gradiente do VitalBar já coberto no R0-08.
- O próprio kit se contradiz sobre o brilho do estado "Selected": `guidelines/effects-states.html` mostra `box-shadow: inset 0 0 0 1px rgba(242,198,107,.4), 0 0 9px rgba(188,118,44,.5)` para esse estado genérico, mas `components/core/Slot.jsx` (o componente de fato usado no HUD renderizado) usa `0 0 0 1px rgba(242,198,107,.4), 0 0 8px rgba(188,118,44,.5)` — sem `inset` e com blur de 8px, não 9px. `.ui-slot--selected` do cliente bate exatamente com `Slot.jsx` (o componente real), não com a página de guideline solta. Vale registrar para que ninguém "corrija" `.ui-slot--selected` na direção do valor do guideline, que é o lado errado dessa divergência interna do kit.

## Notas
Correção a uma premissa do prompt: Tabs e VitalBar TÊM equivalente no kit (components/core/Tabs.jsx e VitalBar.jsx existem e batem quase pixel-a-pixel com os primitivos do cliente) — não são extensões sem contrapartida. O único primitivo do kit sem equivalente no cliente é Stance (R0-10). Não existe FloatingWindow em components/core/ nem no cliente — a "janela flutuante" do kit (Hud.jsx:174-181) é um componente LOCAL da tela, não um primitivo exportado, então sua ausência como arquivo não é um achado.

Inconsistências internas do PRÓPRIO kit (não geram achado de cliente, só contexto):
1. Slot.jsx/.d.ts (default 39/comentário "39 ação, 46 mochila, 34 equipamento") e DESIGN_SYSTEM.md:34 ("39px ações, 46px mochila, 34px equipamento") divergem do que Hud.jsx realmente desenha (36/30/26, grep confirmado). O plano já resolveu a favor da tela, e o cliente segue a tela — correto, mas o default do próprio Slot.jsx do kit continua enganoso para quem ler só o .d.ts.
2. tokens/spacing.css:24 declara `--hud-bottom-h: 104px`, mas a barra de ações realmente renderizada (App.jsx:16, grid `124px`) e o README.md (linhas 49, 63, 100) dizem 124px em três lugares — o token da barra inferior está simplesmente errado no próprio kit. Irrelevante para o cliente porque D5 corta a barra de ações inteira.
3. tokens/spacing.css:22,25 (`--hud-topbar-h:56px`, `--panel-title-h:36px`) nunca são lidos pelos componentes reais do kit: Panel.jsx:4,6 hardcoda 34 e Hud.jsx:4 hardcoda `height:65`. Are tokens "mortos" que só aparecem no guideline spacing-radii.html. O cliente corrigiu para os valores da TELA (34/65), não os do token quebrado — comportamento correto, registrado no próprio comentário de tokens.css do cliente.
4. tokens/spacing.css:19-21 (`--slot-size:44`, `--slot-size-sm:34`, `--slot-size-lg:56`) também não são lidos por Slot.jsx (que recebe um `size` numérico explícito por chamada) — outro conjunto de tokens vestigiais, só usados no guideline spacing-radii.html.
5. Checkbox.jsx tem default size=15 mas as duas únicas telas reais que o chamam usam 12 e 13 — o próprio kit nunca padronizou esse tamanho.
6. `dsAppear` é definido DUAS VEZES com curvas diferentes: index.html/o app real usa `translateY(5px)→none` (o que o cliente reproduziu certo em `ui-appear`); components/core/core.card.html (a demo isolada dos primitivos) define um `dsAppear` só de opacidade, sem translateY — divergência interna do kit, contida à demo.
7. DESIGN_SYSTEM.md:36 diz "Fade-in de 300ms (dsAppear) ao abrir painéis", mas Modal.jsx:4 usa `.2s` (200ms) — 300ms só vale para os cards de Entry.jsx (`.3s ease`). O cliente bate com o Modal.jsx real (200ms), não com o texto do documento.
8. tokens/typography.css declara `--weight-regular/medium/semibold/bold` e `--leading-tight/snug/normal`, mas nenhum arquivo do kit (componentes ou telas) nem do cliente consome essas variáveis — tokens mortos dos dois lados, portanto sem divergência de fidelidade.
9. O comentário de packages/client/src/shell/shell.css:212-218 lista PartyBag como uma das 7 telas ainda usando `.analyzer-head`, mas PartyBag.tsx já importa e usa `ui/Panel` (linhas 14 e 32) — comentário desatualizado no próprio cliente, não um problema visual (ver R0-02).
10. README.md do ui_kits/draconya declara a tela base em 1800×1010, enquanto DESIGN_SYSTEM.md:38 diz 1600×900 — contradição interna não resolvida no kit; irrelevante porque D3 rejeita `transform:scale` por completo, então nenhum dos dois números "ganha" na prática.

Metodologia: todo arquivo de tokens/, components/core/ (todos os 15 pares .jsx+.d.ts), as 16 guidelines/*.html, DESIGN_SYSTEM.md e styles.css do kit foram lidos por inteiro; do lado do cliente, tokens.css, fonts.css, ui.css e os 14 arquivos ui/*.tsx foram lidos por inteiro, e as partes estruturais de shell.css (topbar, windows, chat, vitals, analyzer-head) foram lidas e cruzadas com grep dirigido para confirmar cada citação de arquivo:linha acima. Nenhum arquivo foi modificado; nenhum comando de build/test/servidor foi executado.

## Notas do verificador
Verifiquei os 13 achados reabrindo cada arquivo citado (kit e cliente) linha a linha, mais inspeção binária dos três arquivos de fonte self-hosted com fontTools (ambiente Python isolado só para leitura — nenhum arquivo do projeto foi tocado) e um teste isolado de box-sizing num Chromium real via Browser tool. Nenhum comando de build/test/servidor do projeto foi executado; nenhum arquivo do repositório foi modificado.

Nove achados (R0-01, R0-05, R0-07, R0-08, R0-09, R0-10, R0-11, R0-12, R0-13) se sustentam integralmente, e em dois casos (R0-09, R0-13) a verificação piorou o diagnóstico para o cliente: R0-09 não é hipotético (Chat.tsx já usa Panel sem dock hoje) e R0-13 não precisa mais de "conferir o binário" — já confirmei que o arquivo cobre 100-700. Quatro achados (R0-02, R0-03, R0-04, R0-06) precisaram de correção: R0-02 errou a conta final (7 pendentes, não 6, por esquecer BattlePanel); R0-03 propôs uma correção que pressupunha um binário variável que a inspeção provou não existir (e que pioraria o resultado se aplicada); R0-04 tem uma proposta ambígua que, se executada ao pé da letra, introduz uma regressão em ghost/text; R0-06 não menciona que o próprio kit se contradiz sobre o tamanho da bolsa da party (30 vs 38), então "alargar o union" não é a correção completa.

Nenhum achado foi classificado erroneamente como "sistema-servidor" quando era "fidelidade" ou vice-versa — os 13 são mesmo questões de token/CSS/primitivo dentro do escopo de fundação, sem tocar dado que o servidor não fornece.

Sobre R0-10 (Stance): a classificação e a proposta (primitivo visual decorativo, sem consumidor, para não ferir invariante 4/D8) me parecem corretas dentro da régua que a tarefa define, mas vale uma reflexão de produto fora do escopo desta verificação factual: um controle de três posturas clicável que não muda nada no jogo pode, na prática, sugerir ao jogador que existe uma mecânica de postura que não existe — o dono do produto pode preferir renderizá-lo desabilitado/"em breve" em vez de interativo. Isso é uma decisão de UX, não um erro factual no achado, por isso não afeta o veredito.


---

# R1-topo-entrada

## Conformes
- TopBar: altura 65px
- TopBar: tamanho e estado ativo dos ícones de navegação (36px, borda gold-4, brightness 1.16)
- TopBar: retrato 34x34px
- TopBar: tipografia do nome do personagem (Cinzel 10px bold, gold-5, truncamento com ellipsis)
- TopBar: tipografia da linha vocação/level (7.5px, uppercase, cor muted)
- TopBar: tipografia do wordmark 'DRACONYA' (12px bold, letter-spacing .18em, gold-5)
- TopBar: formatação do valor de gold (agrupamento pt-BR, ex. 2.134.760)
- ConnectionBadge: texto do estado 'conectado'
- Entry: Brand (emblem losango ✦, eyebrow 'MMORPG', título, régua divisória)
- Entry: texto do rodapé de tela 'Cada jornada deixa uma história.'
- Entry: wordmark 'DRACONYA' no rodapé do EntryShell
- CharacterSelect: texto do cabeçalho ('Sua próxima aventura' / 'Escolha seu personagem')
- CharacterSelect: botão 'Trocar de conta'
- CharacterCard: tratamento da inicial como avatar
- VocationChoice: cor do card por id de vocação via classe/atributo
- VocationChoice: formato da linha de ganhos ('+X HP · +Y mana · +Z cap por level')
- LoginScreen: rótulos dos botões ('ENTRAR →' / 'Criar conta')
- TopBar: ícones Hunts/Cyclopedia/Chat (arquivo de ícone e rótulo batendo com o kit)

## Achados

### [R1-01] LoginScreen: formulário de e-mail/senha — reversao-decisao (confirmado)
- kit: Entry.jsx:50-64 (LoginScreen) — Input label={t.email} defaultValue='aldric@draconya.gg' (linha 56); Input label={t.password} type show/hide defaultValue='dragonfire' (linha 57); Checkbox 'Lembrar meu e-mail' (linha 58); EntryCard footnote={t.testAccess}='Acesso com sua conta de teste' (linha 54).
- cliente: packages/client/src/shell/Entry.tsx:88-111 (LoginScreen) — nenhum <Input>, nenhum Checkbox, nenhuma footnote; só dois <Button> chamando beginLogin()/beginLogin(true) (linhas 99-104). Comentário do próprio arquivo (linhas 7-8) documenta a remoção: 'Sem senha (ADR 0029 D7): as duas ações de login navegam para o AuthKit do WorkOS (ADR 0012).'
- dado: Não aplicável — não é falta de dado, é decisão de arquitetura: autenticação é delegada ao WorkOS (ADR 0012); não existe endpoint de e-mail/senha em account/api.ts.
- decisão anterior: ADR 0029 D7 (entrada sem senha) e ADR 0012 (autenticação delegada ao WorkOS)
- proposta: Seguir o kit à risca aqui exige revogar D7 e o ADR 0012 (reimplementar login por e-mail/senha no client e um endpoint de autenticação própria no server) — mudança de arquitetura, não de CSS. Não implementar sem um novo ADR substituindo o 0012; registrar a decisão do dono antes de qualquer código.

### [R1-02] Fluxo de criação de personagem: vocação escolhida na entrada (ClassSelect) vs em jogo — reversao-decisao (confirmado)
- kit: Entry.jsx:116-130 (ClassSelect) — tela cheia com DR.classes.map(ClassCard) (linha 122), Input 'Nome do personagem' (linha 124) e botão 'Forjar personagem' (linha 125), tudo ANTES de entrar no jogo. App.jsx:61 conecta onNew->screen='class' e onConfirm cria o personagem já com cls escolhida.
- cliente: packages/client/src/shell/Entry.tsx:142-174 (CreateForm) — só coleta nome, sem seleção de vocação. A vocação só aparece depois, em packages/client/src/shell/VocationChoice.tsx:60-145, como Modal disparado quando level >= catalogue.vocationLevel (linha 71), dentro da hunt.
- dado: Não falta dado — o intent 'choose-vocation' (VocationChoice.tsx:97) já existe e resolve isso; é timing de UX, não lacuna de protocolo.
- decisão anterior: ADR 0026 decisão d.1 (vocação escolhida em jogo no level 8, não na criação do personagem)
- proposta: Fidelidade estrita exigiria mover a escolha de vocação para o fluxo de criação (antes do 1º login), reabrindo ADR 0026 d.1. O próprio README do kit (linha 59) já reconhece isso: 'no jogo real a vocação é escolhida no level 8, em jogo; a tela de vocação deste kit é a mesma escolha apresentada como tela de entrada' — ou seja, o próprio kit documenta que aqui ele simplificou. Registrar a decisão do dono explicitamente antes de mexer.

### [R1-03] Entry: LangToggle PT/EN — reversao-decisao (confirmado)
- kit: Entry.jsx:9-12 (dentro de EntryShell) — <LangToggle lang={lang} setLang={setLang}/> no header, ao lado do indicador 'ready'; componente definido em Entry.jsx:21-23.
- cliente: packages/client/src/shell/Entry.tsx:49-54 (EntryShell) — header só tem wordmark e tagline; nenhum toggle de idioma. Comentário do arquivo (linha 8): 'Sem i18n (ADR 0029 D7): os textos ficam fixos em pt-BR, sem toggle de idioma.'
- dado: Não aplicável — não há infraestrutura de tradução no cliente hoje.
- decisão anterior: ADR 0029 D7 (sem i18n)
- proposta: Reintroduzir o LangToggle exige construir i18n de verdade (textos duplicados PT/EN em todo o client, não só na entrada) — escopo de projeto, não de tela. Registrar como decisão do dono; não adicionar um toggle decorativo que não traduz nada.

### [R1-04] TopBar: pill de cristais/gems e botão '+' de compra de gold — sistema-servidor (confirmado)
- kit: Hud.jsx:14-15 — <Currency icon='gold' value='2.134.760' plus/> (o `plus` desenha o botão '+' circular, linha 30 de Currency) e <Currency icon='crystal' value='120'/>.
- cliente: packages/client/src/shell/TopBar.tsx:91-94 — só existe .topbar-gold com o valor de gold; nenhum botão '+', nenhuma segunda pill de cristal/gem.
- dado: Falta mecânica inteira: moeda premium (Draconya Coins/gems) e catálogo de loja não existem em content/sim/protocol (confirmado por grep vazio de 'blessing'/loja em todo o repo).
- proposta: Não adicionar a pill nem o botão '+' até a Loja/moeda premium existir (épico E13, docs/design-system-plan.md §8). Adicionar hoje seria inventar dado no cliente, violando D8.

### [R1-05] TopBar: botão 'Loja' — sistema-servidor (confirmado)
- kit: Hud.jsx:16-18 — botão com ícone ⚱ e texto {t.store} ('Loja'), onClick={() => onOpen('shop')}.
- cliente: packages/client/src/shell/TopBar.tsx (arquivo inteiro) — nenhum botão de loja; comentário nas linhas 5-7 lista 'Loja' explicitamente entre os sistemas que não recebem ícone.
- dado: Falta o sistema de loja inteiro (mesma lacuna de R1-04).
- proposta: Mesmo tratamento de R1-04: aguardar o épico da Loja (E13) antes de desenhar o botão.

### [R1-06] TopBar: contador 'N players online' sob o wordmark — sistema-servidor (corrigido)
- kit: Hud.jsx:21 — <span>{...}</span> com '1.284 players online' logo abaixo de <b>DRACONYA</b>, mesmo bloco central.
- cliente: packages/client/src/shell/TopBar.tsx:96-98 — .topbar-wordmark só renderiza <b>DRACONYA</b>, sem segunda linha.
- dado: Falta mecanismo E transporte: `SessionHost.viewerCount` é métrica interna de processo (host.ts:589-593), sem agregação entre nós de `game` nem opcode que a exponha (SV-07/SV-15 do plano M15).
- proposta: Implementar primeiro o diretório de sessões agregando contagem entre nós (SV-07), depois um campo/opcode novo para expor o total (SV-15), só então acrescentar a segunda linha em TopBar.tsx:96-98.
- CORREÇÃO do verificador: A classificação (sistema-servidor) e a evidência principal estão certas (host.ts:589-593 confirmado linha a linha; TopBar.tsx:96-98 confirmado). Mas a proposta erra o papel de SV-15: por docs/design-system-plan.md:360 e :368, é SV-07 (server+protocol) que já cria 'a mensagem própria' com a contagem agregada — SV-15 é só o lado CLIENTE (renderizar o sub-título no wordmark), dependente de SV-07, e não cria opcode nenhum. A proposta correta é: implementar SV-07 (diretório agregado entre nós de `game` + mensagem nova), e só então SV-15 (consumir essa mensagem e renderizar em TopBar.tsx:96-98) — não 'depois um campo/opcode novo (SV-15) para expor o total', que inverte a divisão de trabalho documentada.

### [R1-07] TopBar: ícones Guild, Amigos, Prey e Configurações — sistema-servidor (corrigido)
- kit: Hud.jsx:2 — nav inclui ['guild','Guild','guild'], ['social','Amigos','social'], ['prey','Prey','prey']; Hud.jsx:22 — ícone extra 'Configurações' fora do array nav, sempre por último.
- cliente: packages/client/src/shell/TopBar.tsx:21-28 (WINDOWS) — não há entradas 'guild', 'social', 'prey' nem 'settings'. Comentário (linhas 5-7) documenta a omissão pelo D8.
- dado: Guild/Amigos/Prey: mecânica inexistente por completo (épicos E7/E12, docs/product/ ainda não escrito). Configurações: docs/product/settings.md confirma 'não implementado' — nenhuma coluna de preferência em account/personagem, nenhum endpoint em account/api.ts.
- proposta: Guild/Amigos/Prey aguardam épico próprio. Configurações é composto: os blocos Som/Tela do modal do kit poderiam ser 'feature-cliente' puro (localStorage, sem servidor) se o dono aceitar que não persistam entre dispositivos; mas o texto do kit promete 'Salvas na conta', o que exige endpoint novo (peça de protocolo/server) antes de reproduzir esse texto. Não adicionar o ícone enquanto nenhuma preferência real existir (regra já registrada em docs/product/settings.md).
- CORREÇÃO do verificador: O achado está certo (Guild/Amigos/Prey/Configurações inexistentes; grep de guild/friend/prey em packages/sim e packages/protocol só acha 'guild-war' como SessionType e 'Prey' como interface de alvo de monstro — nada relacionado ao sistema social do kit) e docs/product/settings.md confirma 'não implementado' para Configurações. Mas a citação de épicos é imprecisa: E7 = 'Progressão persistente' (docs/technical-architecture.md:586) cobre Prey e Bestiário; E12 = 'Guildas e Guild War' (linha 623) cobre Guild. NÃO existe nenhum épico para 'Amigos' em docs/technical-architecture.md — grep de 'amigo'/'friend' no documento inteiro não retorna nada. Guild e Prey têm um épico para aguardar; Amigos não tem nem isso, está fora do roadmap. A proposta deveria distinguir os três em vez de tratá-los como 'aguardam épico próprio' igualmente.

### [R1-08] TopBar: ícone 'Personagem' na nav e retrato clicável — reversao-decisao (confirmado)
- kit: Hud.jsx:2 — nav[0] = ['character', t.character, 'character']; Hud.jsx:7 — o próprio retrato é <button onClick={() => onOpen('character')}>.
- cliente: packages/client/src/shell/TopBar.tsx:21-28 (WINDOWS) — não existe entrada 'character'. Linha 83 — <span className='topbar-portrait' aria-hidden='true'> sem onClick. Comentário (linhas 81-82): 'Sem onClick: Personagem é um painel fixo da coluna esquerda (DS-13), não um modal que este retrato abriria — D6.'
- dado: Não falta dado — CharacterPanel já mostra tudo; é puramente modelo de interação (modal no kit vs painel fixo sempre visível no client).
- decisão anterior: ADR 0029 D6 (geografia fixa: Personagem é seção sempre montada na coluna esquerda, não um modal)
- proposta: Sob fidelidade estrita, adicionar um ícone 'Personagem' na nav (packages/client/src/shell/TopBar.tsx:21-28) e tornar o retrato clicável — mas como D6 já fixou o painel Personagem como sempre visível, não há modal para abrir; a ação plausível seria rolar/realçar o CharacterPanel na coluna esquerda. Registrar com o dono se D6 muda ou se o ícone vira só um atalho de scroll.

### [R1-09] TopBar: ícones 'Bot' e 'Inventário' fora do conjunto do kit — reversao-decisao (corrigido)
- kit: Hud.jsx:2 — a nav do kit tem exatamente 8 itens (character, combat, analyzer, loot, guild, social, prey, chat) mais 'settings' à parte (linha 22); NÃO existe 'bot' nem 'inventory' na nav do TopBar do kit — Set/mochila/bolsa e as Automações (bot) ficam sempre visíveis nas colunas, sem toggle no topo.
- cliente: packages/client/src/shell/TopBar.tsx:21-28 (WINDOWS) — inclui {id:'bot', icon:'actions'} e {id:'inventory', icon:'inventory'}, que não têm equivalente na nav do Hud.jsx do kit.
- dado: Não aplicável — é sobre conjunto/ordem de controles de UI, não dado.
- decisão anterior: ADR 0026 d.7 / ADR 0029 D6 (Bot e Set/mochila/bolsa são seções FIXAS; o botão da barra do topo apenas minimiza, nunca remove — mecanismo introduzido em #161/#162, antes do kit)
- proposta: Há uma tensão real: remover os ícones 'Bot'/'Inventário' do topo para bater exatamente com o kit tiraria a única forma de minimizar esses painéis fixos (regressão de UX de M12). Registrar a decisão do dono: manter os dois ícones extras (divergência aceita) ou encontrar outro controle de minimizar (ex.: no próprio cabeçalho do painel, como já é feito com CharacterPanel) para poder igualar a nav do topo à do kit.
- CORREÇÃO do verificador: A citação da decisão prévia pode ser muito mais direta do que 'ADR 0026 d.7 / ADR 0029 D6' (que são inferências a partir de um mecanismo de minimizar). docs/design-system-plan.md linhas 199 e 315 (item de rollout DS-08, do plano aprovado pelo dono do produto em 2026-09-16 — ver o próprio contexto do ADR 0029) já fixam por NOME o conjunto exato dos seis ícones do topo: 'Hunts, Bot, Inventário, Analisador, Cyclopedia, Chat' — exatamente o que `TopBar.tsx` (WINDOWS, linhas 21-28) implementa hoje, Bot e Inventário incluídos. Isso não é uma tensão a ser levantada com o dono do produto: é uma decisão já nomeada e aprovada por ele, que a fidelidade estrita ao kit reverteria diretamente. A proposta deveria citar DS-08 (docs/design-system-plan.md:199/315) como a decisão a ser formalmente revogada, em vez de apenas inferir a partir do mecanismo de minimizar de #161/#162.

### [R1-10] TopBar: rótulo de texto permanente sob cada ícone de navegação — fidelidade (confirmado)
- kit: tmp-design-kit/handoff/components/core/IconButton.jsx:1-8 — o primitivo usado pelo kit (Hud.jsx:22 usa <IconButton title={l}>) só aplica `title` (tooltip nativo do navegador); não renderiza nenhum texto visível permanente dentro/abaixo do botão.
- cliente: packages/client/src/shell/TopBar.tsx:33-61 (NavIcon) — linha 58 sempre renderiza <span className='topbar-icon-label'>{label}</span> visível abaixo do ícone; shell.css:113 dá a esse rótulo font-size 6.5px permanente.
- dado: Não aplicável — puramente CSS/markup.
- proposta: Remover o <span className='topbar-icon-label'> de TopBar.tsx:58 (e o CSS correspondente em shell.css:113) e depender só do atributo `title` já presente, igual ao IconButton do kit. Isso também encurta a altura real do botão para os 36px exatos do kit (hoje o botão do client é mais alto por causa da linha de rótulo).

### [R1-11] Indicador de latência/conexão: posição na tela — fidelidade (confirmado)
- kit: Hud.jsx:93 — bloco absoluto `right:12, bottom:8` sobre o MUNDO (não na TopBar), mostrando ponto verde + '42 ms'; README.md:15 confirma: 'Latência e FPS ficam no canto inferior direito do mundo'.
- cliente: packages/client/src/shell/Shell.tsx:82 renderiza <TopBar .../>, que por sua vez (TopBar.tsx:113) renderiza <ConnectionBadge/> dentro de .topbar-right — ou seja, dentro da barra do topo, não como overlay no canto inferior direito do mundo.
- dado: Não aplicável — é posição de um dado que o client já tem (state.connection/latencyMs).
- proposta: Mover a renderização de <ConnectionBadge/> de dentro de TopBar.tsx:113 para um overlay próprio, irmão de <Viewport/> em Shell.tsx (posição fixa right:12px bottom:8px sobre o mundo), reproduzindo a posição exata do kit.

### [R1-12] Contador de FPS — feature-cliente (corrigido)
- kit: Hud.jsx:93 — o mesmo bloco de latência inclui <span>60 fps</span> ao lado do 'ms'.
- cliente: Nenhum arquivo em packages/client/src/shell/ ou packages/client/src/world/ calcula ou exibe FPS (grep por 'fps' no client não retorna nenhum componente).
- dado: Não depende do servidor — é computável 100% no cliente a partir do laço de requestAnimationFrame do viewport.
- proposta: Adicionar um contador de FPS (média móvel simples sobre os deltas de requestAnimationFrame no laço de render de world/) e exibi-lo ao lado do ConnectionBadge relocado (ver R1-11). Não precisa de protocolo novo.
- CORREÇÃO do verificador: Classificação errada: não é 'feature-cliente' (algo que simplesmente falta implementar e pode ser adicionado livremente). docs/design-system-plan.md:232 já decidiu explicitamente EXCLUIR o contador de FPS do design ('FPS | derivável no cliente | fica de fora (custo sem leitor) | laço do viewport'), e esse plano foi aprovado pelo dono do produto em 2026-09-16 (contexto do ADR 0029, primeiro parágrafo: 'aprovado pelo dono do produto em 2026-09-16, §10'). Adicionar o contador de FPS hoje reverteria uma decisão já registrada e aprovada nominalmente, mesmo sendo tecnicamente barato e sem depender do servidor — a classificação correta é 'reversao-decisao', citando docs/design-system-plan.md:232 como a decisão prévia. A proposta deveria ser: registrar com o dono do produto se a instrução de hoje ('seguir o kit na risca') também derruba essa exclusão específica, documentando a reversão, antes de implementar — não simplesmente 'adicionar, não precisa de protocolo novo'.

### [R1-13] TopBar: moldura visual (borda completa, gradiente de vinheta horizontal, sombra interna dourada) — fidelidade (confirmado)
- kit: Hud.jsx:4 — border: '1px solid var(--gold-1)' com borderTopColor var(--ash-3) e borderBottomColor var(--gold-3) (borda nas 4 bordas, cores diferentes por lado); background com DOIS gradientes empilhados (vinheta horizontal + gradiente vertical ash); boxShadow com duas camadas: '0 4px 20px rgba(0,0,0,.7), inset 0 -1px rgba(201,162,77,.1)'.
- cliente: packages/client/src/shell/shell.css:59-68 (.topbar) — só `border-bottom: 1px solid var(--gold-3)`; background com um único gradiente vertical (sem a vinheta horizontal); box-shadow com uma única camada (`0 4px 20px rgba(0,0,0,.7)`, sem o inset dourado).
- dado: Não aplicável — puramente CSS.
- proposta: Atualizar .topbar em shell.css:59-68 para incluir a borda nas 4 bordas com as cores por lado do kit, o segundo gradiente (vinheta horizontal) e a segunda camada de box-shadow (inset dourado).

### [R1-14] Entry header: indicador 'Pronto para entrar' — fidelidade (confirmado)
- kit: Entry.jsx:11 — <span>{ponto verde 5x5}{t.ready}</span> ('Pronto para entrar'), ao lado do LangToggle no header.
- cliente: packages/client/src/shell/Entry.tsx:44-59 (EntryShell) — header só tem wordmark (linha 50-52) e tagline (linha 53); nenhum indicador de status.
- dado: Não aplicável — no próprio kit é texto estático (sempre 'ready', não ligado a nenhum estado real), não é dado do servidor.
- proposta: Adicionar o ponto+texto 'Pronto para entrar' ao header de EntryShell em Entry.tsx:49-54, como elemento decorativo estático — não requer nenhum dado novo do servidor.

### [R1-15] Entry footer: nome do servidor/realm e versão — reversao-decisao (confirmado)
- kit: Entry.jsx:16 — footer com 'DRACONYA / {t.env}' (env='Servidor Ignis · PvP opcional') e 'v0.1 · design system'.
- cliente: packages/client/src/shell/Entry.tsx:56 — <footer className='entry-footer'>DRACONYA</footer>, sem segmento de servidor/realm nem versão.
- dado: Não aplicável ao segmento de realm — Draconya não tem múltiplos mundos/realms (conceito cortado por decisão).
- decisão anterior: ADR 0029 D7 ("sem e-mail/senha/'mundo'(realm)/i18n")
- proposta: O segmento de nome de servidor ('Servidor Ignis') pressupõe múltiplos mundos, que D7 cortou — não reproduzir um nome de realm fictício. O texto de versão ('v0.1 · design system') é identificação do próprio protótipo/handoff, não um dado de produto — não se aplica a produção. Se o dono quiser bater 100% com o kit, isso reabre a decisão de 'sem mundo' do D7; caso contrário, manter o rodapé como está hoje é a leitura correta.

### [R1-16] CharacterSelect: fluxo de seleção em duas etapas (selecionar depois confirmar) — fidelidade (confirmado)
- kit: Entry.jsx:65-79 (CharacterCard) — grid-template-columns '58px minmax(0,1fr) 18px' com indicador ◆/◇ na 3ª coluna (linha 69, 76), estado `selected` (border/background diferentes) e hover com translateY(-1px); Entry.jsx:80-100 (CharacterSelect) — clique no card só chama setSel(i) (seleciona), e um botão separado 'Entrar no jogo →' (linha 95) com hint 'Selecione um personagem para continuar.' (linha 94) é quem de fato entra.
- cliente: packages/client/src/shell/Entry.tsx:113-140 (CharacterCard) — grid-template-columns só '58px minmax(0,1fr)' (shell.css:392, sem 3ª coluna, sem indicador ◆/◇); onClick={() => void play(character.id)} (linha 126) entra DIRETO no jogo, um único clique. shell.css:401 só muda border-color no hover, sem transform nem troca de background.
- dado: Não falta dado — character.id já está disponível para implementar o fluxo de duas etapas.
- proposta: Reescrever CharacterGrid em Entry.tsx:176-220 para separar seleção (useState local, sem side-effect) de confirmação: manter o clique no card como 'selecionar' (adicionar 3ª coluna com ◆/◇, hover com translateY e troca de background em shell.css:391-402), e adicionar o botão 'ENTRAR NO JOGO →' com o hint de texto que de fato chama play().

### [R1-17] VocationChoice (card de vocação): selos de elemento/dano — sistema-servidor (confirmado)
- kit: Entry.jsx:111 (ClassCard) — <span>{k.elements.map(...Badge)}</span> renderiza um Badge colorido por elemento (ex.: 'Fogo', 'Energia' para o Feiticeiro) além dos badges de arma.
- cliente: packages/client/src/shell/VocationChoice.tsx:105-141 (vocation-cards) — nenhum badge de elemento é renderizado; só ícone, nome/id, papel, ganhos e arma inicial.
- dado: Falta sistema inteiro: monsterSchema/itemSchema não têm campo de elemento (packages/content/src/schemas.ts), e não há tipagem de dano elemental em nenhuma camada (content/sim/protocol) — confirmado por grep vazio de 'element' em combat/damage.ts.
- proposta: Não adicionar os badges de elemento até o sistema de dano elemental existir no sim/content — reproduzi-los hoje seria inventar dado de jogo no cliente (viola invariante 4/D8, que a instrução do dono explicitamente mantém intocado).

### [R1-18] VocationChoice (card de vocação): texto de papel/descrição e ordem ganhos-vs-arma — fidelidade (confirmado)
- kit: Entry.jsx:108-112 (ClassCard) — duas linhas de texto distintas: `k.role` curto e colorido (ex. 'Tanque · corpo a corpo', data.js:7) logo abaixo do nome, e depois `k.desc` completo (ex. 'Tanque: mais vida e capacidade, bate de perto com espada, machado ou maça.', data.js:7) como parágrafo; a linha de crescimento (`k.growth`) vem por ÚLTIMO, depois dos badges de arma/elemento (linha 112, marginTop:'auto'). Cabeçalho da tela usa t.classKicker='Vocação' + t.chooseFate='Escolha seu destino' + t.classSub (subtítulo explicativo, data.js:3).
- cliente: packages/client/src/shell/VocationChoice.tsx:30-35 (ROLE) — uma única frase truncada por vocação (ex. 'Tanque: mais vida e capacidade, bate de perto.', sem a segunda parte 'com espada, machado ou maça.'), sem a linha curta separada do kit. Linhas 130-136 — vocation-gains (crescimento) vem ANTES de vocation-weapon (arma), ordem invertida vs. kit. Linha 87 — título do Modal é só 'Escolha a sua vocação', sem o subtítulo explicativo do kit.
- dado: Não aplicável — texto estático do cliente, não vem do servidor.
- proposta: Em VocationChoice.tsx: (1) restaurar a frase completa de cada vocação e reintroduzir a linha curta de papel separada (dados equivalentes a data.js `role`+`desc`); (2) inverter a ordem para arma antes de ganhos, batendo com Entry.jsx:111-112; (3) acrescentar um subtítulo ao Modal equivalente a t.classSub, ou aceitar a diferença e registrar a decisão.

## O que o auditor deixou passar (verificador)
- CharacterCard do kit (Entry.jsx:74: `Lv {c.level} · {c.world}`) mostra o MUNDO do personagem — data.js:13-15 tem personagens em dois mundos diferentes ('Ignis'/'Umbra') — reproduzindo o conceito de 'mundo'/realm que ADR 0029 D7 explicitamente cortou ('sem... mundo/realm, o jogo não tem'). R1-15 flagou essa mesma tensão D7 só para o rodapé da Entry ('Servidor Ignis'); a mesma reabertura de D7 aparece de novo no card de personagem e não foi registrada como achado próprio (o cliente hoje já evita o problema mostrando level+estado em Entry.tsx:134-136 em vez de mundo, o que é compatível com D7 — mas fidelidade estrita ao kit reabriria a questão aqui também).
- O retrato/avatar da TopBar no kit (Hud.jsx:7) tem um ponto radial-gradient decorativo mais um box-shadow de dois anéis internos (`inset 0 0 0 2px var(--ash-1), inset 0 0 0 3px rgba(208,163,75,.25), 0 1px 4px #000`); `.topbar-portrait` no cliente (shell.css:70-75) não tem nenhum box-shadow nem o gradiente radial interno, só o gradiente linear de fundo. Gap de fidelidade puramente CSS, não coberto por R1-13 (que só toca a classe `.topbar`) nem por R1-08 (que é sobre `onClick`, não sobre o visual do retrato).
- A pill de gold (Currency) do kit (Hud.jsx:27-28) tem box-shadow (`inset 0 1px rgba(255,255,255,.05), 0 1px 2px #000`) e o disco de moeda tem seu próprio brilho (`boxShadow: '0 0 7px rgba(215,164,38,.4)'`, linha 28); `.topbar-gold`/`.topbar-coin` no cliente (shell.css:85-94) não têm nenhum box-shadow. Gap de fidelidade puramente CSS na pill que JÁ EXISTE no cliente — distinto de R1-04, que trata só da pill de cristal/gems e do botão '+' ausentes.

## Notas
Inconsistências e observações que não couberam no schema, todas dentro do escopo R1:

1. Bug de box-sizing em `.entry-card` (shell.css:357-364, sem `box-sizing: border-box`) causa overflow em telas estreitas — é o QA #287 já aberto e sem milestone (docs/design-system-plan.md digest). NÃO tratei como achado de fidelidade ao kit porque o próprio kit não desenha um breakpoint mobile (Entry.jsx/App.jsx não têm `@media` nem `Scaled` na tela de entrada) — ou seja, não há uma versão "correta" do kit em largura estreita para comparar. É uma regressão de CSS já rastreada, ortogonal a este exercício de fidelidade visual.

2. As telas de entrada do kit (Login/CharacterSelect/ClassSelect) NÃO são envolvidas pelo wrapper `<Scaled>` de 1800×1010 que o `GameScreen` usa (App.jsx:57 vs. 58-62) — ou seja, ao contrário do HUD do jogo, a entrada no próprio kit já é fluida/responsiva por natureza (`minHeight:'100vh'`), o que muda a leitura de "fidelidade de layout" nessa região: não há uma resolução fixa de referência a bater.

3. O rodapé do EntryCard do kit usa credenciais de demonstração hardcoded (`aldric@draconya.gg` / `dragonfire`) e o texto "Acesso com sua conta de teste" — isso é claramente andaime de protótipo (mostrar como o formulário ficaria preenchido), não copy de produto; não port ei isso como um requisito literal dentro do achado R1-01, só a AUSÊNCIA do formulário em si.

4. O texto de rodapé "v0.1 · design system" (Entry.jsx:16) é a marca d'água do próprio handoff sobre si mesmo, não um dado de produto — reproduzi-lo em produção não faz sentido; por isso não entrou como achado, só citado em R1-15.

5. O README do kit (linha 59) já assume que o `ClassSelect` da entrada é uma simplificação da escolha real (level 8, em jogo) — o próprio autor do kit documentou a divergência que o R1-02 formaliza. Vale destacar isso ao dono antes de decidir se ADR 0026 d.1 deve mesmo ser revertido.

6. Não encontrei nenhum estado "zero personagens" no kit (seus mocks sempre têm 3 personagens) — o client tem uma mensagem própria para esse caso ("Você ainda não tem personagem. Crie o primeiro.", Entry.tsx:195) sem equivalente no kit para comparar; não é uma divergência, é uma capacidade que o kit simplesmente não modelou.

7. Consultei tokens/*.css e guidelines/*.html do handoff por completo procurando variáveis de cor/tipografia específicas do topo/entrada que pudessem contradizer o que as telas desenham; não achei divergência adicional além das já cobertas pelo plano (65px vs 56px do token, já resolvida a favor da tela, D3).

## Notas do verificador
Reabri e conferi linha a linha todos os 18 achados contra os arquivos citados (Hud.jsx, Entry.jsx, App.jsx, data.js, README.md, components/core/IconButton.jsx, TopBar.tsx, Entry.tsx, VocationChoice.tsx, ConnectionBadge.tsx, Shell.tsx, shell.css, ADR 0029, ADR 0012, ADR 0026, docs/product/settings.md, docs/technical-architecture.md, docs/design-system-plan.md, packages/client/CLAUDE.md) e com greps direcionados em packages/sim, packages/content, packages/protocol e packages/server. Todas as 18 citações arquivo:linha do auditor bateram exatamente com o conteúdo real — nenhum achado foi refutado.

Quatro correções, duas delas materiais:
- R1-12 (FPS) tinha classificação errada: docs/design-system-plan.md:232 já registra a exclusão EXPLÍCITA do contador de FPS ('fica de fora, custo sem leitor'), num plano aprovado pelo dono do produto em 2026-09-16 — isso é reversao-decisao, não feature-cliente livre.
- R1-09 (ícones Bot/Inventário) tinha uma citação de decisão fraca (inferida de ADR 0026 d.7/ADR 0029 D6); docs/design-system-plan.md linhas 199 e 315 (DS-08) na verdade NOMEIA por extenso o conjunto exato de seis ícones do topo — incluindo Bot e Inventário — como decisão já aprovada, o que torna o achado mais forte, não mais fraco.
- R1-06 e R1-07 tiveram apenas imprecisões pontuais de citação (papel de SV-15 vs SV-07; ausência total de épico para "Amigos", diferente de Guild/Prey que têm épico a aguardar).

A varredura adicional (missed) achou uma terceira instância da mesma tensão D7 (mundo/realm) não coberta por R1-15, mais duas lacunas puramente visuais de CSS (retrato da TopBar e pill de gold) que ficaram de fora do escopo cirúrgico de R1-13/R1-04. Nenhum achado do auditor tratou como 'sistema-servidor' algo que já trafega no protocolo, nem como 'fidelidade' algo que na verdade falta dado — o erro mais comum que eu estava procurando não apareceu; os erros reais encontrados foram de precisão de citação, não de categoria fundamental (exceto R1-12, que trocou de categoria).


---

# R2-skills-automacoes

## Conformes
- Nomes e ordem das categorias do bot: Cura, Poções, Ataque, Runas e itens, Suporte (data.js:35 vs BotPanel.tsx:38-44, CATEGORY_TEXT — texto e ordem idênticos)
- Padrão visual da linha de regra: Switch + texto truncado + engrenagem ⚙ + setas ▴▾ + remover × (Hud.jsx:109-118, RuleRow do BotPanel do kit — não renderizado, ver notes — vs BotPanel.tsx:49-77, RuleRow do cliente, estruturalmente igual)
- Switch com tom 'traffic' (verde ligado / vermelho desligado) usado nas linhas de regra do bot

## Achados

### [R2-01] Painel 'Skills' dedicado na coluna esquerda — feature-cliente (confirmado)
- kit: Hud.jsx:36-38 define SkillsPanel: SidePanel com título t.skills='Skills' (data.js:3) e ação=IconButton ⚙ (t.customizeSkills) que abre modal de personalização; corpo = skills.map(s => StatRow label/value/percent/tone). App.jsx:2,5,12: skills=DR.allSkills filtrado por skillIds=useState(DR.defaultSkills) (data.js:21, 11 ids); é a PRIMEIRA seção da coluna esquerda.
- cliente: packages/client/src/shell/CharacterPanel.tsx:36-64 — painel único chamado 'PERSONAGEM', sem prop `actions` no Panel (sem gear no header), com apenas 6 StatRow fixas e não customizáveis (Experiência, Level, HP, Mana, Capacidade, Stamina). Comentário nas linhas 7-10 do próprio arquivo confirma a omissão deliberada por ora de skills/Magic Level/Speed/Soul.
- dado: exp/level/hp/mana/capacidade/stamina já chegam por `player-stats` (packages/protocol/src/types.ts:539-547); os campos que faltam para igualar a lista padrão do kit (Magic Level, Sword Fighting, Shielding, Speed, Soul Points) são tratados nos achados R2-02 a R2-04.
- proposta: Construir o painel de Skills completo (SV-10, docs/design-system-plan.md:363): dar ao Panel um `actions` com IconButton ⚙ ('Personalizar skills') e usar todas as StatRow habilitadas por padrão, aproveitando os props `percent`/`tone`/`onRemove` que StatRow.tsx (linhas 10-20) já expõe sem nenhum consumidor hoje. Não depende de SV-04 para os 6 campos já transportados; depende dele só para Magic Level/Sword/Shielding/Speed (ver achados abaixo).

### [R2-02] Linha 'Soul Points' — sistema-servidor (confirmado)
- kit: data.js:18 — allSkills inclui { id:'soul', label:'Soul Points', value: 9 }, e 'soul' está em defaultSkills (data.js:21), aparecendo por padrão.
- cliente: packages/client/src/shell/CharacterPanel.tsx — nenhuma linha 'Soul Points'; comentário na linha 10 confirma explicitamente que Soul não tem linha 'ou nunca'.
- dado: falta: Soul Points não existe em nenhum schema de `packages/protocol/src/types.ts`, nem em `packages/sim/src/character.ts` ou em qualquer arquivo de `progression` (grep por 'soul' vazio) — mecânica inexistente, não apenas campo não transportado.
- proposta: Não construir enquanto Soul Points não virar uma mecânica de jogo real (fora de M14/M15, sem épico definido); se a fidelidade estrita exigir mesmo assim, a linha precisaria ser retirada do escopo do kit até a mecânica existir.

### [R2-03] Linha 'Speed' — protocolo (confirmado)
- kit: data.js:18 — { id:'speed', label:'Speed', value: 334 }, presente em defaultSkills (data.js:21).
- cliente: packages/client/src/shell/CharacterPanel.tsx — nenhuma linha 'Speed'; comentário linha 10 cita Speed explicitamente como faltante para M15 SV-04.
- dado: packages/sim/src/character.ts:179,217 — `CharacterRuntime.speed` já existe e é usado por `speedScale()` (linhas 232-233 do mesmo arquivo); nenhum campo em `player-stats` (types.ts:539-547) nem em `session-state.self` carrega o valor. É transporte, não mecânica nova.
- proposta: M15 SV-04 (docs/design-system-plan.md:235,357): adicionar `speed` a `player-stats` (protocol+server), incluir na comparação `sameStats` (packages/server/src/game/host.ts:319-331) para não quebrar o 'só manda quando muda', e então exibir a StatRow no cliente.

### [R2-04] Linhas 'Magic Level', 'Sword Fighting', 'Shielding' com barra de % até o próximo nível — protocolo (confirmado)
- kit: data.js:19 — { id:'ml', label:'Magic Level', value:5, pct:64, tone:'vital-mp' }, { id:'sword', label:'Sword Fighting', value:42, pct:80 }, { id:'shield', label:'Shielding', value:29, pct:14 }, todos em defaultSkills (data.js:21).
- cliente: packages/client/src/shell/CharacterPanel.tsx não tem essas linhas. packages/client/src/shell/ui/StatRow.tsx:13-14 já suporta a prop `percent` (desenha barra de 3px), mas nenhum consumidor do shell a usa hoje (grep por `percent=` no shell não retorna uso em CharacterPanel).
- dado: packages/sim/src/skills.ts:15-19 (SkillState/SkillsState), 36-39 (pointsForLevel, dá o custo do próximo nível) e 41 (class Skills) calculam tudo; nada em player-stats/session-state transporta nível ou pontos de nenhuma skill. Magic Level é a skill 'magic' do catálogo de conteúdo, usada em packages/sim/src/casting.ts:133-176.
- proposta: M15 SV-04 (docs/design-system-plan.md:357): adicionar `skills` (nível + % para o próximo, por skill relevante) a `player-stats`/protocolo; no cliente, alimentar StatRow com `percent`/`tone`, já suportados pelo primitivo.

### [R2-05] Ação ⚙ 'Personalizar skills' e o modal de seleção/reordenação de linhas — feature-cliente (confirmado)
- kit: Hud.jsx:37 — actions={<IconButton title={t.customizeSkills} onClick={onCustomize}>⚙</IconButton>}; App.jsx:40 referencia `<SkillsCustomizeModal t={t} selected={skillIds} setSelected={setSkillIds} onClose={close} />`, que NÃO existe em Modals.jsx nem em nenhum outro arquivo do kit (grep confirma zero definições) — clicar no gear quebraria o protótipo.
- cliente: CharacterPanel.tsx não passa `actions` ao Panel (sem gear no header). packages/client/src/shell/ui/StatRow.tsx:17 já expõe `onRemove` (comentário do arquivo cita o painel Personagem/DS-13 como consumidor futuro), mas nenhuma linha do CharacterPanel usa `onRemove` hoje.
- dado: Nenhum campo novo de servidor é necessário para a PREFERÊNCIA em si — docs/design-system-plan.md:363 já resolve isso como `localStorage` ('é conveniência de tela, não estado de jogo'). Os DADOS das linhas adicionais (Fist/Club/Axe/Distance/Fishing Fighting) dependem de SV-04, como em R2-04.
- proposta: Construir o modal de seleção (marcar/desmarcar/reordenar as StatRow visíveis) com persistência em localStorage, conforme SV-10 já decidiu; funciona hoje para as 6 linhas já transportadas, e passa a oferecer fist/club/axe/dist/fishing só depois de SV-04.

### [R2-06] Título do painel e rótulo da primeira linha — fidelidade (confirmado)
- kit: Hud.jsx:36-38 — título = t.skills = 'Skills' (data.js:3); data.js:18 — primeira linha label:'Experiência total'.
- cliente: packages/client/src/shell/CharacterPanel.tsx:53 — título = 'PERSONAGEM'; linha 57 — label='Experiência' (sem 'total').
- proposta: Ao reformar o painel (ver R2-01), usar 'Skills' como título e 'Experiência total' como rótulo, texto idêntico ao kit — troca de string, sem dependência de dado novo.

### [R2-07] SidePanel 'Automações' (segunda seção da coluna esquerda) — sistema-servidor (confirmado)
- kit: Hud.jsx:39-47 — AutomationsPanel: título t.automations='Automações' (data.js:3), footer com Button '+ {t.add}' (onAdd), corpo com grid por automação 'Switch | nome+resumo | ⚙ | ×'. App.jsx:13 monta como segunda seção da coluna esquerda, logo depois de SkillsPanel, alimentada por DR.automations (data.js:22-27, 5 itens).
- cliente: packages/client/src/shell/Shell.tsx:83-96 — a coluna esquerda monta só BotPanel, CharacterPanel, PartyMembers; nenhuma seção chamada 'Automações'. Busca por 'Automações'/'Automation' em todo `packages/client/src/shell/*.tsx` retorna zero ocorrências.
- dado: O mais próximo é o vocabulário genérico do bot (condição única → ação única: `botConditionSchema`/`botActionSchema` em packages/content/src/schemas.ts), já transportado opaco em `bot-config`/`session-state.botConfig` — mas é um nível de abstração ABAIXO do que o kit desenha (automação nomeada, com resumo textual e um único liga/desliga). Precisa de vocabulário novo, épico E4.
- proposta: Não construir a tela antes do E4 definir o vocabulário de 'automação nomeada' em content/sim; implementar antes disso forçaria o cliente a compor texto/resumo sem dado real por trás, o que viola D8.

### [R2-08] Automações 'Renovar anel' e 'Renovar colar' (renovação por carga) — sistema-servidor (confirmado)
- kit: data.js:23-24 — { id:1, name:'Renovar anel', summary:'Life Ring · quando acabar', on:true }, { id:2, name:'Renovar colar', summary:'Dragon Necklace · quando acabar', on:true }.
- cliente: Nenhuma automação de 'renovar por carga' existe em packages/client/src/bot/store.ts nem em BotPanel.tsx/RuleEditor.tsx; não há vocabulário de carga editável em nenhuma tela do cliente.
- dado: falta: `charges`/`durationMs` existem no SCHEMA (packages/content/src/schemas.ts:344-345) mas nada no `sim` decrementa carga ou expira por tempo (campos mortos — o próprio arquivo comenta isso nas linhas 338-342). 'Renovar quando acabar' não tem o que nunca acaba.
- proposta: Fora de escopo até o `sim` implementar consumo de carga/duração de item (pré-requisito de mecânica); só depois desenhar a automação como extensão do vocabulário de bot (E4).

### [R2-09] Automação 'Trocar arrow por alvos' — sistema-servidor (confirmado)
- kit: data.js:25 — { id:3, name:'Trocar arrow por alvos', summary:'≥ 3 alvos → Burst Arrow · senão Crystalline', on:false }.
- cliente: Nenhuma automação condicional de troca de munição por contagem de alvos existe em BotPanel.tsx/RuleEditor.tsx/bot/store.ts; a seleção de munição do cliente (AmmoPicker.tsx) é manual, por família, sem automação.
- dado: O vocabulário do bot é UMA condição → UMA ação; o card do kit descreve duas condições com retorno automático ('≥3 alvos → X, senão Y') como automação nomeada única — abstração acima do que existe hoje (E4).
- proposta: Aguardar vocabulário novo de automação composta (E4) antes de desenhar a tela; a troca manual (AmmoPicker) já cobre a parte sem automação dessa necessidade.

### [R2-10] Automação 'Trocar arma/escudo por vida' — sistema-servidor (confirmado)
- kit: data.js:26 — { id:4, name:'Trocar arma/escudo por vida', summary:'HP < 50% → Shield + Espada · HP > 80% → 2H', on:true }.
- cliente: Nenhuma automação de troca de equipamento por HP existe no cliente; RuleEditor.tsx edita ação spell/supply/item avaliada pelo bot, não uma automação nomeada de troca de slot(s) condicionada.
- dado: Mesma lacuna de abstração de R2-09: condição composta com dois limiares e ação de troca simultânea de dois slots (arma+escudo) não existe no vocabulário de bot atual.
- proposta: Mesma resposta de R2-08/R2-09: fica para o épico E4, junto das demais automações compostas.

### [R2-11] Automação 'Swap ring · Energy Ring' (kind='swapRing', modal próprio) — sistema-servidor (corrigido)
- kit: data.js:27 — { id:5, name:'Swap ring · Energy Ring', summary:'HP < 60% ou ≥ 4 alvos · volta ao Life Ring', on:true, kind:'swapRing' }; Hud.jsx:44 onConfig abre modal dedicado quando kind==='swapRing' (App.jsx:13), renderizando SwapRingModal (Modals.jsx:96-107 — este SIM existe no kit, ao contrário dos outros três modais desta região).
- cliente: packages/client/src/bot/store.ts:29,34,212,222-223 — `ringSwap` já é campo de BotConfig, mantido e devolvido opaco ('nenhuma tela edita ainda', comentário linha 29). Nenhuma tela do cliente o expõe.
- dado: O mecanismo (`botRingSwapSchema`, packages/content/src/schemas.ts:977-990: itemId/equipBelow/removeAbove/manaFloor/restorePrevious) já é transportado opaco via bot-config. Faltam duas coisas: (1) a TELA em si; (2) nenhum item `ring`/`amulet`/`necklace` existe hoje em packages/content/data/items (confirmado por listagem do diretório) — o `itemId` do modal não teria o que resolver em produção.
- proposta: Construir a tela é viável em termos de protocolo desde já (o campo já viaja), mas fica sem efeito prático até existir ao menos um item de anel/amuleto no catálogo de conteúdo — priorizar o conteúdo (SV-16/SV-17 do plano) antes ou em paralelo à tela.
- CORREÇÃO do verificador: Classificação errada: não é 'sistema-servidor', é 'feature-cliente'. O ring swap NÃO é um schema opaco só transportado — é um MECANISMO FUNCIONAL COMPLETO no sim: `#applyRingSwap`/`#takeOffRing` em packages/sim/src/rulesets/hunt.ts:1895-1938 (chamado em 1468 e 2026) lê HP%/mana% do personagem, equipa/desequipa o slot 'finger' pelo itemId configurado e restaura o anel anterior — exatamente a lógica que o SwapRingModal do kit edita, já em produção, não um stub. No cliente, packages/client/src/bot/store.ts:10 importa `botConfigSchema`/`BotConfig` do próprio `@draconya/content`, e `loadConfig` (linhas 238-239) roda `botConfigSchema.safeParse(raw)` — ou seja, `ringSwap` chega TIPADO e validado na aplicação; a 'opacidade' citada no Mapa de Capacidade (AVISOS #5) é só do campo bruto no protocolo (`z.unknown()`), e a aplicação já a resolve por completo via o schema de `content`, que o cliente tem permissão de importar (boundaries do pacote). `BotDraft.advanced` (store.ts:23-34) preserva `ringSwap` ida e volta sem perda — 'nenhuma tela edita ainda' é literalmente o único porém no comentário da própria store. Falta só A TELA (trabalho 100% de cliente, reaproveitando NumField/Select/Box do próprio Modals.jsx como referência), o que a proposta do próprio achado já reconhece ('viável em termos de protocolo desde já') — contradizendo o rótulo 'sistema-servidor' colado nele. A lacuna real (nenhum item ring/amulet em packages/content/data/items) é uma lacuna de CONTEÚDO/dado, não de mecanismo, e não bloqueia construir a tela — só a deixa sem efeito prático até existir um anel no catálogo, como a própria proposta já nota.

### [R2-12] Botão de rodapé '+ Adicionar' e o fluxo de criar automação nomeada nova — sistema-servidor (confirmado)
- kit: Hud.jsx:40 — footer=<Button variant='secondary' ...>+ {t.add}</Button> onAdd; App.jsx:39 referencia `<AddAutomationModal .../>`, que NÃO existe em Modals.jsx (grep confirma) — o clique quebraria o protótipo.
- cliente: BotPanel.tsx:113-117 tem um botão análogo '+ regra' por categoria, mas ele cria uma linha condição→ação DENTRO de uma categoria fixa (Cura/Poções/Ataque/Runas e itens/Suporte) — não uma 'automação' nomeada e livre como o kit desenha.
- dado: Não há opcode/verbo para 'criar automação nomeada livre' — o que existe é 'adicionar regra a uma categoria de bot' (mesmo bot-config de sempre).
- proposta: O botão '+ regra' já cobre a criação dentro do vocabulário atual do bot; um botão equivalente ao do kit exigiria primeiro o vocabulário de automação nomeada (E4) existir no servidor.

## O que o auditor deixou passar (verificador)
- CharacterPanel.tsx:59 usa label 'HP' e formato 'atual / máximo' (`${count(health)} / ${count(maxHealth)}`); o kit usa label 'Hit Points' e um valor único ('3.165', tmp-design-kit/handoff/ui_kits/draconya/data.js:18). Nenhum achado (R2-06 só cobre título do painel e 'Experiência'/'Experiência total') sinaliza essa divergência literal de rótulo+formato — classificação: fidelidade, dado já existe (health/maxHealth em player-stats).
- Mesma classe de problema para Mana: kit mostra valor único (785, data.js:18) e cliente mostra 'atual / máximo' (CharacterPanel.tsx:60); o rótulo 'Mana' já bate, só o formato diverge — fidelidade, não citado em nenhum achado.
- CharacterPanel.tsx:62 (`duration(staminaMs)`, função em 28-34) produz 'X h Y min'; o kit mostra Stamina como '41:40' (dois-pontos, data.js:18) — divergência literal de formatação de tempo que nenhum achado cobre; fidelidade.
- CharacterPanel.tsx:59-60 não passa `tone` às linhas HP/Mana, embora os tokens `--vital-hp`/`--vital-mp` já existam (packages/client/src/shell/tokens.css:70-73), StatRow já use `tone` para colorir valor e barra via `--stat-tone` (packages/client/src/shell/ui.css:530,544) e StatRow.test.ts:45 já exercite `tone: 'vital-hp'` em teste que passa. O kit marca exatamente esses tons nesses dois itens (data.js:18: tone:'vital-hp'/'vital-mp'). É uma cor 'grátis' (zero dependência pendente) que nenhum achado cita.
- O item 'Level' do kit carrega `pct: 27` (data.js:18) — uma barra de progresso até o próximo level, renderizada por StatRow via `percent`. `docs/design-system-plan.md:253` registra que 'a curva de XP não vai ao cliente' como decisão de produto (mesma razão pela qual o Analisador não mostra 'próximo level'). Nenhum achado (R2-01 a R2-06) nota que a linha 'Level' do kit especificamente contém esse dado hoje excluído por decisão — é um conflito de mesma natureza do Soul Points (R2-02), mas para a barra de progresso do Level, e vale levar ao dono do produto junto com R2-02 já que a diretriz de hoje é seguir o kit 'na risca'.
- App.jsx:39-40 mostra que `AddAutomationModal` e `SkillsCustomizeModal` recebem props (`onAdd`, `selected`/`setSelected`) que nenhum componente do kit implementa (confirmado: grep em Modals.jsx não acha as duas funções) — reforça R2-05/R2-12, mas vale registrar que é dois modais quebrados no PRÓPRIO protótipo do handoff, não só ausência no cliente; útil para não tentar 'copiar' um modal que não existe em lugar nenhum.

## Notas
Duas inconsistências internas do kit, relevantes para decidir o que 'fidelidade estrita' sequer significa nesta região:

1) **`BotPanel` (Hud.jsx:119-131) — o vBot com 'Configurações avançadas' (Lure, Ring swap, Alvo e postura, Regras de saída) — é definido no kit mas NUNCA renderizado.** `grep -rn "<BotPanel" tmp-design-kit/handoff/ui_kits/draconya/*.jsx` não retorna nada: `GameScreen` (App.jsx) monta a coluna esquerda só com `SkillsPanel`, `AutomationsPanel` e `PartyPanel` (App.jsx:11-15). Ou seja, a tela que o README.md chama de 'exatamente o que o dono quer ver' NÃO mostra o editor de regras condição→ação em lugar nenhum — mostra a SkillsPanel (stats com %) e a AutomationsPanel (cards nomeados). Só que é justamente esse componente órfão (`BotPanel`/`RuleRow` do kit) que estruturalmente bate com o que o cliente real já implementou (`packages/client/src/shell/BotPanel.tsx`) — switch + texto + engrenagem + setas + remover, categorias Cura/Poções/Ataque/Runas e itens/Suporte. Uma leitura 'pixel a pixel do que renderiza' pediria remover essa seção da tela e substituí-la por SkillsPanel+AutomationsPanel; isso jogaria fora a única parte desta região com dado real de servidor por trás (o bot de condição→ação) em favor de uma automação nomeada que não existe em nenhuma camada (achados R2-07 a R2-12). Vale decisão explícita do dono antes de qualquer trabalho, porque as duas leituras de 'fidelidade' apontam para direções opostas.

2) **Três modais referenciados pelo próprio App.jsx nunca são definidos em Modals.jsx, e travariam o protótipo se clicados**: `SkillsCustomizeModal` (App.jsx:40), `AutomationConfigModal` (App.jsx:43), `AddAutomationModal` (App.jsx:39). (Fora do escopo R2 mas no mesmo arquivo: `ActionConfigModal` e `AnalyzerModal` têm o mesmo problema, e o componente `NumField`, usado dentro de `RuleEditorModal`/`SwapRingModal`/`LureTargetingModal`, também não é definido em lugar nenhum do kit.) `SwapRingModal` é a EXCEÇÃO nesta região — ele existe de fato (Modals.jsx:96-107) — mas aponta para um `itemId` de anel que não existe no catálogo de conteúdo (achado R2-11). Nenhum desses três é, portanto, uma fonte de verdade visual utilizável tal como está; qualquer implementação 'fiel' desses modais precisaria ser desenhada do zero a partir da lista de parâmetros (data.js), não copiada de um arquivo existente.

## Notas do verificador
Verifiquei os doze achados reabrindo cada arquivo citado (Hud.jsx, App.jsx, data.js, Modals.jsx, CharacterPanel.tsx, StatRow.tsx, Panel.tsx, Shell.tsx, BotPanel.tsx, bot/store.ts, packages/protocol/src/types.ts, packages/sim/src/{character,skills,casting,rulesets/hunt}.ts, packages/content/src/schemas.ts e packages/content/CLAUDE.md) e conferindo número de linha contra o conteúdo real — as citações do auditor bateram com precisão notável em quase todos os casos (ex.: Hud.jsx:36-38/39-47/40, StatRow.tsx:10-20, botRingSwapSchema:977-990, sameStats:319-331).

Onze dos doze achados se sustentam sem ressalva. O único corrigido é R2-11 (ring swap): o auditor citou corretamente o schema e a lacuna de catálogo, mas rotulou o achado inteiro como 'sistema-servidor' quando na verdade o MECANISMO do sim já está implementado e em produção (`#applyRingSwap`, hunt.ts:1895-1938) e o cliente já desserializa e tipa `ringSwap` por inteiro via `botConfigSchema` de `@draconya/content` (bot/store.ts:10,238-239) — não há nada 'opaco' na aplicação, só no campo bruto do protocolo. A própria proposta do achado ('viável em termos de protocolo desde já') contradiz o rótulo que ele carrega; a classificação correta é 'feature-cliente' com uma nota à parte sobre o catálogo vazio de anéis.

Achado curioso de suporte: o schema (`packages/content/src/schemas.ts:344-345`) e o comentário do CLAUDE.md do pacote confirmam que `charges`/`durationMs` são campos mortos — reforça R2-08 além do que o achado já citava. Também vale registrar que `case 'item': return NOT_IN_CATALOG;` em `packages/sim/src/rulesets/hunt.ts` (~linha 1496) mostra que a ação genérica `kind: 'item'` do vocabulário do bot é hoje um no-op explícito — reforça (não enfraquece) a classificação 'sistema-servidor' de R2-09/R2-10, que dependeriam dessa mesma ação para trocar munição/equipamento.

A varredura adicional (missed) ficou concentrada em pequenas divergências literais de rótulo/formato no painel Personagem (HP, Mana, Stamina) e num ponto mais substantivo: o item 'Level' do kit inclui uma barra de progresso (`pct`) que depende exatamente do dado que `docs/design-system-plan.md:253` já decidiu não expor ao cliente — o mesmo tipo de conflito de R2-02 (Soul Points), só que para a barra do Level, e vale ser escalado ao dono do produto junto com aquele achado dado o pedido de fidelidade estrita de hoje.


---

# R3-party

## Conformes
- "você" como rótulo do próprio jogador (PartyPanel.tsx:82, PartyMembers.tsx:57 vs Hud.jsx:165)
- Glifo ★ prefixando o nome do líder (presença do glifo, não a cor — cor é achado R3-13)
- Opacidade 0.55 no membro caído/morto (shell.css:865 `.party-companion-down` vs Hud.jsx:163 `opacity: m.hp ? 1 : .55`)
- Texto "caiu" no lugar do HP% de membro morto (PartyMembers.tsx:63 vs Modals.jsx:75)
- Formato do HP% "{n} %" com espaço antes do símbolo (PartyMembers.tsx:63 vs Modals.jsx:75)
- Rótulos de modo "Dividido"/"Compartilhado" (PartyPanel.tsx:20, PartyMembers.tsx:25 vs Modals.jsx:62,70,76)
- Formato da linha "party {8 chars} · {modo}" (PartyPanel.tsx:78 vs Modals.jsx:69)
- Texto do botão "Criar party" (PartyPanel.tsx:57 vs Modals.jsx:67)
- Texto "Procurar party"/"Cancelar busca…" (PartyPanel.tsx:61-62 vs Modals.jsx:67)
- Placeholder "id da party" e botão "Entrar" (PartyPanel.tsx:66-72 vs Modals.jsx:67)
- Placeholder "id do personagem" e botão "Convidar" (PartyPanel.tsx:97-103 vs Modals.jsx:72)
- Texto do botão "Propor" (PartyPanel.tsx:116-118 vs Modals.jsx:72)
- Texto do botão "sair da party" em minúsculas (PartyPanel.tsx:136-138 vs Modals.jsx:65,161)
- Texto do botão "Iniciar" (PartyPanel.tsx:122-124 vs Modals.jsx:65)
- Rótulos de dificuldade "Cauteloso"/"Ousado"/"Agressivo" (PartyPanel.tsx:17-19 vs Modals.jsx:52,70)
- Status "✓ aprovou"/"aguardando" por membro (PartyPanel.tsx:83 vs Modals.jsx:69)

## Achados

### [R3-01] Moldura do painel Party (cabeçalho, borda, fio dourado) — fidelidade (confirmado)
- kit: Hud.jsx:158 (`SidePanel` usa `Panel dock` — ver core/Panel.jsx:4-8: fio dourado no topo, header com `--grad-titlebar`/borda `--gold-2`, título uppercase mono `--text-gold` 7.5px)
- cliente: PartyMembers.tsx:48 e PartyPanel.tsx:52 usam `<header className="analyzer-head"><strong>Party</strong></header>` dentro de um `<section>` cru — NÃO importam `ui/Panel.tsx` (que existe e é usado por PartyBag.tsx:14,32-37 e CharacterPanel). Sem o wrapper, a seção cai em `.windows > section` (shell.css:125-135), que ainda lê os tokens pré-design-system `--window-bg`/`--window-line`/`--window-head` (shell.css:46-49, azul-acinzentado) e um header 12px branco (`color:#fff`), não o dourado uppercase do kit. O próprio comentário do CSS (shell.css:212-218) lista `PartyMembers` e `PartyPanel` entre as telas que ainda usam "o Panel informal de antes do design system" e que "migra para Panel na própria issue (DS-10 a DS-17)" — migração que não aconteceu apesar do M14 constar como fechado.
- proposta: Reescrever PartyMembers.tsx e PartyPanel.tsx para usar `ui/Panel.tsx` (dock) como PartyBag.tsx já faz, herdando hairline dourado, `ui-panel-header`/`ui-panel-title`, slot de `actions`, `meta` e `footer`. Isso resolve de raiz R3-01 a R3-03 e parte de R3-09.

### [R3-02] Título do painel com contagem de membros ("Party · N") — feature-cliente (confirmado)
- kit: Hud.jsx:158 `title={t.party + " · " + p.members.length}`
- cliente: PartyMembers.tsx:48 e PartyPanel.tsx:52 renderizam só `<strong>Party</strong>`, sem contagem, em ambos os componentes que cobrem esta região.
- proposta: Ao migrar para `Panel` (R3-01), passar `title={`Party · ${partyView.members.length}`}` — o dado (`members.length`) já está no estado do cliente, não depende de protocolo novo.

### [R3-03] Ícones de ação no cabeçalho: "Party loot" (▣) e "Gerenciar party" (⚙) — feature-cliente (confirmado)
- kit: Hud.jsx:158 `actions={<><IconButton title="Party loot" onClick={onLoot}>▣</IconButton><IconButton title="Gerenciar party" onClick={onOpen}>⚙</IconButton></>}`; onOpen abre `PartyModal` (App.jsx:14,37)
- cliente: PartyMembers.tsx (durante a hunt) não tem nenhum `actions`/IconButton — ausente por completo. Não existe equivalente de "Party loot" (janela flutuante `PartyLootWindow`, Hud.jsx:198, fora do escopo desta região) nem de "Gerenciar party" client-side.
- proposta: Ao migrar para `Panel` (R3-01), adicionar um IconButton "Gerenciar party" — mas sua ação de abrir depende de resolver R3-12 primeiro (não há hoje modal de gerenciamento acessível durante a hunt). "Party loot" como janela dedicada é feature separada, fora do range de linhas 155-173; registrar como item à parte se o dono confirmar que quer replicá-la.

### [R3-04] Vocação e level de cada membro da party — protocolo (confirmado)
- kit: Hud.jsx:165 `<span style={{color: vocColor[m.voc]...}}>{m.voc}</span><span>LV {m.lv}</span>` (sidebar); Modals.jsx:75 `{p.cls} · LV {p.lv}` (modal "Na hunt")
- cliente: packages/protocol/src/types.ts:169-178 — `PartyState.members` só tem `characterId`, `name`, `alive`, `healthPercent`; sem `vocationId`/`level`. packages/server/src/game/host.ts:1804-1823 (`#partyBlock`) monta `members` a partir de `hosted.session.participants`, mas só copia `characterId`/`name`/`alive`/`healthPercent` — não copia vocação nem level, embora o `CharacterRuntime` de cada participante já os carregue (mesmos campos que `player-stats`/`session-state.self` expõem para o PRÓPRIO personagem). PartyMembers.tsx:56-58 e PartyPanel.tsx:82 só renderizam nome.
- dado: `hosted.session.participants[i]` já tem vocação/level em memória (mesma fonte de `playerStatsOf`, host.ts:285-304); falta copiá-los em `#partyBlock` (host.ts:1816-1821) e adicionar `vocationId`/`level` ao schema `PartyState.members` (types.ts:172-178). Corresponde a SV-03 do M15.
- proposta: Adicionar `vocationId: z.string()` e `level: z.number().int().positive()` ao schema de `PartyState.members`; preencher em `#partyBlock` a partir do `CharacterRuntime` de cada participante; renderizar em PartyMembers.tsx e PartyPanel.tsx (Formação) com a cor por vocação do kit.

### [R3-05] Barra de Mana (MP) por membro, junto com a de HP — protocolo (confirmado)
- kit: Hud.jsx:169 `<VitalBar kind="hp" .../><VitalBar kind="mp" .../>` — duas barras finas por membro
- cliente: PartyMembers.tsx:59-64 renderiza só `<VitalBar kind="hp" .../>`; não há segunda barra de mana. `PartyState.members` (types.ts:172-178) não tem campo de mana.
- dado: Mana atual/máxima de cada participante já existe em `CharacterRuntime` (mesma fonte usada em `player-stats.mana`/`maxMana` para o próprio); falta um `manaPercent` em `PartyState.members`, calculado do mesmo jeito que `healthPercent` (host.ts:1820). Corresponde a SV-03/SV-11 do M15.
- proposta: Adicionar `manaPercent` ao schema e a `#partyBlock`; renderizar `<VitalBar kind="mp" percent={member.manaPercent} height={4} showText={false} />` abaixo da barra de HP em PartyMembers.tsx.

### [R3-06] "Gasto" (supply gasto na sessão) por membro — protocolo (confirmado)
- kit: Hud.jsx:166 `<span title="Gasto em supplies nesta sessão">Gasto: <b>{m.xp.toLocaleString("pt-BR")}</b></span>`
- cliente: Nenhum campo de gasto por membro em `PartyState` (types.ts:169-179). O mecanismo de `analyzer`/`Aggregates` (que TEM `goldSpent` por participante, types.ts:52-69) só é mandado a quem está olhando aquele personagem especificamente (host.ts, `#presentAnalyzer`/`sentAnalyzer`) — não a todos da party.
- dado: `Aggregates.goldSpent` já é calculado por participante (session.ts, `aggregatesOf`); falta uma mensagem/campo novo que agregue os N conjuntos de `Aggregates` da party e os transmita a TODOS os visualizadores (hoje só o dono de cada personagem recebe o seu). Não é mecânica nova, é distribuição nova.
- proposta: Estender `party-state` (ou nova mensagem `party-spending`) com `spent: Record<characterId, number>` (ou array paralelo a `members`), preenchido a partir dos `Aggregates` já calculados de cada participante, e mandado a todos que visualizam a sessão.

### [R3-07] DPS/HPS por membro, com dano/cura totais ("DPS 723 · 135.7k") — sistema-servidor (confirmado)
- kit: Hud.jsx:170 `<span><b>DPS {m.dps}</b> · {m.dmg}</span><span><b>HPS {m.hps}</b> · {m.heal}</span>`
- cliente: Nenhuma ocorrência de `dps`/`hps` em `packages/sim/src` nem `packages/protocol/src` (verificado por busca; ausente por completo — não há arquivo onde isso seja calculado hoje).
- dado: falta: acumulador de dano-por-segundo e cura-por-segundo (janela deslizante) em `sim/`. Não existe hoje em nenhuma camada — não é campo a expor, é mecânica a construir (E2, combate).
- proposta: Não implementável sem novo sistema no `sim` (janela de tempo para taxa de dano/cura por personagem) mais transporte novo. Abrir como item de épico E2, fora deste ciclo de fidelidade visual.

### [R3-08] Botão "×" para remover membro da party (líder expulsa membro) — sistema-servidor (confirmado)
- kit: Hud.jsx:167 `{m.self ? <span/> : <button title="Remover da party">×</button>}`
- cliente: Nenhuma ocorrência de "kick"/remoção-por-líder em packages/server/src/party-store.ts, packages/server/src/api/party.ts (rotas: create, invite, join, leave, propose, approve, start — sem `/:id/kick` ou similar) nem em packages/client/src/party/api.ts (`PartyClient` não tem `kick`). Só existe auto-saída (`leave`, party-store.ts, api/party.ts:174).
- dado: falta: endpoint e regra de negócio para o líder remover outro membro (quem decide sair hoje é sempre o próprio personagem). Precisa de nova rota HTTP + validação de liderança no `PartyStore`.
- proposta: Adicionar `POST /api/party/:id/kick` (só o líder, characterId alvo no corpo) no server, método `kick()` em `PartyClient`, e o botão "×" em PartyMembers.tsx/PartyPanel.tsx chamando-o — mecanismo simétrico ao `leave` já existente.

### [R3-09] Rodapé "Gasto médio do grupo" / "Sua parte: recebe X gp" — sistema-servidor (confirmado)
- kit: Hud.jsx:159 `<span>Gasto médio do grupo</span><b>{gp(p.avgSpend)}</b><span>Sua parte</span><b>recebe {gp(p.yourShare)}</b>`
- cliente: Nenhum equivalente em PartyMembers.tsx nem PartyPanel.tsx. `party-settlement` (types.ts, opcode 26) só existe como evento pontual ao encerrar/settlement, não como estimativa contínua durante a hunt.
- dado: depende da mesma agregação-e-broadcast que falta em R3-06 (gasto de todos), mais um cálculo novo de rateio estimado em tempo real ("quanto eu receberia se parasse agora") que não existe hoje — `party-settlement` só calcula no fechamento real, não como preview.
- proposta: Tratar como extensão de R3-06: depois que a agregação de gasto de todos existir, adicionar um cálculo de estimativa de rateio ao vivo (server-side, para não inventar dado no cliente) e um novo campo/mensagem para "sua parte estimada".

### [R3-10] Interruptores "Rateio de custos" e "Dividir loot" como dois switches independentes — reversao-decisao (confirmado)
- kit: Hud.jsx:161 `{[["Rateio de custos", p.shareCosts], ["Dividir loot", p.splitLoot]].map(...=> <Switch .../>)}`
- cliente: PartyMembers.tsx:9-11 (comentário) e :49 — o modo é renderizado como TEXTO fixo (`MODE_TEXT[partyView.mode]`), nunca como toggles. `PartyState.mode` (types.ts:171) é um único enum `'split'|'shared'`, fixado na proposta do líder (PartyPanel.tsx propose, linha 116) — não dois booleanos independentes.
- decisão anterior: ADR 0027, decisão 5 (mode único fixado na proposta) — citada explicitamente no comentário de PartyMembers.tsx:9-11 como razão de excluir os dois switches do handoff.
- proposta: Fidelidade estrita ao kit exigiria reabrir a ADR 0027 decisão 5 e o schema `PartyState.mode` para suportar rateio de custo e divisão de loot como dois eixos independentes (hoje são o mesmo campo). Sem essa reabertura, a divergência é intencional e documentada — decisão do dono do produto, não bug.

### [R3-11] Botão "Sair da party" acessível durante a hunt ativa (coluna esquerda) — feature-cliente (confirmado)
- kit: Hud.jsx:161 `<Button variant="danger">Sair da party</Button>` dentro do próprio SidePanel que fica montado durante a hunt
- cliente: O botão "sair da party" só existe em PartyPanel.tsx:136-138, que só é renderizado dentro de `HuntsModal.tsx:148` (tela de escolha de caçada). Durante a hunt, `HuntActions.tsx:18-36` só oferece "Escolher caçada" (fora de hunt) ou "Sair da caçada" (dentro) — não há caminho para reabrir o HuntsModal nem qualquer outra tela com o botão de sair da party enquanto a hunt está em curso. PartyMembers.tsx (o painel que FICA montado durante a hunt) não tem nenhum botão de ação.
- proposta: `partyActions.leave()` (party/store.ts:74-78) já existe e já é chamado por PartyPanel.tsx — só falta expor um botão equivalente em PartyMembers.tsx (ou no rodapé do Panel migrado, R3-01), sem precisar de protocolo novo.

### [R3-12] Modal "Gerenciar party" com abas Formação/Na hunt, título "Party · N/4" e status "Todos aprovaram"/"Aguardando aprovação", acessível a qualquer momento — reversao-decisao (corrigido)
- kit: Modals.jsx:62-79 — `PartyModal` com `title={t.party + " · " + DR.party.length + "/4"}`, `Tabs items={["Formação","Na hunt"]}` e footer com texto de status (linha 65)
- cliente: Não existe um modal de party separado no cliente. A formação (PartyPanel.tsx) só é alcançável embutida em HuntsModal.tsx:146-148 ("Escolha uma caçada"), sem abas, sem "N/4" no título (título do modal é "Escolha uma caçada", HuntsModal usa `Modal` com esse título fixo) e sem o texto de status "Todos aprovaram"/"Aguardando aprovação" (ausente em PartyPanel.tsx — o botão "Iniciar" só fica desabilitado via `!everyoneApproved`, sem mensagem explicando por quê). Durante a hunt, nem essa tela é alcançável (ver R3-11).
- decisão anterior: ADR 0027 decisão 8 ("a formação da party mora no modal de escolha de caçada", citado em PartyPanel.tsx:1-10) e ADR 0029 D6 ("formação continua dentro do modal de caçada", geografia fixa, nada arrastável/modal-flutuante extra).
- proposta: Fidelidade estrita exigiria reabrir ADR 0027 d.8 e ADR 0029 D6 para reintroduzir um modal de party dedicado, com abas e acessível também durante a hunt (não só na escolha de caçada). Sem essa reabertura, adicionar pelo menos o texto de status ausente ("Todos aprovaram"/"Aguardando aprovação") em PartyPanel.tsx é melhoria de fidelidade textual que não conflita com a decisão vigente.
- CORREÇÃO do verificador: O achado se sustenta (nenhum modal de party dedicado existe, sem abas, sem 'N/4', sem texto de status), mas a citação 'ADR 0027 decisão 8' como base do requisito de reabertura é imprecisa: a decisão 8 do ADR 0027 fala só do MECANISMO de formação (HTTP/Redis, transitório: criar/convidar/entrar/sair/propor/aprovar/iniciar) — ela não diz onde a tela mora. Quem fixa a GEOGRAFIA ('a formação da party continua dentro do modal de escolha de caçada') é a decisão D6 do ADR 0029 (linhas 42-44: 'mantém ADR 0027'), que o achado também já cita corretamente. A reabertura correta é de ADR 0029 D6 (geografia), não de ADR 0027 decisão 8 (mecanismo) — a proposta e a conclusão do achado continuam válidas, só a atribuição da decisão 8 precisa ser removida ou reformulada como suporte indireto, não como a decisão que fixou o local da tela.

### [R3-13] Cor dourada do glifo ★ de líder, independente de ser "você" — fidelidade (confirmado)
- kit: Hud.jsx:165 `{m.leader && <span style={{color: "var(--gold-4)", fontSize: 7}}>★</span>}` — a estrela tem SEMPRE cor dourada própria, e o nome tem cor separada (`m.self ? gold-5 : parchment-1`)
- cliente: PartyMembers.tsx:56-58 concatena o glifo dentro da MESMA string/span do nome: `{`${leader ? '★ ' : ''}${isSelf ? 'você' : name}`}`, com `className={isSelf ? 'party-companion-self' : undefined}` (shell.css:866, `color: var(--gold-4)`) — a estrela só fica dourada quando o líder também é "você"; um líder que NÃO é o jogador atual tem a estrela na cor padrão do texto, não dourada.
- proposta: Separar o glifo ★ em um `<span className="party-leader-star">` com `color: var(--gold-4)` fixo, independente de `isSelf`, em PartyMembers.tsx e PartyPanel.tsx.

### [R3-14] Título da bolsa da party com o modo ("Bolsa da party · Compartilhado") — fidelidade (confirmado)
- kit: Modals.jsx:76 `<Box title="Bolsa da party · Compartilhado">`
- cliente: PartyBag.tsx:34 `title="Bolsa da party"` — string fixa, sem o sufixo de modo (embora `partyView.mode` já esteja disponível na própria função, linha 19).
- proposta: Trocar para `title={`Bolsa da party · ${MODE_TEXT[partyView.mode]}`}` reaproveitando o mapeamento já usado em PartyMembers.tsx.

### [R3-15] Barra de capacidade (%) da bolsa da party — fidelidade (confirmado)
- kit: Modals.jsx:76 não tem barra de progresso — só o texto "Capacidade = soma das capacidades dos presentes..."
- cliente: PartyBag.tsx:69-71 `<div className="party-bag-cap"><span className="party-bag-cap-fill" style={{width: capPercent+"%"}} /></div>` — elemento visual que o kit, nesta região ancorada, não desenha.
- proposta: Remover a barra de progresso (ou confirmar com o dono se é adição intencional aceitável) para bater com o kit, que só usa texto nesta seção.

### [R3-16] Slots vazios/tracejados no grid da bolsa da party (afordance de espaço restante) — sistema-servidor (confirmado)
- kit: Modals.jsx:76 `{[0,1,2].map((i) => <Slot key={"e"+i} size={38} empty label="" .../>)}`  — 3 slots vazios tracejados sempre aparecem após os itens reais
- cliente: PartyBag.tsx:42-67 só itera `bag.items` (lista real do servidor); não há conceito de "quantidade de slots" na bolsa compartilhada — `PartyBag` (protocol types.ts:182+) é uma lista de itens limitada por peso/capacidade, não por contagem de slots fixos.
- dado: falta: um conceito de "número de slots" da bolsa compartilhada. Hoje o modelo é lista + peso/capacidade em oz, sem noção de slots — mostrar N slots vazios exigiria inventar um número que o servidor não define (violaria D8/invariante 4 se feito no cliente).
- proposta: Não replicar sem antes decidir, no servidor, se a bolsa da party ganha um conceito de capacidade em "slots" (e não só peso) — decisão de produto/mecânica, não de UI.

### [R3-17] Formatação de gold e peso na bolsa da party (abreviação "k", separador de milhar) — fidelidade (confirmado)
- kit: Modals.jsx:76 mostra GOLD como slot com valor abreviado "8.4k" (dado de exemplo em vez de meta-texto); Hud.jsx:156 usa `v.toLocaleString("pt-BR")+" gp"` como padrão de formatação de gold em todo o kit
- cliente: PartyBag.tsx:35 `meta={`${String(bag.weight)}/${String(bag.capacity)} oz · ${String(bag.gold)} gold`}` — `String(number)` puro, sem `toLocaleString("pt-BR")` nem abreviação; um gold de 8400 apareceria como "8400 gold", não "8.4k gold" nem "8.400 gold".
- proposta: Formatar `bag.gold`/`bag.weight`/`bag.capacity` com `toLocaleString('pt-BR')` no mínimo (padrão usado em todo o resto do HUD); abreviação "k" é decisão de formatação a alinhar com o restante do HUD (ex. Analisador), não específica desta bolsa.

### [R3-18] Texto explicativo "Capacidade = soma das capacidades dos presentes · vendida e dividida ao sair alguém e no fim." — fidelidade (confirmado)
- kit: Modals.jsx:76 `<p>Capacidade = soma das capacidades dos presentes · vendida e dividida ao sair alguém e no fim.</p>`
- cliente: PartyBag.tsx não renderiza nenhum texto equivalente — o comentário de código (linha 27) menciona a mesma ideia ("a reserva não existe no servidor"), mas isso não vira texto na tela; só aparece a linha condicional de "Último settlement" (linhas 72-76), que é outra informação.
- proposta: Adicionar o texto explicativo estático (sem dependência de dado do servidor) junto à barra de capacidade em PartyBag.tsx, texto puro copiado do kit.

## O que o auditor deixou passar (verificador)
- packages/server/src/api/party.ts:58-68 (função view()) e packages/server/src/party-store.ts:23-34 (PartyRecord) — a FORMAÇÃO da party (rota HTTP /api/party e /api/party/mine) nunca carrega o NOME dos membros, só characterId. packages/client/src/party/api.ts:7-9 (PartyMemberView: só characterId+approved) confirma que o tipo do cliente também não tem `name`. Resultado: packages/client/src/shell/PartyPanel.tsx:82 exibe `member.characterId` cru para qualquer companheiro que não seja 'você' (`{member.characterId === me ? 'você' : member.characterId}`), enquanto o kit (Modals.jsx:69,75) sempre mostra nome legível (`p.n`, ex. 'Aldric Ferro'/'Seraphine'/'Tvk'). Isto é 'protocolo/API' (o servidor certamente sabe o nome — o mesmo `#nameByCharacter` que host.ts:1818 usa para o party-state via WebSocket —, só a rota HTTP de formação não o inclui na resposta) e é um gap mais grave que vários dos R3-XX listados, pois afeta a legibilidade básica da tela de formação inteira, não um detalhe de estilo.
- packages/client/src/shell/shell.css:848 — `.party-approved { color: #8fd18f; }` usa um verde hardcoded que NÃO bate com o token `--ok` (`#5fb56a`, definido em packages/client/src/shell/tokens.css:80 e igual em tmp-design-kit/handoff/tokens/colors.css:69). O kit usa exatamente `var(--ok)` para o texto '✓ aprovou' (Modals.jsx:69, `tone={p.approved ? "var(--ok)" : ...}`). É uma divergência de cor discreta mas real, e read-only-comprovável (cores diferentes, não é o mesmo verde): fidelidade.
- A proposta de R3-04 ('renderizar ... com a cor por vocação do kit') não observa que os rótulos do kit ('EK'/'RP'/'ED'/'MS', vocColor em Hud.jsx:157) codificam PROMOÇÃO de vocação (Elite Knight/Royal Paladin/Elder Druid/Master Sorcerer, ao estilo Tibia). O conteúdo do Draconya (packages/content/data/vocations/{knight,paladin,druid,sorcerer}.json, campo `name: "Knight"`) não tem qualquer conceito de vocação promovida/tier — só a vocação base escolhida no level 8 (ADR 0026 d.1). Reproduzir 'EK/RP/ED/MS' na risca exigiria inventar uma abreviação sem correspondência real no modelo de dados (ou decidir, à parte, uma abreviação diferente tipo 'K'/'P'/'D'/'S'), o que é uma nuance de fidelidade que R3-04 não menciona ao propor 'a cor por vocação do kit' como se fosse mapeamento direto.

## Notas
- Inconsistência interna do kit: em `data.js:71` (`partyHunt`), o campo usado para \"Gasto\" de cada membro está nomeado `xp` (`{ n: \"Funkcaipora\", ..., xp: 54115, ... }`), e Hud.jsx:166 o rotula como \"Gasto\" com tooltip \"Gasto em supplies nesta sessão\" — o nome do campo no próprio kit está trocado com o de experiência; não é um requisito real de expor XP ali, é lapso de nomenclatura da mock do handoff. Não propor renomear nada no protocolo por causa disso.
- `packages/client/src/shell/shell.css:212-218` lista `PartyBag` entre os componentes que \"ainda usam o Panel informal\" e que \"migra para Panel na própria issue\" — mas a leitura direta de `PartyBag.tsx:14,32-37` mostra que ele JÁ usa `ui/Panel.tsx` (dock) corretamente. Esse comentário está desatualizado (documentação divergindo do código) e vale uma limpeza à parte — não é um achado de fidelidade kit-vs-cliente, é doc-drift interno ao próprio repositório.
- Tamanho de slot da bolsa da party no kit (`Slot size={38}` em Modals.jsx:76) não bate com nenhum dos três tamanhos que `docs/design-system-plan.md` §1 formalmente adotou (36 ação / 30 equipamento-party / 26 container) — o cliente usa 30px (`PartyBag.tsx:56`), tratando a bolsa da party como \"equipamento/party\" por decisão implícita, não por um item explícito da tabela de tamanhos. Vale confirmar com o dono se 30px é mesmo a decisão final para este caso específico, já que o kit desenhou um quarto valor.
- R3-06 e R3-09 dependem do MESMO mecanismo novo (agregação de `Aggregates` de todos os membros da party, transmitida a todos os visualizadores) — tratar como uma única frente de trabalho de protocolo/servidor evita duas implementações divergentes.
- R3-11 e R3-12 são dois sintomas da mesma barreira estrutural: hoje não existe NENHUM caminho para reabrir gerenciamento de party (convidar, propor nova hunt, sair, ver aprovação) uma vez que a hunt começou — só a formação pré-hunt (dentro de `HuntsModal`) tem essas ações. Resolver R3-12 arquiteturalmente (se o dono decidir reabrir ADR 0027 d.8 / ADR 0029 D6) resolveria R3-11 de graça.
- Escopo respeitado: nenhuma leitura ou citação cobriu o conteúdo de `PartyLootWindow` (Hud.jsx:198+) além de constatar que o ícone que a abre (linha 158) não tem equivalente client-side (R3-03) — está fora do range de linhas 155-173 desta região e não foi auditado linha a linha.
- Nenhum arquivo foi modificado e nenhum comando de build/test/servidor foi executado durante esta análise, conforme escopo pedido (só Read/Grep/Bash de leitura).

## Notas do verificador
Reabri e conferi linha a linha todos os 18 achados contra os arquivos citados (tmp-design-kit/handoff/ui_kits/draconya/{Hud,Modals}.jsx, components/core/Panel.jsx, packages/client/src/shell/{PartyPanel,PartyMembers,PartyBag}.tsx e shell.css, packages/protocol/src/types.ts, packages/server/src/game/host.ts, packages/server/src/{party-store,api/party}.ts, packages/client/src/party/{api,store}.ts, docs/adr/0027 e 0029). Todas as 18 citações de arquivo:linha resistiram à verificação byte a byte — inclusive as mais específicas (shell.css:46-49/125-135/212-218, host.ts:1804-1837, types.ts:169-179, party.ts:58-68). Não encontrei nenhum achado falso ou mal classificado como 'sistema-servidor' quando já trafegava no protocolo, nem o inverso. A única correção é de atribuição de ADR em R3-12 (decisão 8 vs D6), que não muda a conclusão nem a proposta do achado. Os três itens em `missed` são novos, com evidência de arquivo:linha verificada nesta passada; o primeiro (nomes ausentes na formação da party) é o mais significativo dos três — é uma lacuna de dado real (a API HTTP de formação nunca leva nome de personagem), não um detalhe estético, e merece o mesmo nível de atenção que R3-04/R3-05.


---

# R4-centro

## Conformes
- Pill "Escolher caçada" (ícone ⚔, texto, posição centralizada sobre o mundo)
- Pill "Sair da caçada" (ícone ↩, texto, chevron », estilo de perigo)
- Popover "Sair sozinho quando…" — título exato
- Popover: labels "Acabar o gold" e "Alguém do grupo sair" — texto idêntico ao kit
- Resumo "Saindo sozinho: x · y" — minúsculas e separador " · " idênticos
- Slot: contagem crua sem prefixo "×", canto inferior direito (primitivo já é fiel)
- Viewport ocupa o container de ponta a ponta, chrome sobreposto por cima (estrutura geral)
- Formatação numérica pt-BR com separador de milhar nos valores que de fato trafegam (Analyzer)

## Achados

### [R4-01] Pill de boost de EXP ("EXP +64% 18h") no canto superior-esquerdo do mundo — sistema-servidor (confirmado)
- kit: Hud.jsx:91 — <Badge tone="exp">EXP +64% <b>18h</b></Badge>, absolute top:10,left:12
- cliente: packages/client/src/shell/Viewport.tsx:111 — o componente só renderiza <div className="viewport" ref={holder} />, sem nenhum overlay DOM; nenhuma ocorrência de "EXP +" em todo packages/client/src (grep confirmado)
- dado: falta: mecânica de boost de XP temporário (item tipo scroll) inteira — content, sim e protocolo
- proposta: Não construir agora: não há mecânica de scroll/boost de XP temporário em content/sim/protocol (grep 'blessing'/boost vazio). Abrir épico de economia/consumíveis antes de desenhar a pill.

### [R4-02] Pill "Bênção ativa" no canto superior-direito do mundo — sistema-servidor (confirmado)
- kit: Hud.jsx:92 — <Badge tone="gold">Bênção ativa</Badge>
- cliente: packages/client/src/shell/Viewport.tsx:111 (nenhum overlay); grep -rn "blessing" em content/sim/server/protocol não retorna nada
- dado: falta: mecânica de bênção inteira
- proposta: Não construir: bênção (blessing) não existe em nenhuma camada do jogo. Precisa de sistema novo (E-algum de economia/proteção de morte) antes de qualquer UI.

### [R4-03] Texto "Covil dos Dragões · Ousado" + "N criaturas no alcance" (nome da área, dificuldade e contagem) no canto superior-direito — protocolo (confirmado)
- kit: Hud.jsx:92 — {mobs.length ? "Covil dos Dragões · Ousado" : "Cidade · zona protegida"}<br/>{mobs.length + " criaturas no alcance"}
- cliente: Viewport.tsx:111 (nenhum overlay); packages/client/src/shell/BattlePanel.tsx:46-57 já deriva `rows.length` (contagem de criaturas visíveis) a partir de `world.creatures`, mas nada equivalente é desenhado sobre o mundo
- dado: contagem: já disponível via `world.creatures` (creature-appear); huntId/difficulty: faltam em `instance-enter` (packages/protocol/src/types.ts:261-265) — mecânica existe no sim (`HuntRuleset#difficulty`, `hunt.ts:463,555`), só não é transportada
- proposta: Composto: a CONTAGEM de criaturas já é derivável no cliente hoje (mesma fonte que `BattlePanel`, sem novo campo) — é feature-cliente pura. NOME DA ÁREA e DIFICULDADE dependem de `instance-enter.{huntId,difficulty}` (M15 SV-05): hoje só `map` sai (packages/protocol/src/types.ts:261-265); nem `huntId` nem `difficulty` trafegam em mensagem nenhuma. Adicionar os dois campos ao protocolo antes de desenhar o bloco de texto completo.

### [R4-04] Pills de buff com contagem regressiva (Haste 2:14, Utamo Vita 0:48, Magic Shield 1:31) no canto inferior-esquerdo do mundo — protocolo (confirmado)
- kit: Hud.jsx:94 — [["haste","Haste","2:14"],["ice","Utamo Vita","0:48"],["energy","Magic Shield","1:31"]].map(...Badge...)
- cliente: Viewport.tsx:111 (nenhum overlay); nenhuma ocorrência de condição ativa em packages/client/src/state/hud.ts ou shell/
- dado: falta: transporte de `Conditions` (haste/buff/mana-shield/heal-over-time com `expiresAtMs`) — mecânica existe em packages/sim/src/conditions.ts, zero campos no protocolo hoje
- proposta: O sim já calcula `Conditions` com `expiresAtMs` lógico por personagem (packages/sim/src/conditions.ts:14,24-35) mas nenhuma mensagem carrega isso — nem `player-stats` nem `session-state.self`. Adicionar `active-conditions` ao protocolo (M15 SV-05) antes de desenhar as pills.

### [R4-05] Moldura ao redor da criatura alvo (borda sólida vermelha vs. tracejada nas demais) — protocolo (confirmado)
- kit: Hud.jsx:102 — border: "1px " + (a ? "solid var(--blood-6)" : "dashed rgba(200,182,173,.35)"), boxShadow quando a===true
- cliente: Nenhum equivalente em packages/client/src/world/viewport.ts ou health.ts; grep -rln "targetId" em packages/client/src não retorna nada
- dado: falta: `targetId` do personagem, campo novo em `player-stats` ou mensagem própria — mecânica existe em packages/sim/src/targeting.ts:71
- proposta: `targetId` não trafega em mensagem nenhuma hoje (grep vazio em packages/protocol/src) embora o sim já calcule o alvo do bot (`selectTarget`, packages/sim/src/targeting.ts:71). Adicionar campo ao protocolo (M15 SV-05) antes de desenhar a moldura no Pixi.

### [R4-06] HP/Mana como arcos circulares ao redor do sprite do personagem, com nome flutuando acima — reversao-decisao (confirmado)
- kit: Hud.jsx:86-98 — função arc() desenha dois <svg> de progresso circular sobre o sprite; nome do personagem em span acima do círculo
- cliente: packages/client/src/shell/Vitals.tsx:8-11,47-52 — HP/Mana são duas barras HORIZONTAIS, montadas no topo da coluna direita (`.windows-right`), não sobre o sprite; packages/client/src/shell/Shell.tsx:98-100 confirma a posição
- decisão anterior: ADR 0029 D3 (vitais movidas para o topo da coluna direita, #253) — fidelidade estrita pede desenhar HP/Mana como arco sobre o sprite do jogador
- proposta: Reabre D3 do ADR 0029 (mundo em tela cheia, chrome sobreposto — vitals saíram do topo para o alto da coluna direita desde #253, justamente para NÃO desenhar HUD sobre o personagem). Fidelidade estrita exigiria mover HP/Mana de volta para um overlay circular centrado no sprite do jogador, dentro do canvas Pixi (ou DOM absoluto sobre ele) — decisão que precisa de novo ADR, não é ajuste de CSS.

### [R4-07] Indicador de latência ("42 ms") + FPS ("60 fps") no canto inferior-direito do mundo — feature-cliente (confirmado)
- kit: Hud.jsx:93 — <span title="Latência">42 ms</span><span>60 fps</span>, absolute right:12,bottom:8
- cliente: packages/client/src/shell/ConnectionBadge.tsx:20,25 — `latencyMs` já existe e é exibido, mas dentro de `.topbar-right` (TopBar.tsx:113), nunca sobre o viewport; não há contador de FPS em nenhum lugar do cliente (nenhuma ocorrência de 'fps' em packages/client/src)
- proposta: Latência já chega por `state.latencyMs` (ConnectionBadge.tsx:20) — só falta um overlay posicionado sobre o canvas, reaproveitando o dado existente. FPS não depende do servidor: é um contador local de `requestAnimationFrame`, inteiramente novo mas sem dependência de protocolo. Construir os dois como um pequeno overlay absoluto no canto inferior-direito de `.viewport`.

### [R4-08] Pill "DETALHES DA CAÇADA" (abre modal com nome, monstros, recorde e loot possível) — feature-cliente (corrigido)
- kit: Hud.jsx:140 — <button onClick={onDetails}>...Detalhes da caçada</button>; Modals.jsx:124 define HuntDetailsModal de fato (não é um dos 5 modais quebrados do protótipo)
- cliente: packages/client/src/shell/HuntActions.tsx:19-38 — só existem os pills "Escolher caçada" (linha 23) e "Sair da caçada" (linha 31); nenhum pill de detalhes
- dado: nome/dificuldades/monstros/loot: já em catalogue.hunts (packages/server/src/game/catalogue.ts:29-38); recorde XP/h-gp/h: falta — não há agregação histórica por hunt em lugar nenhum do servidor
- proposta: O nome, nível recomendado, dificuldades e monstros (via outfitIds) já saem em `catalogue.hunts[]` (packages/server/src/game/catalogue.ts:29-38) — dá para construir o pill + a maior parte do modal hoje. Falta apenas o "recorde" (XP/h, gp/h) do kit, que é agregação histórica cross-sessão e não existe (sistema-servidor à parte, fora deste pill).
- CORREÇÃO do verificador: O achado inverte o peso das partes. 'Nome/nível recomendado/dificuldades' são de fato a MENOR parte do que o modal do kit mostra, e são a ÚNICA parte já disponível hoje. 'Monstros' e 'loot possível' NÃO estão em catalogue.hunts: outfitIds (catalogue.ts:29-38,175-185, função monsterOutfitsOf) é só uma lista de ids numéricos de sprite para pré-aquecimento — não há nome de monstro nem ponte de volta a catalogue.monsters (que só tem {id,name}, sem outfitId) — e lootDrops (catalogue.ts:158-172, função lootDropsOf) é explicitamente SÓ A CONTAGEM, com comentário no próprio código: 'Só o NÚMERO: a lista de loot possível é da tela de detalhe, que não existe'. docs/design-system-plan.md:250 confirma isso como gap de M15: 'Detalhes da caçada: monstros, loot possível | composição e loot existem no conteúdo, não no catalogue | M15 (SV-02, SV-13)'. Além disso, a descrição textual do kit (data.js huntDetails.desc) não existe em huntSchema (packages/content/src/schemas.ts:448-478 não tem campo de descrição) — gap nem sequer rastreado no plano. E a seção 'Loot possível' do kit não é uma lista passiva: tem raridade por item e checkboxes PEGAR/VENDER, que dependem de autovenda por item (sistema E5, docs/design-system-plan.md linha ~247: 'Raridade do loot, PEGAR/VENDER por hunt | raridade não existe; autovenda é por item, na conta | sistema (E5)'), não citado no server_data do achado. Reclassificação: o BOTÃO 'Detalhes da caçada' é feature-cliente (pode abrir um modal hoje), mas o CONTEÚDO do modal do kit é bloqueado por quatro coisas distintas — SV-02/SV-13 (protocolo/conteúdo já existe, falta transporte de monstros+loot), E5 (mecânica de raridade/autovenda inexistente), decisão de produto (recorde nunca trafega) e um campo inexistente no schema (descrição). server_data corrigido: nome/recommendedLevel/difficulties = já em catalogue.hunts (catalogue.ts:29-38); monstros e loot (lista com nome/raridade) = faltam, M15 SV-02 (transporte — composição já existe em content.hunts.difficulties[].composition); raridade + pegar/vender = mecânica inexistente (E5); descrição = campo inexistente em huntSchema; recorde = decisão de produto de nunca expor (confirmado, mantém-se).

### [R4-09] Pill "DESPACHAR LOOT" + chevron — sistema-servidor (confirmado)
- kit: Hud.jsx:141 — <button onClick={onDispatch}>Despachar loot</button>{chev(false,onDispatch)}; Modals.jsx:137 define DispatchLootModal
- cliente: packages/client/src/shell/HuntActions.tsx:19-38 — nenhum pill de despacho de loot existe
- dado: falta: sistema de despacho/venda de loot com raridade — mecânica inexistente (E5)
- proposta: Não construir agora: despacho/venda de loot com raridade é do épico E5 (economia), fora do M14/M15 conforme o plano de design system. Sem mecânica de venda/raridade no servidor, o pill não teria o que fazer.

### [R4-10] Quarta regra de saída "Acabar a capacidade" no popover — sistema-servidor (confirmado)
- kit: data.js:75 — exitRules inclui ["out-of-capacity","Acabar a capacidade",false]; Hud.jsx:147 renderiza todas as linhas de `exitRules` sem filtro
- cliente: packages/client/src/bot/exit-rules.ts:12 — EXIT_RULE_KINDS = ['hp-below','out-of-gold','party-member-lost'] (só 3); comentário em ExitRulesPopover.tsx:4-5 confirma a omissão deliberada
- dado: falta: kind 'out-of-capacity' em botExitRuleSchema — mecânica de saída por capacidade não existe no sim
- proposta: `botExitRuleSchema` (packages/content/src/schemas.ts:932-944) não tem o `kind` 'out-of-capacity'. É o SV-06 do M15: adicionar o kind ao schema de content + sim antes de reabrir a quarta linha no popover.

### [R4-11] Ordem das linhas no popover de saída — fidelidade (confirmado)
- kit: data.js:75 — ordem: out-of-gold, out-of-capacity, party-member-lost, hp-below
- cliente: packages/client/src/bot/exit-rules.ts:12 — EXIT_RULE_KINDS = ['hp-below','out-of-gold','party-member-lost'] — hp-below vem PRIMEIRO, não por último
- proposta: Reordenar EXIT_RULE_KINDS para ['out-of-gold','party-member-lost','hp-below'] (mantendo fora 'out-of-capacity', ver R4-10) para bater com a ordem do kit.

### [R4-12] Texto de rodapé em itálico no popover: "A mesma saída de cinco segundos, iniciada para você." — fidelidade (confirmado)
- kit: Hud.jsx:148 — <p style={{font:"italic 7px..."}}>A mesma saída de cinco segundos, iniciada para você.</p>
- cliente: packages/client/src/shell/ExitRulesPopover.tsx:32-68 — ExitRulesList termina no map de regras, sem nenhum parágrafo de rodapé
- proposta: Acrescentar o parágrafo de nota ao final de ExitRulesList (texto estático, sem dependência de dado do servidor).

### [R4-13] Campo numérico editável de percentual para "HP abaixo de X%" dentro do popover — fidelidade (confirmado)
- kit: Hud.jsx:147 — a linha de HP é só <label>{label}<Checkbox .../></label>, com `label` já contendo o número fixo ("HP abaixo de 30 %"), sem input algum para editar o valor no popover de saída
- cliente: packages/client/src/shell/ExitRulesPopover.tsx:44-55 — <input type="number" className="exit-rule-percent" .../> permite editar o percentual inline, algo que o kit não desenha neste popover
- proposta: Sob fidelidade estrita, remover o input editável deste popover e deixar o percentual fixo/apenas ligar-desligar, como o kit — ou, se o dono preferir manter a funcionalidade extra (mais útil), registrar a divergência intencional em vez de tratá-la como pendência.

### [R4-14] Janela do Analisador como FloatingWindow arrastável sobre o mundo (drag por mousedown/mousemove) — reversao-decisao (confirmado)
- kit: Hud.jsx:174-180 — FloatingWindow usa onMouseDown+window.addEventListener('mousemove'/'mouseup') para arrastar; AnalyzerWindow (Hud.jsx:189) é montada dentro dela com posição inicial {x:250,y:12}
- cliente: packages/client/src/shell/Analyzer.tsx:207-220 — <Panel dock title="ANALISADOR" .../> é uma seção FIXA da coluna direita (ver também Shell.tsx:111-113); Panel.tsx não implementa nenhum mecanismo de arraste
- decisão anterior: ADR 0029 D6 (geografia fixa, nada arrastável) — fidelidade estrita pede janela flutuante e arrastável
- proposta: Reabre D6 do ADR 0029 ("nada arrastável, geografia fixa") e a arquitetura de `Panel dock` (DS-04/DS-15). Fidelidade estrita exigiria tornar o Analisador uma janela flutuante e arrastável, posicionada por estado próprio (x,y) fora das colunas — decisão que precisa de novo ADR, não é troca de classe CSS.

### [R4-15] Título da janela do Analisador — fidelidade (confirmado)
- kit: Hud.jsx:189 — <FloatingWindow title={t.analyzer} .../>, e t.analyzer = "Analisador de caçada" (data.js:3)
- cliente: packages/client/src/shell/Analyzer.tsx:210 — title="ANALISADOR" (texto fixo, mais curto)
- proposta: Trocar o título para "Analisador de caçada" (a folha CSS já uppercasa via `.ui-panel-title`, então o efeito visual final ficará "ANALISADOR DE CAÇADA").

### [R4-16] Abas "Dano recebido" / "Dano causado" com repartição por criatura/fonte — sistema-servidor (confirmado)
- kit: Hud.jsx:191-194 — <Tabs items={["Sessão","Dano recebido","Dano causado"]}/>, cada aba usa <Share rows={a.taken|a.dealt}> com percentuais por fonte
- cliente: packages/client/src/shell/Analyzer.tsx:207-220 — não há <Tabs>; só SessionBox e HourBox são renderizados, sempre juntos, sem seleção de aba
- dado: falta: acumulador de dano recebido/causado POR FONTE — mecânica inexistente em packages/sim/src
- proposta: Não construir agora: não existe acumulador de dano por fonte (criatura/magia/arma) em `combat-events.ts`/`session.ts` — só `bestBasicHit`/`bestSpellHit` (o MAIOR golpe). Precisaria de estrutura de agregação nova no sim e novo campo de protocolo antes de qualquer aba.

### [R4-17] Contagem regressiva "Próximo level" no cabeçalho do Analisador (00:35:53) — protocolo (corrigido)
- kit: Hud.jsx:190 — [["Sessão",a.session],["Próximo level",a.nextLevel]].map(...)
- cliente: packages/client/src/shell/Analyzer.tsx:93-115 — SessionBox não tem nenhuma linha de ETA para o próximo level
- dado: curva de XP existe em content/progression; decisão de produto atual é NÃO expor 'XP para o próximo level' (types.ts:359-364)
- proposta: A curva de XP existe em progression.ts/content mas é uma decisão de produto EXPLÍCITA de não trafegar (comentário em packages/protocol/src/types.ts:359-364 — para não virar métrica oficial comparável entre hunts). Reabrir esta linha do kit exige primeiro reverter essa decisão de produto, não só adicionar um campo — registrar a decisão explicitamente antes de implementar.
- CORREÇÃO do verificador: A citação de evidência está errada, embora a conclusão de fundo sobrevive. packages/protocol/src/types.ts:359-364 é o comentário sobre a mensagem 'catalogue' (HuntListing) na TELA DE SELEÇÃO de hunt — a decisão ali é não expor estimativa de XP/h e gold/h POR HUNT ('recorde'), para não virar métrica comparável entre hunts (essa é a evidência certa para R4-08's 'recorde', não para este achado). Não tem relação direta com o 'próximo level' do Analisador AO VIVO. A citação correta para a decisão específica de não expor 'tempo/XP até o próximo level' é docs/design-system-plan.md:253 — 'Analisador: suprimentos e loot por item, dano por criatura/fonte, "próximo level" | só contagens e maiores golpes; a curva de XP não vai ao cliente | fica de fora; linhas atuais entram (DS-15)' — e packages/client/src/shell/CharacterPanel.tsx:8, que documenta a mesma regra ('a curva de XP para o próximo level não trafega'). Tecnicamente, o transporte realmente falta: packages/server/src/game/catalogue.ts:123 só copia `content.progression.vocationLevel` para o catálogo; os parâmetros da fórmula (`progression.xp.base`/`exponent`, usados por `xpToCompleteLevel`/`totalXpForLevel` em packages/sim/src/progression.ts:63-85) nunca chegam ao cliente — então mesmo com `xp`/`level` já em `player-stats`, o cliente não pode calcular a ETA sozinho. Mas isso já é uma decisão de ESCOPO registrada ('fica de fora'), não apenas uma pendência de M15 como o restante da tabela de gaps sugere — vale marcar essa nuance ao registrar a issue. Classificação 'protocolo' permanece adequada; troque só a citação de evidência.

### [R4-18] Sufixo de unidade "gp" nos valores de gold do Analisador — fidelidade (confirmado)
- kit: data.js:72 — analyzerLive.sess: [["Gold","79.930 gp"],...]; hour: [["Gold/h","1.133.402 gp"],...]
- cliente: packages/client/src/shell/Analyzer.tsx:102-103,124-127 — <Line label="Gold" value={count(aggregates.goldGained)} /> não anexa nenhuma unidade
- proposta: Anexar " gp" aos valores de Gold/Gasto/Saldo em SessionBox e HourBox (dado já disponível, é só formatação de string).

### [R4-19] Listas "Suprimentos usados" e "Loot recolhido" com item, contagem e valor por linha — sistema-servidor (confirmado)
- kit: Hud.jsx:186,192 — componente Items renderiza a.supplies/a.loot, cada linha com nome, "×q" e valor (ex.: data.js:72 ["Diamond Arrow",93,"12.09k"])
- cliente: packages/client/src/shell/Analyzer.tsx:106-107 — SessionBox só mostra `optional(aggregates.itemsLooted)` e `optional(aggregates.suppliesUsed)` como contadores agregados únicos, sem lista por item
- dado: falta: breakdown por item de supplies usados e loot recolhido — Aggregates hoje só tem contadores únicos (packages/protocol/src/types.ts:52-69)
- proposta: Não construir a lista agora: `suppliesUsed`/`itemsLooted` são contadores agregados únicos no sim (nenhum breakdown por id de supply/item). Precisa de estrutura nova em `session.credit` e novo campo de protocolo antes de qualquer lista por item.

### [R4-20] Janela "Party loot" como FloatingWindow arrastável, com ícone próprio (▣) no painel da party para abrir/fechar — reversao-decisao (confirmado)
- kit: Hud.jsx:198-211 (PartyLootWindow dentro de FloatingWindow, posição inicial {x:12,y:300}); Hud.jsx:158 — <IconButton title="Party loot" onClick={onLoot}>▣</IconButton> controla `partyLootOpen` independentemente das demais janelas
- cliente: packages/client/src/shell/PartyBag.tsx:31-37 — <Panel dock title="Bolsa da party" collapsed={collapsed} .../> é uma seção fixa da coluna direita; Shell.tsx:110 — collapsed={!open.inventory}, atrelada ao MESMO toggle "Inventário", sem ícone próprio
- decisão anterior: ADR 0029 D6 (geografia fixa, nada arrastável; Analisador seria seção — o mesmo vale aqui para a bolsa da party)
- proposta: Reabre D6 do ADR 0029 (mesma decisão de R4-14). Fidelidade estrita exigiria tornar a Bolsa da Party uma janela flutuante independente, com seu próprio controle de abrir/fechar (não compartilhado com "Inventário").

### [R4-21] Linha "Cap reservado" + marcador de reserva na barra de uso da bolsa da party — sistema-servidor (confirmado)
- kit: Hud.jsx:205-206 — <div>Cap reservado<b>{reserved...}</b></div> e uma segunda <i> marcando a posição da reserva na barra
- cliente: packages/client/src/shell/PartyBag.tsx:27-29 — comentário explícito: "Sem 'cap reservado' (a reserva não existe no servidor): só total e em uso"; só `capPercent` é calculado, sem segunda linha
- dado: falta: conceito de "capacidade reservada" da bolsa da party — mecânica inexistente
- proposta: Não construir: não existe conceito de reserva de capacidade no sim/protocolo hoje. Precisaria de mecânica nova antes de qualquer UI de reserva.

### [R4-22] "Valor estimado" em gp da bolsa da party — protocolo (confirmado)
- kit: Hud.jsx:207 — <span>valor est. 226.6k gp</span>
- cliente: packages/client/src/shell/PartyBag.tsx:44-46 — `named()` só resolve nome/appearanceId do item; nenhum cálculo de valor total é feito ou exibido
- dado: falta transporte: `value` existe em content/items/*.json (schemas.ts:319) mas não é copiado para catalogue.items (catalogue.ts:79-99)
- proposta: `value` (preço de venda) já existe como campo obrigatório em content/items/*.json (packages/content/src/schemas.ts:319), mas `buildCatalogue` não o copia para `catalogue.items[]` (packages/server/src/game/catalogue.ts:79-99 não lista `value`). É o SV-01 do M15: adicionar `value` ao catálogo primeiro; o cliente então soma `quantity × value` por item da bolsa.

### [R4-23] Grade de 12 slots fixos (6×2) com placeholders vazios preenchendo o restante — fidelidade (confirmado)
- kit: Hud.jsx:202 — grid de 6 colunas com os itens reais seguidos por [0..5].map(i => <Slot empty .../>) até completar 2 linhas
- cliente: packages/client/src/shell/PartyBag.tsx:42; shell.css:871 — `.party-bag-grid { grid-template-columns: repeat(auto-fill, 30px) }` só renderiza os itens reais existentes, sem slots vazios de preenchimento
- proposta: Ajustar o grid para um número fixo de colunas com slots vazios (`<Slot empty />`) completando a grade, como no kit, em vez de `auto-fill` dinâmico.

### [R4-24] Título e subtítulo ("meta") da janela da bolsa da party — fidelidade (confirmado)
- kit: Hud.jsx:201 — title="Party loot" meta="vendido e dividido ao fim"
- cliente: packages/client/src/shell/PartyBag.tsx:34-35 — title="Bolsa da party", meta={`${bag.weight}/${bag.capacity} oz · ${bag.gold} gold`} (usa a palavra "gold" por extenso, não a abreviação "gp" usada no resto do kit)
- proposta: Renomear o título para "Party loot" e ajustar o meta para o padrão de unidade "gp" usado em todo o resto do handoff, mantendo o peso/capacidade real como conteúdo (o kit usa texto estático fixo aqui, mas o dado real do cliente é preferível — só a UNIDADE precisa bater).

## O que o auditor deixou passar (verificador)
- O chat flutuante inteiro é uma invenção do D5 (ADR 0029) que nenhum achado aponta como reversão: o kit NÃO desenha nenhuma janela de chat — 'chat' no TopBar do kit abre um modal-placeholder cujo texto diz 'Este menu já vive nas barras laterais / inferior do HUD' (tmp-design-kit/handoff/ui_kits/draconya/App.jsx:41), e Hud.jsx não tem nenhum componente de chat. O cliente real desenha uma janela flutuante fixa no canto inferior esquerdo com moldura própria, abrir/fechar e posição via CSS (packages/client/src/shell/Chat.tsx:1-16, comentário cita explicitamente '#252, ADR 0029 D5'; packages/client/src/shell/Shell.tsx:127-130; packages/client/src/shell/shell.css:153). Sob fidelidade estrita isso reabre D5 por inteiro (existência da janela, não só a barra de ações que D5 já registrava como excluída), no mesmo padrão de R4-14/R4-20 para D6.
- A pill 'Sair da caçada' e o toggle do popover de saída não formam um único botão partido como no kit — viram dois elementos com um gap de 8px entre eles (packages/client/src/shell/shell.css:452-456, `.hunt-actions{gap:8px}`) e a pill carrega um '»' decorativo dentro do próprio texto (packages/client/src/shell/HuntActions.tsx:33) além do '»' funcional do toggle separado (packages/client/src/shell/ExitRulesPopover.tsx:77-83, `.exit-rules-toggle`), resultando em dois chevrons visíveis e um vão entre as peças. No kit, label e chevron são o MESMO botão partido, colados, sem gap, com bordas cortadas (`chev()`, tmp-design-kit/handoff/ui_kits/draconya/Hud.jsx:136,141,143 — `borderRadius: '3px 0 0 3px'`/`'0 3px 3px 0'`, `borderLeft: 0`, dentro do mesmo `<span style={{display:'flex'}}>`, um único '»' clicável).
- A descrição textual da caçada no modal de detalhes do kit (`data.js` `huntDetails.desc`, ex.: 'As galerias sob a Fortaleza Rubra...') não tem NENHUMA fonte no conteúdo — `huntSchema` (packages/content/src/schemas.ts:448-478) não define campo de descrição — e esse gap não está nem listado em docs/design-system-plan.md junto com 'monstros, loot possível' (linha 250); é um dado a mais que falta e que R4-08 não capturou.

## Notas
Inconsistências internas do PRÓPRIO kit, encontradas na leitura linha a linha do escopo R4-centro (não são bugs do cliente):

1. **App.jsx referencia 5 modais nunca definidos**, e um deles é acionado a partir do escopo desta região: o botão \"⤢ Abrir completo\" do AnalyzerWindow (Hud.jsx:189, onExpand={() => setOpen(\"analyzer\")}) leva App.jsx:25 a tentar renderizar `<AnalyzerModal .../>` — componente que não existe em Hud.jsx nem em Modals.jsx (confirmado por grep: Modals.jsx só define CharacterModal, HuntsModal, PartyModal, RuleEditorModal, SwapRingModal, LureTargetingModal, HuntDetailsModal, DispatchLootModal, SettingsModal, SocialModal, PreyModal, CyclopediaModal, GuildModal, ShopModal — nunca AnalyzerModal, ActionConfigModal, AutomationConfigModal, AddAutomationModal ou SkillsCustomizeModal). O protótipo do kit quebra ao clicar nesse botão.

2. **O kit tem DUAS listas de regras de saída diferentes e divergentes**: `DR.bot.exit` (data.js:47, 3 itens: hp-below/out-of-gold/party-member-lost, usada no resumo do BotPanel — fora do escopo R4-centro) versus `DR.exitRules` (data.js:75, 4 itens, incluindo \"out-of-capacity\", usada no popover de HuntActions — dentro do escopo). As duas listam praticamente as mesmas regras com contagens e ordens diferentes, e nada no kit reconcilia as duas — um indício de que \"Acabar a capacidade\" foi adicionado num lugar só do protótipo e esquecido no outro.

3. **Base de tela divergente**: App.jsx:9 fixa `width:1800,height:1010` para o GameScreen, mas README.md do próprio ui_kit também cita essa mesma base enquanto DESIGN_SYSTEM.md cita 1600×900 (já registrado no digest do plano) — irrelevante para o cliente real porque D3 rejeita `transform:scale` por inteiro, mas seguiria sendo uma divergência do kit consigo mesmo caso alguém tentasse reproduzir a tela pixel a pixel a partir dele.

4. **HuntActions no kit é posicionada a `bottom: 130`** (Hud.jsx:138-139), pressupondo a barra de ações de 124px do rodapé (que o D5 do ADR 0029 já removeu do cliente). O cliente hoje usa `bottom: 24px` (shell.css:453) porque não há mais rodapé disputando esse espaço — isso não é um erro do cliente, é consequência de uma decisão já tomada (D5) que a fidelidade estrita também reabriria indiretamente, mesmo sem um finding próprio: se a barra de ações do kit voltasse, o valor `bottom: 130` teria que voltar junto com ela.

Sobre o pedido de \"de onde viriam os dados do analisador ao vivo\": kills/xp/gold/gasto/saldo/duração já chegam por `analyzer` (opcode 20, Aggregates); \"/h\" é sempre calculado no cliente a partir de `durationMs` (decisão de produto, nunca trafega); supplies/loot por item e dano por fonte NÃO existem em nenhuma camada (R4-19/R4-16); \"próximo level\" existe no sim mas é propositalmente retido (R4-17).

## Notas do verificador
Verifiquei os 24 achados reabrindo cada arquivo citado (kit e cliente) e conferindo número de linha, e cruzei contra packages/protocol/src/types.ts, packages/server/src/game/catalogue.ts, packages/sim/src/{targeting,conditions,progression,hunt/catalogue}.ts, packages/content/src/schemas.ts e docs/design-system-plan.md (que se revelou uma fonte de verdade já muito mais granular que o mapa de apoio, com uma tabela SV-01..SV-19/DS-01..DS-19 linha a linha). 22 dos 24 achados sobrevivem a esta verificação sem alteração — evidências (arquivo:linha), classificação e proposta batem com o código hoje. Dois precisam de correção pontual: R4-08 superestima o quanto do modal de detalhes já é possível construir (só nome/nível/dificuldades estão no catálogo; monstros, loot, raridade, pegar/vender e a descrição textual faltam, por quatro razões distintas), e R4-17 cita o comentário errado do protocolo (confundiu a decisão de não expor XP/h por hunt na tela de seleção com a decisão, documentada em outro lugar, de não expor a curva de XP para o Analisador ao vivo) — a classificação de ambos continua correta, só a evidência/peso muda. Nenhum achado foi refutado. Na varredura adicional pelo escopo R4-centro encontrei três discrepâncias que os 24 achados não cobriram: a janela de chat flutuante inteira é uma invenção do D5 não listada como reversão (paralelo direto a R4-14/R4-20), um defeito visual de composição no par pill+chevron de 'Sair da caçada' (gap + chevron duplicado), e a ausência total de um campo de descrição de hunt no schema de conteúdo (mais básico que os gaps de monstro/loot já rastreados).


---

# R5-acoes-bot

## Conformes
- RuleEditorModal — grid condição/operador/valor (1.2fr/.6fr/.8fr)
- RuleEditorModal — divisor "→ AÇÃO"
- RuleEditorModal — lista de ações (altura 30px, estados selecionado/bloqueado)
- RuleEditorModal — texto do rodapé "Salvar manda agora · quem decide é o servidor"
- RuleEditorModal — nota "Dentro da categoria a avaliação é de cima para baixo..."
- RuleRow — switch tone=traffic (verde ligado/vermelho desligado), engrenagem "editar regra", setas ▴▾, × "remover regra"
- Categorias do bot — nomes e tetos de slot (Cura 3, Poções 4, Ataque 10, Runas e itens 10, Suporte 10)
- Texto de gate "Bot avançado a partir do level 50"
- ExitRulesPopover — título "Sair sozinho quando…", rótulos "Acabar o gold"/"Alguém do grupo sair", 30% padrão de hp-below
- Posição do popover de saída (chevron » ao lado de "Sair da caçada")
- Slot primitivo — tamanho 36 já reservado para "barra de ação" com hotkey/contagem/elemento, ainda que sem consumidor

## Achados

### [R5-01] Barra de Ações (ActionBar, 2×12 slots) — reversao-decisao (corrigido)
- kit: Hud.jsx:71-84 função ActionBar — grid 12×2 de Slot(36px) com tecla (a.h), nome (a.l), contagem (a.c) e elemento (a.el); título t.actions="Ações" com meta t.autosave="Salva automaticamente"; Select "CONJUNTO" (Energia/Fogo/Gelo/Sagrado) e "ALVO" (Seguir/Mais próximo/Menor HP); botão ⌖ Lure·Follow. Renderizada de fato em App.jsx:16 dentro do GameScreen — não é código morto no kit.
- cliente: packages/client/src/shell/ não tem nenhum arquivo ActionBar; grep por "ActionBar|action-bar" não retorna consumidor algum — só a prop `hotkey` declarada e nunca usada em ui/Slot.tsx:14. shell.css não reserva rodapé para isso; o CLAUDE.md do client documenta a decisão: "sem a faixa inferior de 124 px do handoff, porque a barra de ações que ela hospedava não entra neste marco (D5)".
- dado: packages/protocol/src/messages.ts:8-27 lista os 16 opcodes C2S completos (authenticate…move-item); nenhum é "cast"/"use-item"/"use-slot". Não existe hoje como o cliente mandar "execute esta ação agora" — precisaria de opcode novo (E10).
- decisão anterior: ADR 0029 D5 — "Chat é janela flutuante; barra de ações do kit NÃO entra", justificada explicitamente pela ausência de opcode de ação manual.
- proposta: Manter D5 enquanto o motor manual (E10) não for escopo formal: "na risca" aqui não é ajuste de CSS/markup, é reverter uma decisão de arquitetura que exige opcode novo + motor de prioridade/cooldown compartilhado do PRD v2 §23/§28 no sim. Se o dono confirma que quer isso agora, abrir um ADR substituindo D5 e entregar em ordem: (1) opcode C2S de intenção de uso manual com validação server-side de recurso/cooldown/alvo/prioridade; (2) ActionBar.tsx reaproveitando Slot size=36 (já pronto, DS-04); (3) o motor RP-001..011 do PRD v2 no sim.
- CORREÇÃO do verificador: Classificação e recomendação (reversao-decisao, manter D5, exigir opcode novo + ADR) CONFIRMADAS: Hud.jsx:71-84 e App.jsx:16 batem exatamente; os 16 opcodes C2S (messages.ts:8-27) de fato não incluem cast/use-item/use-slot; e packages/client/CLAUDE.md cita literalmente "sem a faixa inferior de 124 px do handoff, porque a barra de ações que ela hospedava não entra neste marco (D5)" — e ADR 0029 D5/Alternativas confirma a mesma razão ("não há intenção C2S para disparar ação manual"). MAS uma peça da evidência está errada: 'só a prop `hotkey` declarada e nunca usada em ui/Slot.tsx:14' é falso — `hotkey` É usada dentro do próprio Slot.tsx:53 (`{hotkey !== undefined && <small className="ui-slot-hotkey">{hotkey}</small>}`) e tem cobertura de teste (Slot.test.ts:29,36). O correto é: nenhum CONSUMIDOR do Slot passa `hotkey` com valor hoje, porque não há ActionBar — a prop existe e funciona, só falta quem a alimente. Isso não muda o veredito (ActionBar continua ausente, D5 continua vigente), só corrige a formulação da evidência.

### [R5-02] "Configurar ação" (ActionConfigModal) — sistema-servidor (confirmado)
- kit: Hud.jsx:74 (`onClick={() => onSlot(i, a)}`) e App.jsx:42 (`{slot && <ActionConfigModal t={t} slot={slot} onClose={close} />}`) — mas `ActionConfigModal` não é definido em nenhum arquivo do kit (grep em Hud.jsx/Modals.jsx/App.jsx/Entry.jsx não encontra a função); README.md só descreve em prosa ("Tipo (magia, suprimento, equipar, macro)... uso automático com regras").
- cliente: Não existe no cliente — depende da barra de ações (R5-01), que não existe.
- proposta: Bloqueado por R5-01. Mesmo resolvendo isso, o kit não tem especificação executável desta tela (só prosa) — precisa passar por /spec antes de codar, definindo o schema de "macro" e "uso automático com regras" (que hoje não existe em botActionSchema/botConditionSchema).

### [R5-03] Select "CONJUNTO" (Energia/Fogo/Gelo/Sagrado) — sistema-servidor (confirmado)
- kit: Hud.jsx:76 — `<Select inline label={t.set} options={["Energia","Fogo","Gelo","Sagrado"]} value={set} onChange={setSet} />`.
- cliente: Nenhuma seleção de "conjunto" elemental existe no cliente; nenhum campo de elemento de dano existe em state/hud.ts nem em catalogue.
- dado: Falta por completo: monsterSchema/itemSchema (packages/content/src/schemas.ts) não têm campo de elemento/resistência; busca por "element" em packages/sim/src/combat não retorna nada. Dano é hoje um número genérico sem tipo — confirmado no mapa de capacidade.
- proposta: Não construir enquanto não existir um sistema de dano elemental (elementos causados + resistências) — épico próprio. Mesmo com a barra de ações resolvida, este seletor específico não teria o que selecionar.

### [R5-04] Botão "⌖ Lure · Follow" e modal "Lure e alvo" — feature-cliente (confirmado)
- kit: Hud.jsx:80-81 (botão com hint "mín 4 · máx 8"/"seguir alvo"); Modals.jsx:109-123 LureTargetingModal — lure com histerese min/max, política nearest/lowest-hp/highest-hp, priorizar/ignorar, postura stand/follow/keep-distance.
- cliente: Nenhum botão nem modal equivalente em packages/client/src/shell/. bot/store.ts:28-34,221-224 já carrega `lure`/`ringSwap` de forma OPACA (`advanced: Pick<BotConfig,'lure'|'ringSwap'>`) com comentário próprio: "que nenhuma tela edita ainda".
- dado: Pronto: botLureSchema (min/max, packages/content/src/schemas.ts:962-968), botTargetingSchema (policy/prioritize/ignore/posture, schemas.ts:887-897), catalogue.bot.advancedOnly.{conditions,targetPolicies,postures} e advancedFromLevel (packages/server/src/game/catalogue.ts:39-47) — os mesmos dados que o modal do kit consome, com o mesmo gate LV 50+.
- proposta: Construir o modal e trocar bot/store.ts de pass-through opaco (`advanced`) para campos editáveis (setLure, setTargetingPolicy, setPrioritize, setIgnore, setPosture) com o mesmo debounce de toggleRule. É exatamente a SV-09 do M15 — nenhuma mudança de protocolo necessária.

### [R5-05] Regra de saída "Acabar a capacidade" + ordem das regras — sistema-servidor (confirmado)
- kit: data.js:75 exitRules = [["out-of-gold",...],["out-of-capacity","Acabar a capacidade",false],["party-member-lost",...],["hp-below",...]] — 4 regras, renderizadas por HuntActions (Hud.jsx:147) nessa ordem.
- cliente: packages/client/src/bot/exit-rules.ts:12 — EXIT_RULE_KINDS = ['hp-below','out-of-gold','party-member-lost'] — só 3 regras, em ordem diferente (hp-below primeiro, não por último).
- dado: botExitRuleSchema (packages/content/src/schemas.ts:932-944) só conhece esses 3 kinds; falta "out-of-capacity" — mecânica inexistente, precisa de kind novo em content+sim (M15 SV-06). O comentário de exit-rules.ts:1-5 já documenta essa lacuna.
- proposta: Adicionar "out-of-capacity" ao botExitRuleSchema + sim quando SV-06 entrar. Até lá, ajustar só a ORDEM de EXIT_RULE_KINDS para bater com o kit (out-of-gold, party-member-lost, hp-below por último) — edição simples de um array, não depende de sistema novo.

### [R5-06] Campo numérico do percentual de HP no popover de saída — fidelidade (confirmado)
- kit: Hud.jsx:147 — o rótulo do checkbox já vem pronto como string ("HP abaixo de 30 %", data.js:75); não há input numérico nenhum dentro do popover do kit.
- cliente: ExitRulesPopover.tsx:44-55 acrescenta um `<input type="number">` inline para editar o percentual sem sair do popover.
- proposta: Divergência é uma melhoria funcional, não defeito: o kit não oferece NENHUM outro lugar para editar esse percentual (o BotPanel/"Configurações avançadas" que poderia fazer isso é código morto — ver R5-09). Manter o input e registrar a decisão em docs/design-system.md em vez de removê-lo.

### [R5-07] Nota "A mesma saída de cinco segundos, iniciada para você." — sistema-servidor (confirmado)
- kit: Hud.jsx:148 — `<p>A mesma saída de cinco segundos, iniciada para você.</p>` dentro do popover de saída.
- cliente: ExitRulesPopover.tsx (função ExitRulesList, linhas 32-68) não tem parágrafo equivalente.
- dado: packages/server/src/game/host.ts:862-864 — `case 'leave-hunt': void this.#requestTransition(viewer, { to: 'city' })`, transição imediata; busca por "5000"/"cinco segundos" em host.ts não retorna nada. Não existe atraso de cinco segundos em lugar nenhum do servidor hoje.
- proposta: Não copiar esta frase: ela afirma um mecanismo de "saída de cinco segundos" que o servidor não tem — copiá-la violaria D8/invariante 4 (nunca sugerir comportamento que o servidor não executa). Se o dono quer essa semântica, é decisão de produto nova para leave-hunt, não ajuste de texto.

### [R5-08] Painel "Automações" (5 itens nomeados) — sistema-servidor (confirmado)
- kit: data.js:22-28 automations:[{name:'Renovar anel'},{name:'Renovar colar'},{name:'Trocar arrow por alvos'},{name:'Trocar arma/escudo por vida'},{name:'Swap ring · Energy Ring',kind:'swapRing'}]; renderizado de fato por AutomationsPanel (Hud.jsx:39-47) e chamado em App.jsx:13 — é o painel realmente visível no lugar de "Bot" na composição renderizada do kit.
- cliente: grep -rln "Automa" packages/client/src packages/content/src não retorna nenhum arquivo — o conceito de "automação nomeada" (nome+resumo+liga/desliga+configurar+remover, por trás uma regra combinada) não existe em lugar nenhum do cliente/conteúdo. O que existe (BotPanel.tsx) é a máquina condição→ação simples por categoria.
- dado: Confirmado pelo mapa de capacidade: vocabulário do bot é condição→ação de uma linha; o que o kit desenha é um nível de abstração acima (precisa de vocabulário novo, E4). Sub-lacunas: "renovar quando as cargas acabarem" depende de item.charges/durationMs nunca consumidos pelo sim (packages/content/CLAUDE.md: "ninguém os consome ainda"); "trocar arrow por alvos" não tem automação de troca de munição por contagem de alvos (só seleção manual por família, AmmoPicker.tsx; ADR 0026 fixa munição como família, não item físico); "trocar arma/escudo por vida" não tem par entrar/retornar no vocabulário do bot, embora botActionSchema já tenha um kind:'item' (packages/content/src/schemas.ts:846-849) cuja validação cruzada com o catálogo de itens ainda não está pronta (M7/M8, comentário da própria linha 838-842).
- proposta: Não construir "Automações" como desenhado sem antes especificar (via /spec, épico E4) o vocabulário de automação nomeada — condição composta, par entrar/sair, cross-reference de item. O único item da lista com mecanismo pronto ponta-a-ponta é "Swap ring" (ver R5-10).

### [R5-09] "Bot" como categorias condição→ação (BotPanel.tsx/RuleEditor.tsx do cliente) — reversao-decisao (confirmado)
- kit: Hud.jsx:119-131 define BotPanel ("Configurações avançadas": Lure/Ring swap/Alvo e postura/Regras de saída) e Hud.jsx:109-118 define RuleRow, mas NENHUM dos dois é invocado em App.jsx. App.jsx:2 declara `const [rules,setRules] = useState(DR.bot.rules)` e `const [edit,setEdit] = useState(null)`, mas `setEdit` nunca é chamado com valor não-nulo em lugar nenhum do kit (confirmado por grep) — RuleEditorModal (Modals.jsx:80-95) e a lista de regras por categoria são código morto no protótipo clicável. O que App.jsx efetivamente renderiza no lugar de "Bot" é AutomationsPanel (R5-08).
- cliente: packages/client/src/shell/Shell.tsx:86 monta `<BotPanel .../>` de verdade, fixo na coluna esquerda; BotPanel.tsx (190 linhas) implementa exatamente a máquina condição→ação por categoria (heal/potion/attack/rune/support) que o kit definiu em Hud.jsx mas nunca ligou a nada clicável.
- decisão anterior: M12/#162 e ADR 0026 d.7 (Bot fixo na coluna esquerda, vBot do OTClientV8) — decisão já entregue e documentada extensamente nos comentários de BotPanel.tsx:1-20 ("É a interação central de um jogo idle-first").
- proposta: Esclarecer com o dono antes de mexer: fidelidade "na risca" aqui significaria desmontar uma feature já entregue, testada e com ADR (BotPanel/RuleEditor) para substituí-la por "Automações" — algo que o próprio kit nunca chegou a ligar de verdade e sem vocabulário nenhum no motor (R5-08). Isso não é correção visual, é reabrir a arquitetura do bot — pede ADR novo, não PR de CSS. Recomendação: não reverter; o BotPanel atual é a única metade desta região que corresponde a um mecanismo real e em produção.

### [R5-10] "Swap ring · Energy Ring" (SwapRingModal) — feature-cliente (confirmado)
- kit: data.js:27 (item `kind:'swapRing'` dentro de `automations`), roteado por App.jsx:13 (`onConfig={(a) => a.kind === "swapRing" ? setOpen("swapRing") : setCfg(a)}`) para SwapRingModal (Modals.jsx:96-108) — o único item de "Automações" com modal de verdade e alcançável no protótipo.
- cliente: Nenhum SwapRingModal/equivalente em packages/client/src/shell/; bot/store.ts:34,221-224 já carrega `ringSwap` opaco (mesma mecânica de R5-04).
- dado: Pronto: botRingSwapSchema (packages/content/src/schemas.ts:977-990) com os mesmos campos do modal do kit (itemId, equipBelow, removeAbove, manaFloor, restorePrevious) e a mesma validação removeAbove>equipBelow que o kit mostra como aviso. FALTA: nenhum item ring/amulet existe em packages/content/data/items hoje — o itemId do formulário não resolveria a nada em produção.
- proposta: Mecanicamente viável hoje (schema e passthrough prontos), mas apontaria para um anel inexistente — sequenciar depois de M15 SV-16 (Energy Ring/Life Ring no catálogo), ou construir a tela já com aviso de que nenhum anel está disponível ainda.

### [R5-11] Filtragem de condições avançadas no editor de regra — fidelidade (confirmado)
- kit: Modals.jsx:87 — Select "Condição" lista sempre as 4 opções de DR.bot.conditions, sem nenhum filtro por level (RuleEditorModal não gate condição nenhuma; só gate AÇÕES via `lockedOf`, deixando-as visíveis porém desabilitadas).
- cliente: RuleEditor.tsx:125-127 — `.filter((kind) => !vocabulary.advancedOnly.conditions.includes(kind) || level >= advancedFromLevel)` remove a opção da lista inteiramente para personagem abaixo do gate, em vez de mostrá-la desabilitada como o cliente já faz para ações (linha 152, `disabled={action.locked}`).
- proposta: Divergência de baixo impacto — só visível para personagem abaixo do level 50, estado que o kit nunca exercita (seu personagem de exemplo é level 200). Provavelmente intencional (evita configurar o que o servidor recusaria), mas o padrão fica inconsistente dentro do mesmo modal (ações bloqueadas ficam visíveis+desabilitadas, condições bloqueadas somem). Se quiser fidelidade estrita ao padrão do próprio cliente, uniformizar: mostrar a condição avançada desabilitada em vez de escondê-la.

## O que o auditor deixou passar (verificador)
- HuntActions (Hud.jsx:139-141) desenha DUAS pills que o cliente também não tem e que nenhum achado cobre: 'ⓘ Detalhes da caçada' (abre HuntDetailsModal, Modals.jsx:124-136) e 'Despachar loot »' (abre DispatchLootModal, Modals.jsx:137-146). packages/client/src/shell/HuntActions.tsx só implementa 'Escolher caçada' e 'Sair da caçada' + o popover de saída — grep por 'DispatchLoot|HuntDetails|Despachar' em packages/client/src não retorna nada, e não existe opcode nem mecanismo de 'mensageiro que vende loot durante a hunt' em packages/protocol/src/messages.ts nem em packages/server/src (grep por 'mensageiro|messenger|dispatch' vazio). É a mesma classe de lacuna do R5-01 (mecânica servidor inexistente), no mesmo componente que R5-05/06/07 já auditam, mas nenhum achado menciona as duas pills ausentes.
- O select 'ALVO' do ActionBar (Hud.jsx:77) não tem `onChange` nenhum — é um controle morto mesmo dentro do próprio kit, sempre fixo em value="follow". Além disso confunde política de alvo com postura: usa os values 'follow'/'nearest'/'lowest', enquanto o schema real (`botTargetPolicySchema`, content/schemas.ts:860) só conhece 'nearest'/'lowest-hp'/'highest-hp' (postura 'follow' é campo separado, `botPostureSchema:873-877`). O próprio LureTargetingModal do kit (Modals.jsx:117-120) já separa os dois corretamente. Qualquer implementação futura de ActionBar deve seguir o modelo do modal, não o select inline quebrado — nenhum achado (R5-01/R5-04) registra essa inconsistência interna do kit.
- README.md do kit (linha 59) já admite, na própria fonte, que 'barra de Ações' e 'Automações de supply' são 'proposta de design' e 'não existe no repo' — frase que reforça diretamente R5-01 e R5-08 (reversao-decisao / sistema-servidor) mas que nenhum dos dois achados cita como evidência, apesar de ser a admissão mais direta possível de que o próprio kit não trata esses dois blocos como comportamento real capturado do produto.

## Notas
Inconsistências internas do próprio kit, achadas na leitura linha a linha do escopo R5:

1. **BotPanel/RuleRow/RuleEditorModal são código morto no protótipo clicável.** Hud.jsx define `BotPanel` (119-131) e `RuleRow` (109-118), e Modals.jsx define `RuleEditorModal` (80-95), mas App.jsx nunca invoca `<BotPanel>` e nunca chama `setEdit` com valor não-nulo (confirmado por grep em todos os .jsx do kit) — não há NENHUM caminho de clique que alcance essas três peças. O "Bot" de fato renderizado é `AutomationsPanel` (Hud.jsx:39-47), um conceito completamente diferente (ver R5-08/R5-09).

2. **Quatro componentes referenciados e nunca definidos** (confirmado por grep): `ActionConfigModal` (App.jsx:42), `AutomationConfigModal` (App.jsx:43), `AddAutomationModal` (App.jsx:39) e `NumField` (usado em Modals.jsx:89,102,103,114,120). Clicar em qualquer slot da barra de ações, no "+" de Automações, ou na engrenagem de qualquer automação que não seja "Swap ring" quebra o protótipo com um componente indefinido. Isso já está documentado no digest do plano lido antes desta análise, mas vale repetir porque toca diretamente o escopo do bot/automações.

3. **O kit tem DOIS conjuntos de "regras de saída" divergentes, nunca reconciliados:** `DR.exitRules` (data.js:75 — 4 itens: out-of-gold/out-of-capacity/party-member-lost/hp-below, usado pelo popover ALCANÇÁVEL de HuntActions) vs. `DR.bot.exit` (data.js:47 — 3 itens: hp-below/out-of-gold/party-member-lost, com valores/ordem diferentes, referenciado só pela linha morta "Regras de saída" do BotPanel não-invocado). Um agente que implementasse a partir de `DR.bot.exit` em vez de `DR.exitRules` chegaria a uma tela diferente da que o dono realmente vê ao abrir `index.html`.

4. **Os tetos de slot por categoria do bot (Cura 3, Poções 4, Ataque 10, Runas e itens 10, Suporte 10, data.js:35) batem exatamente com `packages/content/data/bot/baseline.json:7`** — evidência de que esses números do kit vieram do repositório real (como o próprio README.md do kit declara), mesmo que a tela que os usaria (RuleRow/BotPanel do kit) esteja morta. Isso reforça que o `BotPanel.tsx` do cliente, embora sem equivalente na composição renderizada do kit, não é uma invenção do cliente — é fiel a uma fonte de dados que o próprio kit também leu e depois abandonou na composição final.

5. Region delimitada estritamente a "Barra de ações e Bot" (R5-acoes-bot): elementos do mundo (buffs, EXP badge, latência/fps) que o README descreve como "colados à barra de Ações" (Hud.jsx:85-106, função World) não entraram nos achados por ficarem fora das ancoragens explícitas desta tarefa — provavelmente pertencem a uma região de overlays do mundo à parte.

## Notas do verificador
Reabri e conferi linha a linha todos os arquivos citados nas evidências (Hud.jsx, App.jsx, Modals.jsx, data.js, README.md do kit; exit-rules.ts, ExitRulesPopover.tsx, HuntActions.tsx, RuleEditor.tsx, BotPanel.tsx, bot/store.ts, ui/Slot.tsx, shell.css, Shell.tsx no cliente; messages.ts, schemas.ts, catalogue.ts no servidor/conteúdo/protocolo). Todas as 11 classificações do auditor se sustentam contra o código real; nenhuma foi refutada. A única correção factual é pontual (R5-01): a alegação sobre `hotkey` em ui/Slot.tsx:14 está errada em seu enunciado (a prop é usada e testada dentro do próprio Slot), mas isso não muda o veredito geral do achado, que continua correto e bem fundamentado (ADR 0029 D5 e a lista de 16 opcodes batem exatamente). Todas as citações de arquivo:linha verificadas bateram com o código atual, incluindo números de linha exatos em Hud.jsx (71-84, 109-132, 133-153), Modals.jsx (80-95, 96-108, 109-123), data.js:75, e os schemas de conteúdo (819-1118). Três discrepâncias adicionais no mesmo escopo (R5) ficaram de fora dos 11 achados e foram registradas em `missed`.


---

# R6-direita-equip

## Conformes
- Vitais: HP e Mana no topo da coluna direita, HP antes de Mana (App.jsx:18 vs Vitals.tsx montado como primeiro filho de .windows-right, shell.css:167)
- Vitais: altura das barras 14px (App.jsx:18 height={14} vs shell.css:174 height:14px)
- Vitais: cores hp/mana idênticas nos tokens (--vital-hp #c8323a, --vital-mp #3d5ec8 em tokens/colors.css:59-62 e tokens.css:70-73)
- Equipamento: grade de 10 lugares na mesma posição do desenho de corpo (Pescoço/Cabeça/Mochila, Mão/Peito/Escudo, Dedo/Pernas/Munição, vazio/Pés/vazio) — data.js:32 vs shell.css:699-703
- Equipamento: tamanho do slot 30px (Hud.jsx:51 Slot size=30 vs shell.css:724)
- Equipamento: rótulos em português idênticos (Pescoço/Cabeça/Mochila/Mão/Peito/Escudo/Dedo/Pernas/Munição/Pés) — data.js:32 vs EquipmentPanel.tsx:26-29
- Equipamento: rótulo do slot vazio cortado em 4 letras maiúsculas (Hud.jsx:52 label.slice(0,4).toUpperCase() vs EquipmentPanel.tsx:116)
- Equipamento: moldura da grade (borda ash-5, radius 6px, gradiente ash-3→ash-2) — Hud.jsx:51 vs shell.css:704-705
- Cap: sufixo ' oz' e moldura do rótulo (surface-slot, borda ash-5, radius 3px) — Hud.jsx:54 vs shell.css:759-764

## Achados

### [R6-01] Vitals — texto dentro das barras de HP/Mana — fidelidade (confirmado)
- kit: App.jsx:18 monta <VitalBar value={3165} max={3165}/> e <VitalBar value={785} max={1000}/>; components/core/VitalBar.jsx:4 formata text = value.toLocaleString('pt-BR') + ' / ' + max.toLocaleString('pt-BR') — exibido '3.165 / 3.165' e '785 / 1.000'.
- cliente: packages/client/src/shell/Vitals.tsx:36 <span className="bar-label">{value}</span> — mostra só o valor atual, sem o máximo e sem locale pt-BR (ex.: '3165', não '3.165 / 3.165'); o par 'value/max' só existe no atributo title (linha 28), invisível sem hover.
- dado: health/maxHealth/mana/maxMana já chegam em player-stats (opcode 9) e em session-state.self — dado 100% disponível no cliente hoje.
- proposta: Trocar o conteúdo de .bar-label em Vitals.tsx:36 para `${integer.format(value)} / ${integer.format(max)}`, reaproveitando o Intl.NumberFormat('pt-BR') já criado em EquipmentPanel.tsx:31 (mover para um util compartilhado se usado nos dois arquivos).

### [R6-02] Cap — rótulo 'Cap' — fidelidade (confirmado)
- kit: Hud.jsx:54 <span>Cap</span><b>612 / 3.715 oz</b> dentro do mesmo bloco flex space-between.
- cliente: EquipmentPanel.tsx:137-141 — o <div className="capacity"> só tem dois <span>, nenhum com o texto 'Cap'; o comentário da linha 138 confirma a intenção ('Os dois números do servidor, sem conta nenhuma no meio'), mas omite o rótulo.
- proposta: Adicionar `<span>Cap</span>` antes do span de valores em EquipmentPanel.tsx:139; a CSS de .capacity (shell.css:759-764) já usa justify-content:space-between, então nenhuma mudança de layout é necessária.

### [R6-03] Cap — formatação numérica — fidelidade (corrigido)
- kit: Hud.jsx:54 exibe '612 / 3.715 oz' com separador de milhar pt-BR (consistente com o padrão do kit inteiro, ex. data.js:156 gp() usa toLocaleString('pt-BR')).
- cliente: EquipmentPanel.tsx:139 `${inventory.capacity.used.toFixed(0)} / ${inventory.capacity.total.toFixed(0)} oz` — .toFixed(0) não agrupa milhar; com capacity.total=3715 o texto sai '612 / 3715 oz', não '612 / 3.715 oz'.
- dado: inventory.capacity.{used,total} já vem pronto do servidor (host.ts:1205) — é só formatação, nenhum dado novo necessário.
- proposta: Trocar os dois `.toFixed(0)` por `integer.format(...)` (o mesmo Intl.NumberFormat('pt-BR') já definido em EquipmentPanel.tsx:31 e usado para o gold na linha 140).
- CORREÇÃO do verificador: A citação 'data.js:156 gp()' está ERRADA: `tmp-design-kit/handoff/ui_kits/draconya/data.js` tem só 80 linhas (conferido por leitura integral do arquivo) — não existe conteúdo na linha 156 dele. O helper `gp = (v) => v.toLocaleString('pt-BR') + ' gp'` citado existe, mas em `Hud.jsx:156` (dentro de `PartyPanel`), não em `data.js`. A correção exata é trocar 'data.js:156 gp()' por 'Hud.jsx:156 gp()' na kit_evidence. Isso não invalida o achado: a evidência PRINCIPAL do padrão pt-BR do kit já está correta e é auto-suficiente — o próprio Hud.jsx:54 (já citado no achado R6-02) mostra '3.715' com separador de milhar na mesma linha de Cap. `EquipmentPanel.tsx:139` de fato usa `.toFixed(0)` sem agrupamento (`inventory.capacity.used.toFixed(0)` / `inventory.capacity.total.toFixed(0)`), confirmando o texto '612 / 3715 oz' sem ponto de milhar. Classificação 'fidelidade' e proposta (trocar por `integer.format(...)`, já definido em EquipmentPanel.tsx:31) continuam corretas e executáveis.

### [R6-04] Cap — gold exibido junto da capacidade — fidelidade (confirmado)
- kit: Hud.jsx:48-58 (EquipmentSet inteiro): a linha de Cap mostra só 'Cap 612/3.715 oz', sem gold nenhum; o gold do kit aparece só na TopBar (Hud.jsx:14, Currency icon="gold") e na bolsa (App.jsx:20, BagPanel purse com tile 'GOLD 8.4k').
- cliente: EquipmentPanel.tsx:140 <span className="capacity-gold">...{integer.format(gold)}</span> — soma um terceiro lugar para o gold, dentro do próprio bloco de capacidade do set, que o kit nunca desenha ali.
- proposta: Remover o span de gold de dentro de .capacity (EquipmentPanel.tsx:140) para bater exatamente com o cap-only row do kit; se o produto quer gold visível perto do equipamento, replicar o padrão do kit (um tile 'GOLD' na Bolsa/BagPanel, fora do escopo desta região) em vez de anexá-lo à capacidade.

### [R6-05] Equipamento — estilo de borda do slot vazio (tracejada vs sólida) — fidelidade (confirmado)
- kit: Hud.jsx:52 `dashed={i !== 4 && i !== 3 && i !== 5}` combinado com components/core/Slot.jsx:4 (`border: '1px ' + (dashed?'dashed':'solid') + ...`): Pescoço/Cabeça/Mochila/Dedo/Pernas/Munição/Pés saem tracejados, e Mão/Peito/Escudo saem com borda sólida.
- cliente: shell.css:718-721 `.slot { border: 1px solid var(--ash-5); }` — borda sólida uniforme para todos os 10 lugares, sem nenhuma variante tracejada.
- proposta: Adicionar um modificador (ex.: classe `.slot-dashed` ou seletor por `:not(.slot-hand, .slot-chest, .slot-shield)`) que aplique `border-style: dashed` aos sete slots que o kit tracejou, mantendo Mão/Peito/Escudo sólidos.

### [R6-06] Equipamento — padding da grade — fidelidade (confirmado)
- kit: Hud.jsx:51 `padding: 6` no wrapper da grade de slots.
- cliente: shell.css:696-698 `.equipment { margin: 8px auto; padding: 8px; ... }` — 8px em vez de 6px.
- proposta: Trocar `padding: 8px` por `padding: 6px` em shell.css:697 para bater pixel a pixel com o kit.

### [R6-07] Equipamento — cabeçalho 'Set' e botão de minimizar — fidelidade (confirmado)
- kit: Hud.jsx:48-58 — EquipmentSet não tem nenhum título nem botão; ao contrário de SkillsPanel/BagPanel/BattlePanel (que usam SidePanel com title=...), o bloco de equipamento vai direto da grade para o Cap, sem cabeçalho. A TopBar do kit (Hud.jsx:2) nem tem um ícone de 'Inventário' na navegação.
- cliente: EquipmentPanel.tsx:55-64 renderiza `<header className="analyzer-head"><strong>Set</strong>...<button aria-label={collapsed?'expandir':'minimizar'}>▾/▸</button></header>` antes da lista de slots — estrutura e texto que não existem no kit.
- proposta: Remover o `<strong>Set</strong>` (e, se possível, todo o header) para igualar ao bloco sem título do kit; como esse cabeçalho hoje é o gancho pelo qual o botão 'Inventário' da barra minimiza a seção (packages/client/CLAUDE.md, 'collapsed esconde tudo menos o cabeçalho'), remover o texto sem preservar outro lugar para o toggle é uma decisão de produto — não aplicar silenciosamente sem confirmar onde o controle de minimizar passa a morar.

### [R6-08] Equipamento — slot Escudo vira seletor de munição (Ring/Ammo swap) — reversao-decisao (confirmado)
- kit: data.js:32 `equip: [[...],["Mão","Peito","Escudo"],["Dedo","Pernas","Munição"],...]` — Escudo e Munição são dois lugares SEMPRE separados e estáticos; nenhuma lógica em Hud.jsx ou nos primitivos de components/core faz um substituir o outro.
- cliente: EquipmentPanel.tsx:86-100 — com arma de distância na mão, o slot 'shield' vira um botão que abre o AmmoPicker.tsx no lugar do Escudo normal (comentário da linha 7-10 do próprio arquivo cita a origem da regra).
- decisão anterior: ADR 0026 decisão 3 (munição por família, sem pilha física, usando o slot do escudo como seletor) — citada nos comentários de EquipmentPanel.tsx:7 e AmmoPicker.tsx:1.
- proposta: Não é um ajuste de CSS: fidelidade estrita ao kit pede dois slots sempre visíveis (Escudo e Munição), o que reabre a ADR 0026 d.3 (munição viraria item físico empilhável para caber num slot próprio). Decisão do dono do produto antes de qualquer mudança: manter ADR 0026 d.3 como está (e aceitar que o kit não modela essa dinâmica) ou abrir uma nova ADR revertendo-a.

### [R6-09] Posturas de combate (Defensiva/Balanceada/Atacante) — reversao-decisao (confirmado)
- kit: components/core/Stance.jsx (arquivo inteiro) e Stance.d.ts definem o primitivo; Hud.jsx:56 monta `<Stance value={stance} onChange={setStance}/>` dentro de todo EquipmentSet, logo abaixo da linha de Cap, com escala 0.82.
- cliente: Nenhum arquivo `Stance.*` existe em packages/client/src/shell/ (confirmado por listagem de diretório) e busca por 'stance'/'postura de combate'/'defensiva'/'balanceada'/'atacante' em shell/, sim/src e content/src não retorna nenhuma correspondência de postura de combate (o único 'stance' existente é packages/content/src/schemas.ts:1128, um grupo de exclusividade de magia, mecanismo diferente e sem relação com dano/defesa).
- dado: falta: não há campo de postura de combate em nenhuma mensagem do protocolo, e não há mecânica de postura (dano/defesa) em packages/sim/src — só existe botPostureSchema (stand/follow/keep-distance), que é posicionamento do bot, não postura de combate.
- decisão anterior: ADR 0029 D2 — Stance ficou de fora dos primitivos .tsx porque não existe postura de combate no sim.
- proposta: Implementação client-only é impossível sem violar o invariante 4 (um toggle que não faz nada no servidor seria dado fabricado na tela). Para fidelidade estrita: reabrir D2 via nova ADR, definir a mecânica de postura em sim/ (multiplicadores de dano/defesa) e o campo correspondente em protocol/ antes de desenhar qualquer coisa no cliente.

### [R6-10] Vitals — tratamento visual do preenchimento e do trilho das barras — fidelidade (confirmado)
- kit: components/core/VitalBar.jsx:3 pinta o preenchimento com gradiente de dois tons por tipo (hp: linear-gradient(180deg,#d95a55,#a52a2f); mp: linear-gradient(180deg,#6f86d8,#3d5ec8)) mais um bisel interno (linha 9: inset 0 1px rgba(255,255,255,.18), inset 0 -1px rgba(0,0,0,.3)); o TRILHO (linha 8) é sempre o mesmo gradiente neutro linear-gradient(180deg,var(--ash-4),var(--ash-3)) para hp e mana, nunca usando --vital-hp-track/--vital-mp-track.
- cliente: shell.css:177-178 `.bar-hp{background:var(--vital-hp-track)}` / `.bar-mana{background:var(--vital-mp-track)}` (trilho colorido, não neutro) e linhas 183-184 `.bar-hp .bar-fill{background:var(--vital-hp)}` / `.bar-mana .bar-fill{background:var(--vital-mp)}` (cor sólida, sem gradiente nem bisel).
- proposta: Trocar .bar-fill por gradiente de dois tons por kind (os mesmos hex do kit) com o inset highlight/shadow, e trocar o background de .bar-hp/.bar-mana para o gradiente neutro ash-4→ash-3 (igual nos dois), reproduzindo exatamente o que VitalBar.jsx desenha na tela.

## O que o auditor deixou passar (verificador)
- Cabeçalho da área sobre o mundo (Hud.jsx:92, texto 'Covil dos Dragões · Ousado' + 'N criaturas no alcance') não tem NENHUM equivalente em packages/client/src/shell/ — grep por 'criaturas'/'ambience'/'zona protegida' em Shell.tsx, Viewport.tsx e shell.css não retorna nada; nenhum dos 10 achados do auditor cobre esse elemento apesar de ele estar explicitamente no escopo original ('confirme onde isso é desenhado'). É um gap misto: a contagem de criaturas já é derivável hoje (world.creatures, mesma fonte que alimenta BattlePanel.tsx) — seria 'fidelidade' pura; o nome da hunt e a dificuldade não trafegam em NENHUMA mensagem do protocolo hoje (confirmado no próprio MAPA DE CAPACIDADE, seção 'Área atual + dificuldade', AVISO 2) — seria 'protocolo'. Hoje o jogador simplesmente não vê nenhum equivalente na tela real, nem a parte que já daria para mostrar.
- Cor da borda dos slots do set: Slot.jsx:4 (`border = ... : kind === 'loot' ? 'var(--gold-2)' : 'var(--gold-1)'`) faz TODOS os 10 lugares do EquipmentSet (kind='equip', nunca 'empty' nesse bloco) saírem com borda DOURADA (var(--gold-1)) no kit, tracejada ou sólida conforme R6-05 — não cinza. shell.css:718-721 usa `var(--ash-5)` uniforme para todo `.slot`, sem nenhuma variante dourada. R6-05 capturou só o estilo (tracejado/sólido), não essa segunda dimensão (cor).
- Fundo dos slots do set: Slot.jsx:7 usa `background: empty ? 'linear-gradient(145deg,var(--ash-3),var(--ash-2))' : 'linear-gradient(145deg,#2d2420,#1c1614)'` — o kit diferencia um gradiente claro para vazio e um gradiente marrom-escuro para preenchido; shell.css define `.slot { background: var(--surface-slot); }` (cor lisa única, #0a0707), igual para slot vazio e ocupado. Nenhum achado cobre essa diferença de tratamento visual entre 'vazio' e 'ocupado'.
- `.capacity` (shell.css:763) usa `letter-spacing: 0.04em`, mas Hud.jsx:54 usa `letterSpacing: '.08em'` — exatamente o dobro. O próprio R6-02 já cita o bloco shell.css:759-764 para confirmar `justify-content: space-between`, mas não notou essa divergência de letter-spacing na mesma regra que acabou de ler. Além disso, shell.css:761 impõe `max-width: 168px` ao `.capacity`, restrição que não existe no Hud.jsx:54 (o bloco do kit ocupa a largura do grid-track '1fr' do wrapper, sem teto explícito) — vale conferir na renderização real se isso encolhe a barra de Cap em relação ao kit.

## Notas
Inconsistência interna do próprio kit (não é achado de fidelidade do cliente, é o kit se contradizendo): `tokens/colors.css:59-62` define `--vital-hp-track`/`--vital-mp-track` como tons escuros tingidos de vermelho/azul, mas o componente que de fato é renderizado na tela (`components/core/VitalBar.jsx:8`) nunca usa essas duas variáveis — ele pinta o trilho com o MESMO gradiente neutro cinza (`--ash-4`→`--ash-3`) para HP e Mana. Ou seja, os tokens de trilho colorido existem no arquivo de tokens mas são mortos no HUD que o dono aprovou. Isso é o mesmo padrão de divergência token-vs-tela que o `docs/design-system-plan.md` §1 já resolveu para outros elementos (topo 65px vs token 56px, títulos 34px vs 36px, etc.) sempre a favor do que está desenhado — a mesma regra deveria valer aqui: R6-10 propõe seguir a TELA (trilho neutro), não os tokens de trilho colorido, que ficam órfãos/mortos e talvez devessem ser removidos de `tokens/colors.css` num passe de limpeza do próprio kit (fora do escopo desta análise de cliente).

Esclarecimento de escopo (o anchor da tarefa pediu para confirmar onde o cabeçalho 'COVIL DOS DRAGÕES · OUSADO' + '4 CRIATURAS NO ALCANCE' é desenhado): ele NÃO fica dentro de `EquipmentSet` (Hud.jsx:48-58) nem em nenhum lugar da coluna direita — está em `World()` (Hud.jsx:92), como overlay HTML absolutamente posicionado no canto SUPERIOR DIREITO da área central do mapa (ao lado de 'Bênção ativa'), junto com os badges de buff (haste/utamo vita/magic shield, inferior-esquerdo) e o indicador de latência/fps (inferior-direito) — tudo overlay de tela sobre o World, não sobre a coluna de equipamento. Portanto esse elemento cai FORA do perímetro real de R6-direita-equip; pertenceria a uma região tipo 'overlay do mundo/HUD central' (client: `Viewport.tsx`/`Shell.tsx`, que hoje não desenham nada equivalente ali). Vale registrar também que, mesmo se estivesse em escopo, área+dificuldade não trafegam em nenhuma mensagem hoje (`instance-enter` só manda `map`, nunca `huntId`/`difficulty` — AVISO 1/2 do mapa de capacidade), então o achado correto para esse elemento seria 'protocolo'/'sistema-servidor', nunca fidelidade de cliente.

Todos os arquivos foram lidos diretamente nesta sessão (não só os digests): tmp-design-kit/handoff/ui_kits/draconya/{App.jsx,Hud.jsx,data.js}, tmp-design-kit/handoff/components/core/{Stance.jsx,Stance.d.ts,Slot.jsx,VitalBar.jsx}, packages/client/src/shell/{Vitals.tsx,EquipmentPanel.tsx,AmmoPicker.tsx,shell.css,tokens.css}, packages/client/CLAUDE.md, packages/content/src/schemas.ts (grep ITEM_SLOTS/stance). Nenhum arquivo foi modificado; nenhum comando de build/test/servidor foi executado.

## Notas do verificador
Metodologia: reabri e conferi, linha a linha, todos os arquivos citados nas evidências dos 10 achados (Hud.jsx, App.jsx, data.js, components/core/{Slot,VitalBar,Stance}.jsx, EquipmentPanel.tsx, Vitals.tsx, AmmoPicker.tsx, shell.css, tokens.css, schemas.ts, ADR 0026 e ADR 0029, packages/client/CLAUDE.md), sem modificar nada e sem rodar nenhum comando de build/test/servidor.\n\nResultado: os 10 achados sobrevivem à verificação adversarial. Todos os números de linha citados batem exatamente com o conteúdo real dos arquivos (inclusive citações de duas casas decimais de precisão, como shell.css:718-721 e VitalBar.jsx:3/8/9), e nenhuma classificação estava trocada — em particular, R6-08 e R6-09 corretamente evitam classificar como 'fidelidade' o que na verdade reabre uma decisão de arquitetura registrada (ADR 0026 d.3 e ADR 0029 D2), e nenhum dos achados tenta empurrar para o cliente um dado que o servidor não fornece (o que violaria invariante 4/D8) — pelo contrário, R6-09 é explícito em recusar a saída fácil (Stance client-only) por essa razão.\n\nÚnico problema real de evidência: R6-03 cita 'data.js:156' para o padrão `toLocaleString('pt-BR')`, mas `data.js` só tem 80 linhas — o `gp()` citado está em `Hud.jsx:156` (dentro de `PartyPanel`), não em `data.js`. Isso não muda o veredito do achado (a evidência primária, Hud.jsx:54, já citada corretamente no próprio achado, já basta), mas é uma citação factualmente errada que corrijo explicitamente.\n\nA varredura adicional encontrou 4 discrepâncias reais que os 10 achados não cobriram: a ausência total, no cliente, de qualquer equivalente ao cabeçalho de área do kit (nome da hunt/dificuldade/contagem de criaturas) — item que estava explicitamente no escopo desta região e que nenhum achado tocou; e três nuances de estilo dentro do próprio Slot/`.capacity` (cor de borda, fundo do slot vazio-vs-preenchido, letter-spacing/max-width do Cap) que ficaram de fora dos achados R6-05/R6-02 apesar de estarem nos mesmos arquivos e blocos já citados por eles.\n\nNenhuma correção proposta aqui pede para inventar dado no cliente nem reabre invariante 4/D8: as duas primeiras linhas de 'missed' são explicitamente qualificadas por tipo (fidelidade vs protocolo/mecânica inexistente), e as duas últimas são puramente de CSS.


---

# R7-direita-containers

## Conformes
- Título e sufixo de contagem do painel Batalha ("Batalha · N") — Hud.jsx:60 vs BattlePanel.tsx:77
- Limiares de cor da barra de HP na Batalha (60/30 %, ok/warn/danger) — Hud.jsx:63 vs BattlePanel.tsx:35-39
- Rótulos em português dos containers ("Mochila" para backpack, "Bolsa" para satchel) — data.js:3 (t.backpack/t.purse) vs ContainerWindow.tsx:21
- Slot de container vazio sem rótulo/glifo, célula em branco — Hud.jsx:69 (icon={<span/>}) vs ContainerWindow.tsx:82-90
- Tamanho do slot de container em 26px — Hud.jsx:69/App.jsx:20-21 vs shell.css:725

## Achados

### [R7-01] Moldura (Panel) de Bolsa, Mochila e Batalha — fidelidade (confirmado)
- kit: components/core/Panel.jsx:1-19 — cabeçalho fixo de 34px com fio dourado no topo (linear-gradient, L5), título uppercase mono 7,5px cor var(--text-gold), letter-spacing .14em (L6-7); Hud.jsx:59-70 usa esse Panel via SidePanel para BattlePanel e as duas BagPanel.
- cliente: packages/client/src/shell/BattlePanel.tsx:75 e ContainerWindow.tsx:59,73 renderizam <section className='battle-panel'>/'container-window'>, filhos de .windows; shell.css:125-142 estiliza esse <section>/<header> genérico com --window-bg/--window-line/--window-head (definidas em shell.css:46-49, tons azulados) e título branco 12px bold, sem uppercase (shell.css:142) — não o --grad-panel/hairline dourado do kit. O primitivo correto (shell/ui/Panel.tsx, com .ui-panel-hairline/.ui-panel-title batendo no kit — ui.css:358-404) existe mas não é importado por nenhum dos dois arquivos.
- proposta: Trocar o <section>/<header> manuais de BattlePanel.tsx e das duas instâncias de ContainerWindow.tsx pelo primitivo Panel de shell/ui/Panel.js (dock, com actions/onToggle), removendo a dependência de .battle-panel/.container-window/.analyzer-head e das variáveis --window-* (shell.css:46-49), que o próprio código já rotula como pele antiga a ser substituída.

### [R7-02] Ordem Bolsa → Mochila na coluna direita — fidelidade (confirmado)
- kit: App.jsx:20-21 — <BagPanel title={t.purse}.../> (Bolsa) é renderizado ANTES de <BagPanel title={t.backpack}.../> (Mochila).
- cliente: packages/client/src/shell/Shell.tsx:104-105 — <ContainerWindow container="backpack"> (Mochila) vem ANTES de <ContainerWindow container="satchel"> (Bolsa): ordem invertida em relação ao kit.
- proposta: Inverter as duas linhas em Shell.tsx:104-105 — satchel (Bolsa) primeiro, backpack (Mochila) depois.

### [R7-03] Número de colunas da grade de slots — fidelidade (corrigido)
- kit: App.jsx:20-21 — as duas chamadas de BagPanel passam cols={6} explicitamente (Bolsa 1×6 = 6 slots; Mochila 2×6 = 12 slots); Hud.jsx:68 monta gridTemplateColumns com esse valor.
- cliente: packages/client/src/shell/shell.css:660-663 — .container-grid { grid-template-columns: repeat(5, 26px); }, fixo em 5 colunas para os dois containers (comentário próprio na L658 justifica '5 por linha').
- proposta: Mudar .container-grid para repeat(6, 26px) em shell.css:662, batendo com o cols=6 da tela que o dono validou como referência.
- CORREÇÃO do verificador: Achado no mérito procede (kit cols=6 explícito em App.jsx:20-21; client fixo em `repeat(5, 26px)`), mas com dois ajustes: (1) citação de linha imprecisa — o `gridTemplateColumns` do kit está em Hud.jsx:69 (a função `BagPanel` inteira, com a linha de retorno/grid, ocupa a linha 69; a 68 é só `const cells = ...`), não 68. (2) mais importante: a proposta 'mudar para repeat(6, 26px)' ignora um acoplamento que a própria evidência citada already aponta — o comentário de shell.css:658 ('Cinco por linha: uma linha da tela é uma linha do container, #160 cresce de 5 em 5') não é estético à toa: docs/adr/0026-...md:84-89 (decisão 6) fixa a mochila com 20 lugares e a bolsa com 10, exatamente múltiplos de 5, e enquadra o crescimento como 'por linhas'. 20 e 10 não são múltiplos de 6 — trocar só o CSS não quebra o layout (o grid quebra linha sozinho com sobra), mas quebra a leitura 'abriu uma linha = ganhou uma linha inteira visível' que o comentário promete, e destoa da decisão 6 do ADR 0026 sem reabri-la formalmente. Correção recomendada: ou (a) tratar largura de exibição e granularidade de crescimento como independentes e atualizar/remover a frase de shell.css:658 ao mudar para 6 colunas, ou (b) levar ao dono como uma pequena reabertura da decisão 6 do ADR 0026 (ex.: realinhar os tamanhos iniciais para múltiplos de 6) antes de mudar só o CSS.

### [R7-04] Cabeçalho de Bolsa/Mochila (ícone e contador used/total) — fidelidade (confirmado)
- kit: Hud.jsx:69 — BagPanel renderiza só <SidePanel title={title}>, sem actions nem meta; App.jsx:20-21 não passa nada além de title/rows/cols/items.
- cliente: packages/client/src/shell/ContainerWindow.tsx:44-55 — header() adiciona um ícone do item equipado em 'back' (container-icon, L46) e um entry-meta com `${used}/${total}` (L48); nenhum dos dois existe no kit.
- proposta: Remover o ícone do container e o contador used/total do cabeçalho (ContainerWindow.tsx:44-55), deixando só o título como no kit — ou registrar formalmente que mantê-los é uma decisão de produto fora da fidelidade estrita.

### [R7-05] Ação 'Ordenar' no cabeçalho da Batalha — fidelidade (confirmado)
- kit: Hud.jsx:60 — actions={<IconButton title="Ordenar">↕</IconButton>} no SidePanel do BattlePanel (sem onClick, decorativo até no próprio kit).
- cliente: packages/client/src/shell/BattlePanel.tsx:76-86 — o <header className="analyzer-head"> só tem o botão de minimizar/expandir (▾/▸); nenhum ícone de ordenação.
- proposta: Adicionar um IconButton 'Ordenar' (↕) ao cabeçalho do BattlePanel, ainda sem comportamento ligado — igual ao stub do kit.

### [R7-06] Ícone/placeholder por linha da Batalha — fidelidade (confirmado)
- kit: Hud.jsx:61-62 — grid "16px minmax(0,1fr)"; a primeira coluna é um quadrado tracejado 16×16 (border 1px dashed var(--ash-6), background var(--surface-slot)) antes do nome.
- cliente: packages/client/src/shell/BattlePanel.tsx:90-98 e shell.css:639-644 — .battle-row é grid de 2 colunas (minmax(0,1fr) auto), sem nenhum elemento de ícone antes do nome.
- proposta: Adicionar a coluna de 16px com o quadrado tracejado ao grid de .battle-row; como Creature.appearanceId já existe (packages/client/src/state/world.ts:34), considerar usar o sprite real como melhoria — mas isso é decisão de produto além da fidelidade literal ao placeholder do kit.

### [R7-07] Seleção de alvo e moldura na lista de Batalha — protocolo (confirmado)
- kit: Hud.jsx:61,63 — cada linha é um <button onClick={() => setTarget(m.name)}>; quando target === m.name, borda var(--blood-5), fundo var(--surface-selected) e texto var(--blood-7).
- cliente: packages/client/src/shell/BattlePanel.tsx:6-7 (comentário do próprio arquivo) e L90-98 — <li className="battle-row"> sem onClick e sem estado de seleção; o comentário diz explicitamente 'targetId não trafega ainda (M15, SV-05)... nenhuma linha é clicável nesta issue'.
- dado: targetId atual do bot: packages/sim/src/targeting.ts:71 (selectTarget) calcula, mas nenhum campo de player-stats/session-state (packages/protocol/src/types.ts) carrega isso hoje (M15 SV-05/SV-12). Selecionar manualmente uma criatura por clique também não tem opcode C2S hoje — busca por 'target' em packages/protocol/src/messages.ts não retorna nenhum opcode.
- proposta: Curto prazo (M15 SV-05): transportar targetId atual do bot via player-stats/session-state e destacar a linha correspondente. Decidir separadamente, como item de produto adicional (fora do SV-05), se 'clicar para mirar manualmente' vira uma nova intenção C2S ou se o kit deve refletir que o alvo é só o que a política do bot escolhe.

### [R7-08] Painel 'Bolsa' como moeda em slots (GOLD/PLAT/GEM) — reversao-decisao (confirmado)
- kit: App.jsx:20 — <BagPanel title={t.purse} rows={1} cols={6} items={[{l:'GOLD',c:'8.4k'},{l:'PLAT',c:12},{l:'GEM',c:3}]}/>: ouro, platina e gema desenhados como itens de slot com contagem.
- cliente: packages/protocol/src/types.ts:339 — satchel é CarriedItem[] genérico (mesma forma de backpack); packages/sim/src/inventory.ts:41,151-152 confirma que satchel guarda itens comuns, não moeda; packages/server/src/game/host.ts (playerStatsOf, comentário sobre gold = character.gold + character.goldDelta) mostra que gold é SALDO numérico, nunca item de container; packages/content/data/items/ não tem nenhum arquivo de moeda (gold coin/platinum coin/gem).
- dado: falta: item de conteúdo para platina/gema não existe hoje; transformar gold num item de container conflitaria com o invariante 10 (movimentação de valor só pelo ledger com (session_id, seq)) e com o desenho atual de gold-como-saldo.
- decisão anterior: ADR 0026 (containers elásticos e genéricos, sem aninhamento, sem container especial de moeda) + invariante 10 (gold é ledger, nunca item solto)
- proposta: Não recriar 'Bolsa' como container de moedas. Fidelidade literal exigiria um ADR revertendo gold-como-saldo para gold-como-item (impacto grande em ledger/anti-duplicação). Alternativa recomendada: manter o saldo de gold onde já aparece (TopBar/EquipmentPanel, fora deste escopo) e usar 'Bolsa' (satchel) só para itens comuns, como já é hoje.

### [R7-09] Itens de 'Mochila' que são poções/runas/munição (UH, MP, SD, ARROW, BURST) — sistema-servidor (confirmado)
- kit: App.jsx:21 — items={[{l:'UH',c:158},{l:'MP',c:160},{l:'SD',c:50},...,{l:'ARROW',c:900},{l:'BURST',c:300}]}: desenhados como slots de item com contagem em estoque.
- cliente: packages/content/src/schemas.ts:356 (comentário: 'price 0 é o padrão da família, e cada tiro das outras debita price do gold') e L251 (ammoFamily) — munição é seleção por família com preço por tiro, não estoque; supplies (poções/runas) são debitadas em gold no uso (packages/sim/src/casting.ts), sem peso/slot/instância — não existem como CarriedItem.
- dado: falta: um modelo econômico onde poção/runa/munição sejam CarriedItem empilhável com quantity. Hoje UH/MP/SD (supply) e ARROW/BURST (ammo) não podem, por desenho, ocupar inventory.backpack/inventory.satchel.
- proposta: Não é campo faltando — é decisão de produto: manter supply/ammo como estão (custo por gold, sem estoque) e não desenhar 'Mochila' com esses itens; ou abrir uma decisão explícita para migrar supply/ammo a itens empilháveis reais, o que muda sim/content/protocol antes de qualquer trabalho de UI.

### [R7-10] E-RING/L-RING (anéis) na 'Mochila' — sistema-servidor (confirmado)
- kit: App.jsx:21 — {l:'E-RING',c:4} e {l:'L-RING',c:2} no exemplo de Mochila.
- cliente: packages/content/data/items/ não contém nenhum arquivo de anel/amuleto (confirmado por busca no diretório); o mecanismo de troca de anel (botRingSwapSchema, packages/content/src/schemas.ts) existe, mas sem item real de catálogo para apontar.
- dado: falta: itens de conteúdo 'energy-ring'/'life-ring' — nenhum dos dois existe hoje em packages/content/data/items.
- proposta: Criar os itens de anel em packages/content/data/items/ antes de qualquer tela poder mostrá-los numa mochila real; até lá, a Mochila não pode conter E-RING/L-RING de fato.

### [R7-11] Estilo do número de contagem no slot — fidelidade (confirmado)
- kit: components/core/Slot.jsx:10 — <b style={{position:'absolute',right:3,bottom:2,color:'var(--gold-5)',font:'500 6.5px var(--font-mono)'}}>{count}</b>: texto dourado sólido, sem contorno.
- cliente: packages/client/src/shell/shell.css:751-756 — .slot-count { right:2px; bottom:1px; color:#fff; text-shadow: 1px 0 0 #000, -1px 0 0 #000, 0 1px 0 #000, 0 -1px 0 #000; }: branco com contorno preto em 4 direções, posição deslocada em 1px.
- proposta: Trocar .slot-count para color: var(--gold-5), remover o text-shadow de contorno e ajustar a posição para right:3px; bottom:2px, batendo com Slot.jsx:10 do kit.

### [R7-12] Borda do slot por estado/tipo (ocioso, hover, kind=loot) — fidelidade (confirmado)
- kit: components/core/Slot.jsx:4 — borda varia por estado: selected → gold-4, hover → gold-3, empty → ash-5, kind==='loot' (item comum ocioso) → gold-2.
- cliente: packages/client/src/shell/shell.css:718-721 — .slot { border: 1px solid var(--ash-5); } fixo, sem variação por conteúdo; .slot-button:hover (L733) troca para outline: 1px solid var(--text-muted) (contorno cinza-claro, não borda dourada).
- proposta: Usar o primitivo shell/ui/Slot.tsx (já implementa data-kind='loot' → border-color: var(--gold-2) e :hover → var(--gold-3) em ui.css:452-453) em vez do <li className='slot'> manual em ContainerWindow.tsx.

### [R7-13] Botão de minimizar do painel — fidelidade (confirmado)
- kit: components/core/Panel.jsx:11 — <IconButton title="Minimizar">–</IconButton>, presente por padrão em todo SidePanel (nenhuma chamada do kit passa onMinimize={null} para BattlePanel/BagPanel).
- cliente: packages/client/src/shell/BattlePanel.tsx:78-85 — botão custom com glifos ▾/▸, classe entry-quiet, rótulos 'expandir'/'minimizar', implementado à mão em vez de reusar shell/ui/IconButton.tsx.
- proposta: Trocar o botão custom pelo IconButton com o glifo '–' do kit, ou adotar diretamente o Panel primitivo (que já inclui esse botão) conforme R7-01.

### [R7-14] Texto de estado vazio (Batalha e Containers) — fidelidade (confirmado)
- kit: Hud.jsx:59-66 — BattlePanel não tem texto para lista vazia (mobs.map sobre array vazio não renderiza nada); Hud.jsx:67-70 — BagPanel sempre desenha a grade fixa de slots, nunca um texto de 'vazio'.
- cliente: packages/client/src/shell/BattlePanel.tsx:87-88 — <p className="quiet">Nenhuma criatura à vista.</p> quando rows.length === 0; packages/client/src/shell/ContainerWindow.tsx:75-76 — 'Sem mochila nas costas'/'Bolsa vazia' quando places.length === 0; nenhum dos dois tem equivalente no kit.
- proposta: Essas mensagens cobrem estados reais que o protótipo estático nunca precisou tratar (fora de hunt, ou 0 slots antes de vestir mochila). Recomendo manter como exceção documentada em vez de remover às cegas — sem elas a tela pareceria quebrada nesses casos, que o kit simplesmente nunca desenhou.

### [R7-15] Exibição da contagem quando a pilha é 1 — fidelidade (confirmado)
- kit: components/core/Slot.jsx:10 — {count != null && <b>...{count}</b>}: mostra a contagem sempre que ela é passada, mesmo count=1 (ex.: PartyLootWindow em Hud.jsx:202, item F-SWD com quantidade 1 ainda exibe '1').
- cliente: packages/client/src/shell/ContainerWindow.tsx:116 — {item.quantity > 1 && <span className="slot-count">{item.quantity}</span>}: o número some quando quantity === 1.
- proposta: Remover a condição '> 1' e mostrar item.quantity sempre, igual ao Slot.jsx do kit — item único mostra '1' em vez de nada.

## O que o auditor deixou passar (verificador)
- Tipografia: BattlePanel.tsx:94 renderiza `${row.percent} %` (com espaço antes do %), enquanto o kit (Hud.jsx:63, `{m.hp}%`) não tem espaço — divergência pequena mas real que nenhum achado cobre.
- Sprite vs rótulo de texto nos slots de item: ContainerWindow.tsx:115 desenha `<ItemSprite appearanceId=... />` (sprite real em canvas, 24px, shell.css:727) para cada item de Bolsa/Mochila, enquanto o Slot.jsx do kit (sem prop `icon`, só `label`) mostra abreviação de texto ('UH', 'MP', 'E-RING' etc. — nenhum sprite). É exatamente a mesma classe de lacuna que o auditor já reconheceu para a Batalha em R7-06 ('quadrado tracejado' vs sprite real, tratando sprite real como melhoria além da fidelidade literal), mas não estendeu ao container — vale registrar a mesma ressalva aqui para não tratar os dois casos de forma inconsistente.
- Espaçamento vertical das linhas da Batalha: kit usa `margin: "1px 0"` por linha (Hud.jsx:61) — bem mais compacto — enquanto `.battle-list` no client usa `gap: 4px` (shell.css:638), quase 4x mais espaço entre linhas; é um sintoma menor do mesmo problema de fundo do R7-01 (painel ainda não usa a régua de espaçamento do design system), mas não foi citado explicitamente em nenhum achado.

## Notas
Inconsistência interna do próprio kit: a assinatura padrão de BagPanel (Hud.jsx:67, cols=5, rows=2) coincide, por acaso, com o grid de 5 colunas que o cliente já implementa hoje (shell.css:662) — mas a TELA renderizada e aprovada pelo dono (App.jsx:20-21) sobrescreve para cols=6 nas duas chamadas (Bolsa e Mochila). Como a instrução é seguir "esse HUD renderizado" como fonte de verdade, 6 é o número que a fidelidade estrita exige (R7-03), não 5, apesar da coincidência com o default não usado.

A maior parte dos achados de fidelidade (R7-01, R7-04 em parte, R7-05 via ausência do botão default do Panel, R7-11, R7-12, R7-13) tem uma causa raiz única e já documentada no próprio código: BattlePanel.tsx e ContainerWindow.tsx ainda usam a "pele" de painel anterior ao design system (`.windows > section`, variáveis `--window-bg/--window-line/--window-head` em shell.css:42-51, explicitamente comentadas como "seção velha... aceitável entre PRs, plano §6"), em vez do primitivo `shell/ui/Panel.tsx`/`shell/ui/Slot.tsx` (DS-04) que já replica os tokens do kit corretamente (ui.css:358-481). Ou seja: o mecanismo certo já existe no repositório, só não foi aplicado a estas duas telas — migrar para os primitivos resolveria de uma vez boa parte da lista.

Colisão de nome relevante para o dono do produto: a palavra "Bolsa" é usada tanto pelo container de moeda do kit (GOLD/PLAT/GEM, App.jsx:20) quanto pelo container genérico "satchel" do cliente (ContainerWindow.tsx:21) — são conceitos diferentes com o mesmo rótulo em português. Isso não se resolve só com CSS/markup (ver R7-08); é uma decisão de produto que a fidelidade estrita ao kit reabre de fato, junto com o modelo de supply/munição como "estoque" (R7-09) — ambos esbarram em decisões de arquitetura já tomadas (invariante 10 e ADR 0026) e não em lacunas triviais de transporte.

Nenhum arquivo foi modificado nem comando de build/test/servidor executado durante esta análise.

## Notas do verificador
Reabri e conferi linha a linha todos os 15 achados nos arquivos citados (kit: Hud.jsx, App.jsx, data.js, Panel.jsx, Slot.jsx; client: BattlePanel.tsx, ContainerWindow.tsx, Shell.tsx, shell.css, shell/ui/Panel.tsx, shell/ui/Slot.tsx, ui.css; protocolo/sim/content: types.ts, messages.ts, targeting.ts, inventory.ts, schemas.ts, casting.ts, host.ts, e o diretório packages/content/data/items|supplies|ammunition). Todas as 15 citações de arquivo:linha resistiram à conferência, com duas imprecisões menores de número de linha (Hud.jsx:68→69 em R7-03; Hud.jsx:202→199 em R7-15) que não mudam a substância dos achados. Nenhum achado foi refutado.

Dois achados (R7-08 e, por extensão, R7-09) já estão corretamente presos a decisões explícitas do ADR 0026 (gold como saldo; munição por família e supply debitado em gold) — a classificação 'reversao-decisao'/'sistema-servidor' e a recomendação de não reverter sem decisão de produto estão certas. R7-03 é o único que precisou de correção real: a proposta de trocar para `repeat(6, 26px)` ignora que o próprio comentário citado pelo auditor (shell.css:658) amarra '5 por linha' ao crescimento por linhas de ADR 0026 decisão 6 (mochila 20, bolsa 10 — ambos múltiplos de 5, não de 6); reclassifiquei como 'corrigido' com o caminho de correção. R7-02 é tecnicamente correto mas vale registrar que a ordem atual (mochila antes de bolsa) reproduz literalmente a prosa da decisão 7 do ADR 0026 — não muda o veredito, mas é bom contexto para quem for abrir a mudança.

R7-01 confirma que o painel/skin do design system (`shell/ui/Panel.tsx`) já existe e tem exatamente as props (`actions`, `onToggle`, `dock`) que a proposta presume — é executável tal como escrito — mas o próprio shell.css já documenta essa migração como dívida conhecida e agendada (DS-10 a DS-17), então não é uma descoberta nova, só uma confirmação de que a dívida ainda não foi paga para estas duas telas.

Na varredura livre, encontrei três discrepâncias que o auditor não cobriu: (1) espaço antes do '%' no HP da Batalha, (2) uso de sprite real em vez do rótulo de texto do kit nos slots de Bolsa/Mochila — o mesmo tipo de gap que o próprio auditor já sinalizou para a Batalha (R7-06) mas não estendeu aos containers —, e (3) o espaçamento entre linhas da Batalha bem mais largo que o kit. Nenhuma delas muda uma arquitetura ou reabre invariante; são do mesmo porte que R7-11/R7-12 (CSS fino).


---

# R8-modais

## Conformes
- HuntsModal: dimensões do modal (860×560)
- HuntsModal: texto do rodapé nos estados com/sem caçada ativa ("Trocar de caçada é sair e entrar de novo…" / "Level recomendado é conselho, não trava")
- HuntsModal: aviso âmbar de level abaixo do recomendado, sem travar entrada
- Modal (primitivo): scrim + fechar no × + fechar no clique fora + fechar no Esc
- Modal (primitivo): suporte a subtítulo `meta`
- Analyzer: conjunto e ordem das linhas da caixa "Sessão" (Tempo, XP, Gold, Gastos, Saldo, Mortos, Loot, Supplies, Maior golpe, Maior magia)
- Bestiário: fórmula do bônus global de XP (mesma conta do kit, já calculada no cliente)
- Padrão visual Box+Kicker+Line reaproveitado do kit em Analyzer.tsx

## Achados

### [R8-01] Personagem: modal com abas (kit) vs painel fixo (cliente) — reversao-decisao (confirmado)
- kit: Modals.jsx:6-25 — CharacterModal é um <Modal> com Tabs ["Personagem","Outfit"], aberto por `open==="character"` (App.jsx:24), retrato + nome + "Vocação · LV n · Ignis" como cabeçalho.
- cliente: packages/client/src/shell/CharacterPanel.tsx:1-16,36-65 — é um `Panel dock` sempre montado na coluna esquerda, sem `open.*` no TopBar (TopBar.tsx:14,21-28 não lista "character" entre as 6 janelas), sem abas, sem retrato, sem linha de identidade.
- decisão anterior: ADR 0029 D6 — geografia fixa: Personagem é seção fixa da coluna esquerda, nunca modal, confirmado pelo próprio comentário do arquivo ("não passa por open/TopBar, porque não há ícone Personagem na barra do topo").
- proposta: Decisão de produto explícita antes de qualquer código: manter Personagem como painel fixo (D6) e usar o kit só como referência de CONTEÚDO das seções internas, ou reabrir D6 e migrar para modal com abas como o kit desenha. Não implementar a segunda opção sem atualizar o ADR 0029.

### [R8-02] Cabeçalho do CharacterModal: retrato OUTFIT + HP/Mana/Exp como VitalBar com % e valor/máximo — fidelidade (corrigido)
- kit: Modals.jsx:13-15 — slot OUTFIT tracejado 72×74, h2 com nome, linha "{cls.name} · LV {level} · Ignis", e HP/Mana/Exp como `<VitalBar>` com barra + valor formatado pt-BR.
- cliente: packages/client/src/shell/CharacterPanel.tsx:50-64 — `StatRow` de texto puro ("HP", "Mana" como "1234 / 5678"), sem barra, sem retrato, sem linha de vocação/level/mundo (esses dados já aparecem no TopBar, não aqui).
- dado: health/maxHealth/mana/maxMana já chegam em `player-stats` (opcode 9) e em `session-state.self`; XP existe mas a % para o próximo level é decisão de produto de NÃO expor (packages/protocol/src/types.ts:359-364).
- proposta: Trocar os StatRow de HP/Mana por `ui/VitalBar.tsx` (já existe, DS-04), com os mesmos dados já disponíveis; manter Exp como contagem simples até a curva de XP ser exposta (decisão já tomada, não reabrir aqui).
- CORREÇÃO do verificador: O corpo do achado (trocar StatRow por VitalBar, dados já disponíveis) procede, mas a citação 'packages/protocol/src/types.ts:359-364' para justificar 'a % para o próximo level é decisão de produto de NÃO expor' está ERRADA: esse trecho é o comentário sobre o catálogo de HUNTS ('Level recomendado aparece; estimativa de XP/h e gold/h NÃO... para não virar métrica oficial comparável entre hunts') — não tem nada a ver com a curva de XP do PRÓPRIO personagem. A evidência correta para 'curva de XP não é exposta' é packages/server/src/game/catalogue.ts:111-112, no mapeamento de `vocations`: 'Só os ganhos e a arma inicial (id de item); nada de fórmula' — é ali que `progression.xp.base/exponent` fica de fora do catálogo. A conclusão prática (Exp continua como contagem simples) permanece válida, só a citação/justificativa precisa trocar de arquivo.

### [R8-03] Aba "Outfit" do CharacterModal: paleta de cores + "Salvar outfit" — sistema-servidor (confirmado)
- kit: Modals.jsx:24 — 6 swatches de cor clicáveis por CABEÇA/CORPO/PERNAS/PÉS/etc + botão "Salvar outfit".
- cliente: ausente por completo — nenhum arquivo em packages/client/src/shell tem aba, formulário ou botão de escolha de outfit/cor.
- dado: `OutfitColors` (packages/protocol/src/types.ts:26-29) só viaja do SERVIDOR para o cliente, em `creature-appear`/`session-state`, como apresentação; não existe nenhum opcode C2S para o jogador mudar suas próprias cores. `packages/server/CLAUDE.md` (seção "As cores do outfit viajam no ticket") confirma: "Ninguém escreve a coluna [outfit_colors] ainda".
- proposta: Precisa de um fluxo novo inteiro (mensagem C2S de escolha de cor, gravação em `characters.outfit_colors`, tela de escolha — hoje só citada como pendência em §7.4). Não é ajuste de protocolo pequeno.

### [R8-04] Box "Atributos e skills" (lista de skills com valor e barra de %) — protocolo (confirmado)
- kit: Modals.jsx:20 — grid por skill com nome, valor, barra de progresso e %, usando `DR.allSkills`.
- cliente: ausente — CharacterPanel.tsx não tem nenhuma seção de skills.
- dado: `Skills` com `level`/`points` e `pointsForLevel` existem em packages/sim/src/skills.ts:15-19,36-39, mas nenhum opcode carrega isso — nem `player-stats` nem `session-state.self` (SV-04, confirmado por grep vazio em protocol/src).
- proposta: M15 SV-04: adicionar `skills[]` (id, level, pontos, % até o próximo) a um novo campo de `player-stats`/`session-state.self`, depois portar a grade do kit 1:1.

### [R8-05] Box "Progressão e bônus" (Bestiário/Guild/Premium/Total) — sistema-servidor (confirmado)
- kit: Modals.jsx:21 — 4 linhas: "Bestiário · Entrada +30%", "Bestiário · Maestria +20%", "Bônus da guild +6,5%", "Bônus de premium +20%", mais "Bônus total de experiência +76,5%".
- cliente: ausente — CharacterPanel.tsx não mostra nenhum bônus de XP, embora o número do Bestiário já seja calculado em outro painel do mesmo cliente (shell/bestiary-progress.ts, usado por Bestiary.tsx:70-74).
- dado: Bônus do Bestiário: `catalogue.bestiary.xpBonusPercentPerMilestone` (protocol/src/types.ts:405-408) — já chega. Bônus de guild: não existe guild (ver R8-23). Bônus de premium: `premium` só é usado em packages/sim/src/progression.ts:149 para REDUZIR a penalidade de morte (`deathPenalty.premiumFraction`, packages/sim/src/progression.test.ts:16, 0,60→0,54) — não concede bônus de ganho de XP nenhum.
- proposta: A linha do Bestiário já pode ser somada aqui hoje (feature-cliente, dado já em mãos). "Bônus da guild" espera a guild existir (R8-23). "Bônus de premium +20%" deve ser removido ou corrigido: o benefício real do premium hoje é outro (penalidade de morte menor), publicar "+20% XP" seria inventar um número que o servidor não concede.

### [R8-06] Box "Detalhes de combate" (Armadura/Defesa/Dano/Crítico/Life leech) — protocolo (confirmado)
- kit: Modals.jsx:23 — 5 cards: Armadura 28, Defesa 14 ("com escudo"), Dano 252–306, Crítico 0%, Life leech 0%.
- cliente: ausente por completo em CharacterPanel.tsx.
- dado: Armadura/Dano: `attack`/`armor` existem em cada item (packages/content/src/schemas.ts:319,325-326 — `value` e `attack`/`armor`) e são usados no cálculo de dano (packages/sim/src/combat/damage.ts:24,66-67 — `defender.armor * armorEffectiveness`), mas `buildCatalogue` NUNCA os copia para `catalogue.items[]` (packages/server/src/game/catalogue.ts:79-99 só tem id/name/appearanceId/weight/slot/twoHanded/weapon). Crítico e Life leech: nenhum campo ou cálculo em packages/sim/src/combat/damage.ts (grep vazio). "Defesa" como estatística separada de Armadura (para escudo) também não é modelada — só existe um `armor` único.
- proposta: M15 SV-01 primeiro (expor `attack`/`armor` por item em `catalogue.items[]`), o que já destrava Armadura/Dano somados client-side a partir do `inventory.equipped`. Crítico, Life leech e uma "Defesa" separada de escudo exigem mecânica nova em `sim/combat` (épico de combate, E2) antes de qualquer UI.

### [R8-07] Linhas Velocidade / Magic level / Regeneração de vida / Regeneração de mana — protocolo (confirmado)
- kit: Modals.jsx:17 — Box com Velocidade 993, Capacidade 52oz, Magic level 99, Regen vida +8/s, Regen mana +60/s, Stamina 42h.
- cliente: packages/client/src/shell/CharacterPanel.tsx:57-62 — só Experiência/Level/HP/Mana/Capacidade/Stamina; sem Velocidade, sem Magic level, sem as duas linhas de regeneração.
- dado: Todos existem em `content`: `startingSpeed`/`speedPerLevel` (packages/content/src/schemas.ts:541-542) e `regen.healthPerSecond`/`manaPerSecond` (schemas.ts:551-554), usados pelo `sim` (packages/sim/src/character.ts:179,217,232-233). Mas `catalogue.vocations` (packages/server/src/game/catalogue.ts:113-122) só copia `healthPerLevel`/`manaPerLevel`/`capacityPerLevel`/`startingWeaponItemId` — nem o valor ESTÁTICO de velocidade/regen chega, e o valor AO VIVO (afetado por haste) nunca teve campo em `player-stats`.
- proposta: M15 SV-04: acrescentar `speedPerLevel`/`startingSpeed`/`regen` a `catalogue.vocations` (estático) e `speed`/`magicLevel` ao vivo em `player-stats` (dinâmico, afetado por haste/skills).

### [R8-08] Barra de abas Caçadas/Treino/Quests/Arena/Bosses no topo do HuntsModal — reversao-decisao (confirmado)
- kit: Modals.jsx:42 — `<Tabs items={["Caçadas","Treino","Quests","Arena","Bosses"]} value="Caçadas" />`, sem `onChange` — mesmo no próprio kit as outras 4 abas são decorativas, não clicáveis.
- cliente: packages/client/src/shell/HuntsModal.tsx:1-4,106-119 — nenhum `Tabs`; o comentário do próprio arquivo já documenta o corte: "Sem abas (Treino/Quests/Arena/Bosses não existem, D8)".
- decisão anterior: D8 (ADR 0029) — dado que o servidor não afirma não aparece; o próprio HuntsModal.tsx já cita essa decisão.
- proposta: Se a fidelidade estrita exigir a barra visível, ela pode voltar como PURAMENTE decorativa (igual ao kit: só "Caçadas" funcional, sem `onChange` nas outras) sem reabrir D8 de fato — mas Treino/Quests/Arena/Bosses continuam sem nenhuma mecânica no `sim`/`content` (sistema-servidor, épicos próprios).

### [R8-09] Campo de busca "⌕ Buscar uma caçada ou criatura" com filtro ao vivo — feature-cliente (confirmado)
- kit: Modals.jsx:38,45-46 — `Input` controlado filtrando `DR.hunts` por nome+monstros, com contador "{n} caçadas disponíveis".
- cliente: ausente — packages/client/src/shell/HuntsModal.tsx:93-131 lista `hunts` sem nenhum campo de busca.
- dado: `catalogue.hunts[]` já chega inteiro no cliente (packages/server/src/game/catalogue.ts:29-38); filtrar por nome é lógica pura de cliente.
- proposta: Adicionar `Input` + filtro client-side por `hunt.name`; filtrar por "criatura" depende de `monsters[]` existir no catálogo (ver R8-10).

### [R8-10] Grade de criaturas da hunt selecionada + MonsterTip (hover com vida/exp/dano/elementos/resistências) — protocolo (confirmado)
- kit: Modals.jsx:27-35,54 — ícones de monstro clicáveis (abrem Bestiário) com tooltip `MonsterTip` mostrando vida total, exp, dano médio, elementos causados e tabela de resistências por elemento.
- cliente: ausente por completo — packages/client/src/shell/HuntsModal.tsx não tem nenhuma lista de monstros na coluna de detalhe.
- dado: `catalogue.hunts[]` não tem `monsters[]` (só `outfitIds`/`lootDrops`, um contador — catalogue.ts:29-38); é a lacuna SV-02. Resistências elementais e "elementos causados": `monsterSchema` (packages/content/src/schemas.ts:391-427) não tem nenhum campo de elemento — não existe sistema de dano elemental em `sim/combat/damage.ts` (grep vazio por "element").
- proposta: SV-02 primeiro (adicionar `monsters: [{id,name}]` por hunt ao catálogo) já destrava a grade de ícones + nomes. O tooltip com resistências/elementos fica fora até um sistema de dano elemental existir (não modelado em nenhuma camada hoje).

### [R8-11] Coluna "Loot possível" com checkboxes PEGAR/VENDER por item — protocolo (confirmado)
- kit: Modals.jsx:57-58 — lista de loot da hunt com raridade, checkbox "pegar" e checkbox "vender" (exceto Gold Coin).
- cliente: ausente — packages/client/src/shell/HuntsModal.tsx não tem terceira coluna de loot; o terceiro espaço é ocupado por `PartyPanel` (ver R8-14).
- dado: O próprio servidor documenta a lacuna: packages/server/src/game/catalogue.ts:155-156 — "Só o NÚMERO: a lista de loot possível é da tela de detalhe, que não existe." `lootDropsOf` (catalogue.ts:158-172) só soma um contador.
- proposta: M15 SV-02/SV-13: expor `loot: [{itemId, name, rarity}]` por hunt. As checkboxes PEGAR/VENDER como preferência persistida do jogador são uma camada extra (nova mensagem de preferência), não vêm de graça com a lista.

### [R8-12] Rodapé do HuntsModal em caçada ativa: "Sair da hunt" (danger) + "Completar o time" + botão primário — fidelidade (corrigido)
- kit: Modals.jsx:41 — três controles no rodapé quando `hunting`: `<Button variant="danger">{t.leaveHunt}</Button>`, `<Button variant="secondary">Completar o time</Button>`, botão primário Entrar/Trocar.
- cliente: packages/client/src/shell/HuntsModal.tsx:106-119 — rodapé só tem o botão primário Entrar/Trocar. "Sair da caçada" existe, mas como pill flutuante FORA do modal (HuntActions.tsx, citado em packages/client/CLAUDE.md: "as pills de HuntActions ('Escolher caçada'/'Sair da caçada')"). "Completar o time" não existe em lugar nenhum do cliente.
- dado: Matchmaking de party já existe no servidor: `POST /api/matchmaking/join` (packages/server/CLAUDE.md, seção "A party é formada no api"), casando por vocações distintas e faixa de level — o mesmo texto que aparece em `PartyModal` (fora de escopo aqui).
- proposta: "Sair da caçada" já existe como intenção, só está noutro lugar da tela (pill vs rodapé do modal) — decisão de posicionamento a confirmar antes de mover. "Completar o time" é feature-cliente: já há endpoint de matchmaking pronto, falta só o botão aqui chamando `/api/matchmaking/join`.
- CORREÇÃO do verificador: A parte de 'Sair da caçada' (posicionamento pill vs rodapé) está certa. Mas a proposta para 'Completar o time' está errada: ela diz que 'já há endpoint de matchmaking pronto, falta só o botão aqui chamando /api/matchmaking/join'. Isso não funciona no caso que o próprio kit desenha — o botão aparece no rodapé do HuntsModal JUNTO com 'Sair da hunt', ou seja, para uso enquanto `hunting === true`. Mas `/api/matchmaking/join` recusa explicitamente quem não está na cidade: packages/server/src/api/party.ts:134 (`if (location !== null && location.type !== 'city') return reply.code(409).send({ error: 'not-in-city' })`), confirmado pelo teste packages/server/src/api/party.test.ts:157-166 ('the one in a hunt is refused'). Um jogador já em hunt que clicasse 'Completar o time' seria recusado com 'not-in-city' pelo endpoint hoje. Ou vira uma automação de convite/matchmaking DENTRO da hunt (mecânica servidor nova, sistema-servidor) ou, fora da hunt, é só um atalho redundante para o 'Procurar party' que já existe em PartyPanel.tsx:62 embutido no mesmo HuntsModal — não é uma feature-cliente pronta para ligar como descrito.

### [R8-13] Parágrafo de descrição da hunt (`hn.desc`) — sistema-servidor (confirmado)
- kit: Modals.jsx:55 — parágrafo de lore sob a grade de monstros ("As galerias sob a Fortaleza Rubra...").
- cliente: ausente — nenhum texto descritivo em packages/client/src/shell/HuntsModal.tsx.
- dado: `huntSchema` (packages/content/src/schemas.ts:448) não tem nenhum campo de texto livre/descrição — não é lacuna de transporte, é campo que nunca foi definido no conteúdo.
- proposta: Adicionar campo opcional `description` ao `huntSchema` de conteúdo + `catalogue.hunts[]`, e então escrever o texto para cada hunt existente (é trabalho de autoria de conteúdo, não só de protocolo).

### [R8-14] Terceira coluna do HuntsModal: PartyPanel (cliente) vs "Loot possível" (kit) — e Party como modal separado no kit — reversao-decisao (confirmado)
- kit: Modals.jsx:43-59 — HuntsModal do kit tem 3 colunas: lista | detalhe+monstros | loot possível. Formação de party é um modal TOTALMENTE separado (`PartyModal`, Modals.jsx:62-79, fora de escopo aqui).
- cliente: packages/client/src/shell/HuntsModal.tsx:146-148 — a terceira coluna é `<PartyPanel hunts={hunts} />`, embutida dentro do próprio HuntsModal.
- decisão anterior: ADR 0027 (formação de party mora no modal de caçada) + ADR 0029 D6 ("formação da party continua dentro do modal de caçada, não separada como o kit desenha").
- proposta: Já documentado como decisão explícita a MANTER, não a implementar diferente sem avaliação do dono do produto — sinalizar como pergunta aberta em vez de mexer: fidelidade estrita ao kit reabriria o ADR 0027 inteiro, que está fora do pedido desta análise.

### [R8-15] HuntDetailsModal inteiro ("Seu recorde", monstros, loot com pick/sell) — sistema-servidor (confirmado)
- kit: Modals.jsx:124-136 — modal com "Seu recorde" (Party/Solo, XP/h e gp/h), grade de monstros e lista de loot com checkboxes.
- cliente: ausente por completo — nenhum arquivo em packages/client/src/shell corresponde a este modal (App.jsx tem `open==="details"` funcional no kit, mas não há equivalente no cliente).
- dado: "Seu recorde": nenhuma mecânica de melhor XP/h ou gp/h por hunt/personagem foi encontrada em `sim`/`server` (busca por "record"/"best session" não indica tal mecanismo). Monstros/loot: mesma lacuna SV-02/SV-13 de R8-10/R8-11.
- proposta: "Seu recorde" precisa de um mecanismo de registro novo (melhor XP/h e gp/h por combinação personagem×hunt×modo, persistido) — não existe hoje em nenhuma camada. Monstros/loot reaproveitam SV-02/SV-13 quando chegarem.

### [R8-16] DispatchLootModal ("Despachar loot", mensageiro vende a cada 30/60 min) — sistema-servidor (confirmado)
- kit: Modals.jsx:137-146 — modal com lista de itens marcáveis, total em gold, texto sobre premium (30 min) vs sem premium (60 min).
- cliente: ausente — nenhuma referência a "dispatch"/"mensageiro" em packages/protocol/src, packages/server/src, packages/sim/src ou packages/content/src (busca por regex vazia).
- proposta: Mecânica de economia nova (E5): job periódico de venda remota, mais opcode C2S/S2C dedicado. Nada disso existe hoje para construir a tela em cima.

### [R8-17] SettingsModal inteiro (idioma, som, tela: nomes/hpBars/damageText/autoLoot) — reversao-decisao (confirmado)
- kit: Modals.jsx:147-157 — modal com seleção de idioma pt/en, toggles de som e de tela, rodapé "Salvas na conta · valem em qualquer dispositivo".
- cliente: ausente — packages/client/src/shell/TopBar.tsx:1-7 documenta explicitamente a omissão ("Nenhum ícone para sistema inexistente (Loja, Guild, Amigos, Prey, Configurações)"). Não há `lang`/`i18n` em nenhum outro arquivo do cliente além de um único hit não relacionado em Entry.tsx.
- dado: Nenhuma tabela/rota de preferências de conta existe (`grep -rli "preference\|settings"` em packages/server/src só bate em nomes não relacionados). O toggle "Abrir loot ao matar" cita "a Caixa de Loot" — ela É real (packages/server/src/loot-box.ts:1-20, TTL de 30 min), mas é sobra de INVENTÁRIO CHEIO ao ENCERRAR a sessão, não um popup por abate como o texto do kit sugere.
- decisão anterior: D7 ("sem i18n") e D8 (Configurações é um dos 5 sistemas escondidos).
- proposta: Separar em partes: (1) a seleção de idioma reabre D7 explicitamente — decisão de produto isolada, não implementar sem ADR; (2) os 4 toggles de Tela + Som são preferência pura de renderização, sem dependência de servidor — podem virar um SettingsModal local (localStorage) hoje mesmo, sem reabrir D8 de fato; (3) corrigir o texto do autoLoot para descrever a Caixa de Loot real (sobra ao encerrar sessão), não um popup por abate; (4) "Salvas na conta" exige endpoint novo de preferências (protocolo/API), que não existe.

### [R8-19] SocialModal ("Amigos": lista, pedidos, bloqueados, mensagem, convite) — sistema-servidor (confirmado)
- kit: Modals.jsx:158-166 — lista de amigos com status online/offline, local, botões de mensagem e convite para party.
- cliente: ausente — nenhuma referência a "friend" em packages/protocol/src, packages/server/src ou packages/sim/src.
- proposta: Sistema de amizade inteiro por construir (modelo de dados, add/aceitar/bloquear, presença online) antes de qualquer tela — épico próprio (E12/produto).

### [R8-20] PreyModal (cartas de bônus por criatura, timer, reroll, wildcards) — sistema-servidor (confirmado)
- kit: Modals.jsx:167-177 — 3 cartas com bônus temporário contra uma criatura, tempo restante, reroll grátis e "cartas selvagens".
- cliente: ausente por completo.
- dado: `packages/server/src/jobs/scheduler.ts:1-5` só cita "reset de Prey" como item de um ESQUELETO ainda não implementado; `Prey` em `packages/sim/src/monster/monster.ts:48` é um conceito de IA de alvo (predador escolhe presa), não relacionado ao sistema de cartas do kit.
- proposta: Épico próprio: modelo de conteúdo das cartas, cronômetro de bônus no `sim`, opcodes novos, e só então a tela. Nada disso existe hoje.

### [R8-21] Cyclopedia como MODAL com 3 abas (Itens/Bestiary/Bosstiary) vs Bestiário como painel fixo de lista única — reversao-decisao (confirmado)
- kit: Modals.jsx:182-203 — `CyclopediaModal`, 860×600, com Tabs ["Itens","Bestiary","Bosstiary"], busca, categorias, grade/lista, ordenação e paginação.
- cliente: packages/client/src/shell/Bestiary.tsx:92-141 — painel FIXO (`Panel dock`) na coluna, sem modal, sem abas, com uma lista simples de monstros (nome, abates, próximo marco).
- decisão anterior: ADR 0029 D6 — o ícone "Cyclopedia" do TopBar (TopBar.tsx:26) abre um painel fixo minimizável, no mesmo padrão de Analyzer/Bot, não um modal.
- proposta: Decidir estruturalmente antes: manter painel fixo (D6, mais barato para o que já existe) ou migrar para modal com abas como o kit — a resposta muda o esforço de SV-01/SV-02/SV-08 de forma significativa.

### [R8-22] Aba Bestiary do CyclopediaModal: busca, categorias, grade/lista, ordenação, "Destacar", estrelas, barra de progresso por monstro, box de progresso geral — feature-cliente (confirmado)
- kit: Modals.jsx:187-195 — SideList por categoria, grade com sprite+estrelas+progresso, toggle grade/lista, `Select` de ordenação, `Box` "Progresso no Bestiário" com % e barra.
- cliente: packages/client/src/shell/Bestiary.tsx:62-90 — `BestiaryBody` só renderiza uma linha de bônus + `<ul>` plana com nome/abates/próximo marco/contagem de marcos; sem busca, sem categorias, sem grade, sem ordenação, sem estrelas, sem barra por monstro, sem box de progresso geral com %.
- dado: Todo o dado necessário já chega: `bestiary` (contagens por monstro) e `catalogue.bestiary.milestones` (packages/client/CLAUDE.md, seção Bestiário: "Os contadores chegam INTEIROS"); `progressOf`/`bonusPercent` já calculam marco seguinte e bônus (shell/bestiary-progress.ts, citado no mesmo arquivo).
- proposta: Maior ganho barato do lote: nenhum dado novo é necessário. Construir busca/categorias/grade/ordenação/estrelas (= `progress.reached`, já calculado)/barra de progresso por monstro/box de progresso geral usando os dados que o cliente já tem.

### [R8-22b] Aba Itens do CyclopediaModal (Atq/Def, peso, descrição, "dropado por") — protocolo (confirmado)
- kit: Modals.jsx:196-199 — cada item com ícone, categoria, descrição, badge "dropado por", Atq/Def e peso.
- cliente: ausente — não há aba de itens em nenhum lugar do cliente.
- dado: Atq/Def: existem em `content` (schemas.ts:325-326) mas ausentes em `catalogue.items[]` (catalogue.ts:79-99) — SV-01. Descrição: `itemSchema` não tem campo de texto livre — mecânica/conteúdo inexistente. "Dropado por": exigiria varrer o `loot` de todos os monstros no servidor; nada monta isso hoje.
- proposta: SV-01 primeiro (Atq/Def/Valor por item). Descrição e "dropado por" ficam para depois — o primeiro é autoria de conteúdo nova, o segundo é uma agregação nova no catálogo.

### [R8-22c] Aba Bosstiary do CyclopediaModal (ciclo, cooldown de boss) — sistema-servidor (corrigido)
- kit: Modals.jsx:201 — grade de bosses com abates, ciclo (semanal/mensal) e badge de cooldown/disponibilidade.
- cliente: ausente por completo.
- dado: Nenhum conceito de "boss" existe em `content`/`sim` (busca vazia).
- proposta: Épico próprio (E11): modelar boss como entidade de conteúdo com cooldown antes de qualquer tela.
- CORREÇÃO do verificador: A frase 'Nenhum conceito de boss existe em content/sim (busca vazia)' é factualmente errada — a busca NÃO é vazia. `packages/sim/src/session.ts:103` já reserva `'boss'` como um dos seis `SessionType` planejados ('city' | 'hunt' | 'training' | 'quest' | 'boss' | 'guild-war'), com comentários em session.ts, bot.ts, death.ts e rulesets/city.ts confirmando que é trabalho futuro reconhecido; e `packages/content/src/schemas.ts:266` já lista `'boss'` como um `ItemOrigin` válido (proveniência de item). Nenhum dos dois é um MONSTRO boss com ciclo/cooldown — não existe ruleset de boss, nem entidade, nem dado de ciclo/cooldown, então a conclusão prática do achado (épico próprio, nada para montar a tela hoje) continua correta — só a frase 'busca vazia' precisa ser trocada por 'reservado como tipo de sessão e origem de item, sem ruleset nem entidade implementados'.

### [R8-23] GuildModal inteiro (roster, expedições, doação de gold, tier) — sistema-servidor (confirmado)
- kit: Modals.jsx:204-225 — guild com tag, MOTD, roster com posição/contribuição/status, expedições diárias, doação de gold, lista de guilds.
- cliente: ausente — as únicas ocorrências de "guild" no `sim`/`server` (packages/sim/src/movement.ts:51, packages/sim/src/combat/damage.ts:19) são comentários sobre uma futura "Guild War" instanciada, não um sistema de guild persistente com membros.
- proposta: Sistema inteiro por construir (entidade guild, roster, ledger de contribuição respeitando invariante 10) — épico E7, fora de qualquer milestone atual.

### [R8-24] ShopModal inteiro (Loja de Draconya Coins + Casa de leilões) — sistema-servidor (corrigido)
- kit: Modals.jsx:226-253 — loja com pacotes, categorias, e aba de leilão P2P com ofertas de compra/venda.
- cliente: ausente — busca por "coins"/"auction"/"shop" em protocol/server/sim/content só retorna arquivos de teste de auth/DB não relacionados.
- proposta: Monetização (E13) inteira por construir — moeda paralela, catálogo de loja, leilão P2P. Fora do escopo de qualquer milestone atual; sinalizar ao dono do produto o tamanho real desse pedido.
- CORREÇÃO do verificador: A frase 'busca por coins/auction/shop... só retorna arquivos de teste de auth/DB não relacionados' está errada para 'coins': `packages/server/src/db/schema.ts:36` (`coins: integer('coins').notNull().default(0)`) e `packages/server/src/db/repository.ts:10,374` NÃO são arquivos de teste — são o schema Drizzle real e o repositório que já leem esse campo, com comentário explícito de design em schema.ts:4 ('Coins vivem na CONTA; Premium vive no PERSONAGEM', ADR 0012 §35.3) reservando o campo de propósito para não exigir migração destrutiva depois. Na prática o campo está sempre em 0 em todo teste e não é escrito por nenhuma rota — não muda a conclusão de que loja/leilão/pacotes não existem —, mas a evidência deveria reconhecer que já existe uma fundação de dado (mesmo que inerte) para 'Draconya Coins', diferente de um vazio completo. 'auction' e 'shop' continuam de fato ausentes de toda a base.

### [R8-25] AnalyzerModal (referenciado, indefinido no kit) — caixas "Suprimentos usados"/"Loot recolhido" itemizados e abas "Dano recebido"/"Dano causado" — sistema-servidor (confirmado)
- kit: App.jsx:25 referencia `<AnalyzerModal>` que NÃO existe em nenhum arquivo do kit (lacuna do próprio kit). A referência de FORMA mais próxima é `AnalyzerWindow` em Hud.jsx:182-193 (fora do escopo estrito de Modals.jsx, mas é o HUD que o README trata como autoritativo): 4 caixas na aba "Sessão" (Sessão, Por hora, Suprimentos usados com qtd+valor por item, Loot recolhido com qtd+valor por item) e 2 abas extras de dano por fonte com % de participação.
- cliente: packages/client/src/shell/Analyzer.tsx:93-131 — só as caixas "Sessão" e "Por hora" existem (agregados únicos); não há "Suprimentos usados"/"Loot recolhido" por item, nem abas de dano por fonte.
- dado: `Aggregates.suppliesUsed`/`itemsLooted` são contadores agregados ÚNICOS (sem breakdown por item) — não há estrutura por item em `session.ts`/`casting.ts`. Dano por fonte: não há acumulador por criatura/magia em `combat-events.ts`/`session.ts` (só `bestBasicHit`/`bestSpellHit`, o MAIOR golpe, não o total por fonte).
- proposta: Breakdown por item de supply/loot e acumulador de dano por fonte exigem estrutura nova no `sim` (não é só expor campo) — tratar como épico à parte antes de portar essas caixas/abas. As caixas Sessão/Por hora que já existem estão essencialmente cobertas (ver conformant).

### [R8-26] "Próximo level" (ETA) no cabeçalho do analisador — reversao-decisao (corrigido)
- kit: Hud.jsx:189 — `["Próximo level", a.nextLevel]` no cabeçalho do AnalyzerWindow.
- cliente: ausente em Analyzer.tsx — nenhum campo de tempo-até-o-próximo-level.
- dado: Decisão de produto explícita de NÃO expor a curva de XP (packages/protocol/src/types.ts:359-364), "para não virar métrica oficial comparável entre hunts" — não é falta de dado, é dado propositalmente retido.
- proposta: Se a fidelidade estrita exigir essa linha, é preciso reabrir explicitamente a decisão de types.ts:359-364 (expor a curva de XP), não apenas "adicionar um campo".
- CORREÇÃO do verificador: Mesmo problema de citação do R8-02: 'packages/protocol/src/types.ts:359-364' não fala da curva de XP do personagem, fala da decisão de não mandar estimativa de XP/h e gold/h por HUNT (para não virar 'a hunt oficialmente melhor'). A razão real por trás de 'Próximo level' não aparecer é outra: `packages/server/src/game/catalogue.ts:111-112` mostra que o mapeamento de `vocations` no catálogo deliberadamente só leva ganhos por level e arma inicial, 'nada de fórmula' — é isso que impede o cliente de calcular ETA sem o servidor mandar o dado pronto. A conclusão (reabrir uma decisão explícita antes de adicionar o campo) continua válida, mas quem for agir sobre este achado leria a razão errada (comparação entre hunts) em vez da real (não vazar parâmetro de balanceamento/fórmula de XP).

## O que o auditor deixou passar (verificador)
- App.jsx referencia quatro modais do próprio kit que NUNCA são definidos em nenhum arquivo do handoff — ActionConfigModal (App.jsx:42), AutomationConfigModal (App.jsx:43), AddAutomationModal (App.jsx:39) e SkillsCustomizeModal (App.jsx:40); grep -rn 'function ActionConfigModal\|function AutomationConfigModal\|function AddAutomationModal\|function SkillsCustomizeModal' em tmp-design-kit/handoff/ não retorna nada. O escopo desta análise pediu explicitamente para listar essas lacunas do próprio kit (só 'AnalyzerModal' foi coberto, em R8-25) — as outras quatro ficaram de fora dos 26 achados.
- As 'Tamanho do pull' do kit (Modals.jsx:52, `hn.pulls.map(([id,n,c]) => <Button>{n} · {c}</Button>)`) mostram a contagem de monstros por dificuldade; packages/client/src/shell/HuntsModal.tsx:136-142 só mostra o rótulo da dificuldade, sem contagem — e isso não é só omissão do cliente: `catalogue.hunts[].difficulties` (packages/protocol/src/types.ts:377) é um array de STRING puro, sem `monsterCount`, embora `huntDifficultySchema.monsterCount` já exista em packages/content/src/schemas.ts:441. É um gap de protocolo (teria que virar `{id, monsterCount}` em vez de string) que nenhum dos 26 achados nem o mapa de capacidade menciona.
- packages/server/src/api/characters.ts expõe `premiumUntil` por HTTP (citado no próprio mapa de capacidade, seção 'Gems / loja / premium') — ou seja, ao contrário de Coins/Loja/Leilão, o status de Premium já tem um dado durável e transportável hoje. R8-17 e R8-24 tratam 'premium' só como ausente ou inventado (R8-05 já cobre o bônus de XP inexistente), mas nenhum achado nota que uma eventual exibição de 'Premium ativo até X' no Settings ou em qualquer lugar da casca já teria de onde puxar o dado, diferente de Loja/Leilão que não têm nenhuma fonte.

## Notas
Lacunas do próprio kit (não são achados contra o cliente): App.jsx referencia cinco modais que NENHUM arquivo do kit define — `AnalyzerModal` (App.jsx:25), `ActionConfigModal` (App.jsx:42), `AutomationConfigModal` (App.jsx:43), `AddAutomationModal` (App.jsx:39), `SkillsCustomizeModal` (App.jsx:40) — e `RuleEditorModal` (Modals.jsx:89) usa um componente `NumField` que também não é definido em nenhum arquivo do handoff. O protótipo quebraria ao abrir qualquer um desses cinco. Tratados aqui como gap do kit, não como "sistema-servidor" do cliente.

HuntsModal do próprio kit tem uma Tabs decorativa: `value="Caçadas"` sem `onChange` (Modals.jsx:42) — mesmo dentro do kit, clicar em "Treino"/"Quests"/"Arena"/"Bosses" não faz nada. Isso importa para R8-08: fidelidade "estrita" a essa barra é fidelidade a um elemento que o próprio kit não tornou funcional.

CyclopediaModal tem paginação decorativa: `Pager` (Modals.jsx:178) sempre mostra 9 páginas fixas, sem ligação real com `c.items`/`c.entries`; e o rodapé cita "1 – 8 de 867 itens" como texto fixo, não estado. Não é uma especificação de paginação real, é placeholder do protótipo.

O próprio kit tem DOIS conjuntos de dados divergentes para "a mesma coisa" (o analisador): `data.js:68` (`analyzer.rows`, usado por ninguém — o modal que o consumiria não existe) vs `data.js:72` (`analyzerLive`, de fato renderizado em Hud.jsx). O primeiro embute a taxa por hora na MESMA linha (segunda coluna); o segundo separa "Sessão" e "Por hora" em duas caixas — são dois formatos incompatíveis para o mesmo conceito dentro do próprio handoff.

Fora do escopo estrito de R8 (Modals.jsx) mas relevante para R8-25/R8-26: `AnalyzerWindow` em Hud.jsx é uma janela FLUTUANTE arrastável (`FloatingWindow`), o que colidiria com D6 ("nada arrastável") se fosse usada como referência estrutural — mas como o README trata a renderização do Hud.jsx como o HUD que "o dono quer ver", vale registrar que mesmo essa referência já contradiz D6 antes de qualquer decisão sobre o Analyzer.

Nenhum arquivo foi modificado nesta análise; nenhum comando de build/test/servidor foi executado. Arquivos lidos integralmente: tmp-design-kit/handoff/ui_kits/draconya/Modals.jsx (253 linhas), trechos relevantes de App.jsx, Hud.jsx e data.js; packages/client/src/shell/CharacterPanel.tsx, HuntsModal.tsx, Bestiary.tsx, Analyzer.tsx, ui/Modal.tsx, TopBar.tsx na íntegra; packages/server/src/game/catalogue.ts (trechos citados); packages/content/src/schemas.ts (trechos citados); packages/sim/src/combat/damage.ts, progression.ts, monster/monster.ts (trechos citados); packages/server/src/loot-box.ts, jobs/scheduler.ts (trechos citados); e os dois CLAUDE.md de packages/client e packages/server na íntegra, fornecidos pelo sistema.

## Notas do verificador
Reabri e conferi linha a linha todas as evidências citadas nos 26 achados (Modals.jsx, App.jsx, data.js, Hud.jsx do kit; CharacterPanel.tsx, HuntsModal.tsx, TopBar.tsx, Bestiary.tsx, Analyzer.tsx, PartyPanel.tsx, HuntActions.tsx, ExitRulesPopover.tsx do cliente; types.ts, messages.ts, catalogue.ts, host.ts, schemas.ts, skills.ts, progression.ts, character.ts, session.ts, combat/damage.ts, party.ts/party.test.ts, db/schema.ts, db/repository.ts, jobs/scheduler.ts, monster/monster.ts, movement.ts do servidor/sim/protocolo/conteúdo). A esmagadora maioria das citações de arquivo:linha bateu exatamente com o código atual — o auditor original fez um trabalho rigoroso. Encontrei 5 correções pontuais (nenhuma delas derruba a conclusão prática de um achado, mas duas — R8-02 e R8-26 — apontam para o arquivo/decisão ERRADA como justificativa, o que importa se alguém for reabrir a decisão certa depois; e R8-12 tem uma proposta que não é executável como escrita, porque o endpoint citado recusaria o próprio caso de uso do botão). Não encontrei nenhum achado totalmente refutado (nenhum 'refutado' nesta rodada) — a classificação sistema-servidor vs protocolo vs fidelidade vs reversao-decisao vs feature-cliente bateu em todos os 24 que restaram sem correção de citação. Os 3 achados de 'missed' são concretos e verificáveis: a lacuna do próprio kit não totalmente coberta (4 de 5 modais indefinidos ficaram fora), um gap de protocolo real e específico (contagem de monstros por dificuldade de pull) que nenhum dos 26 achados nem o mapa de capacidade tocou, e uma nuance sobre premiumUntil já existir como dado transportável (ao contrário de Coins/Loja/Leilão) que nenhum achado sobre Premium/Loja registrou.


---

# Crítico de completude


## O que nenhuma região cobriu


### Global transform:scale wrapper for the whole 1800×1010 game canvas
- onde: App.jsx:47-51 (Scaled component)
- nota: The entire GameScreen is fit to any viewport purely via CSS transform:scale (uncapped up or down, recalculated on resize) — no width breakpoint, no alternate 'modo página' layout exists anywhere in the kit. This is the literal opposite of ADR 0029 D3 ('sem transform:scale', fixed-px overlay, page-mode below 720px). No region names 'Scaled' or flags that strict fidelity to the rendered kit means adopting exactly the mechanism D3 rejected — this is the single biggest structural tension in the whole handoff and no auditor raised it.


### BotPanel is defined but never mounted in GameScreen
- onde: Hud.jsx:119-131 (BotPanel) vs App.jsx:11-15
- nota: GameScreen's left column only renders SkillsPanel, AutomationsPanel and PartyPanel. BotPanel — with the bot categories/slot caps ('Cura 3, Poções 4, Ataque 10...'), the 'Bot avançado a partir do level 50' text, and the lure/swapRing/targeting/exit summary rows that R2's and R5's 'conformes' lists cite as kit ground truth — never appears in 'o HUD renderizado.' Those conformance claims rest on reading dead source, not the interactive demo.


### RuleEditorModal (`edit` state) is unreachable via any click path
- onde: App.jsx:2,6,34,39-40 + Hud.jsx AutomationsPanel
- nota: Nothing ever calls setEdit with a non-null value: BotPanel (the only component with an edit-rule affordance) is never mounted, and AutomationsPanel's gear icon wires to setCfg/AutomationConfigModal or setOpen('swapRing'), never to setEdit. Beyond RuleRow being unrendered (already noted by R2), the whole RuleEditorModal — the most detailed modal in the kit — is provably dead code in the interactive demo.


### Orphaned real-money shop dataset, never referenced
- onde: data.js:76 (DR.shop)
- nota: DR.shop lists crystal/currency packs priced in real reais ('R$ 24,90', tag 'Popular') and is never read by ShopModal or anything else (ShopModal uses DR.store, priced in Draconya Coins). No region notices this unused, real-currency-pricing data sitting in the handoff.


### Two additional unused bestiary datasets
- onde: data.js:69,77 (DR.bestiaryRows, DR.bestiary)
- nota: Neither DR.bestiaryRows nor DR.bestiary (with weak/res/loot/charm fields) is read anywhere; the only bestiary data actually rendered comes from DR.cyclopedia (CyclopediaModal) and DR.monsterInfo (MonsterTip). Easy to mistake for a third source of truth if read in isolation.


### Kit-internal HP contradiction
- onde: Hud.jsx:18 vs Modals.jsx:15
- nota: The sidebar VitalBar shows HP 3165/3165 while CharacterModal's own 'Vida' row shows 3065/3065 for the same character. A same-kit numeric contradiction, distinct from any client-vs-kit gap already flagged.


### Kit-internal Capacity contradiction
- onde: Hud.jsx:54 vs Modals.jsx:17 vs data.js:18
- nota: EquipmentSet's Cap row shows '612 / 3.715 oz', CharacterModal's Line shows 'Capacidade 52 oz', and data.js's own allSkills 'cap' entry is '3.715' — three disagreeing figures for the same stat.


### Kit-internal Magic Level contradiction
- onde: Modals.jsx:17 vs data.js:19 (id 'ml')
- nota: CharacterModal hardcodes 'Magic level 99' while the Skills sidebar's own data gives Magic Level = 5 (64% to next) for the same character.


### Third, kit-internal Stamina value/format disagreeing with data.js
- onde: Modals.jsx:17 vs data.js:18 (id 'stamina')
- nota: CharacterModal hardcodes 'Stamina 42h 00m'; data.js's own allSkills gives '41:40'. R2's missed note already flags the client-vs-kit-sidebar format gap ('X h Y min' vs '41:40') — this is a separate, third figure inside the kit itself that agrees with neither.


### Styled header logo (bordered 'D' box, asymmetric corner radii) in EntryShell's top bar
- onde: Entry.jsx:24-27 (Wordmark, small variant)
- nota: Distinct from both the Brand emblem (✦ diamond on login/character-select) and the plain-text 'DRACONYA' in the EntryShell footer (which R1 does cover). No region distinguishes or covers this specific header wordmark treatment.


### Hardcoded literal 'Ignis' in CharacterModal subtitle
- onde: Modals.jsx:14
- nota: '{cls.name} · LV {char.level} · Ignis' bakes the world/realm name directly into the Character modal — a third occurrence of the D7-reopening world/realm concept, beyond the two the R1 verifier already flagged (CharacterCard, EntryShell footer).


### Raw account email interpolated into CharacterSelect heading copy
- onde: Entry.jsx:86
- nota: 'aldric@draconya.gg · N personagens disponíveis' — no region notes that the kit hardcodes/displays the account email directly in UI copy, relevant given D7 moves auth to WorkOS SSO.


### Silent 'Sem nome' fallback on empty character-name field
- onde: App.jsx:61 / Entry.jsx:124-125
- nota: ClassSelect's confirm handler does `name || "Sem nome"` — leaving the name input blank silently creates a character literally named 'Sem nome' instead of blocking submission or showing validation. No region documents this empty-input behavior.


### Empty/city-state text pair for the world overlay
- onde: Hud.jsx:92
- nota: When mobs.length === 0: 'Cidade · zona protegida' / 'a praça não credita nada' — the alternate to the active-hunt text already covered by R4-03; this specific empty-state pairing is not itemized anywhere.


### Exit-rules summary pill is fully suppressed, not just reformatted, when no rule is active
- onde: Hud.jsx:150
- nota: The 'Saindo sozinho: x · y' pill only renders at all when on.length > 0 && !exitOpen; with zero active rules nothing appears in its place. No region calls out this empty-state suppression, only the populated-state text format.


### Static Action Bar panel subtitle 'Salva automaticamente'
- onde: Hud.jsx:73 (meta={t.autosave})
- nota: Distinct from the dynamic 'salvo'/'salvando…' indicator tracked separately at GameScreen level (App.jsx:4); not itemized by any region.


### Action Bar panel explicitly opts out of minimize
- onde: Hud.jsx:73 (onMinimize={null})
- nota: Every other side panel (Skills/Automations/Party/Bag/Battle) implicitly keeps the Panel primitive's minimize affordance (per R6-07/R7-13's complaints that the client lacks it); Action Bar alone explicitly disables it. No region notes this deliberate exception.


### ActionBar slot hotkey labels imply real keyboard-shortcut execution
- onde: Hud.jsx:74 (hotkey={a.h}, values 1-9,0,'F1')
- nota: R5-01 treats the Action Bar as a purely visual bar; no region calls out that the hotkey labels imply pressing a number key (or F1) should fire the corresponding bot action — an actual keyboard-input requirement, not just a cosmetic label.


### Third PartyPanel footer line: 'Parar no meio da caçada exige o sim de todos.'
- onde: Hud.jsx:160
- nota: Sits below the two spend figures already covered by R3-09; this italic line is not quoted by any region.


### PartyModal's mode-dependent explanatory paragraphs ('Dividido: cada um paga o próprio supply...' / 'Compartilhado: supply rateado na hora...')
- onde: Modals.jsx:71
- nota: R3 covers the mode labels ('Dividido'/'Compartilhado') but not this pair of full explanatory paragraphs that swap based on selection.


### RuleEditorModal title-bar subtitle 'slot N/M'
- onde: Modals.jsx:85
- nota: meta={'slot '+...+'/'+cat.slots} shows the rule's position within its category's slot cap; not itemized despite the modal's grid/footer text being extensively covered elsewhere.


### Shared locked-state banner and dual live-validation danger messages in SwapRingModal/LureTargetingModal
- onde: Modals.jsx:99,112
- nota: Both modals share identical locked-banner copy ('...A configuração fica salva; o servidor recusa até lá.') and each toggles between two distinct footer danger strings depending on live form validity (e.g. 'Retirar precisa ser maior que equipar…' vs 'Sem anel na mochila...'). Neither modal's copy is quoted; both are covered only as whole-feature achados.


### Hover tooltip on PartyPanel's per-member 'Gasto' figure
- onde: Hud.jsx:166 (title="Gasto em supplies nesta sessão")
- nota: No region notes this specific tooltip text clarifying the spend figure's meaning.


### «‹1234…N›» pagination control used in CyclopediaModal's Itens-tab footer
- onde: Modals.jsx:178 (Pager component)
- nota: Not mentioned by any of the nine regions.


### Three inconsistent currency-formatting helpers sharing the same name
- onde: Modals.jsx:177 vs Hud.jsx:156 vs Modals.jsx:140 (all named `gp`)
- nota: Module-level gp (Modals.jsx:177) formats pt-BR with NO 'gp' suffix (used for guild points/Cyclopedia counts); PartyPanel's local gp (Hud.jsx:156) and DispatchLootModal's local gp (Modals.jsx:140) both append ' gp'. Same identifier, incompatible output — no region flags this.


### Drag-handle hit region and reused dsAppear entrance animation
- onde: Hud.jsx:174-181 (FloatingWindow)
- nota: The drag strip excludes the header's right 60px (reserved for close/expand buttons); every floating surface (FloatingWindow, MonsterTip, ExitRulesPopover, EntryCard, CharacterSelect/ClassSelect) reuses the same dsAppear open transition. R0 covers dsAppear only for the Modal primitive; no region checks the drag-region boundary or the animation's consistent reuse elsewhere.


### Additional decorative, non-functional controls beyond the one already-flagged broken Select
- onde: Modals.jsx:42 (HuntsModal top Tabs) and Modals.jsx:243-244 (ShopModal auction filters/Tabs)
- nota: R5's verifier flagged the ActionBar target Select as dead (value fixed, no onChange). The same pattern recurs elsewhere in the kit's own demo — HuntsModal's top Tabs bar (fixed value='Caçadas', no onChange) and ShopModal's four auction filter buttons plus 'Por nome/Por level' Tabs (no state wiring at all) — but no region generalizes this as a recurring kit defect.


## Padrões sistemáticos

Five systematic blind spots produced most of these gaps:

1. Conformance-by-source, not conformance-by-demo: R2 and R5 built substantial "conformes" lists by reading BotPanel and RuleEditorModal's source code, but neither component is ever reachable through any click in the interactive kit (BotPanel is never mounted; nothing ever calls setEdit). The brief states "esse HUD renderizado é EXATAMENTE o que o dono quer ver" — but a chunk of the cited "kit truth" describes UI the dono has never actually seen render. This is the same class of issue as the already-caught undefined modals (ActionConfigModal etc.), just one level more subtle: the code exists and is syntactically valid, it's simply never invoked.

2. Kit-internal contradictions were never checked. Every region compared "kit vs client." Nobody compared "kit vs itself." The sidebar (data.js-driven) and the CharacterModal (partly hardcoded) disagree on HP, Capacity, Magic Level and Stamina for the same character. Any team implementing "fidelity to the kit" needs the product owner to pick a winner among these — this is orthogonal to any client gap and wasn't caught because auditors treated data.js and the JSX literals as a single unified source rather than tracing each number to its actual origin.

3. Unused data/props require a cross-file usage check that per-region auditing skips. DR.shop and DR.bestiary/bestiaryRows in data.js are never imported by any component — finding that requires grepping all four JSX files against every data.js top-level key, not just reading one region's slice. This is exactly how the four undefined modal components slipped through until a dedicated verifier pass caught them; the same blind spot let two more dead data structures through.

4. Small ancillary strings consistently lost to primary-label focus: every region reliably caught headline labels, panel titles, and button text, but tooltips (title=), panel meta/subtitles, third/fourth footer lines, locked-state banners, and empty-state suppression (an element that renders nothing at all in some state) were skipped across the board. A second, narrow pass grep'ing for title=, meta=, and short conditionally-rendered <p>/<span> text would likely surface more of this same class.

5. "Looks interactive but isn't" is a recurring kit defect, not an isolated one. Beyond the ActionBar target Select already caught, HuntsModal's top Tabs bar and ShopModal's auction filters/Tabs are equally inert in the kit's own demo. Worth a blanket rule before treating any control's appearance as "the reference": confirm it actually has an onChange/onClick wired to state, not just the right visual state for its default value.
