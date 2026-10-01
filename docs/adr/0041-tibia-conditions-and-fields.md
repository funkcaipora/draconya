# 0041 — Condições e campos do Tibia no sim

**Status:** proposto — decorre do [ADR 0037](0037-tfs-canary-fidelity-except-action-bar-and-automation.md)
decisão 6 e do invariante 11 (a automação é legítima); nenhuma das doze questões do plano trava
esta decisão diretamente (ver seção própria)
**Data:** 2026-09-25
**Contexto técnico:** `packages/content` (`conditions.ts` e o schema de condição/campo de
monstro), `packages/sim` (fila de eventos, movimento, bot), `packages/protocol` (nenhuma
mensagem nova esperada — reusa `creature-hit`/`creature-health-changed`, como o ADR 0031 emenda
CMB-07 já fez para o DOT genérico)
**Issues:** M31 — #556 a #561

## Contexto

O ADR 0031, emenda CMB-07, já generalizou condição para um vocabulário fechado — `haste`, `buff`,
`mana-shield`, `heal-over-time`, `damage-over-time` — e campo por tile com cadeia de estágios.
Isso resolveu o problema genérico; o que falta é o vocabulário **do Tibia** em cima dele.
`conditions.ts:28` hoje declara 5 tipos. O catálogo do Canary usa 737 ocorrências de condição de
velocidade (`speed`, com sinal — paralyze e slow reduzem, haste de monstro aumenta) e 77 de
`drunk`, nenhum dos dois modelado; o DOT do Tibia não é uma taxa constante, é uma **lista de dano
decrescente** gerada no instante da aplicação
(`ConditionDamage::generateDamageList`) para poison, burning, electrified, bleeding, cursed,
drowning, freezing e dazzled; e a imunidade por condição é dado de **monstro**
(`monster.immunities`), declarada em 1.655 dos 1.656 monstros do bestiário — hoje inexistente no
Draconya.

Drunk também levanta uma pergunta de arquitetura, não só de conteúdo: no Tibia,
`Creature::onWalk` (`src/creatures/creature.cpp:291`) desvia o passo do jogador embriagado de
forma aleatória. O invariante 4 diz que o cliente só manda intenção, e o invariante 11 diz que a
automação é legítima — "parece bot" nunca é sinal de punição. Se o desvio de drunk também se
aplicar ao passo que o **bot** dá, isso não é uma exceção aos dois invariantes: o bot manda
intenção (para onde ir), o `sim` resolve o resultado (incluindo o desvio), exatamente como já
acontece com qualquer outro passo.

## Decisão

1. **Condição ganha um tipo do Tibia como chave**, com no máximo uma ativa por tipo e reposição
   conforme o mecanismo do Canary: `speed` com sinal (paralyze/slow negativo, haste positivo,
   inclusive de monstro), DOT por lista de dano gerada no momento da aplicação — poison, burning,
   electrified, bleeding, cursed, drowning, freezing, dazzled —, `drunk`, `invisible`, e depois
   `outfit`, `light`, `rooted`, `feared`, `pacified` (esses cinco últimos entram no M44, fora do
   escopo direto deste ADR, mas usam o mesmo vocabulário).
2. **Imunidade por condição é dado de monstro** (`monster.immunities`), e imunidade especificamente
   a `invisible` significa "vê o invisível" — o `Monster::canSeeInvisibility`
   (`src/creatures/monsters/monster.cpp:303`) do Canary, e não um bloqueio genérico de condição.
3. **Drunk desvia o passo com o RNG da sessão, inclusive o passo do bot.** Isso não viola o
   invariante 4: o bot continua mandando só a intenção de mover; o `sim` é quem resolve, com o RNG
   determinístico e semeado da sessão (o mesmo RNG que já governa Dodge e crítico sob o ADR
   0031), se o passo de fato vai para onde o bot pediu ou é desviado. Isso também não viola o
   invariante 11: o jogador embriagado sofre o mesmo desvio esteja ele jogando manualmente ou
   automatizado — não há tratamento diferente por origem da intenção.
