# Plano do endgame — como os sistemas do Tibia 13.x entram num jogo idle-first (M38–M44)

**Status:** proposto em 2026-09-27; decisões de arquitetura nos [ADRs 0052 a 0059](adr/README.md);
este documento é o inventário por sistema, a ordem de implementação e a **direção de spec** de
cada issue — o parágrafo que a skill `/spec` recebe pronto, para não ter de decidir nada de
produto ao escrever a spec completa.
**Base:** [`docs/tibia-parity-plan.md`](tibia-parity-plan.md) §1 grupo 5 e 6 (M39–M44) e M38;
[ADR 0051](adr/0051-playable-delivery-cut-and-art-pack-1533-on-parity.md) d.6 (grupo 4 do
`PLAN.md`). Fontes: Canary em `CANARY_DIR` (só números e mecanismos — ADR 0019 limite 1, ADR 0037
d.3); Huntera para produto onde observado (`docs/reference/huntera-observed.md`).

## 1. As três regras que valem para os sete milestones

1. **Persistir e cobrar tem um caminho só** — [ADR 0052](adr/0052-endgame-progression-state-and-city-services-through-the-owning-session.md):
   registro `jsonb` por sistema na linha do personagem, lido no ticket, escrito pelo ledger a
   partir do extrato; serviço de Cidade é **intenção C2S tratada pela sessão de Cidade**, nunca
   endpoint `api`; gold, item e overlay pelos canais de extrato que já existem; rolagem só na
   Cidade, com o `session.rng` dela; "online" = tempo de sessão de hunt; cooldown de parede =
   carimbo; entradas de fora (loyalty, boosted, hazard, Premium) fixadas no ticket.
2. **Um perfil de combate para tudo, `combat-v4`**, emendado por issue enquanto a `tibia-parity`
   é a branch de integração (ADR 0052 d.7, ADR 0040 d.3). Cada issue que muda resultado ou RNG
   declara o estágio em `docs/product/combat-conformance.md`.
3. **O corte de versão não mudou com o pacote 15.33.** O release de referência é 13.32 (ADR 0031;
   ADR 0038 d.5; ADR 0031 já dizia que a versão de arte não é a fonte). Regra refinada pelo
   [ADR 0053](adr/0053-bestiary-xp-line-kept-and-charms-added.md) d.3: **revisão de sistema que o
   13.32 já tinha segue o Canary `main`** (Charms com tiers, Roda sem Monk); **sistema novo
   pós-13.32 fica fora** (Monk, Weapon Proficiency — #630 fechada —, Animus Mastery, Soulpit).
   Convergence da Forja: verificar na TibiaWiki se é anterior ao 13.32 antes de incluir.

## 2. Sistema por sistema

Formato: (a) o mecanismo do Tibia; (b) o que conflita com idle-first / sessão desanexada / versão
fixada / ledger; (c) adaptação escolhida e alternativas descartadas; (d) o que fica fora e por quê;
(e) ordem e dependências. A direção de spec por issue está na §3.

### 2.1 M38 · Invocações e familiares — [ADR 0057](adr/0057-player-summons-in-a-detached-hunt.md)

- (a) Criatura com `master`: segue, herda o alvo, o dano credita XP ao mestre; Summon Creature
  (lvl 25, teto 2, mana do monstro), familiares (lvl 200, 15 min / 30 min), Convince, Animate Dead.
- (b) Nada estrutural; a dúvida era o que acontece desanexado e se o bot ressumona.
- (c) Criatura da sessão com `masterId` de personagem, no snapshot da sessão; idêntica anexada ou
  não; ressumonar é ação do bot (`summon`, condição `summons`). Descartado: invocação como estado
  do personagem; invocação passiva quando desanexado; proibir o bot.
- (d) Invocar na Cidade (PZ). Loot transferido ao Skeleton do Animate Dead (destruído, ADR 0048 d.5).
- (e) #598 → #599 → #600. Depende de #546 (`masterId`) e #580 (importador lê `summonable`,
  `convinceable`, `manaCost`, `familiars/`).

### 2.2 M39 · Bestiário e Charms — [ADR 0053](adr/0053-bestiary-xp-line-kept-and-charms-added.md)

