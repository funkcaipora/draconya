# 0045 — Os sistemas de Cyclopedia e treino do Tibia substituem os do PRD

**Status:** proposto — decorre do [ADR 0037](0037-tfs-canary-fidelity-except-action-bar-and-automation.md)
decisão 1, que revoga para mecânica de jogo o limite 2 do [ADR 0019](0019-opentibia-as-domain-specification.md)
sob o qual `docs/product/bestiary.md`, `prey.md` e `training.md` foram escritos; bloqueada por uma
questão em aberto (ver seção própria); em 2026-09-25 o Huntera contestou a decisão 1 (bônus de XP
do Bestiário) — conflito para o dono resolver, ver emenda
**Data:** 2026-09-25
**Contexto técnico:** `packages/content` (`bestiary/`, charms, prey, task hunting, `training/`),
`packages/sim` (contadores de abate existentes, motor de treino), `docs/product/bestiary.md`,
`prey.md`, `training.md`
**Issues:** M39 — #601 a #603; M42 — #612 a #615; M44-13 (#631)

## Contexto

Três sistemas do PRD foram escritos sob o limite 2 do ADR 0019 ("igual ao Tibia não é argumento
sozinho"), antes de o ADR 0037 revogar esse limite para mecânica de jogo:

- **Bestiário** (`docs/product/bestiary.md`): hoje o contador de abate por monstro é permanente
  e cada um dos cinco marcos (10.000/25.000/50.000/100.000/200.000 abates) dá **+1 % de XP PvE
  para sempre**, global e cumulativo (FUN-113). O Canary organiza isso por **estágios por
  monstro** (`FirstUnlock`/`SecondUnlock`/`toKill`) e concede **pontos de Charm** ao completar —
  sem o bônus de XP global do Draconya.
- **Prey** (`docs/product/prey.md`, status "não implementado"): a especificação vigente é
  observação do Huntera (slots, faixa de level ±70, quatro bônus de +10 %), não do Canary/TFS. O
  Canary tem Prey, Task Hunting e Concoctions próprios, com números documentados em
  `config.lua.dist` (`preySystemEnabled`, `preyRerollPricePerLevel` etc., linhas ~144-160;
  `taskHuntingSystemEnabled` e afins, ~154-165; Tibiadrome Concoctions, ~282-285) e mecanismo em
  `src/io/ioprey.cpp`.
- **Treino** (`docs/product/training.md`, status "não implementado"): a especificação vigente são
  dois Trainer Monks batendo sem dano numa instância dedicada. O Tibia usa **exercise weapons**
  (armas de treino consumíveis, sem instância) e **offline training** (evolução de skill
  enquanto desconectado, dentro de um teto de horas) — mecanismo diferente do fim ao começo.

Os três sistemas mudam XP e loot por hora — exatamente o eixo que o ADR 0037 existe para tornar
comparável entre o Draconya e uma party real na mesma hunt. Divergir deles, sob o novo limite,
torna o teste de paridade incomparável.

## Decisão

1. **Bestiário passa a ser o do Canary**: estágios por monstro e pontos de Charm ao completar,
   **sem** o +1 % de XP global por marco. Os contadores de abate já persistidos continuam
   valendo — a migração preserva a contagem, só muda o que ela desbloqueia.
2. **Charms entram como no `bestiary_charms.lua`** (`data/scripts/systems/bestiary_charms.lua`,
   com `register_bestiary_charm.lua` como registro): desbloqueio por pontos de Charm, atribuição a
   uma criatura específica, persistência por personagem.
3. **Prey, Task Hunting e Concoctions seguem o Canary** (`ioprey.cpp`,
   `config.lua.dist:139-162,282-287`), substituindo `docs/product/prey.md` inteiro — a
   especificação vinda da observação do Huntera deixa de ser a fonte.
4. **Treino passa a ser exercise weapons e offline training**, no lugar dos Trainer Monks de
   `docs/product/training.md` — os dois documentos de produto são reescritos, não emendados, já
   que o mecanismo muda de ponta a ponta.

## Questões em aberto (decisão do dono)

- **Remover o +1 % de XP por marco do Bestiário é uma regressão visível para quem já alcançou
  marcos — confirmar a remoção sem compensação?** Ao contrário das outras questões deste lote,
  esta não é sobre qual número usar: é sobre um jogador existente **perder** um bônus que já
  tinha. O plano não recomenda compensação nem a omite por engano — ele nomeia explicitamente que
  é uma regressão e pede confirmação do dono antes de a issue (M39-01, #601) remover o bônus. As
  opções são: remover sem compensação (fidelidade direta ao Canary), remover com uma compensação
  pontual (ex.: pontos de Charm retroativos pelos marcos já alcançados), ou manter o +1 % como
  exceção de produto registrada, na forma do `combat-v1` (ADR 0031).

## Alternativas

- **Manter o Bestiário atual e só adicionar Charms por cima.** Descartada: os dois sistemas
  competem pelo mesmo gatilho (marco de abate); manter os dois juntos duplicaria a recompensa por
  completar um monstro sem fonte no jogo real.
- **Adaptar a especificação do Huntera para Prey em vez de substituí-la pelo Canary.** Descartada
  pelo próprio ADR 0037: a Huntera deixou de ser fonte de mecânica de jogo desde a decisão 4
  daquele ADR (só TibiaWiki continua valendo, para fato que nenhuma engine carrega); Prey tem
  mecanismo completo no Canary, então não há razão para usar uma fonte observada em vez da fonte
  primária.
- **Manter os Trainer Monks e só ajustar os números.** Descartada: exercise weapons e offline
  training não são uma variação numérica dos Trainer Monks — são um mecanismo sem instância
  dedicada nenhuma, e "ajustar números" preservaria uma estrutura que o Tibia não tem.

## Consequências

- M39 (#601–#603, Bestiário e Charms), M42 (#612–#615, Prey/Task Hunting/Concoctions/Boosted
  Creature) e M44-13 (#631, treino) ficam desbloqueados quanto ao mecanismo; a remoção do bônus de
  XP (decisão 1) espera a confirmação do dono antes de fechar M39-01.
- `docs/product/bestiary.md`, `prey.md` e `training.md` são reescritos, não emendados — os três
  description atuais descrevem um sistema que deixa de existir, não uma versão anterior dele.
- M39-03 ("[Combate] Efeitos dos Charms em combate") depende de `combat-v3` (ADR 0040) já estar
  aceito, porque Charms de combate (ex.: o Dodge do charm, já citado pelo ADR 0037 decisão 5 como
  possível correspondência do Dodge atual) entram como modificador no mesmo pipeline.

## Invariantes afetados

Nenhum muda de texto. Nenhum dos três sistemas toca estado quente fora do `CharacterRuntime` da
sessão dona (invariante 9), e nenhum introduz I/O em `sim` (invariante 1) — contadores e slots
continuam dado de conteúdo/estado de personagem, como já são hoje.

## Emenda — 2026-09-25: decisões do dono ("copie do Huntera") — o Bestiário do Huntera dá bônus de XP, conflito em aberto

Em 2026-09-25 o dono respondeu as doze questões abertas do `docs/tibia-parity-plan.md` §5 com
"copie do Huntera". Para a questão 7 do plano ("confirmar a remoção do +1% de XP por marco sem
compensação?"), a resposta puxa na direção OPOSTA à decisão 1 acima.

A tela de personagem do Huntera lista cinco fontes de bônus de XP lado a lado: "Progresso no
Bestiary, Experience Scroll, Bônus da guild, Bônus de Premium, Bônus de level" (Parte I §5-6,
linha 85: "Progresso no Bestiary | —"). Na conta observada (level 1), o valor estava inativo
(`—`) porque nenhum marco de Bestiário tinha sido alcançado — a porcentagem exata por marco, se
ela escala por monstro ou globalmente, e um eventual teto nunca foram observados com valor
diferente de zero.

**O Huntera trata "Progresso no Bestiary" como um item de linha dentro do bônus de XP TOTAL do
personagem** — o mesmo grupo de level/guild/Premium —, não como um sistema de Charm points sem XP
direta. Isto contraria a leitura direta da decisão 1 acima (Bestiário vira estágios + Charms,
**sem** o +1% de XP global do Draconya) e a própria questão em aberto original, que perguntava
"confirmar a remoção", não "reconsiderar".

**Sob "copie do Huntera": não remover o bônus de XP do Bestiário do Draconya (FUN-113) sem uma
compensação equivalente.** O rótulo da caixa de progresso do Huntera ("Progresso no Bestiary")
inclusive é quase idêntico ao já usado no Draconya ("Progresso no Bestiário",
`docs/product/bestiary.md` linha 31) — o formato "Bestiário como item de bônus de XP total" é
ANTERIOR à primeira captura do Huntera (o PRD §18 é de 2026-09-07, três dias antes da captura de
2026-09-10 do Huntera), e a observação do Huntera corrobora a FORMA de forma independente, sem
decidir o número exato.

**Isto é um conflito genuíno para o dono, não uma resposta limpa.** As opções ficam registradas
em aberto: manter o +1%/marco do FUN-113 ao lado dos Charms novos (os dois sistemas convivendo),
manter o +1%/marco e adiar Charms, ou seguir a decisão 1 original (remover, Charms puro) — a
diretriz "copie do Huntera" pesa CONTRA a remoção sem compensação, mas não decide sozinha o
desenho final entre as opções que sobram. A questão em aberto original permanece aberta; M39-01
(#601) não remove o bônus até o dono decidir à luz desta emenda.

Confiança: média. **Captura pendente:** uma conta do Huntera com progresso real de Bestiário
(muitas mortes de um monstro fácil, ou uma conta veterana) para ler o valor numérico real da
linha "Progresso no Bestiary" e ver como ele escala com a contagem de abates — de preferência
cruzando um ou mais marcos enquanto se observa o total de bônus de XP mudar, e checando se o
bônus é por monstro ou global.

(Evidência: `docs/reference/huntera-observed.md` Parte I §5-6 linhas 79-89; decisão 1 acima;
`docs/product/bestiary.md` linha 31; `docs/prd-v0.9.md` §18, 2026-09-07.)