4. **Campos continuam cadeias de estágios** (`decayTo`, já modelado pelo ADR 0031 emenda CMB-07),
   ganhando flags de bloqueio de movimento e de projétil — o que fecha Magic Wall e Wild Growth
   como campos que impedem passagem, em vez de só causarem dano.

## Questões em aberto (decisão do dono)

Nenhuma das doze questões em aberto listadas no plano de paridade bloqueia esta decisão
especificamente — ela é uma consequência direta do ADR 0037 decisão 6 e do vocabulário que o ADR
0031 (emenda CMB-07) já preparou. O status **proposto**, em vez de aceito, existe porque esta é a
primeira vez que o vocabulário de condição ganha um formato de dado novo e persistido
(`ConditionState` por tipo do Tibia, em vez dos cinco tipos fixos atuais) — uma mudança de
schema que, como qualquer mudança de `packages/content`, merece a confirmação explícita do dono
antes de virar trabalho, mesmo sem uma pergunta de produto pendente por trás dela.

## Alternativas

- **Manter os cinco tipos fixos e adicionar `speed`/`drunk` como casos especiais fora do
  vocabulário de condição.** Descartada: duplicaria a máquina de fusão (`merge: refresh/replace/
  strongest`) e o agendamento de tique que o ADR 0031 já resolveu genericamente, só para dois
  tipos a mais — exatamente o retrabalho que a generalização da emenda CMB-07 existe para evitar.
- **Tratar drunk como puramente visual (a tela balança), sem afetar o passo de verdade.**
  Descartada: o ADR 0037 decisão 1 é explícita — mecanismo e número vêm do TFS/Canary, e
  divergência é defeito a menos que caia numa exceção; drunk sem desvio de passo é uma fidelidade
  cosmética, não mecânica.
- **Excluir o bot do desvio de drunk, para o jogador automatizado nunca "errar" o próprio
  caminho.** Descartada pelo invariante 11: tratar a automação como merecedora de uma vantagem
  que o jogo real não dá ao jogador manual é o tipo de assimetria que o invariante existe para
  proibir.

## Consequências

