# Treino

**Status:** implementado (#631, M44-13) — exercise weapons numa sessão de Treino e offline
training como banco. Substitui os Trainer Monks do PRD §11.
**PRD:** §11
**Épico:** E7 (E8 no PRD original)
**ADRs:** [0059](../adr/0059-training-session-and-offline-training-bank.md) (decisão sobre este
sistema, com a emenda de 2026-09-30), [0045](../adr/0045-tibia-bestiary-charms-prey-and-training.md)
d.4 (os Trainer Monks saem), [0052](../adr/0052-endgame-progression-state-and-city-services-through-the-owning-session.md)
(estado durável e serviço de Cidade), [0060](../adr/0060-tibia-open-world-without-pvp.md) d.14c
(o Treino é online e a stamina não anda nele)

## Comportamento

O Tibia treina de dois jeitos, e o Draconya tem os dois — sem os Trainer Monks do PRD.

### Exercise weapon: a sessão de Treino

O jogador compra uma **exercise weapon** na Cidade (`buy-item`), abre a tela de Treino (pill
"Treino", ao lado de "Escolher caçada") e escolhe "Treinar". O servidor cria uma **sessão de
Treino** — estado ATIVO do personagem (invariante 8), privada, de um dono só — e coloca o
personagem ao lado do exercise dummy, no próprio mapa da Cidade (o boneco livre da Thais).

A sessão é **orientada a evento** (invariantes 2 e 3): cada golpe é UM evento da fila, o primeiro no
instante da entrada e os seguintes a cada `combat.player.attackIntervalMs` (2 000 ms, o
`getBaseAttackSpeed()` do Canary). Cada golpe gasta **uma carga** e credita `7 × rate` tries na
skill da arma — ou `600 × rate` de mana gasta, para wand e rod (`rate` do boneco, 100 = 1×). O
resultado é o mesmo a 10 Hz, a 1 Hz e desanexado: fechar o navegador não pausa nem acelera o
treino, e o teste de equivalência o prende. Uma weapon de 500 cargas são ~17 min; a de 14 400, oito
horas — por isso o Treino é uma sessão, e não uma conta feita na hora do uso.

- A **última carga também rende**: o crédito vem antes do desconto, como no Canary.
- Zerou, a arma **é destruída** (`weapon:remove(1)`, via `removedInstances` e o ledger) e a sessão
  acaba `completed`. As cargas que restam vivem no **overlay da instância**
  (`ItemInstanceOverlay.charges`, "ausente é cheia") e atravessam sessões.
- Sair antes (`Parar treino`, o `leave-hunt` de toda sessão privada) devolve o personagem à Cidade
  e a arma guarda o que sobrou. A arma que sai do inventário no meio (vendida, descartada) encerra o
  treino, como o "the training has stopped" do Canary.
- Sem monstro, sem dano, sem RNG, sem suprimento consumido, sem gold gasto.
- **A stamina não anda**: o exercise training do Canary é online, e o Canary só regenera stamina
  deslogado (emenda do ADR 0060 d.14c ao ADR 0059 d.1). O Treino não a drena, e a saída dele só
  avança o marco (`holdStamina`) — o tempo de treino não vira recuperação.
- Tempo de treino **enche o banco** de offline training, 1:1.

### Offline training: um banco gasto na volta

O **banco** (`training.offlineBankMs`, teto 12 h) cresce 1:1 com o tempo que o personagem passa em
hunt ou em treino (`Player::addOfflineTrainingTime`). Na Cidade o jogador escolhe uma skill no
**livro** (`set-offline-training-skill`, o `skill_trainer.lua` do Tibia; `null` desmarca) —
intenção de Cidade, tratada pela sessão dona.

Quem **gasta** o banco é a `api`, na emissão do ticket, com o personagem em **repouso** (sem sessão
hospedada — o único momento em que a linha não tem dono quente, ADR 0052 d.5), com as fórmulas de
`offline_training.lua`:

1. sem skill escolhida, nada acontece;
2. a escolha é **consumida** (`null`) — qualquer que seja o desfecho;
3. "fora" menor que a **carência de 10 min** não treina e não gasta o banco;
4. `treino = min(fora, banco, teto da conta)` em segundos inteiros — **Free 6 h, Premium 12 h**
   (a forma do PRD §11.3; no Canary o offline training é só Premium — divergência abaixo);
5. o banco desce o que foi treinado, mesmo que seja pouco demais para render;
6. menos de 60 s não rende nada;
7. tries: melee `(s / ataqueBase) / 2`, distância `/ 4`, magic level `s × manaGain / manaTicks`
   (o `manaGain` da vocação, os ticks da vocação PROMOVIDA), truncados como o `uint64_t` do Canary,
   passando pelo rate de skill do conteúdo;
8. o escudo treina junto (`s / 4`) — só se a skill principal avançou de nível ou de percentual.

O "fora" é `agora − o fim da última sessão`: o `game` grava um **carimbo de repouso** no Redis
(`char:{id}:rest`, no `release` do diretório) e a `api` o lê no ticket. Registrar uma sessão nova
apaga o carimbo. **Sem carimbo** — Redis reiniciado, ou a sessão que caiu sem `release` (`kill -9`) —
a `api` **não gasta o banco**: o tempo continua nele, e nada se perde. O "fora" nunca conta mais que
21 dias (`os.time() - lastLogout`, `math.min(…, 86400 * 21)`).

O ticket leva o resultado (skills e banco novos) e a **mesma transação** o grava em
`characters.skills` (com o instante que a guarda do ledger compara) e `characters.training`. Ticket
recusado (`active-limit`) não gasta.

### Comprar a exercise weapon

`buy-item { itemId }` é o mínimo que a exercise weapon precisa enquanto a loja geral (E5) não existe:
só item com `purchasable: true`, ao `buyPrice` — o MENOR `buy` de NPC do Canary (`npc-prices.ts`,
ADR 0038 d.6) —, uma unidade, direto na mochila (`Inventory.add`: o peso recusa, como no NPC do
Canary). O gold sai por `goldDelta` e o extrato o leva ao ledger (invariante 10); o item nasce como
instância NOVA de origem `purchase`, e o mesmo extrato a leva por `acquired`. A loja geral substitui
o mecanismo sem mudar o dado. As 21 exercise weapons do corte do Canary
(sword, axe, club, bow, rod, wand e shield × comum 500 / durable 1 800 / lasting 14 400 cargas)
estão em `content/data/items/generated/exercise-weapons.json`; as **exercise wraps de fist** (Monk)
e as weapons de 50 cargas de treino ficam fora do corte (ADR 0038 d.5).

### A tela

O pill "Treino" (só na Cidade, só em servidor com `catalogue.training`) abre o `TrainingModal`: o
**banco** (barra e tempo, os tetos e a carência), o **livro** (um select com as skills do conteúdo),
as **exercise weapons carregadas** (cargas restantes, o que rendem, "Treinar") e a **loja** (preço,
o que a arma rende, "Comprar" desabilitado sem gold). Em treino, o pill vira o estado —
"Treinando Espada · 431/500 cargas" — e "Parar treino". A tela é apresentação: cada botão manda só
QUAL id (invariante 4).

## Regras

- O Treino é uma sessão privada de um dono só; o boneco é do personagem, e o teto de sessões do nó
  (ADR 0001) não comporta treino em grupo.
- Um golpe por `attackIntervalMs`; um golpe gasta uma carga; `7 × rate` tries (`600 × rate` de mana
  gasta para wand/rod), o primeiro golpe na entrada.
- A arma esgotada é destruída; a instância guarda as cargas restantes no overlay.
- O banco cresce 1:1 com o tempo de hunt e de treino, teto 12 h; é gasto só pela `api`, no ticket,
  com o personagem em repouso e carimbo de repouso presente.
- Carência de 10 min; `min(fora, banco, teto da conta)`; Free 6 h, Premium 12 h.
- A escolha do livro é consumida em todo login que a lê, com ou sem treino.
- A stamina não recupera nem gasta no Treino; o tempo dele não conta como "fora de hunt".
- Sair do Treino cedo não perde nada: as cargas restantes ficam na arma, e o tempo treinado já
  entrou no banco.
- A compra é só na Cidade; a escolha do livro também.

## Parâmetros de balanceamento

| Parâmetro | Valor | Onde mora em packages/content |
|---|---|---|
| Rate do boneco (`exercise dummy`) | 100 (1×) — os bonecos de casa valem 110 e ficam fora | `data/training/baseline.json`, `dummy.rate` |
| Tries por carga | 7 | `data/training/baseline.json`, `strike.triesPerCharge` |
| Mana gasta por carga (wand/rod) | 600 | `data/training/baseline.json`, `strike.manaSpentPerCharge` |
| Onde o personagem fica e onde está o boneco | (73, 87, 7) e (72, 87, 7) no mapa da Cidade | `data/training/baseline.json`, `place` |
| Intervalo entre golpes | 2 000 ms | `data/combat/baseline.json`, `player.attackIntervalMs` |
| Teto do banco | 12 h | `data/training/baseline.json`, `offline.bankCapMs` |
| Carência | 10 min | `data/training/baseline.json`, `offline.graceMs` |
| Teto do "fora" | 21 dias | `data/training/baseline.json`, `offline.maxAwayMs` |
| Teto de gasto — Free / Premium | 6 h / 12 h | `data/training/baseline.json`, `offline.spendCapMs` |
| Divisor do escudo | 4 | `data/training/baseline.json`, `offline.shieldingDivisor` |
| O livro (skill, tipo, divisor) | sword/axe/club `attacks` ÷ 2, distance `attacks` ÷ 4, magic `mana` | `data/training/baseline.json`, `offline.skills` |
| Cargas por exercise weapon | 500 / 1 800 / 14 400 | `data/items/generated/exercise-weapons.json`, `charges` |
| Skill da exercise weapon | `exercise.skillId` | idem |
| Preço da exercise weapon | o menor `buy` de NPC do Canary | idem, `buyPrice` (só com `purchasable: true`) |

Todo número do Canary cita a fonte (`exercise_training_weapons.lua`, `offline_training.lua`,
`player.cpp`, `items.xml`) no `_open` do `baseline.json` e nos comentários do código.

## Em aberto

Nenhum `[ABERTO]` do PRD atinge este sistema. A captura do Huntera **não registra** treino,
exercise weapon nem offline training (zero ocorrências em `docs/reference/huntera-observed.md`,
2026-09-25): vale o que o ADR 0059 deriva do Canary, até uma captura mostrar outra coisa.

## Divergências do PRD e do Tibia

- **Os Trainer Monks saíram** (ADR 0045 d.4): o PRD §11 previa dois monges que atacavam sem dano
  efetivo. O Tibia 13.x treina com exercise weapon e offline training, e é isso que existe.
- **Teto de offline training por conta: Free 6 h, Premium 12 h** — a forma do PRD §11.3 e de
  `docs/product/monetization.md`, e não a do Tibia, onde offline training é só Premium. Premium é
  decisão de monetização, não mecânica de caça (ADR 0037 d.2 não a cobre). O **banco** continua com
  teto 12 h para todos, como o Canary.
- **O banco só cresce por tempo de hunt e de treino** (ADR 0059 d.3). O Canary também o reabastece
  a cada `Player::onThink` online e, no login, soma o tempo deslogado inteiro quando nenhuma skill
  está escolhida e devolve o `remainder` quando está (`offline_training.lua`); aqui nada disso
  acontece — o banco é dado pela hunt e pelo Treino, e o tempo não gasto fica nele. O tempo de mundo
  (ADR 0060 d.14c) entra com o mundo aberto.
- **O "fora" é o repouso**, medido pelo carimbo do diretório (ADR 0060 d.14c): o tempo na Cidade
  com o jogador conectado NÃO conta. Sem carimbo (Redis reiniciado, queda sem `release`), o banco
  não é gasto naquele login — o lado seguro, que nunca perde tempo do jogador.
- **Exercise wraps de fist e as weapons de 50 cargas de treino** ficam fora do corte (Monk é
  pós-13.32, ADR 0038 d.5; as de 50 cargas não são vendidas).
- **O treino desanexado continua** (invariante 3): no Canary o exercise training para no logout;
  aqui a sessão de Treino sobrevive ao navegador fechado, como a hunt, e acaba sozinha quando a
  arma acaba.
- **Exercise dummy só o livre** (rate 100): os bonecos de casa (110) dependem do sistema de casas,
  fora do ADR 0060 d.15.