- (a) Estágios por monstro (`firstUnlock`/`secondUnlock`/`toKill`) que rendem pontos de Charm;
  20 charms com tiers; slots 2/6/25; remover custa `level × 100`.
- (b) Conflito de produto: o Huntera mostra "Progresso no Bestiary" como linha de XP; o ADR 0045
  queria removê-la. Nada arquitetural.
- (c) Os dois coexistem: estágios + Charms do Canary **e** a linha de XP do FUN-113 como exceção
  de produto (limiares de outra ordem — não disparam juntos). Charms com tiers (Canary `main`).
  Descartado: remover sem compensação; pontos retroativos; adiar Charms; reconstruir os Charms
  de 13.32 da TibiaWiki.
- (d) Charm Expansion (Loja, M22). O Dodge do PRD não volta — o único Dodge é o charm.
- (e) #601 → #602 → #603. #603 depende de #548 (`combat-v3` aceito) e abre o `combat-v4`.

### 2.3 M40 · Imbuements — ADR 0046 (aceito) + ADR 0052

- (a) 3 bases × 20 categorias, 20 h de duração que só decai em combate fora de PZ; santuário
  consome materiais + gold, rola `percent` (100 % com proteção).
- (b) Decaimento por tick (resolvido no ADR 0046 d.4: sob demanda); onde roda a rolagem (ADR 0052
  d.4: só Cidade); "em combate" precisa de definição única (a janela de 60 s do #625).
- (c) Santuário como intenção de Cidade; materiais por `removedInstances`, gold pelo ledger,
  resultado por `overlays`. Descartado: endpoint `api`; imbuir na hunt.
- (d) Imbuement scrolls da Loja (M22). Nada do mecanismo fica fora.
- (e) #605 → #625 → #606 → #607. #604 já pousou.

### 2.4 M41 · Wheel of Destiny — [ADR 0055](adr/0055-wheel-of-destiny-allocation-in-protect-zone.md)

- (a) `(level − 50)` pontos; slots por cor com adjacência; dedicação, convicção, revelações,
  gemas; só em PZ; exige lvl > 50, promovido, Premium.
- (b) Alocação é estado quente que o combate lê (fixar por sessão); a estrutura mora no cliente do
  Tibia (transcrever como número); gemas do Canary são KV, não item.
- (c) Estrutura em `content/data/wheel/`; alocação atômica por intenção de Cidade, fixa na hunt;
  dedicação nos stats derivados, convicção no `combat-v4`; gemas como registro (não item).
  Descartado: árvore própria do PRD; realocar na hunt; gemas como item; adiar gemas.
- (d) Roda do Monk e pontos da quest dele (corte). Portão Premium fica como dado de conteúdo.
- (e) #608 → #609 → #610 → #611. #609 depende de #548; #610 depende de #596 (extrator de
  magias) e #622 (condições de controle, para Avatar/feared); #611 por último.

### 2.5 M42 · Prey, Task Hunting, Concoctions, Boosted — [ADR 0054](adr/0054-prey-task-hunting-concoctions-and-boosted-creature-on-hunt-time.md)

- (a) Prey 2 h "online", reroll grátis 20 h ou `level × 200`; Task Hunting com dificuldade e
  pontos; Concoctions 1 h / 24 h; boosted diária com spawn ÷ 2 e XP × 2.
- (b) "Online" não existe; o `sim` não lê relógio; "do dia" é do mundo, não da sessão.
- (c) "Online" = tempo de hunt (evento na fila); carimbos de parede comparados na intenção;
  boosted sorteada pelo `jobs` e fixada no ticket. Descartado: tempo de parede; Cidade como
  online; boosted por sessão; Wildcards em gold.
- (d) Terceiro slot e tudo que custa Prey Wildcard (Loja, M22). `prey.md` do Huntera sai.
- (e) #615 → #612 → #613 → #614. #612 depende de #563 (termo de XP) e #601 (bestiário importado,
  classes); #614 depende de #613 (pontos) e de #556 (condições).

### 2.6 M43 · Forja e Influenced/Fiendish — [ADR 0056](adr/0056-exaltation-forge-in-instanced-hunts.md)