- M31 (#556–#561) implementa a decisão: condição de velocidade com sinal (M31-01), DOT por lista
  decrescente (M31-02), drunk (M31-03), imunidade e invisibilidade (M31-04), campos com cadeia de
  estágios e bloqueio (M31-05), e a apresentação de campo no cliente (M31-06).
  M31 depende de M29 (IA de monstro, para invocação e comportamento que interage com condição) e
  de M30 (combat-v3, para o DOT reusar o mesmo resolver de dano).
- `packages/content/src/conditions.ts` ganha o vocabulário novo; o `SNAPSHOT_FORMAT_VERSION` não
  sobe se o estado de condição continuar plano e opcional, na mesma disciplina que o ADR 0031
  (emenda CMB-07) já usou.
- `docs/product/bot.md` ganha uma nota explícita sobre drunk afetando o passo do bot, para que a
  divergência (hoje inexistente) não seja lida como bug quando a issue entrar.

## Invariantes afetados

Nenhum muda de texto. O invariante 4 é quem justifica a decisão 3 (bot manda intenção, `sim`
resolve o desvio). O invariante 11 é quem justifica não haver exceção de automação para drunk.

## Emenda — 2026-09-29 (#559): o vocabulário de imunidade e o timing do "não enxergo mais o alvo"

A decisão 2 disse **o quê** (imunidade por condição é dado de monstro; imunidade a `invisible` é
"vê o invisível"). A implementação da M31-04 (#559, com o conteúdo jogável da #592) fixou o
**como**, e duas escolhas merecem registro porque não são óbvias:

1. **O vocabulário de `monster.conditionImmunities` são os onze nomes do ADR**, não os do Lua:
   `paralyze`, `drunk`, `invisible` e as oito DOTs da decisão 1 (`bleeding`, `poison`, `burning`,
   `electrified`, `cursed`, `drowning`, `freezing`, `dazzled`). O importador traduz o nome do
   Canary (`bleed`/`physical`, `fire`, `earth`/`poison`…) pela tabela de
   `luaMonsterTypeConditionImmunities`, e o `sim` casa uma DOT com a imunidade pelo tipo de dano do
   tique (`Combat::DamageToConditionType`). O portão é o do Canary: só o combate consulta a
   imunidade — `Combat::CombatConditionFunc` é o único chamador que BLOQUEIA uma condição por
   ela (`Monster::canSeeInvisibility` a lê para outro fim) —, e por isso o portão é **opt-in do
   chamador de combate** no `sim` (`#applyConditionTo(..., fromCombat)`); a auto-aplicação
   (`caster == target`), o campo de tile e o que entra por `addCondition` direto (charm
   Cripple/Numb) não consultam. `outfit` (119 monstros) fica para o M44-03, que traz a condição.
2. **Largar o alvo que ficou invisível é um evento agendado, não uma checagem por passo.** O
   `Creature::onThink` do Canary confere `canSeeCreature(alvo)` uma vez por 1000 ms numa fase
   sorteada por criatura, então quem perseguia o invisível ainda o ataca por até um segundo — e o
   golpe do jogador nesse intervalo revela o monstro (`Monster::drainHealth`). O `sim` não tem
   relógio de think por criatura (seria um evento por criatura por segundo, contra o invariante 2),
   nem pode largar o alvo no primeiro passo depois da invisibilidade (largaria antes do Canary), e
   por isso agenda **um** `visibility-think` por criatura interessada, no instante em que a
   invisibilidade começa, em `[0, 1000)` ms sorteados com o `Rng` da sessão — a mesma distribuição
   da fase do Canary, determinística por semente e restaurável pelo snapshot da fila. A eleição de
   alvo do BOT continua sendo do Draconya (ADR 0037 d.2): ela nunca escolhe um invisível e cai na
   hora; só o alvo fixado pelo jogador segue até o think.

Nenhum invariante muda de texto.

## Emenda — 2026-09-29 (#622): as condições de controle, e o que `feared` de fato é

A decisão 1 listou `rooted`, `feared` e `pacified` como "entram no M44". O #622 as implementa, e
três escolhas merecem registro porque não são as que o plano do endgame supunha:

1. **`feared` não é "um passo de fuga sorteado como o drunk".** Lido no Canary
   (`condition.cpp:2163-2455`), é uma caminhada FORÇADA: a cada segundo de pensamento a condição
   escolhe uma direção a partir de onde o lançador estava (cinco regiões, sem sorteio — só o tile do
   próprio lançador sorteia), busca um caminho até um ponto sintético (A*, caixa de sete tiles) e
   entrega a lista a `Game::forcePlayerAutoWalk`, que substitui a caminhada do próprio jogador —
   só jogador. Como `hunting mechanics must be IDENTICAL` (ADR 0037 d.6), o `sim` reproduz o
   mecanismo e QUANDO ele dispara: o pensamento é um evento da fila na grade de pensamento do
   personagem (a fase sorteada UMA vez, persistida — o desenho do `VISIBILITY_THINK` do #559, só que
   com fase fixa), o fim da condição é o primeiro pensamento depois do prazo (a fuga do último
   pensamento sai antes de ela fechar), a imunidade de 10 s e o orçamento de party `(membros + 5) /
   5` são os do Canary. **A busca de caminho é original, não uma transcrição do algoritmo do
   Canary** (ADR 0019, limite 1): `fear.ts` entrega o que o `getPathMatchingCond` entrega — custo
   10/35 na caixa de sete tiles, destino o mais distante do ponto sintético — com um desempate
   declarado, e uma versão anterior que traduzia o A* linha a linha foi retirada na revisão do #622.
   O que NÃO se reproduz bit a bit — o desempate entre nós de mesmo custo (o `getBestNode` do Canary
   tem uma versão por conjunto de instruções) e o primeiro passo forçado cair no próximo
   `PLAYER_STEP` em vez do `getEventStepTicks` — não muda o gatilho, e está em
   `docs/product/combat.md`. As esquisitices da fonte (o ponto sintético do `SOUTH`, o valor do enum
   gravado como índice) ficam preservadas.
2. **`merge` ganha o valor `longest`.** `Condition::updateCondition` do Canary — que `rooted`,
   `pacified` (`ConditionGeneric`) e `feared` usam — mantém a condição que já corre quando o prazo
   novo terminaria antes dela. Nenhum dos três valores de fusão existentes diz isso: `refresh`
   deixa o novo vencer sempre (uma troca de andar de 2 s encurtaria um Swift Foot de 10 s),
   `strongest` compara magnitude, e estas condições não têm. O schema EXIGE `longest` nas três — não
   é escolha do conteúdo. O `drunk` e o `invisible`, que têm a mesma regra no Canary, continuam com o
   `merge` que o conteúdo declara (dívida registrada, fora do escopo).
3. **A trava de escada do M30-07 É a condição `pacified`.** O instante solto
   (`attackLockedUntil`) deixou de existir; um snapshot antigo é lido como um `pacified` que vence
   no mesmo instante (ADR 0014). O Swift Foot passa a acelerar e pacificar pelos mesmos 10 s, como
   `swift_foot.lua` (ramo sem a Roda) — o conteúdo deixa de carregar a redução de 30 % de dano do
   TibiaWiki. O golpe básico NÃO volta no instante exato do vencimento: `Player::doAttacking` volta
   sob a condição e o Canary não re-arma o ataque ao fim dela, então o golpe sai no primeiro gatilho
   depois — o pensamento seguinte do personagem (até 1000 ms) ou um passo dele ou do alvo. A magia e
   a runa AGRESSIVAS (dano, DOT, a invocação — `summon_creature.lua` não chama `isAggressive(false)`
   —, as runas de dano/campo e a Paralyze Rune) recusam sob a condição (`spells.cpp:517`).

**Vocabulário de imunidade.** `monster.conditionImmunities` sobe de onze para catorze nomes
(`rooted`, `feared`, `pacified`). É vocabulário autoral: a ponte do Lua
(`luaMonsterTypeConditionImmunities`) não os nomeia, e nenhum monstro do bestiário os declara.

## Emenda — 2026-09-30 (#826, ADR 0060 d.8): o campo tem dono

O campo de tile desta decisão atingia todo participante sobre ele, e a parede (Magic Wall, Wild
Growth) bloqueava toda criatura. Isso ficou diferente do Canary no que o no-pvp muda: o campo
lançado por jogador, num mundo no-pvp, vira a variante que não fere jogador, e a parede vira a
variante segura (`canary/src/creatures/combat/combat.cpp:1207-1218`, `2594-2640`;
`condition.cpp:2015-2020`; `tile.cpp:864-876`). Como o Draconya é no-pvp em toda sessão, a
correção vale já, inclusive para a hunt de party — onde o fire field de um membro queimava a
própria party.

`TileFieldState.owner` (`{ kind: 'character' | 'monster', id }`) registra quem lançou; sem ele o
campo é de mapa e segue pegando todo mundo, e o snapshot de antes restaura assim. O campo de
personagem — ou de invocação de personagem, que o Canary trata como o jogador — não fere
personagem nem invocação de personagem (o lançador incluso); a parede de personagem segue
barrando monstro, mas cede ao passo de qualquer personagem, que a remove. Fica de fora o crédito
do dano do campo ao dono (a condição do campo segue com o id do campo como origem), que é o
crédito do Canary do ADR 0060 (OW-28).

Nenhum invariante muda de texto.
