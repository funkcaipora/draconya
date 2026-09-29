# 0045 — Os sistemas de Cyclopedia e treino do Tibia substituem os do PRD

**Status:** proposto — decorre do [ADR 0037](0037-tfs-canary-fidelity-except-action-bar-and-automation.md)
decisão 1, que revoga para mecânica de jogo o limite 2 do [ADR 0019](0019-opentibia-as-domain-specification.md)
sob o qual `docs/product/bestiary.md`, `prey.md` e `training.md` foram escritos; bloqueada por uma
questão em aberto (ver seção própria)
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
