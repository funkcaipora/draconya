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

Nenhum invariante muda de texto.

## Emenda — 2026-09-30 (#621): a condição `outfit` — referência por conteúdo, fusão por prazo, ataque não agressivo

A decisão 1 listou `outfit` entre os cinco tipos que entrariam no M44. A implementação (#621,
M44-03) fixou o **como**, e cinco escolhas merecem registro porque não são óbvias:

1. **A condição referencia CONTEÚDO, nunca arte (invariante 6).** O efeito `{ kind: 'outfit', look }`
   carrega `look` como `{ monsterId }` (o outfit de um monstro, o `lookType`), `{ itemId }` (o objeto
   de um item do catálogo, o `lookTypeEx` da Chameleon Rune) ou `{ objectKey }` (o objeto que um
   monstro veste, o `outfitItem` do Lua). O `sim` não conhece id de arte; o hospedeiro resolve na
   tabela de aparências (`monsters`/`items`/`looks`), e uma aparência sem linha na tabela é MUDA — a
   condição e o prazo valem igual. `looks` é uma seção nova (`chave → appearanceId`, conferida
   contra o inventário do pacote) porque só um dos seis itens do `outfitItem` do Canary está no
   catálogo de caça, e `appearances.items` é conferida dos dois lados.
2. **A fusão é a de `Condition::updateCondition`, medida pelo PRAZO.** Uma criatura tem no máximo um
   outfit emprestado (chave reservada `outfit`); o segundo só entra se acabar DEPOIS do ativo
   (`getEndTime() > now + novo.ticks` recusa) — `merge: 'strongest'` com a força igual a
   `expiresAtMs`, e o schema exige `strongest` explícito: é o mecanismo da classe, não parâmetro da
   fonte. A recusa não emite evento. (O #622 acrescentou depois `merge: 'longest'`, a MESMA regra de
   prazo de `Condition::updateCondition` para as condições de controle; o `outfit` segue com
   `strongest` medido pelo prazo — o resultado é idêntico, e migrá-lo para `longest` é limpeza de
   vocabulário que não muda regra de caça, deixada fora desta emenda.)
3. **O ataque `outfit` de monstro é uma condição NÃO agressiva, e por isso não é um golpe.**
   `COMBAT_PARAM_AGGRESSIVE 0` + `COMBAT_NONE` faz o caminho ser `CombatNullFunc` → só
   `CombatConditionFunc`: sem bloqueio, esquiva, crítico nem dano — o `sim` o executa antes do
   pipeline de dano e o único sorteio além do `chance` do vencimento é o do **Cleanse**, o primeiro
   bloco dessa mesma função (`combat.cpp:1039-1062`), que roda para QUALQUER condição de monstro
   num jogador: com o charm atribuído ao monstro e uma condição limpável ativa ele rola, limpa
   uma, dá os 11 s de imunidade e a aparência NÃO entra (`#cleanseBeforeCondition`, na mesma ordem
   de sorteio do golpe) —, e, com área,
   `Combat::CombatFunc` só exclui o lançador quando a ability é agressiva: a forma atinge TODOS os
   personagens e monstros nela, o LANÇADOR inclusive. Sem área, o ataque vai no alvo (o flag `target`
   do Lua só decide algo com área). A defesa é o próprio monstro.
4. **A imunidade `outfit` entrou no vocabulário (quinze nomes, com os três de controle do #622) e segue o portão de #559**: só vale
   quando o chamador é um combate e o alvo não é o próprio lançador (`caster == target` a pula) —
   então o monstro imune ainda se disfarça, e a Creature Illusion/Chameleon do jogador (`addCondition`
   direto no Lua) nunca é barrada.
5. **As duas fontes do jogador têm o parâmetro na INTENÇÃO, e o servidor confere (invariante 4).**
   Creature Illusion leva o monstro no `monsterId` da ação do slot (o mesmo campo da invocação,
   conferido contra `Monster.illusionable` — a flag própria, não `summonable`); a Chameleon Rune leva
   a instância de um item que o personagem carrega em `target: { instanceId }` (terceira forma de
   `manualTargetSchema`). Sem parâmetro válido, `not-illusionable` ANTES de mana, gold ou cooldown.

A apresentação segue o padrão do ADR 0031 (CMB-07): o `sim` emite `creature-look-changed` (quem
vestiu o quê), o hospedeiro o resolve em `creature-update` (S2C 49, broadcast como `creature-health`;
`object: true` separa o registro de objeto) e o mesmo `#lookFor` alimenta `creature-appear` e
`session-state` — o estado mora na condição, nunca num campo de apresentação (invariante 3).

**Fica de fora, por decisão:** a defesa `outfit` com área (o Feverish Citizen) — o schema de defesa
não tem área, e atingir só o próprio monstro seria a metade da mecânica; as cores do outfit imitado
(o `creature-update` de um outfit de monstro vai sem `colors`, até a #620 levá-las no protocolo); a
Chameleon sobre item do chão, cadáver ou cenário (a mira é um item que o personagem carrega). Nenhuma
é regra de caça — o outfit não entra em conta nenhuma. Nenhum invariante muda de texto.
