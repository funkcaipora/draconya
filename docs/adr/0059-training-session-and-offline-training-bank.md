# 0059 — Treino: exercise weapon numa sessão de Treino por eventos; offline training é um banco gasto na volta

**Status:** aceito (#631) — implementa a decisão 4 do [ADR 0045](0045-tibia-bestiary-charms-prey-and-training.md)
**Emendado pelo [ADR 0060](0060-tibia-open-world-without-pvp.md) (2026-09-30) — d.1 e d.3:** o treino é online; o banco cresce no mundo; o “fora” é o repouso.
(exercise weapons e offline training no lugar dos Trainer Monks); persiste pelo
[ADR 0052](0052-endgame-progression-state-and-city-services-through-the-owning-session.md)
**Data:** 2026-09-27
**Contexto técnico:** `packages/sim` (ruleset novo `training`, `skills.ts`), `packages/content`
(`training/` — dummy, taxas; itens exercise weapon com `charges`), `packages/server` (estado
`training` do personagem, registro `training { offlineBankMs, offlineSkill }`, cálculo na `api`
na emissão do ticket), `packages/protocol` (`set-offline-training-skill`, entrada/saída de treino)
**Issues:** M44-13 (#631)

## Contexto

O Tibia treina de dois jeitos que o Draconya não tem: **exercise weapons** — item com cargas
(500 / 1 800 / 14 400) usado num boneco em zona de proteção, uma carga por golpe no ritmo da
vocação, cada carga dando `7 × rate` tries de skill (ou `600 × rate` de mana gasta para magic
level); e **offline training** — o jogador escolhe uma skill num livro, e ao voltar recebe tries
por `min(tempo offline, banco, 12 h)`, banco que se enche 1:1 enquanto ele está online
(`addOfflineTrainingTime`), com carência de 10 min.

Os dois esbarram em invariantes de formas diferentes. A exercise weapon leva 16 min (500 cargas a
2 s) de golpes agendados — e a Cidade **não simula nada** (invariante 8, ADR 0004). O offline
training precisa saber quanto tempo o personagem passou fora — e o `sim` não lê relógio
(invariante 1). O ADR 0045 decidiu **o quê**; falta **onde** roda cada um.

## Decisão

1. **Exercise weapon roda numa sessão de Treino**, ruleset `training` novo: estado ATIVO do
   personagem (invariante 8), instanciado como a hunt, **orientado a eventos** (cada golpe é um
   evento da fila no intervalo de ataque base da vocação, invariante 2), 1 Hz desanexado e
   idêntico com ou sem visualizador (invariante 3). O ruleset consome uma carga por golpe,
   credita `7 × rate` tries na skill da arma (ou `600 × rate` de mana gasta) com `rate` do dummy
   em conteúdo (100), e encerra quando as cargas acabam ou o jogador sai. Sem monstro, sem
   suprimento consumido, sem dano; stamina **recupera** como na Cidade (é PZ). Um mapa mínimo
   (o tile do dummy) como recorte OTBM.

2. **Exercise weapon é item com `charges`** do catálogo (M34), comprada com gold: sem loja de
   Cidade ainda (E5), a #631 entrega a intenção mínima `buy-item { itemId }` restrita a itens com
   `purchasable: true`, pelo ledger (ADR 0052 d.3) e `acquired` — a loja geral a substitui depois
   sem mudar o dado. Preço pelo NPC do Canary/TibiaWiki (ADR 0038 d.6).

3. **Offline training é um banco no registro `training`**: `offlineBankMs` cresce 1:1 com o tempo
   de sessão de hunt ou de treino (o "online" do ADR 0052 d.6), teto 12 h; `offlineSkill` é
   escolhido por intenção de Cidade (`set-offline-training-skill`, o livro do Tibia). **Quem gasta
   é a `api`, na emissão do ticket**, com o personagem em repouso (ADR 0052 d.5): tempo fora =
   agora − fim da última sessão, ≥ 10 min de carência, gasto `min(fora, banco, teto)`, tries pela
   fórmula de `offline_training.lua` (melee/distance: `tempo / velocidadeDeAtaque / 2` ou `/ 4`;
   magic level: `tempo × manaGain / manaTicks`; `shielding` ganha `tempo / 4` junto), gravadas em
   `characters.skills` na mesma transação. A Cidade conta como fora (ADR 0043 d.2).

4. **Teto de gasto por conta: Free 6 h, Premium 12 h** — a forma do PRD §11.3 e de
   `docs/product/monetization.md`, registrada como divergência do Tibia (onde offline training é
   só Premium): Premium é decisão de monetização, não mecânica de caça (ADR 0037 d.2 não a
   cobre, ADR 0055 d.1 usa a mesma régua). O banco continua com teto 12 h para todos.

5. **`docs/product/training.md` é reescrito**: os Trainer Monks saem; a tabela de parâmetros passa
   a ser cargas, `rate`, teto do banco, carência e tetos por conta.

## Alternativas

- **Resolver a exercise weapon em fórmula fechada, na hora do uso.** Descartada: pula 16 min a
  4 h de tempo real que o Tibia faz o jogador esperar; mudaria tries por hora de forma
  incomparável.
- **Agendar os golpes na sessão de Cidade.** Descartada pelo invariante 8 (a Cidade não simula) e
  pelo custo: a Cidade é shard de até 200 pessoas orientado a evento, e 200 fitas de golpes a
  2 s a transformariam numa hunt.
- **Manter os Trainer Monks.** Descartada pelo ADR 0045 d.4.
- **Offline training calculado pelo `sim` na entrada da sessão.** Descartada pelo invariante 1: o
  `sim` não sabe que horas são; a `api` já faz exatamente esse cálculo para a stamina.
- **Offline training só para Premium (Tibia).** Descartada em favor da forma do PRD; registrada.

## Consequências

- #631 destrava e ganha um ruleset novo pequeno (`training`), o terceiro depois de `hunt` e `city`.
  `characters.state` ganha o valor `training`.
- Registro `training { offlineBankMs, offlineSkill, version }`; opcodes `enter-training`,
  `set-offline-training-skill`, `buy-item` (mínimo); itens exercise weapon no catálogo.
- O que piora: mais um tipo de sessão hospedada conta no teto de sessões do nó (ADR 0001); é
  barato (um evento a cada ~2 s) mas não é zero — medir antes do deploy, como a stamina pediu.

## Invariantes afetados

Nenhum. **8** (sessão de Treino como estado ATIVO), **2** (golpe é evento), **3** (idêntico
desanexado), **1** (a `api` calcula o offline, não o `sim`).

## Emenda — 2026-09-30: a implementação (#631)

O que a implementação decidiu onde o ADR era genérico, e o que ela alinhou ao [ADR 0060](0060-tibia-open-world-without-pvp.md).

1. **O "fora" do offline training é o repouso, medido por um carimbo no diretório** (d.3, emendada
   pelo ADR 0060 d.14c). O `game` grava `char:{id}:rest` — o instante do `release` — no Redis, no
   `SessionDirectory.release`; a `api` o lê no `resolveNode` (que diz se o personagem está em repouso:
   nenhum registro de sessão) e o `register` o apaga. Não é coluna do Postgres: é dado de duração curta
   (o "fora" nunca conta mais que 21 dias) e de leitura barata no ticket. **Sem carimbo — Redis
   reiniciado, ou a sessão que caiu sem `release` — a `api` não gasta o banco naquele login**: o tempo
   continua nele, a escolha do livro também, e nada se perde. A alternativa "agora − `stamina_updated_at`"
   foi descartada: esse marco é o do último login/transição e contaria como "fora" o tempo online na
   Cidade.
2. **A `api` escreve na MESMA transação da trava de linha do ticket.** `withOwnedCharacter` passa à
   operação um `CharacterWriter` (`applyOfflineTraining`) preso à `tx` que segura a linha — um método
   do repositório abriria outra conexão e esperaria, sem fim, pela linha travada. O ticket leva o
   resultado (skills e banco novos), e a escrita só acontece com o ticket emitido: `active-limit` não
   gasta o banco. Quando nada rendeu (carência, banco vazio) só `characters.training` é escrito — as
   skills e o instante delas (`skills_updated_at`, a guarda do ledger) ficam como estavam.
3. **A stamina não anda no Treino** — a d.1 dizia "recupera como na Cidade"; o ADR 0060 d.14c
   corrigiu para "não recupera", porque o exercise training do Canary é online e o Canary só regenera
   stamina deslogado. Implementado como `holdStamina` (`packages/sim/src/stamina.ts`): sair do Treino
   só avança o marco; a entrada materializa como sempre (o tempo antes do treino é recuperação).
4. **Compra e persistência.** `buy-item` cria a instância de origem `purchase` (nova em
   `ITEM_ORIGINS`), com id `${sessão da praça}:${personagem}:buy:${UUID}` — único por compra, porque a
   mesma cópia da Cidade é reaberta em outro dia. O extrato de estado durável da Cidade agora **também
   sai na transição para uma sessão privada** quando há estado sujo (`#runTransition`, como
   `#leaveForParty` já fazia): sem isso, a arma comprada (prefixo da sessão da praça) nunca chegaria ao
   banco — o extrato do Treino só leva o `acquired` nascido NELE — e o gold gasto sumiria junto, já que
   o `goldDelta` da praça não entra nos agregados da sessão de destino.
5. **O corte do catálogo**: 21 exercise weapons (sword, axe, club, bow, rod, wand e shield × 500 / 1 800
   / 14 400 cargas). As exercise wraps de fist (Monk, pós-13.32) e as de 50 cargas de treino ficam
   fora, com o boneco livre (`rate` 100); o boneco de casa (110) espera o sistema de casas.
6. **O boneco mora no mapa da Cidade**, e não num recorte OTBM mínimo à parte (d.1 previa um): o
   boneco livre da Thais é um item do próprio recorte da Cidade (`things/maps/otservbr.otbm`, item
   28565 em (32347, 32240, 7) = (72, 87, 7)), então a sessão de Treino reaproveita `content.city` e o
   tile do personagem é conferido no boot (`buildContent`).

**Status:** implementado na #631.

## Emenda — 2026-10-01: correções da revisão (#631)

A revisão da PR achou onde a implementação divergia do Canary e deste ADR; o que ela corrigiu:

1. **A stamina é segurada em TODA saída do Treino**, e não só no `leave-hunt` (emenda de 2026-09-30,
   item 3). A saída pela transição constrói a Cidade ANTES de gravar o extrato, mas a arma que acaba
   sozinha (`#settleOne` grava e só depois constrói), o logout dentro do Treino, a drenagem e o
   snapshot irrestaurável gravavam o marco da ENTRADA — e o ticket seguinte devolvia como recuperação
   o tempo de treino inteiro (uma arma de 14 400 cargas são oito horas). Agora o extrato carrega o
   marco do fim: `#persistReceipt` segura o marco (`holdStamina` com o relógio de parede `wallNow` do
   host) quando a sessão é `training`, e `settleSnapshotAsReceipt` o faz com o `nowMs` de quem liquida.
2. **O `training-exhaustion` do Canary entra** (`exerciseExhaustedUntilMs`, `startCooldownMs` = 10 s):
   o Canary recusa um novo início de Treino por 10 s ("This exercise dummy can only be used after a
   10 seconds cooldown."), e sem isso entrar/sair/entrar a cada ciclo creditava um golpe por entrada.
   É cooldown de PAREDE do ADR 0052 d.6: carimbo no registro `training` (campo aditivo, sem migração),
   comparado com o relógio que o servidor passa. Nenhuma divergência: o jogo recusa quando e como o
   Canary recusa.
3. **O banco de offline training lê o tempo EXATO da participação** (`Session.inSessionMsOf`), e não o
   `durationMs` dos agregados, que soma a janela do `advanceBy` inteira antes dos eventos: uma sessão
   que acaba por evento no meio da janela (arma esgotada, morte) gravava um banco que dependia do Hz
   do host (invariante 3).
4. **O escudo do offline training segue o `sendUpdate` do Canary**: `Skill.percent` é um `double` de 2
   casas comparado com o percentual novo truncado, e não "o inteiro mudou" — para quem tem decimais
   guardados o escudo treina quase sempre (d.3, item 8 de `docs/product/training.md`).
5. **O catálogo leva o nome e o tipo de TODA skill que o Treino toca** (`catalogue.training.skills`), e
   não só as do livro: o exercise shield treina o `shielding`, que o livro não oferece.
