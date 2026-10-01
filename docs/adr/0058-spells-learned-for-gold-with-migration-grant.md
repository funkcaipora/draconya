# 0058 — Magia é aprendida por gold numa tela de serviço da Cidade; quem já existe recebe o que já podia lançar

**Status:** proposto — resolve a questão 8 de `docs/tibia-parity-plan.md` §5 (bloqueio de #624
**Emendado pelo [ADR 0060](0060-tibia-open-world-without-pvp.md) (2026-09-30) — d.2:** a tela de aprender magia fica em tile PZ do mundo.
desde 2026-09-25); persiste e cobra pelo [ADR 0052](0052-endgame-progression-state-and-city-services-through-the-owning-session.md);
tela de serviço no padrão do [ADR 0042](0042-tibia-death-promotion-blessings-and-item-loss.md)
**Data:** 2026-09-27
**Contexto técnico:** `packages/content` (magia: `learnPrice`, importado dos NPCs do Canary com
TibiaWiki como fallback — ADR 0037 d.4), `packages/sim` (`casting.ts`: cast exige aprendida; bot
pula slot com magia não aprendida), `packages/server` (registro `learnedSpells`; migração de
concessão), `packages/protocol` (`learn-spell`), `docs/product/progression.md`, `onboarding.md`
**Issues:** M44-06 (#624)

## Contexto

No Tibia toda magia instantânea e toda conjuração é **comprada** de um NPC por gold, com level
mínimo; `Player::learnSpell`/`hasLearnedSpell` são checados antes do cast. No Draconya a magia é
liberada por level (`docs/product/progression.md`), sem compra. O plano de paridade deixou uma
pergunta para o dono: personagens existentes ganham de graça o que já usam, ou todos pagam? A
varredura do Huntera (2026-09-25) não achou evidência em nenhuma direção — o termo "NPC" não
aparece — e a issue ficou bloqueada.

A decisão tem duas metades: o mecanismo (Canary, sem dúvida sob o ADR 0037) e a migração (ADR
0014: dado persistido migra, nunca é descartado — e "poder lançar" é capacidade persistida por
level).

## Decisão

1. **Cast exige magia aprendida.** `learnedSpells` é registro do personagem (ADR 0052 d.1);
   `casting.ts` recusa magia ausente com motivo (`spell-not-learned`), e o bot **pula** o slot
   como já pula magia sem mana — nunca encerra a hunt por isso. Runa (o item/suprimento) continua
   exigindo só level e magic level, como no Tibia; a **conjuração** da runa é magia e exige
   aprendizado.

2. **Aprender é intenção de Cidade sem rolagem** (`learn-spell { spellId }`), aceita também na
   hunt por não tocar RNG (ADR 0052 d.4) — mas a tela vive na Cidade, como tela de serviço (ADR
   0042), sem diálogo de NPC. Requisitos: vocação e `requires.level`; preço `learnPrice` pelo
   ledger (ADR 0052 d.3); idempotente (aprender duas vezes é recusado sem cobrar).

3. **`learnPrice` vem dos NPCs do Canary** (`StdModule.learnSpell` em 51 NPCs — o menor preço
   entre os que ensinam, na regra do ADR 0038 d.6 para preço), com TibiaWiki para magia que nenhum
   NPC importado ensina. Nenhuma magia é grátis por padrão; conteúdo pode declarar `learnPrice: 0`
   como override com citação.

4. **Migração: quem já existe recebe todas as magias da sua vocação com `requires.level ≤ level`
   no momento da migração**, gravadas em `learnedSpells` por uma migração de dados única (ADR
   0014). Ninguém perde um slot da barra que funcionava ontem. Personagem novo começa sem
   nenhuma, como no Tibia; o kit de nascimento (ADR 0026) não muda.

5. **O preset do bot por vocação continua igual**: slots com magia não aprendida ficam na barra,
   marcados na tela como "não aprendida", e a tela de serviço oferece comprar dali. Nada é
   escondido (ADR 0032 d.5).

## Alternativas

- **Todos pagam, inclusive quem já existe.** Descartada pelo ADR 0014: regressão de capacidade
  persistida sem fonte que a justifique.
- **Manter liberação por level (regra atual).** Descartada pelo ADR 0037 d.1: divergência sem
  exceção que a cubra.
- **Esperar a captura do Huntera.** Descartada: a captura decide só a migração, e o ADR 0014 já
  decide a migração; a captura vira corroboração quando existir (#643).
- **Motor de diálogo de NPC.** Descartada (ADR 0042).

## Consequências

- #624 destrava. `docs/product/progression.md` e `onboarding.md` ganham a regra e a divergência
  registrada do kit (sem magia grátis).
- Registro `learnedSpells: string[]` (+ `version`); opcode `learn-spell`; `spellSchema.learnPrice`;
  extrator de magias lê preços dos NPCs.
- O que piora: um personagem de level 8 novo tem gold de kit e nenhuma magia; o onboarding precisa
  mostrar a tela de serviço cedo — é o mesmo atrito do Tibia, registrado como tal.

## Invariantes afetados

Nenhum. **4** (só intenção), **9** e **10** (ADR 0052).

## Emenda — 2026-09-29: a implementação (#624)

A decisão não mudou; a implementação fechou seis pontos que o texto deixava abertos.

1. **`spell-not-learned` fica logo depois de level e vocação e ANTES de cooldown, alvo e mana**
   (`casting.ts`). O Canary confere o aprendizado depois da mana (`playerSpellCheck`), mas a ordem
   entre recusas que nunca melhoram esperando só é observável no texto da recusa — nunca no
   resultado da hunt, porque nenhuma delas gasta nada. O ponto que importa é o do bot: a recusa
   não tem prazo (`retryInMs: 0`), o slot é pulado e o grupo continua; e o slot da barra ganha o
   motivo próprio `not-learned` (o espelho de `slotStates` coincide com `useSlot`, DT-08).
2. **O registro só viaja no extrato quando é a verdade do personagem** (`LearnedSpells#recorded`).
   Uma sessão retomada de um snapshot anterior à #624 — ou um ticket de um `api` ainda não
   atualizado — não sabe o que o personagem aprendeu, e gravar o vazio seria afirmar uma verdade
   que ela não tem (e, antes do ponto 6, apagava a concessão da migração, o que viola o ADR 0014).
   O campo é OMITIDO e o ledger não toca na coluna. A compra ou a concessão (`grant`) tornam o
   registro a verdade — e o ponto 6 diz por que "verdade parcial" também não apaga nada.
3. **A migração 0024 é um retrato.** As 119 magias do dia (id, vocação, `minLevel`) estão no SQL,
   porque a migração descreve o que era verdade na hora dela: uma magia que o conteúdo criar
   depois é COMPRADA, e um teste (`learned-spells-migration.postgres.test.ts`) prende as regras
   (limite exato de level, promoção não é outra vocação, quem não escolheu vocação, quem nasce
   depois começa com `NULL`).
4. **Preço sem NPC.** Três magias do catálogo (`challenge`, `conjure-power-bolt`,
   `conjure-sniper-arrow`) não têm NPC que as ensine no `data-otservbr-global` — o fallback do d.3
   é o TibiaWiki, que ficou inacessível na implementação: os três preços (2000 / 2200 / 800) são
   **PROVISÓRIOS** e estão marcados `[ABERTO — conferir]` no `_open` de cada arquivo. A
   **Great Death Beam** fica SEM `learnPrice`: no Canary só o Wheel of Destiny a concede
   (`player_wheel.cpp`), e o dono deixou a Roda fora em 2026-09-29 — `learn-spell` recusa
   `not-for-sale`, e a migração a concede a quem já tivesse o level 300.
5. **Aprender no meio da hunt acorda o bot** (`HuntRuleset#rearmBot`): a recusa sem prazo deixa
   o grupo engatilhado até o mundo mudar, e aprender uma magia não muda o mundo. É o mesmo
   `#armBot` que dano e troca de configuração já chamam — um evento na fila, nada por tick, o mesmo
   a 1 Hz e a 10 Hz.
6. **O ledger funde o registro pela UNIÃO dos ids, não por última-escrita-vence** — a única
   exceção à regra geral do ADR 0052 d.1 ("sai inteiro, última escrita vence"). O registro só
   CRESCE (o único caminho que esquece magia no Canary é a Wheel of Destiny, em `player_wheel.cpp`,
   e a Roda está fora), então a união (`LearnedSpells.merge`, idempotente e comutativa, como o
   `Bestiary.merge`) é a fusão certa, e fecha duas janelas da última-escrita: (a) extratos
   pendentes se aplicam em ordem qualquer — `ReceiptStore.pending()` percorre um `SCAN` do Redis,
   que não ordena —, e o extrato antigo `[A]` chegando depois do novo `[A, B]` derrubava `B` com o
   gold dele já debitado (o gold é delta); (b) um extrato de base desconhecida — a sessão retomada
   de um snapshot sem registro que comprou UMA magia — carrega só `[X]` e sobrescrevia a concessão
   da migração com ele (a perda do ADR 0014 que o `recorded` do ponto 2 só cobria para o vazio, não
   para o parcial). Se um dia uma magia puder ser revogada, a revogação é uma migração de dado
   versionada (ADR 0014), nunca um efeito colateral de qual extrato chegou por último.

O que este ADR NÃO cobre e continua igual: o `premium` do NPC é ignorado, e o Draconya tem um saldo
de gold só (o `removeMoneyBank` do Canary tira do banco ou da mochila). Ver `docs/product/progression.md`,
"Aprender magia".