- (a) Teto global de criaturas Influenced/Fiendish escolhidas entre todos os monstros vivos; dust,
  slivers, cores; fusão/transferência/conversão com chances da config; procs por tier.
- (b) Teto global não existe em hunts instanciadas; rolagem na hunt mudaria o RNG.
- (c) Sorteio por spawn com `session.rng`, tetos **por sessão**, stack na instância; dust como
  registro, slivers/cores como item; forja como intenção de Cidade; procs no `combat-v4`.
  Descartado: teto em Redis; lista fixa no início; dust como item; forjar na hunt.
- (d) Convergence (verificar corte). Nada mais.
- (e) #617 → #616 → #618. #617 depende de #604 (pousado) e #548; #616 depende de #583 (spawn
  importado) e #580.

### 2.7 M44 · Periféricos

| Issue | Sistema | Onde está decidido | Depende de |
|---|---|---|---|
| #619 | Facções | §3 (sem ADR: só targeting) | #580 |
| #620 | Apresentação do monstro | §3 (sem ADR: invariante 6) | #580 |
| #621 | Condição de outfit | §3 (ADR 0041) | #556 |
| #622 | Rooted/feared/pacified | §3 (ADR 0041) | #556 |
| #623 | Magias utilitárias | §3 | #596, #519 |
| #624 | Aprender magia | [ADR 0058](adr/0058-spells-learned-for-gold-with-migration-grant.md) | #596 |
| #625 | Trava de saída 60 s | §3 (define "em combate" para #606) | — |
| #626 | Skinning + Scavenge | §3 (ADR 0048 d.5/d.6, ADR 0053 d.5) | #603, #585 |
| #627 | Elemental bond, mana shield | §3 | #573 |
| #628 | Loyalty | §3 (ADR 0052 d.5) | — |
| #629 | Bosstiary | §3 (ADR 0052 d.1) | #580 |
| #630 | Weapon Proficiency | fechada — fora do corte (§1.3) | — |
| #631 | Treino | [ADR 0059](adr/0059-training-session-and-offline-training-bank.md) | #567 |
| #632 | Hazard | §3 (ADR 0052 d.5 e d.7) | #583 |
| #643 | Capturas do Huntera | §3 | contínua |

## 3. Direção de spec por issue

Cada parágrafo é o que a spec precisa respeitar; o que não está aqui é decisão da spec, não de
produto. "Registro" é sempre no sentido do ADR 0052 d.1; "intenção de Cidade" no do d.2.

### M38

