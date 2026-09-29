# 0040 — combat-v3: o pipeline de recebimento do Canary e o ciclo de vida dos perfis de combate

**Status:** proposto — decorre do [ADR 0037](0037-tfs-canary-fidelity-except-action-bar-and-automation.md)
decisão 5 (perfil de combate novo, `breaking`, para toda mudança de resultado) e do
[ADR 0031](0031-contrato-de-compatibilidade-de-combate-e-migracao.md) (regra de evolução de
perfil); bloqueada por uma questão em aberto (ver seção própria)
**Data:** 2026-09-25
**Contexto técnico:** `packages/content` (schema de combate, perfil), `packages/sim`
(`combat/defense.ts`, `combat/damage.ts`, resolver canônico), `packages/server` (retomada e
drenagem por perfil)
**Issues:** M30 — #548 a #555

## Contexto

O M28 (#518–#527) trocou o lado **ofensivo** do combate — dano de arma, chance à distância,
fórmulas de magia — mas o lado **defensivo** continua o `combat-v1`/`v2` congelado pelo ADR 0031:
um bloqueio binário em `defense.ts:59` que não corresponde a nenhum mecanismo do Tibia, sem
armadura em faixa e sem mitigação percentual. 1.394 dos 1.655 monstros do bestiário do Canary não
têm campo algum para essas duas coisas no schema atual.

O Canary resolve isso em `Creature::blockHit`
(`src/creatures/creature.cpp:944`), chamado de `Game::combatChangeHealth`
(`src/game/game.cpp:7936`, `:8011`, `:9176`) para os dois lados de um ataque: primeiro absorção e
aumento por tipo em item (`applyAbsorbDamageModifications`), depois imunidade, depois defesa com
`blockCount` — a peça só bloqueia enquanto tem "carga" (+1 a cada 1.000 ms até um teto de 2,
calculada sob demanda a partir do último uso, sem tick, pela mesma disciplina do invariante 2) —,
depois armadura numa faixa aleatória (`uniform_random(arm/2, arm-(arm%2+1))`, ou -1 quando a
armadura é ≤ 3), e por fim a mitigação percentual do `PlayerWheel::calculateMitigation`
(`src/creatures/players/components/wheel/player_wheel.cpp`), que o `Creature::mitigateDamage`
(`creature.cpp:911-921`) explicitamente **pula** para `COMBAT_MANADRAIN`, `COMBAT_LIFEDRAIN` e
`COMBAT_AGONYDAMAGE` — os dois primeiros tipos de dano do M29-07 não curam quem ataca; drenam o
alvo (mana ou vida) sem devolver nada, ao contrário do que uma leitura apressada do nome sugere.

O ADR 0031 já fixa que toda mudança de resultado, ordem de RNG ou arredondamento exige um perfil
`breaking` novo e um ADR antes do código — e o próprio ADR 0031 registra, em suas emendas, que
cada estágio novo (CMB-03 a CMB-08) chegou sob esse contrato. Esta decisão é a próxima emenda
dessa série, e também é a primeira vez que o projeto precisa de uma regra explícita para
**aposentar** um perfil de combate — hoje `combat-v1` nunca é removido, e sem uma regra o projeto
acumularia um perfil `breaking` congelado por milestone para sempre.

## Decisão

1. **Um perfil `breaking` novo, `combat-v3`**, aplica a ordem do `Creature::blockHit` do Canary:
   absorção/flat por tipo e aumento do atacante → imunidade → defesa com
   `uniform_random(def/2, def)` só enquanto `blockCount > 0` → armadura com
   `uniform_random(arm/2, arm-(arm%2+1))` (ou −1 se armadura ≤ 3) → mitigação % — nunca para
   lifedrain/manadrain. Soma-se a isso a defesa e a mitigação do jogador do 13.x
   (`calculateMitigation` sem gemas da Wheel, que fica para o M41), a postura de luta, crítico e
   leech de item e de monstro, reflexo de dano, linha de visão (`isSightClear`) e a trava de
   ataque ao trocar de andar (stairhop, 2 s).
2. **A ordem exata e a posição de cada sorteio são o contrato do perfil**, na mesma disciplina que
   o ADR 0031 já usa para `combat-v1`: cada estágio novo diz explicitamente se consome RNG, e a
   ausência de declaração num conteúdo antigo preserva a sequência anterior — não existe estágio
   "implícito".
3. **Ciclo de vida de perfil.** Cada milestone que muda resultado, RNG ou arredondamento abre o
   **próximo id livre** (`combat-v3`, depois `v4`…) e pode emendá-lo enquanto ele vive na branch
   de integração do milestone (`m28-integration` e sucessoras) — o mesmo espírito das emendas que
   o ADR 0031 já acumula sobre `combat-v1`. **O perfil congela no merge na `main`**: depois disso,
   uma mudança de resultado abre um perfil novo, nunca reabre um já mesclado.
4. **Remoção de perfil morto.** O código de um perfil é removido quando **nenhuma sessão
   hospedada o fixa mais** — o teste é o mesmo do ADR 0031 (`Content.version` congela o perfil na
   sessão) —, com prazo limitado pela vida máxima de uma sessão (a hunt mais longa que o sistema
   permite ficar aberta antes de drenar). Um perfil nunca é removido enquanto uma sessão viva
   ainda referencia sua versão de conteúdo.

## Questões em aberto (decisão do dono)

- **Tipo de dano `arcane` e magias genéricas sem fonte no Canary.** O `combat-v1`/`v2` usa
  `arcane` como o tipo default de magia sem elemento declarado (ADR 0031, emenda de 2026-09-17),
  e o catálogo atual tem magias genéricas (blast/strike/heal) e a Divine Defiance sem
  correspondente no Canary `47dfd51` verificado pelo plano. Isso não é um detalhe de `combat-v3`
  em si — é uma decisão sobre o que entra no catálogo de dano —, mas `combat-v3` é onde a
  taxonomia de `DamageType` vive, e uma resposta aqui evita que a migração de armadura por tipo
  (a mesma tabela `V1_ARMOR_EFFECTIVENESS` que o ADR 0031 já versiona) precise ser refeita duas
  vezes. Duas opções, nenhuma decidida:
  - **remover** `arcane` e as magias/Divine Defiance sem fonte, migrando o conteúdo que as
    referencia para um tipo canônico do Tibia (physical/energy/earth/fire/ice/holy/death);
  - **manter como exceção documentada**, registrando `arcane` como vocabulário próprio do
    Draconya para magia ainda sem elemento no catálogo real. O plano não recomenda uma das duas:
    a escolha muda o escopo do M37 (extração de magias) e depende de quanto do catálogo atual de
    fato não tem correspondente.
  Enquanto essa questão não for respondida, `combat-v3` mantém `arcane` no vocabulário herdado do
  `combat-v1`/`v2` sem alteração — a taxonomia não muda por esta decisão, só o pipeline de
  recebimento.

## Alternativas

- **Encaixar defesa/armadura/mitigação como emenda do `combat-v1`/`v2`.** Descartada: o ADR 0031
  é explícito — mudar ordem de RNG ou resultado exige perfil novo, e a defesa deixa de ser
  identidade (hoje é bloqueio binário) para virar um estágio com sorteio próprio. Não é uma
  correção de bug, é um resultado novo.
- **Não separar o ciclo de vida do perfil da regra de evolução do ADR 0031.** Descartada: o ADR
  0031 diz quando um perfil novo nasce, mas nunca disse quando um perfil velho morre — sem essa
  regra, cada milestone do plano (M30, e potencialmente outros até o M43) empilharia um `id`
  novo para sempre, e o código morto de perfis sem sessão viva nunca seria removido.
- **Migrar sessão em andamento para o perfil novo ao vivo.** Descartada pelo próprio ADR 0031:
  reinterpretar um snapshot produz resultado que ninguém simulou (ADR 0018). Sessão em andamento
  continua no perfil da versão de conteúdo dela.

## Consequências

- M30 (#548–#555) implementa o pipeline: `combat-v3` e `blockHit` (M30-01), defesa/armadura/
  mitigação do jogador (M30-02), postura de luta (M30-03), crítico e leech (M30-04), absorção e
  reflexo (M30-05), linha de visão (M30-06), trava de stairhop (M30-07) e a apresentação do tiro
  errado (M30-08).
- `combat-v3` depende de M29 (#541–#547) ter fechado antes: dano de monstro por drown/lifedrain/
  manadrain (M29-07) é o mesmo pipeline que esta decisão organiza, e as duas issues compartilham
  a exceção do `mitigateDamage`.
- A regra de aposentadoria de perfil é uma obrigação nova e recorrente: a partir de `combat-v3`,
  todo milestone que abrir um perfil precisa também documentar quando o anterior deixa de ter
  sessão viva — o que hoje não existe em lugar nenhum.

## Invariantes afetados

Nenhum muda. O invariante 4 continua garantindo que o cliente nunca manda perfil, tipo de dano ou
resultado. O invariante 7 é o que torna o perfil conteúdo versionado e congelado na sessão — a
regra de aposentadoria da decisão 4 só é segura porque a fixação na sessão já existe.
