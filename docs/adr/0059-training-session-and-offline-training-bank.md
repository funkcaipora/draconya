# 0059 — Treino: exercise weapon numa sessão de Treino por eventos; offline training é um banco gasto na volta

**Status:** proposto — implementa a decisão 4 do [ADR 0045](0045-tibia-bestiary-charms-prey-and-training.md)
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