- **#598 — Summon Creature.** Estender `MonsterState.masterId` (#546) a `characterId`; a invocação
  segue o mestre pelo `follow` existente e assume o alvo dele a cada troca; dano dela entra no mapa
  de dano em nome do mestre (XP por razão de dano e Bestiário são do mestre; loot inalterado);
  monstros a atacam. Teto 2; mana = `manaCost` do monstro (importado com `summonable`); recusar na
  Cidade. Some na morte do mestre, ao sair da hunt e no fim da sessão; entra no snapshot da sessão.
  Barra: ação `summon { monsterId }` e condição `summons < N` (vocabulário v2, default, sem subir
  versão); preset Druid/Sorcerer liga "sem invocação → invocar". `creature-appear.masterId`
  opcional. Testes: teto; alvo do mestre; XP do mestre com e sem party (#523); soma ao sair; RNG
  da hunt inalterado quando ninguém invoca. ADR 0057 d.1–d.4.
- **#599 — Familiares.** Quatro monstros de `familiars/` importados (`summonable`); quatro magias
  lvl 200 (mana 3000/1000/2000/3000); duração 15 min e cooldown 30 min como eventos da fila;
  cooldown restante vira carimbo no runtime e volta no ticket; familiar exige zero invocações vivas
  e ocupa um lugar do teto. Preset do #526 liga "familiar pronto → invocar". ADR 0057 d.3–d.4.
- **#600 — Convince e Animate Dead.** Convince: `convinceable` importado; custa `manaCost`;
  transfere posse; **o ponto de spawn NÃO inicia o respawn — o lugar continua ocupado até o
  convencido morrer ou sair (a emenda de 2026-09-30 do ADR 0057 corrige este texto)**; convencido não
  dá XP nem loot. Animate Dead: exige cadáver MOVÍVEL no topo do tile-alvo (ADR 0048 d.6, emenda do
  0057); consome o cadáver e destrói o loot restante
  (d.5); cria Skeleton dentro do teto; `ground-item-disappear` + `creature-appear`. Runas como
  suprimento abstrato (ADR 0044). ADR 0057 d.5–d.6.

### M39

- **#601 — Bestiário do Canary.** Importar `bestiary.{class, firstUnlock, secondUnlock, toKill,
  charmPoints}` por monstro (M35); estágio e pontos **derivados** do contador que já persiste;
  `charms.pointsSpent` no registro. **Não remover** `applyXpBonus`/`milestones`: a linha de XP
  fica como exceção registrada (ADR 0053 d.2), com `1 %` marcado `[ABERTO — provisório]`. Cyclopedia
  mostra estágio, estrelas, ocorrência, pontos e, à parte, os marcos de XP. `bestiary.md`
  reescrito com "Divergências". Testes: estágios do Dragon (50/500/1000), pontos ao completar, XP
  com marcos inalterada. Critério "+1 % removido" **substituído**.
- **#602 — Charms: economia.** Extrator para `charms/generated/` (nome, category, type,
  damageType, percent, chance[3], points[3]); registro `charms { pointsSpent, echoesSpent, tiers:
  {charmId → 0..3}, assignments: {charmId → raceId} }`. Intenções `charm-unlock`, `charm-assign`,
  `charm-remove` (aceitas na Cidade e na hunt — sem rolagem); slots 2 Free / 6 Premium; major
  exige monstro completo; um major + um minor por criatura; remover custa `level × 100` pelo
  ledger. Echoes `25t² + 25t + 50` por desbloqueio de major. Tela de Charms no Cyclopedia. ADR
  0053 d.3–d.4; ADR 0052 d.1–d.3.
- **#603 — Charms em combate.** Abre o **`combat-v4`** (ADR 0052 d.7). Ordem do Canary:
  defensivos no hit recebido de monstro (minor antes de major, `chance[tier] ≥
  normal_random(1,10000)/100`, antes do mana shield; Dodge encerra); ofensivos no hit dado
  (`percent` da vida inicial, uma vez por hit); passivos nos termos existentes; Bless no termo de
  morte, Gut no loot, Scavenge fica para #626. Um vetor por charm; conformance com e sem charms
  registrada em `combat-conformance.md`. ADR 0053 d.5.

### M40

- **#605 — Catálogo de imbuements.** `scripts/catalog/imbuements.ts` lendo `imbuements.xml`:
  3 bases (price 5000/30000/200000, protectionPrice, percent 90/70/50, removecost 15000, 72000 s),
  20 categorias, 72 entradas com efeito, materiais (resolvidos contra o catálogo de itens; material
  ausente → relatório, não erro) e scroll (fora, Loja). Saída `content/data/imbuements/generated/`
  com `source`. ADR 0038 d.1–d.7.
- **#606 — Efeitos e decaimento.** Agregar as categorias dos itens equipados como estágios do
  `combat-v4` (dano elemental convertendo parte do físico, leech, crítico, absorb, skillboost,
  velocidade, capacidade, paralysis deflection). Decaimento sob demanda (ADR 0046 d.4) a partir do
  tempo **em combate** da definição única do #625 (último ataque dado ou recebido ≤ 60 s), só na
  hunt; agressivo exige em combate, não agressivo decai equipado; expira e sai do overlay.
  Testes: leech; decaimento para fora de combate e na Cidade; expiração.
- **#607 — Santuário.** Intenção de Cidade `imbue { instanceId, slot, imbuementId, protect }`
  e `imbue-remove`: materiais por `removedInstances`, gold (base + protectionPrice) pelo ledger,
  rolagem `percent` (100 % com proteção) no `session.rng` da Cidade, falha consome materiais e
  gold como o Canary; resultado em `overlays`; remoção custa 15000. Tela do santuário no design
  system. Testes: falha consome; retry não cobra duas vezes (chave do extrato); remoção. ADR 0052
  d.2–d.4.

### M41

- **#608 — Pontos e alocação.** Conteúdo `wheel/`: slots por cor/anel com custo, adjacência,
  `requires { level: 51, promoted: true, premium: true }`; pontos `(level − 50) × 1`. Registro
  `wheel { allocation, gems, vessels, version }`. Intenção `wheel-allocate { slots }` só na Cidade,
  substitui tudo, validada (total, custo, adjacência a partir do centro, vocação); fixa na hunt.
  Tela da Roda. Testes: pontos por level; adjacência; recusas. ADR 0055 d.1–d.4.
- **#609 — Dedicação e convicção.** Stats derivados (vida, mana, capacidade, mitigação — o
  multiplicador que ADR 0040 zerou) na entrada da sessão; perks de convicção e bônus (leech,
  crítico, skill) como estágios do `combat-v4` no ponto do `player.cpp`. Vetor: Knight 200 com
  alocação de referência calculado à mão. ADR 0055 d.5.
- **#610 — Revelações e magias.** Extrator gera as magias com `requires.wheelStage`; graus por
  estágio alteram números lidos do conteúdo; Avatar = condição de outfit (#621) + modificadores;
  Expose Weakness/Sap Strength = condições no alvo (M31). Uma magia por vocação testada. ADR 0055 d.6.
- **#611 — Gemas e vessels.** Gemas como entradas do registro (não item): drop pelo callback do
  gem atelier vira "gema revelável" no cadáver que entra no registro ao coletar; `wheel-gem-reveal`
  / `-rotate` / `-equip` na Cidade com gold da config pelo ledger e `session.rng` da Cidade;
  modificadores básicos e supremo aplicados como estágios do `combat-v4`. ADR 0055 d.7.

### M42

- **#615 — Boosted Creature.** Tarefa diária do `jobs` (`boosted.rolloverHourUtc` em conteúdo):
  sorteia entre monstros com bestiário, grava `world_daily.boostedMonsterId` e Redis; ticket leva
  `boostedMonsterId`; sessão fixa no início. Efeitos: `spawntime / 2` nos pontos daquele monstro,
  XP × 2, um roll extra de loot. Destaque no catálogo de hunts. Testes: só a boosted fixada; hunt
  atravessando a virada não muda. ADR 0054 d.7; ADR 0052 d.5.
- **#612 — Prey.** Registro `prey` com 2 slots (2º Premium); grade de 9 por `reloadMonsterGrid`
  (estágios por `level/100`, `preyExclusive`, sem repetir) com `session.rng` da Cidade; reroll
  grátis 20 h (carimbo) ou `level × 200` pelo ledger; bônus e raridade (`2r+5`, `2r+10`, `3r+10`);
  `bonusTimeLeftMs` 7 200 000 consumido por tempo de hunt (evento na fila; remanescente no
  extrato). XP no termo do #563; dano dado/recebido no `combat-v4`; loot como roll extra com
  chance = %, party com fator 0,7. `prey.md` reescrito; Wildcards e 3º slot em "Fora (Loja)". ADR
  0054 d.1–d.4.
- **#613 — Task Hunting.** Registro `taskHunting` com 2 slots (2º Premium), `points`, carimbos;
  dificuldade pela classe do bestiário; `kills` 25/100/400 × estrelas, `secondKills = 2×` com
  upgrade, recompensa pela fórmula de `initializeTaskHuntOptions`; abate conta na hunt no evento
  do Bestiário, sempre; `disabledUntil` 20 h após concluir; reroll como Prey. Tela. ADR 0054 d.5.
- **#614 — Concoctions.** Catálogo do `concoctions.lua`; compra com pontos de Task Hunting
  (preço `[ABERTO — provisório: NPC do Tibiadrome]`); ativação como condição do M31 com 3 600 000
  ms de **tempo de hunt** e `lastActivatedAt` 24 h de parede; "online" definido como tempo de
  sessão de hunt (ADR 0052 d.6, ADR 0054 d.1). Testes: duração só em hunt; cooldown.

### M43

- **#617 — Tier e procs.** `tier: 0..10` no overlay (campo irmão, ADR 0046 impl.); procs
  Onslaught/Ruse/Momentum/Transcendence/Amplification por slot no `combat-v4` com as fórmulas
  quadráticas da config; tier 0 = sem proc. Um vetor por proc. ADR 0056 d.5.
- **#616 — Influenced/Fiendish.** Sorteio por spawn com `session.rng` (estágio declarado no
  `combat-v4`): `forge.influencedChancePerSpawn` (stack 1–5) e `fiendishChancePerSpawn` (15), tetos
  por sessão `maxInfluencedAlive` e 1 Fiendish com `fiendishMinIntervalMs` — valores provisórios
  3 %, 0,2 %, 8, 1 h marcados `[ABERTO]`; elegibilidade `canBeForgeMonster`; vida `× (1 +
  (15·stack+35)/100)` na instância; `creature-appear.forgeStack`. Morte: dust → registro
  `forge.dust` (teto `dustLevel`, 100 → 225), slivers (3–7) e cores como itens no cadáver; divisão
  em party como `exaltation_forge.lua`. ADR 0056 d.1–d.3.
- **#618 — Forja.** Intenções de Cidade `forge-fuse`, `forge-transfer`, `forge-convert` com
  `session.rng` da Cidade: custos de `TierInfo` por classificação e config (100 dust, 50 %/+15 %
  com core, tier loss reduction), gold pelo ledger, itens por `removedInstances`/`acquired`, tier
  por `overlays`; `forge.history` (100 últimas). Convergence só se anterior ao 13.32. Tela. ADR
  0056 d.4 e d.6.

### M44

- **#619 — Facções.** `faction` e `enemyFactions` importados; `selectTarget` do monstro inclui
  monstros de facção inimiga como candidatos (`isOpponent`/`isTarget`); dano monstro↔monstro pelo
  mesmo pipeline; monstro morto por monstro não dá XP a jogador nem loot com dono; atividade sem
  jogador depende só de estado da sessão (invariante 3). Teste: Deepling ataca Deathling.
- **#620 — Apresentação.** Campos opcionais `outfit.{head,body,legs,feet,addons,mount}`,
  `voices`, `light`, `race` (índices, não arte — invariante 6) no monstro; protocolo leva no
  `creature-appear`; fala periódica sorteada **no cliente** (nunca no RNG da sessão); luz e cor do
  sangue no render. Sem efeito em combate. **Entregue (#620)** — ver
  [`docs/product/combat.md`](product/combat.md), "Apresentação do monstro". Dois desvios do texto
  acima, ambos de apresentação: `mount` não entrou (só `mounted-thorn-knight` declara
  `lookMount` no Canary, e ele está fora do corte de caça — o campo não teria quem o usasse), e a
  luz é um clarão aditivo porque o viewport da hunt não escurece o ambiente.
- **#621 — Condição de outfit.** Condição `outfit` (ADR 0041) referenciando `outfitId`/
  `appearanceId` da tabela (invariante 6); Creature Illusion, Chameleon e ataque `outfit` de
  monstro; imunidade `outfit`; `creature-update` transmite a troca; expira na fila. Base do Avatar
  (#610).
- **#622 — Rooted, feared, pacified.** Três condições no schema e no `sim` (rooted: sem passo;
  feared: passo de fuga com o RNG da sessão, como drunk; pacified: sem ataque); migrar a trava de
  escada do M30-07 para `pacified` de 2 s; imunidade por monstro. Um teste por condição.
- **#623 — Utilitárias.** Light/Great/Ultimate Light: condição de apresentação (cliente ajusta a
  escuridão, `sim` não lê); Levitate e Magic Rope: troca de andar pelas regras de tile (#519);
  Find Person/Fiend: `system-message` de direção; Food: credita `fedMs` (ADR 0049 d.5);
  Disintegrate: sem efeito enquanto não há item no chão além do cadáver — registrado.
- **#624 — Aprender magia.** Registro `learnedSpells`; cast recusa `spell-not-learned` e o bot
  pula o slot; intenção `learn-spell` (Cidade, aceita na hunt) com `learnPrice` importado dos NPCs
  (menor preço; TibiaWiki como fallback) pelo ledger, idempotente; migração única concede a quem
  existe todas as magias da vocação com `requires.level ≤ level`; personagem novo começa sem
  nenhuma; runa exige só level/ML, conjuração exige aprendizado; tela de serviço. ADR 0058.
- **#625 — Trava de saída.** Definição **única** de "em combate": último ataque dado ou recebido
  há ≤ 60 000 ms (`pzLocked`), guardada como carimbo lógico no runtime; a saída manual e a por
  regra do bot só concluem fora dela (o `exitDelayMs` continua como contagem visual). A mesma
  definição alimenta o decaimento de imbuement (#606). Testes: saída em combate espera; fora usa o
  delay. **Emenda (#802, achado desta issue):** o `leave-hunt` do socket encerrava a sessão direto,
  sem passar por `requestExit`, então a trava só valia para a saída do bot; passou a PEDIR a saída
  ao ruleset, com `exit-pending` (S2C) para a tela e `cancel-exit` (C2S) para desistir da saída
  manual — ver `docs/product/hunt.md`, "Saída da hunt".
- **#626 — Skinning e Scavenge.** Importador gera os 87 mapeamentos cadáver → material; o bot,
  com a ferramenta (5908/5942) na mochila, esfola **no mesmo evento em que coleta** (ordem de RNG
  determinística: um estágio declarado no `combat-v4`, consumido só quando há ferramenta), chance
  25 %, Scavenge soma; o material cai no cadáver e segue o filtro de Quick Loot (ADR 0048 d.3);
  manual `use-item-on` no cadáver dentro da vida dele (ADR 0049).
- **#627 — Elemental bond e mana shield.** `elementalBond` (32 itens) soma dano no elemento no
  `combat-v4`; `magicShieldCapacityFlat/Percent` (4 itens) entram no cálculo do escudo em
  `combat/outcome.ts`. Um vetor de cada. **Emenda (#627, achado desta issue):** a direção acima
  descrevia efeitos que o Canary não tem. O bond não SOMA dano: troca o tipo de dano da magia
  instantânea, e só para `VOCATION_MONK_CIP` (`combat.cpp:159-174`) — e os 32 itens são todos arma
  `fist`, fora do corte (Monk, DT-01). A capacidade de magic shield só aparece na descrição do
  item e na Cyclopedia (`item.cpp:134-141`, `protocolgame.cpp:5661-5663`): `magic_shield.lua`
  monta o balde sem consultá-la, e nenhum script a lê. Pelo ADR 0037 d.6 a entrega é o DADO —
  campos no schema, importador e catálogo (os 4 spellbooks) — sem estágio no `combat-v4` e sem
  mexer em `combat/outcome.ts`; ver `docs/product/items.md`, "Atributos raros". Aplicar a
  capacidade ao escudo exigiria antes o balde do Canary, que o Draconya não tem (o mana shield
  absorve da mana até o prazo vencer, CMB-08), e ir além do que o Canary faz.
- **#628 — Loyalty.** `api` calcula `loyaltyBonusPercent` na emissão do ticket a partir de
  `accounts.createdAt` (`loyaltyPointsPerCreationDay 1`, tabela de tiers do Tibia em conteúdo);
  fixo na sessão (ADR 0052 d.5); `sim` converte tries totais em níveis extras por skill e ML
  (`getLoyaltySkill`/`getLoyaltyMagicLevel`) como nível efetivo; tela mostra o bônus.
- **#629 — Bosstiary.** `bosstiary.rarity` importado (Bane/Archfoe/Nemesis); registro
  `bosstiary { kills: {raceId → n}, points, version }` escrito no evento de abate (mesmo do
  Bestiário; a chave é o `raceId` do Canary e não o `monsterId` — emenda de 2026-09-29 do ADR 0052);
  pontos por tabela do `io_bosstiary`; Cyclopedia mostra. Boss Slot/boosted boss ficam para o
  sistema de bosses (`bosses.md`).
- **#631 — Treino.** Ruleset `training` (estado ATIVO, eventos na fila no intervalo de ataque da
  vocação, 1 Hz desanexado): uma carga por golpe, `7 × rate` tries ou `600 × rate` mana gasta,
  `rate` do dummy em conteúdo (100), stamina recupera; exercise weapons com `charges` 500/1800/
  14400 compradas por `buy-item` mínimo (`purchasable`) pelo ledger; registro `training {
  offlineBankMs (≤ 12 h, cresce 1:1 com hunt/treino), offlineSkill }`; `api` gasta o banco na
  emissão do ticket (carência 10 min, teto Free 6 h / Premium 12 h) com as fórmulas de
  `offline_training.lua` em `characters.skills`. `training.md` reescrito. ADR 0059.
- **#632 — Hazard.** Só zonas que o Canary marca (`hazard.lua`); nível escolhido na entrada da
  hunt e fixado no ticket (ADR 0052 d.5); registro `hazard { maxLevel: {zoneId → n} }` sobe por
  `levelUp` ao matar no nível máximo; efeitos no `combat-v4`: crítico do monstro (`hazardCritical*`),
  dano × `hazardDamageMultiplier`, esquiva do monstro (`hazardDodgeMultiplier`), XP e loot ×
  bônus (`ondroploot_hazard.lua`: rolls extras). Party: menor nível entre os membros. Pods ficam
  fora até haver item no chão além do cadáver.
- **#643 — Capturas do Huntera.** Continua como está; ganha dois itens já decididos que a captura
  só corrobora: questão 7 (Bestiário — o **número** do bônus, ADR 0053 d.2) e questão 8 (magia —
  a migração já decidida pelo ADR 0058 d.4).

## 4. Ordem recomendada

Grupo 4 do `PLAN.md` (ADR 0051 d.6), depois do Portão 1 e do grupo 3. Dentro dele:

1. **Fundação do ADR 0052** dentro da primeira issue que precisa dela — **#602** (registro,
   intenção de Cidade com gold pelo ledger, extrato/ticket/`jobs`) — precedida de **#601**
   (só conteúdo e derivação). Depois **#625** (define "em combate" uma vez) e **#603** (abre o
   `combat-v4`).
2. **M40:** #605 → #606 → #607 (primeiro serviço com rolagem na Cidade e `overlays`).
3. **M42:** #615 (primeira tarefa diária do `jobs` e primeira entrada fixada no ticket) → #612 →
   #613 → #614.
4. **M38:** #598 → #599 → #600 (independente dos anteriores; pode correr em paralelo com 2–3 por
   outro agente, porque não toca registro nem Cidade).
5. **M44 de motor:** #622 → #621 → #620 → #619 → #623 → #627 (pré-requisitos de #610 e de bosses).
6. **M41:** #608 → #609 → #610 → #611.
7. **M43:** #617 → #616 → #618.
8. **M44 de progressão:** #624 → #628 → #629 → #626 → #631 → #632.
9. **#643** corre em paralelo o tempo todo; cada captura vira emenda no ADR que cita.

PRs empilhadas quando dependem (ex.: #601 → #602 → #603), base `tibia-parity`, `pnpm check` antes
de cada uma; o dono mescla em ordem, como no `PLAN.md`.

## 5. O que fica fora dos sete milestones, e por quê

| Item | Motivo |
|---|---|
| Prey Wildcards, 3º slot de Prey e de Task Hunting, Charm Expansion, imbuement scrolls | Itens da Loja; entram com o M22 (`monetization.md`), não com o mecanismo |
| Monk, Weapon Proficiency, Animus Mastery, Soulpit | Sistemas pós-13.32 (§1.3, ADR 0038 d.5) — o pacote 15.33 não move o corte |
| Boss Slot / boosted boss do Bosstiary | Dependem do sistema de bosses (`bosses.md`, futuro) |
| Hazard Pods | Exigem item no chão além do cadáver (ADR 0048 d.8: nada vai ao chão) |
| Teto global de Influenced/Fiendish | Não existe "mundo" com N monstros vivos; teto por sessão (ADR 0056 d.1) |
| Diálogo de NPC | Tela de serviço (ADR 0042, 0052, 0058) |
| Endpoint `api` para serviço de jogo | Invariante 9 (ADR 0052 d.2) |
