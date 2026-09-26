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
