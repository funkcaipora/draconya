# 0060 — Mundo aberto do Tibia sem PvP: um mundo é uma sessão, nascida da Cidade de Thais; a hunt idle vira o adicional instanciado

**Status:** aceito — direção do dono em 2026-09-29; quatro das cinco questões respondidas pelo dono em 2026-09-30 (ver "Respostas do dono"), e a da economia segue o default proposto. Substitui o [ADR 0004](0004-city-as-protect-zone.md) e emenda os ADRs 0001, 0003, 0009, 0018, 0023, 0024, 0025, 0027, 0037, 0042, 0043, 0047, 0052, 0054, 0055, 0056, 0058 e 0059 (lista na decisão 16).
**Data:** 2026-09-29; revisto em 2026-09-30, depois da crítica.
**Contexto técnico:**
- `packages/sim`: `rulesets/hunt.ts`, `rulesets/city.ts`, `session.ts`, `schedule.ts`, `fields.ts`, `movement.ts`, `combat/`, `monster/`
- `packages/server`: `game/host.ts`, `game/sessions.ts`, `game/transitions.ts`, `game/aoi.ts`, `game/viewer.ts`, `receipts.ts`, `jobs/ledger.ts`, `api/tickets.ts`, `api/friends.ts`, `directory.ts`, `tickets.ts`, `db/schema.ts`
- `packages/protocol`: `types.ts`, `messages.ts`
- `packages/content`: `data/maps/`, `data/monsters/`, `data/worlds/` (a criar)
- `packages/client`: `shell/`, `world/`, `friends/`
- `scripts/`: `import-map.ts`, `catalog/`, `world-*.ts`
- `packages/tools/src/bench/`

**Issues:** OW-01 a OW-66, nos marcos M47 a M51. A ordem e as dependências estão em `docs/open-world-plan.md`.

Convenção das citações: `caminho:linha` sem prefixo é da `origin/tibia-parity` em `733a4e0c`; `canary/` é `things/sources/canary` (git `47dfd51`); `tfs/` é `things/sources/forgottenserver`.

## Contexto

A direção do dono, em 2026-09-29, literal: *“o jogo deve ser igual o tibia, mundo aberto sem pvp mas com hunts. E com adicional das hunts idle afk”*.

Continuam de pé três decisões anteriores:
- tudo como TFS/Canary, exceto a barra de ações e a automação (ADR 0037);
- o que o Canary não responde se resolve pelo Huntera (`docs/reference/huntera-observed.md`);
- a automação é legítima (invariante 11).

Somada a elas, a direção nova inverte a tese escrita do repositório:
- **ADR 0004.** Fez da Cidade o único espaço compartilhado, inerte de propósito (0004:21-25), e descartou o mundo aberto com combate (0004:29-31).
- **`docs/architecture.md:504-508`.** Põe “mundo aberto persistente e contínuo” em “Não dá sem trocar a arquitetura”.
- **ADR 0037.** Guardou “sessão instanciada” entre as exceções à fidelidade (0037:37-38) e recusou “mundo persistente, spawn compartilhado” (0037:81-83).
- **`docs/product/hunt.md:11`.** Abre com “Hunts são instâncias isoladas”.

Este ADR é a troca de arquitetura que esses textos exigiam.

### O que o Tibia é

- **Um mundo, um tipo.** Há um `Game` por mundo (`canary/src/game/game.hpp:95`) e um tipo de mundo só (`game.hpp:927`).
- **No-pvp é regra, não ausência de código.** `no-pvp` é um valor de configuração (`canary/src/canary_server.cpp:319-335`) que vira uma regra no portão de combate (`canary/src/creatures/combat/combat.cpp:551-565`).
- **Zonas são flags por tile do OTBM.** Bits em `canary/src/io/io_definitions.hpp:73-76`, leitura em `canary/src/io/iomap.cpp:165-177`, precedência em `canary/src/items/tile.hpp:188-199`.
- **Monstro ocioso não pensa.** O que está no spawn sai da lista de pensamento (`canary/src/creatures/monsters/monster.cpp:1499-1519, 1540-1555`) e acorda quando alguém entra na visão (`monster.cpp:788-806`).
- **Monstro não hostil nunca ataca.** Ele segue e foge (`monster.cpp:1460-1461, 1491-1496, 2095-2105`).
- **Fechar o cliente não tira o personagem do mundo** (`canary/src/server/network/protocol/protocolgame.cpp:918-933`):
  - ele sai aos 60 s sem pong, se `canLogout` deixar (`canary/src/creatures/players/player.cpp:2321-2338, 6960-6979`);
  - o idle kick o remove em 15 + 1 min (`player.cpp:8636-8647`; `canary/config.lua.dist:477`).
- **Morte.** Morrer manda ao templo, à tela de relogin e para fora do mundo (`player.cpp:4034-4041, 4226-4252`).
- **Relogin.** Relogar volta ao tile de onde se saiu (`player.cpp:12332-12336`), com 10 s de proteção (`protocolgame.cpp:1066`; `config.lua.dist:54`).
- **Mundo cheio.** Quem chega entra numa fila (`protocolgame.cpp:1005-1008`).
- **Save.** O jogador é salvo de hora em hora e no logout (`config.lua.dist:356-362`). O save global das 06:00 reinicia o servidor (`config.lua.dist:549-555`).

### O que o Draconya já tem e serve

- **Um espaço compartilhado com o mapa real.**
  - A Cidade é um shard (ADR 0023): `shared: true`, `hz: () => 0` (`packages/sim/src/rulesets/city.ts:120, 124`), até 200 por cópia (`packages/server/src/game/sessions.ts:70`), com AOI por célula.
  - Ela roda sobre `packages/content/data/maps/thais.json`, cujo `source.region` é x 32275–32458, y 32153–32291, z 4–7.
  - O `entryPoint` (94, 88, 7) somado à origem dá (32369, 32241, 7), que é o templo de Thais.
  - O `Tilemap` guarda `source` (`packages/content/src/map.ts:60`).
- **O motor do Tibia numa classe.** Combate, IA, spawner (ADR 0039), campos, cadáveres e ocupação estão em `HuntRuleset` (`packages/sim/src/rulesets/hunt.ts:1703`, 11.794 linhas).
- **O conteúdo da região.** Contagens sobre `canary/data-otservbr-global/world/otservbr-monster.xml` (83.286 entradas):
  - **z 4–7 do recorte:** 67 pontos de spawn, de 13 espécies: 21 Snake, 12 Wolf, 5 Deer, 5 Skunk, 4 Rabbit, 4 Horse, 4 Sheep, 3 Pig, 3 Brown Horse, 3 Chicken, 1 Bat, 1 Cat e 1 Dog;
  - **z 8 do recorte:** mais 126 pontos, entre eles 72 Rat e 30 Cave Rat;
  - **caixa x 32200–32560, y 32100–32350, todos os andares:** 1.267 pontos de 56 espécies.
- **As 13 espécies existem no catálogo.**
  - A `brown-horse` tem nome de exibição “Horse”, como no Canary (`packages/content/data/monsters/generated/mammals.json:310-311`).
  - O importador resolve pelo nome registrado, que vira o id (`scripts/catalog/spawns.ts:101-102, 177-178`).
  - Nenhum recorte de hunt cai nessa caixa.

### O que falta, medido no código

**Sessão = party.** `HuntRuleset` trata os participantes como uma party:
- todo participante leva o abate (`hunt.ts:9913`);
- a elegibilidade é “todos” (`hunt.ts:9915-9917`);
- o loot vai a um sorteado (`hunt.ts:10504-10513`);
- a sessão acaba quando esvazia (`hunt.ts:2985-2988`);
- a liderança segue `participants[0]` (`hunt.ts:2990-2996`).

`session.participants` aparece 125 vezes no arquivo.

**Monstro nunca dorme.**
- A decisão ociosa existe (`hunt.ts:7802`), mas o `MONSTER_STEP` é reagendado sempre (`hunt.ts:7819-7824`).
- Defesa, troca de alvo e invocação continuam vencendo em silêncio (`hunt.ts:3952-3955, 8342-8349, 8405-8412`).
- Cada decisão varre todos os participantes (`packages/sim/src/monster/monster.ts:830-835`).
- Cancelar um evento reconstrói o heap (`packages/sim/src/schedule.ts:145-179`), e o empate é resolvido pela ordem de inserção.

**Criatura passiva não existe.**
- 28 dos 67 pontos de z 4–7, e 62 dos 1.267 da caixa, são de espécies `hostile = false` (por exemplo, `canary/data-otservbr-global/monster/mammals/deer.lua:49`).
- O schema tem `runOnHealth` (`packages/content/src/schemas.ts:2679`), mas não tem `hostile`.
- Todo monstro que não é invocação é alvo e atacante (`hunt.ts:4096`).
- No mundo, coelho e ovelha perseguiriam o jogador.

**Os extratos não têm ordem.**
- A chave `receipt:{sessionId}:{characterId}` é sobrescrita por `SET` (`packages/server/src/receipts.ts:215, 242`).
- A varredura aplica na ordem do `SCAN` (`receipts.ts:284-302`); o ticket, na ordem do `SMEMBERS` (`receipts.ts:263-264`).
- Onze campos são absolutos e última-escrita-vence: `ammo`, alma, estoques, comida, charms, bênçãos e postura (`packages/server/src/jobs/ledger.ts:228-261`), mais equipamento, layout, overlays e storages (`ledger.ts:303-324`).
- Só stamina e skills têm guarda de instante (`ledger.ts:192-196, 212-214`), e a guarda das skills supõe que as sessões de um personagem terminam em ordem.
- `remove` não recebe `seq` (`receipts.ts:308-316`).

**Dois canais de gold.**
- A hunt credita o `goldDelta` e o agregado juntos (`hunt.ts:10617-10618`) e liquida o delta ao gravar o extrato (`packages/server/src/game/host.ts:4596-4598`).
- O shard põe só o `goldDelta` no extrato, porque o agregado dele é cumulativo (`host.ts:1876-1882, 4627-4632`).
- O hospedeiro escolhe o caminho por `ruleset.shared` em onze lugares (`host.ts:1310, 1511, 1891, 2527, 2550, 3917, 4159, 4223, 4289, 4434, 4687`).

**Vida, mana e condições não persistem.**
- `characters` não tem as colunas (`packages/server/src/db/schema.ts:102-262`).
- O personagem do ticket nasce cheio (`packages/server/src/game/sessions.ts:253, 265-266`).
- A Cidade cura na entrada (`city.ts:126-130`).

**O shard não guarda progresso.** Ver 0023:39-41 e `host.ts:4687`; o extrato de `leave` é descartado em `host.ts:4223-4226`.

**A AOI é cega para tudo que não é jogador.**
- Ela só conhece jogadores e ignora o andar (`packages/server/src/game/aoi.ts:80`).
- Registra sozinha um id desconhecido (`aoi.ts:137-139`).
- Monstro, golpe e efeito vão para todo visualizador (`host.ts:3122-3130, 3158-3194, 3399-3400`).
- Cada mensagem é codificada uma vez por visualizador (`packages/server/src/game/viewer.ts:87-95`), e 512 mensagens na fila derrubam a conexão (`viewer.ts:36`).
- No templo de Thais medimos 291 vizinhos por jogador (`docs/product/city.md:174`).

**O campo não tem dono.** `TileFieldState` não guarda quem o lançou (`packages/sim/src/fields.ts:28-64`) e o campo atinge todo participante que está sobre ele (`hunt.ts:6850-6861`). O fire field de um membro já fere a própria party.

**Não há geometria de mundo no servidor** (ADR 0047:34-36). O `Tilemap` é denso por andar (`map.ts:17-38`), e fora do recorte tudo é parede (`map.ts:200-205`).

**Presença.**
- Na Cidade, a sessão é recolhida depois de 5 min sem visualizador (`host.ts:1072, 4328`).
- O `logout` não passa por portão nenhum (`host.ts:1491-1497`).
- Toda sessão que acaba devolve o personagem à Cidade, com ou sem alguém olhando (`host.ts:4081-4089`).

**O conteúdo é carregado uma vez por processo** (`packages/server/src/main.ts:96-97, 111-116`). Sem reinício, nenhuma sessão nova ganha uma versão mais nova.

### Três desenhos, três juízes

Foram avaliados três desenhos:
- **(a)** regiões como sessões, cortadas em superfície/subsolo e em teleporte;
- **(b)** um mundo por processo, com ativação por setor;
- **(c)** Thais primeiro, crescendo.

Dois juízes escolheram (c) como caminho, e os três apontaram (b) como destino: é a topologia do Canary e a única que mantém o invariante 9 sem migrar estado quente entre nós. Este ADR adota (b) como forma final, (c) como ordem, e enxerta pedaços de (a).

### Custo, derivado e ainda não medido

**CPU de monstro.** A bench de combate dá 57,9 µs por tick de 40 monstros a 1 Hz (`docs/product/combat-conformance.md:360-363`), cerca de 1,45 µs por monstro acordado por segundo simulado.

| Cenário | Custo estimado |
|---|---|
| Os 67 monstros de Thais | ~0,1 ms/s |
| A caixa de 1.267, toda acordada | ~1,8 ms/s |
| O mundo inteiro acordado | ~120 ms/s |

A dormência é obrigatória antes do continente, não antes de Thais.

**Hunts no mesmo processo.** As hunts idle dividem com o mundo o mesmo ciclo de 100 ms (`host.ts:2922-2945`) e as pausas de GC de 100–195 ms (`docs/technical-architecture.md:413`).

**Checkpoint.** Com 200 personagens caçando:

| Cadência | Transações/s | Linhas de ledger por dia, por mundo |
|---|---|---|
| 10 s | 20 | 1,73 M |
| 60 s | 3,3 | até 288 mil |

**Leque de saída.** É o gargalo provável: 0,5–1,5 KB/s por jogador anexado (`docs/architecture.md:263`), mais a multidão no templo.

Todo número será medido na arquitetura de destino (ADR 0013:41-45).

## Decisão

### 1. O Draconya é o mundo aberto do Tibia, tipo `no-pvp`; a hunt idle é o adicional

- Este ADR substitui o ADR 0004.
- O tipo de mundo fica no conteúdo do mundo (`data/worlds/<id>.json`, a criar), como o `worldType` do Canary (`canary/config.lua.dist:28-33`).
- A hunt idle continua instanciada **por escolha de produto**, não como exceção de arquitetura. A emenda ao ADR 0037 d.2 tira “sessão instanciada” da lista de exceções e, para o mundo, reverte a alternativa recusada em 0037:81-83.
- Barra de ações e automação continuam do Draconya.
- A regra para mecânica: Canary; o que ele não responde, Huntera; o que nenhum dos dois responde, o dono.

### 2. Um mundo é uma sessão compartilhada, com relógio, num processo `game`; o personagem pertence a um mundo

**a. Um mundo, uma sessão.**
- `SessionType` ganha `'world'` (`packages/sim/src/session.ts:111`).
- O mundo é escolhido na criação do personagem e fica em `characters.world_id`, como no Tibia.
- Para caber mais gente, cria-se outro mundo (outro `data/worlds/<id>.json`) e mais nós de instância. Um mundo nunca é repartido por geografia.
- É proibido cortar em z 7/8: do subsolo se veem ±2 andares (`canary/src/creatures/creature.cpp:76-81`; `canary/src/map/spectators.cpp:126-128`).
- Se um dia for preciso repartir, só numa viagem de barco ou tapete, que no Canary é `teleportTo` (`canary/data/npclib/npc_system/modules.lua:198-247`).
- Mundo espalhado entre nós, com estado no Redis, continua recusado (0023:128-130).

**b. O teto vale só na entrada.**
- O `capacity` do mundo limita quem entra vindo do repouso.
- Quem volta de uma instância é sempre admitido, porque já estava no mundo.
- Mundo cheio responde como a fila do Canary, com posição e tempo para tentar de novo (`canary/src/server/network/protocol/protocolgame.cpp:1005-1008`), e oferece entrar direto numa hunt idle (decisão 6b).
- Nunca se abre “Thais 2”.
- O teto começa em 200 (`CITY_SHARD_CAPACITY`, `packages/server/src/game/sessions.ts:70`) e o `bench:world` o fixa (decisão 11).

**c. Enquanto houver um nó só** (`compose.coolify.yml`, um `app`):
- mundo e hunts idle dividem o processo;
- ir do mundo para a hunt é um `directory.succeed` no mesmo nó (`packages/server/src/directory.ts:98-105`);
- até existir a trava da decisão 13, `OPEN_WORLD` só liga com um processo `game`.

### 3. O mundo nasce da Cidade de Thais e cresce; o destino é o mapa inteiro em setores

**a. Agora.**
- O shard da Cidade vira o primeiro mundo, sobre `thais.json`, desenhado pelo `instance-enter.map` de hoje (`packages/protocol/src/types.ts:754-760`), atrás da flag `OPEN_WORLD`.
- `CityShard` e o ruleset de Cidade ficam como volta atrás até o mundo cobrir todo serviço de Cidade. Então saem.

**b. A coordenada persistida é absoluta desde o primeiro dia.**
- `characters.world_x/y/z` guarda coordenada do Tibia.
- A sessão traduz pelo `source.region` do recorte (`map.ts:60`).
- Ir para o mapa em setores não migra dado persistido (ADR 0014).

**c. Crescer exige escadas derivadas.**
- Antes da região ampliada, os recortes passam a derivar `floorChanges`, escadas de mão e pontos de corda da regra de `pnpm map:links` (ADR 0025, emenda #663, 0025:355-365).
- A derivação tem de reproduzir as 92 escadas de Thais e os 4 conectores da Dragon Lair.
- Passa a existir UMA regra de caminhabilidade; hoje são duas (`scripts/world-links.ts:115-119`; `scripts/import-map.ts:157-173`).
- Depois vêm z 8 (os esgotos) e a caixa de 1.267 spawns.
- As bordas são escolhidas por ferramenta, em barreira natural, porque borda de recorte é parede invisível (`map.ts:200-205`).

**d. Ferramenta de andar como no Canary, só no mundo.**
- Ponto de corda exige corda; buraco fechado exige pá. As duas se usam por `use-item` no tile (ADR 0049, ADR 0050).
- A hunt idle mantém a abstração de `docs/tibia-math-plan.md:122`.

**e. O continente.**
- Geometria de servidor em setores de 32×32 (ADR 0047, fase 6).
- O artefato fica fora do repositório, fixado por sha256 e fora do `computeVersion`.
- Protocolo em coordenada absoluta (`world-enter`); cliente em `createWorldScene`.
- Terá ADR próprio: o ADR 0025:114-116 só justificou versionar recortes. Servir o artefato é da classe de risco que o ADR 0025 d.2 (0025:58-60) já aceitou.
- Depende da resposta do dono sobre o escopo (pergunta 4 do plano).

O recorte é caminho, não destino: “Thais 2” e regiões com sessão própria ficam descartados.

### 4. O mundo é o `HuntRuleset` com uma costura de topologia

Extrair de `HuntRuleset` uma `SessionTopology` com exatamente o que hoje supõe sessão = party:
- crédito do abate (`hunt.ts:9913`);
- elegibilidade (`hunt.ts:9915-9917`);
- destinatário do loot (`hunt.ts:10504-10513`);
- fim quando vazia (`hunt.ts:2985-2988`);
- liderança (`hunt.ts:2990-2996`);
- início do spawn e das regras de saída com o primeiro corredor (`hunt.ts:2902-2912`);
- morte (`hunt.ts:3280-3363`);
- queima de stamina por tempo (`hunt.ts:3196-3214`);
- colocação na entrada e o walker de rota.

**A topologia `instance`** é a de hoje, byte a byte. Portões: as sequências do FUN-63, 1 Hz = 10 Hz (`docs/product/hunt.md:692-706`) e o `bench:hunts`.

**A topologia `world`:**
- nunca termina;
- não tem rota, regra de saída nem líder;
- entra na posição salva, ou no templo, por `placeReachable` (`packages/sim/src/movement.ts:355`, o padrão de `city.ts:152-161`);
- anda pelo relógio lógico e com a velocidade do Tibia, não pelo relógio do processo de `#requestWalk` (`host.ts:1807`);
- aceita as intenções de serviço de Cidade (ADR 0052 d.2) só em tile PZ.

A extração completa do núcleo fica para a fase do continente, em cinco partes. É dívida registrada.

### 5. Relógio fixo a 10 Hz; monstro ocioso dorme só no mundo, com todas as fases preservadas

O mundo roda a 10 Hz com ou sem visualizador: é conteúdo em que o personagem é vulnerável (ADR 0003:27-32), e desde o ADR 0020 `hz` só agrupa trabalho.

No mundo, um índice de espectadores no `sim` decide a dormência. Ele usa setores de 16 (`canary/src/map/map_const.hpp:23`), segue a regra de andares de `creature.cpp:68-87` e é mantido pelos eventos de posição.

**a. Dormir.**
- Dorme o monstro que não é invocação e decide `idle`: sem alvo, sem condição, no spawn e sem ninguém à vista (`packages/sim/src/monster/monster.ts:889-897`).
- Ao dormir, TODO evento próprio pendente é cancelado: passo, ataque, habilidade, defesa, invocação, troca de alvo e dança (`hunt.ts:153-225`).
- Para cada tipo, o `sim` guarda o último vencimento e a cadência.
- Cancelar não muda o RNG:
  - hoje o monstro reagenda o passo (`hunt.ts:7819-7824`) e os outros timers vencem calados (`hunt.ts:3952-3955, 8342-8349, 8405-8412`);
  - o ramo ocioso retorna antes de qualquer sorteio (`monster.ts:889-897`).

**b. Acordar.**
- O predicado é o MESMO que a decisão usa: `anyInView` sobre personagens e invocações (`monster.ts:830-835`).
- O índice o avalia quando um personagem ou invocação muda de posição, entra, é colocado ou teleporta.
- Dano e condição também acordam.
- Cada timer volta no primeiro instante da SUA grade (último vencimento + k × cadência) em que o evento ainda não teria sido despachado quando o evento que acordou roda.

**c. Desempate que não depende da inserção, só no mundo.**
- A fila do mundo ordena por `(dueAtMs, priority, subject, kind)` e só depois por `seq`.
- A da instância continua `(dueAtMs, priority, seq)`, byte a byte.
- Sem isso, o timer reinserido ao acordar ganharia um `seq` novo e trocaria de lugar com outro evento do mesmo instante.

**d. Portão de merge.** O mesmo roteiro, rodado com dormência e com todo monstro forçado ativo (o `monsterPerfTestForceActive` do Canary, `canary/src/creatures/monsters/monster.cpp:1521-1538`), tem de dar o mesmo fluxo de eventos de domínio, os mesmos agregados e as mesmas posições, a 1 Hz e a 10 Hz.

**O que não muda e o que fica para depois:**
- A hunt idle não muda e não precisa de nova linha de base. Levar a dormência a ela é outra decisão.
- O monstro dormente continua materializado. Virar registro `{slot, hp}` só se o `bench:world` pedir memória.
- A fila ganha cancelamento preguiçoso sem mudar a ordem.
  - **Só acima de 1.024 eventos, que é o mundo (#827).** O índice de pares custa ~100 bytes por par e um acesso a `Map` por evento; ligado também na hunt, o `bench:hunts` mediu +12% de memória por sessão e +25% a +50% no custo da própria fila, sem ganho, porque uma hunt cancela pouco. A fila pequena remove direto e fica como era.
  - A "geração" do par é o próprio `seq`: cancelar grava no slot o próximo `seq`, e o evento com `seq` menor é lápide. O evento não ganha campo.
  - `docs/product/hunt.md`, seção "A fila por dentro".
- `MAX_EVENTS_PER_ADVANCE` (`session.ts:71`) e `MAX_PENDING_DOMAIN_EVENTS` (`session.ts:42`) viram limites por sessão.
- `notableEvents` (`session.ts:788-794`) é limitado no mundo.

### 6. Estados e transições (invariante 8)

Um personagem está sempre em um de três estados:
- **em repouso:** sem sessão e sem registro no diretório. Existe só na linha de `characters`, com mundo, posição absoluta, cidade, vida, mana e condições;
- **na sessão do seu mundo;**
- **em exatamente uma sessão instanciada.**

`ALLOWED` (`packages/server/src/game/transitions.ts:24-31`) põe `'world'` no centro. `'city'` continua valendo enquanto a flag existir (ADR 0014).

O mecanismo é o de hoje:
- o destino é construído antes (`host.ts:4149`);
- a trava `#transitions` impede duas transições ao mesmo tempo (`host.ts:4126-4138`);
- `directory.succeed` troca o registro atomicamente;
- o `CharacterRuntime` é o mesmo objeto (`sessions.ts:401`).

**a. Mundo → instância.**
- Só quando o Tibia deixaria deslogar, isto é, quando `canLogout` passa (`player.cpp:6960-6979`; `IN_FIGHT_WINDOW_MS` em `packages/sim/src/combat/in-fight.ts:30`):

  | Tile | Pode entrar numa instância? |
  |---|---|
  | PZ | sempre |
  | no-logout | nunca |
  | qualquer outro | só sem luta |

- É o que impede fugir de uma luta para dentro de uma instância.
- A entrada continua pelo menu (o ADR 0025 recusou portal). A posição de saída vira a âncora.

**b. Repouso → instância, direto.**
- Ao entrar no jogo, o menu oferece o mundo ou uma hunt idle.
- Entrar direto numa hunt idle cria a primeira sessão sem passar pelo mundo.
- É o que mantém a base econômica acessível com o mundo cheio, fora do ar ou atrás da flag.

**c. Instância → mundo, só com alguém olhando.**

| No fim, morte ou drenagem da instância | Vai para | Posição |
|---|---|---|
| Com visualizador (`#watchers`, `host.ts:4373-4377`) | sessão do mundo | âncora; templo na morte |
| Sem visualizador | repouso | âncora; templo na morte |

- Ninguém é posto no mundo desassistido, onde nada o tiraria de uma luta. Hoje toda sessão que acaba volta à Cidade, assistida ou não (`host.ts:4081-4089`).
- O templo na morte segue `player.cpp:4041`.
- Vida e mana são as da volta; na morte, cheias (`player.cpp:4226-4235`).
- Tile inutilizável cai no templo (`protocolgame.cpp:1056`).
- Qualquer chegada ao mundo com zero visualizadores (uma corrida entre a desconexão e a chegada) submete `presence-lost` na hora da chegada (decisão 7).

**d. Morrer no mundo leva ao repouso**, no templo (decisão 9).

### 7. Presença como no Tibia

**Logout.**
- A intenção `logout` (existe: `types.ts:214`) passa por `canLogout`.
- A recusa volta com o motivo do Canary (`protocolgame.cpp:1151-1162`) numa mensagem nova, `logout-refused`.

**Perda de conexão.** Quando o último visualizador de um personagem se solta, ou quando ele chega ao mundo sem visualizador, o hospedeiro entrega ao `sim` uma intenção de servidor `presence-lost` no instante lógico. Ao reanexar, entrega `presence-restored`. No `sim`, `presence-lost` faz:
- o alvo é solto na hora (`player.cpp:2323-2325`);
- o personagem fica parado e vulnerável (ADR 0001:17-20) e a automação dele para;
- aos 60 s ele tenta sair por `canLogout` (`player.cpp:2327-2334`);
- se a luta impede, uma nova tentativa é agendada para quando a janela de luta vence. É um evento, não uma varredura.

Canary e TFS divergem aqui, e ficamos com uma combinação:
- o Canary tenta uma vez e deixa o idle kick resolver (`player.cpp:2335-2337`);
- o TFS derruba mesmo em luta (`tfs/src/player.cpp:895-908`);
- fica o `canLogout` do Canary, mais o “sai quando a luta acaba” do Tibia, com o idle kick como teto.

**Saída.** Toda saída (logout, x-log, morte, idle kick) grava o checkpoint e solta o personagem para o repouso, com a posição. `#collectResting` (`host.ts:4328`) não vale para o mundo.

**Idle kick.**
- Aviso aos 15 min e remoção aos 16 (`player.cpp:8636-8647`; `config.lua.dist:477`).
- Contado só por intenção do cliente, sujeito à pergunta 1 do plano.

O AFK mora na hunt idle.

### 8. No-PvP no portão de combate do `sim`; criatura passiva existe

**O portão.** Um `canDoCombat(atacante, alvo, zonas)` explícito, copiado do Canary (`combat.cpp:551-565`; `isInPvpZone` em `combat.cpp:428-430`; o mesmo no TFS, `tfs/src/combat.cpp:356-370`). Regras:
- jogador, ou invocação de jogador, nunca atinge jogador nem invocação de jogador;
- PZ recusa combate para dentro e para fora (`combat.cpp:326-345, 398-400`);
- forma agressiva em área pula jogador.

**Campo de jogador.**
- Campo lançado por jogador vira a variante que não fere jogador; magic wall e wild growth viram as seguras (`combat.cpp:1207-1218, 2594-2640`).
- O portão final está em `canary/src/creatures/combat/condition.cpp:2015-2020`.
- Isso exige dono no `TileFieldState`. A peça entra já, como correção de paridade da party hunt.

**O que o no-pvp não tem e o que ele garante.**
- Sem caveira e sem frag (`player.cpp:7123-7126`).
- Monstro só dá in-fight, nunca pz-lock (`player.cpp:4487-4503` contra `player.cpp:6468-6520`), então sempre se pode fugir para a PZ.
- Monstro não pisa PZ, escada nem teleporte (`canary/src/items/tile.cpp:716-719`).

**Zonas.** Entram como camada `zones` por andar, lida de `TILE_FLAGS`, revertendo o ADR 0025 d.9 (0025:100-104). Tile de arena (`PVPZONE`) é tratado como no-pvp no primeiro corte; é divergência registrada.

**Criatura passiva.**
- Monstro não hostil (`hostile = false`) segue o alvo, foge abaixo de `runOnHealth` e nunca ataca (`monster.cpp:1460-1461, 1491-1496, 2095-2105`).
- O campo entra no catálogo pelo importador (ADR 0038) e vale em toda sessão, porque é correção de paridade.
- Isso muda as hunts que têm dog, pig e rabbit (Minotaur Camp e Rat Cellars), com estágio declarado no perfil de combate (ADR 0031, ADR 0040).

**Atravessar jogador** (`player.cpp:1446-1482`) vem no M50. Até lá valem o tile exclusivo (ADR 0023) e o empurrão.

### 9. Recompensa e morte como no Canary

**XP.** A do abate é repartida pela fatia de dano de cada atacante (`creature.cpp:604-657, 1168-1193`).

**Cadáver.**
- É de quem mais causou dano dentro da janela de 60 s (`creature.cpp:623-626`; `monster.cpp:3305-3318`).
- No M49, só o dono o abre, até o primeiro decaimento, que apaga o dono (`canary/src/items/item.cpp:822-824`).
- A party do dono passa a abrir quando a party de mundo existir (`player.cpp:1379-1381`; OW-43).
- O loot do cadáver (ADR 0048) é creditado a quem o pega. Não há transferência entre personagens.

**Morte no mundo.** O Canary põe o jogador no templo, mostra a tela de relogin e o tira do mundo (`player.cpp:4034-4041, 4226-4252`). No Draconya, a mesma sequência:
1. aplica-se a penalidade do ADR 0042;
2. vida e mana voltam cheias;
3. o `sim` emite a saída com motivo `death` e posição no templo;
4. o hospedeiro grava o checkpoint e solta o personagem para o repouso;
5. o cliente mostra a tela de morte com “entrar de novo”, que pede um ticket novo e coloca o personagem no templo.

**Proteção de login.** São 10 s, e valem em TODA colocação no mundo (`protocolgame.cpp:1066`; `config.lua.dist:54`).

**Item perdido.** Continua destruído (ADR 0042 d.4) enquanto não existir item no chão.

### 10. Durabilidade: sem snapshot do mundo; checkpoint por personagem, em lote, a cada 60 s; ordem garantida por versão

**a. Sem snapshot.**
- O mundo não tem snapshot (fica como em `host.ts:4684-4687`).
- Monstros, cadáveres e campos são efêmeros e renascem dos spawns, como no Canary.

**b. Separar os sentidos de `Ruleset.shared`** (`session.ts:238-248`).
- `shared` passa a dizer só “sair é `leave`”.
- `progress: 'none' | 'checkpointed'` diz se a sessão credita.
- `Session.checkpoint(characterId, reason)` emite o extrato (`session.ts:643-656`) e zera os agregados daquele personagem, com a semântica de delta de `leave` (`session.ts:517-531`).

**c. Um canal de gold por sessão.**

| Sessão | Canal de gold |
|---|---|
| Que credita (privada, ou `checkpointed`) | agregado e `goldDelta` juntos, como a hunt (`hunt.ts:10617-10618`); o delta é liquidado logo depois de gravar o extrato (`host.ts:4596-4598`) |
| Que não credita (a Cidade) | o `goldDelta` vai como agregado do extrato de estado (`host.ts:4627-4632, 4671-4673`) |

- Nunca os dois.
- Os onze ramos de `ruleset.shared` do hospedeiro passam a ler predicados nomeados. A auditoria vai na PR (OW-04).

**d. Cadência e custo.**
- A cada 60 s (`WORLD_CHECKPOINT_MS`), e em saída, transição, morte e drenagem, sai um lote com todo personagem sujo.
- Cada linha do lote é o extrato inteiro de `#persistReceipt` (`host.ts:4499`), mais posição, cidade, vida, mana e condições.
- O lote é gravado num `MULTI` só, que é atômico no Redis.
- Saída e transição antecipam o lote inteiro, não só a linha de quem sai.
- Linha sem valor movido (sem XP, gold, item, abate nem morte) não cria linha de ledger. Leva só estado absoluto, idempotente pela versão (item e).
- Com 200 personagens caçando, isso dá até 3,3 transações/s e até 288 mil linhas de ledger por dia por mundo; a 10 s seriam 20/s e 1,73 M/dia.
- Numa queda, o mundo perde até 60 s de todos, e todos voltam ao mesmo instante. O Canary salva de hora em hora (`config.lua.dist:356-362`). A hunt idle continua com 10 s (ADR 0018:57).

**e. Ordem por personagem.**
- A chave do extrato passa a levar o `seq`: `receipt:{sessionId}:{characterId}:{seq}`. As chaves antigas continuam lidas por um deploy (`receipts.ts:215-216`). `remove` também passa a receber o `seq`.
- Todo extrato leva `durableVersion`, um contador por personagem mantido no hospedeiro. No ticket ele começa em `max(characters.durable_version, maior versão pendente)`.
- O índice por personagem vira um conjunto ordenado por versão.
- O `jobs` e o ticket liquidam os pendentes de cada personagem em ordem de versão.
- Todo campo absoluto (`ledger.ts:228-261, 303-324`, mais os novos de posição e vitais) só é escrito quando a versão do extrato é maior que `characters.durable_version`, que sobe junto.
- Os deltas (XP, gold, item) continuam protegidos por `UNIQUE(session_id, seq)`.
- A guarda descarta o extrato mais velho por inteiro, e só é correta com duas coisas juntas (revisão do #823):
  - Todo extrato versionado é o estado absoluto inteiro, o de estado da Cidade inclusive, com o estoque vazio explícito.
  - O personagem liquida completo e em ordem, pelo índice e não pelo `SCAN`, e o primeiro extrato que falha segura os seguintes. O dado torto desiste da espera depois de cinco varreduras seguidas e vai ao log.
- O contador do hospedeiro sobrevive ao `release` como piso por dez minutos. O ticket lê a versão no `api` e não vê o extrato que um `release` concorrente ainda grava.

**f. Vitais.** Vida, mana e condições passam a persistir (`characters.health/mana/conditions`) e a viajar no ticket. Ausentes, o personagem nasce cheio, como hoje.

### 11. Apresentação e o portão de produção

**AOI v2.**
- A chave de célula ganha o andar, com a regra de andares do Canary (`spectators.cpp:125-139`).
- Sujeitos (toda criatura, monstro e invocação inclusive) ficam separados de observadores (personagens com visualizador).
- Acaba o registro silencioso de id desconhecido.
- Toda difusão do hospedeiro (`host.ts:3158-3194, 3226, 3399-3400`) e o `session-state` (`host.ts:4740`) passam a ser filtrados.
- `#appearance` passa a descrever monstro (`host.ts:3958`).
- Cada mensagem é serializada uma vez por ciclo; hoje é uma vez por visualizador (`viewer.ts:87-95`).
- Os visualizadores passam a ser indexados por personagem (`#watchers`, `host.ts:4373`).
- A hunt continua com `aoi = null`.

**O `bench:world` é o portão da flag em produção.** Ele mede a topologia real: o mundo com 200 personagens e os spawns de Thais acordados, DENTRO do mesmo processo que N hunts idle desanexadas (a meta de 5.000 frias, `docs/technical-architecture.md:484`), no ciclo único de 100 ms (`host.ts:2922-2945`). Mede:
- o p99 do ciclo;
- as pausas de GC;
- bytes e fila por visualizador, com nenhum chegando a 512;
- a vazão de liquidação do `jobs` no Postgres, comparada à taxa de checkpoint.

### 12. Versão de conteúdo e o save diário

**Versão de conteúdo.**
- O conteúdo é carregado uma vez por processo (`packages/server/src/main.ts:96-97, 111-116`). Só um deploy, que drena com crédito (ADR 0010), traz versão nova.
- O mundo fixa a versão na criação (invariante 7, texto sem mudança).

**O save das 06:00** (`config.lua.dist:549-555`) vira um reinício só do estado EFÊMERO:
- o hospedeiro constrói uma sessão de mundo nova, na MESMA versão;
- move por `succeed`, no mesmo nó, quem tem visualizador, com contagem regressiva no canal de sistema;
- quem está sem visualizador vai ao repouso;
- monstros, cadáveres e campos recomeçam.

**Deploy.**
- O deploy de produção passa a acontecer na janela do save, como o reinício do Canary.
- O staging continua drenando a cada merge (ADR 0022).
- Recarga de conteúdo a quente fica fora deste ADR (decisão 15).

### 13. Uma trava por mundo, quando houver mais de um nó

- Chave `world:{id}:owner`, com TTL de 30 s (`directory.ts:53`), tomada só quando o dono não bate mais (o padrão de `TAKE_OVER_SESSION` em `directory.ts`).
- O ticket de mundo vai ao dono da trava. Hoje `tickets.ts:360-379` escolhe o nó menos carregado.
- A carga passa a ser medida por jogador, não por sessão (`tickets.ts:526-530`; `host.ts:1161-1163`).
- Nós de mundo ficam separados dos de instância, para que a pausa de GC de milhares de hunts não trave quem está no mundo.

### 14. Stamina, “online” e regeneração no mundo

Fica o que a revisão de 2026-09-25 do ADR 0043 decidiu: teto de 720 min, com a recuperação 1:1 provisória e `[ABERTO]` (0043:133-144). Muda só o que conta como “online”.

**a. Consumo no mundo, na forma do Canary.**
- 1 min por minuto em que se ganhou XP de monstro; 2 min se passou um intervalo maior que 60 s (`canary/data/events/scripts/player.lua:98-135, 532-557`).
- Conta no relógio lógico.
- O tempo de Prey corre junto (`player.lua:126-130`), emendando o ADR 0054 d.1 (0054:30-33).

**b. Recuperação só em repouso** (sem sessão), como no Canary, que regenera no login pelo tempo deslogado (`canary/data/scripts/creaturescripts/player/regenerate_stamina.lua:3-28`).
- A PZ do mundo é online.
- Deixa de valer o “Cidade = offline” do ADR 0043 d.2 (0043:52-55) e do ADR 0052 d.6 (0052:81-84).

**c. Treino.**
- O banco de treino offline (ADR 0059 d.3, 0059:43-50) cresce também com o tempo de mundo, como o Canary faz a cada `onThink` online (`canary/src/creatures/players/player.cpp:8653`).
- O “fora” que o banco gasta passa a ser o repouso.
- O Treino de exercise é online, e a stamina não recupera nele (emenda ao ADR 0059 d.1, 0059:35).

**d. Regeneração de vida e mana no mundo.**
- É a da hunt: pulsos por vocação, sem comida (0043:161-163; `hunt.ts:2881-2893, 3233-3266`), PZ inclusive.
- Vale até o dono responder a pergunta 5.

**e. A hunt idle** segue o ADR 0043 como está.

### 15. Fora deste ADR, com o motivo, para não ser reproposto no meio

| Fora | Motivo |
|---|---|
| Casas (993) | leilão, aluguel e `tile_store` formam um subsistema durável sem dono único |
| Raids; spawn de dia/noite e luz | exigem relógio de mundo injetado como dado (`canary/src/creatures/monsters/monsters.cpp:35-45`) |
| Diálogo de NPC (1.036 scripts Lua) e os 1.503 teleportes por script | conteúdo Lua que o Draconya não tem |
| Barco entre regiões | não faz sentido até existir a segunda região |
| Item no chão, troca e cadáver de jogador | o ledger ainda não modela valor entre personagens |
| Liquidação atômica de lote entre personagens | só será necessária quando houver troca ou item no chão |
| Arena PvP | o dono pediu mundo sem PvP |
| Teto global da Forja e monstro influenciado no mundo | o ADR 0056 segue por sessão, na hunt |
| Boss raro com `spawntime` de 14.402 s (17 entradas) | quando uma região os cobrir, o cooldown é escrito pelo dono do mundo e sobrevive ao save |
| Recarga de conteúdo a quente | pede ADR próprio |
| Fronteira contínua entre nós | invariante 9 |

### 16. Emendas, no mesmo commit

| ADR | O que muda |
|---|---|
| 0001 | no mundo, a sessão sobrevive ao socket só até `canLogout` ou o idle kick |
| 0003 | o mundo roda a 10 Hz fixos |
| 0009 | no mundo, andar-até e perseguição de monstro usam A* limitado e com andar (`maxSearchDist` 12, `creature.cpp:1038-1044`, sobre `Map::getPathMatching`, `canary/src/map/map.cpp:1009`); rota e passo guloso seguem na hunt |
| 0018 | o mundo perde até 60 s numa queda |
| 0023 | o shard vira o mundo, com relógio, monstros e checkpoint; 0023:131-133 deixa de valer para ele |
| 0024 | repouso é o personagem deslogado, com posição, cidade e vitais; o recolhimento de 5 min não vale no mundo |
| 0025 d.9 | `TILE_FLAGS` passam a ser importados, e as `floorChanges` dos recortes passam a ser derivadas |
| 0027 | passa a existir party no mundo, além da party de hunt |
| 0037 d.2 | sai “sessão instanciada” da lista de exceções |
| 0042 d.4 | vale até existir item no chão; a morte no mundo segue a tela de relogin |
| 0043 | d.2 e a revisão de 2026-09-25 mudam: o que é offline e a regeneração no mundo |
| 0047 d.6 | a fase 6 começa por este ADR |
| 0052 d.2 e d.6 | serviço em tile PZ do mundo; o “online” inclui o mundo |
| 0054 d.1 | a Prey corre junto com a stamina no mundo |
| 0055 d.4 | a Roda aloca em tile PZ do mundo |
| 0056 | o teto por sessão vale na hunt |
| 0058 d.2 | a tela de aprender magia fica em tile PZ do mundo |
| 0059 d.1 e d.3 | o treino é online; o banco cresce no mundo; o “fora” é o repouso |

Mudam também:
- `AGENTS.md` (introdução e invariantes 3, 8, 9 e 11);
- `docs/architecture.md`, seção “Não dá sem trocar a arquitetura”;
- `docs/world-map-plan.md`, fase 6;
- `docs/tibia-parity-plan.md:69-70`;
- `docs/tibia-math-plan.md:122`.

## Respostas do dono (2026-09-30)

1. **Bot e idle kick no mundo — aceito como proposto.** Com o jogador presente, o bot roda no mundo: targeting, automações da barra de ações (ADR 0032) e a caminhada atrás do alvo mais próximo, sem a rota fixa, que é da hunt idle (ADR 0009). Ao perder a conexão toda automação para e o personagem sai por `canLogout`, como no Canary. Vale o idle kick do Canary (aviso aos 15 min, saída aos 16, `canary/config.lua.dist:477`), contando só intenção do cliente, nunca ação do bot. O AFK de verdade é a hunt idle.
2. **Personagens por conta — aceito como proposto.** Continuam 2 ativos por conta, com no máximo 1 no mundo: um personagem pode estar numa hunt idle enquanto o outro anda no mundo.
3. **Economia entre o mundo e a hunt idle — sem resposta; vale o default.** As mesmas taxas nos dois modos, a stamina como orçamento comum, e onde o mundo crescer sobre um lugar que também é hunt idle, as duas versões coexistem (a hunt idle é a cópia privada). Revisitável até o M50, que é onde a sobreposição aparece.
4. **Até onde vai o mundo — o otservbr INTEIRO.** O dono escolheu o mapa todo, não um conjunto curado de regiões. O destino da decisão 3 deixa de ser "o mapa inteiro um dia" e passa a ser o alvo do M51: a geometria do continente inteiro em setores é servida, e as áreas ainda sem conteúdo (NPC, scripts de teleporte e de quest que o Draconya não tem) ficam FECHADAS por região até ficarem prontas, abrindo uma a uma. Thais continua sendo onde o mundo nasce (M48–M50), porque é onde as regras do mundo se provam com conteúdo que já existe.
5. **Regeneração no mundo — como na hunt, em todo o mundo.** Pulsos por vocação, sem comida, inclusive em tile PZ: o templo não vira lugar de esperar parado (emenda do ADR 0043).

## Alternativas consideradas

- **Regiões como sessões, cortadas em superfície/subsolo e em teleporte.** Descartada.
  - Do subsolo se veem os andares de cima (`creature.cpp:76-81`). Cada escada de caverna viraria troca de diretório, ids novos e estado inteiro.
  - Party (1 andar do líder), item e chat parariam na borda.
  - Num nó de uma thread só (ADR 0005:53-55), as costuras não compram paralelismo.
  - Dela ficam o `enabled` por região e o save diário.
- **O mundo direto no mapa em setores, sem passar por Thais.** Destino certo, ordem errada. O primeiro mundo andável esperaria a fila nova, a extração do núcleo, a geometria em setores, o protocolo absoluto e o cliente em streaming. Como a coordenada persistida é absoluta desde já, o desvio por Thais não custa migração.
- **Crescer só por recortes, com “Thais 2” quando encher.** Descartada: parede invisível para sempre e amigos em cópias diferentes. O Tibia prende o personagem a um mundo.
- **Um `WorldRuleset` novo, ou extrair o núcleo antes.** Descartada: seria reescrever ou refatorar 11.794 linhas antes de qualquer coisa jogável, com a hunt idle no caminho.
- **Uma flag `topology` testada em cada um dos 125 usos de `session.participants`.** Descartada: um uso esquecido dá a estranhos o loot uns dos outros.
- **Dormência sem desempate estável, ou só do passo.** Descartada. O timer reinserido muda de ordem entre eventos do mesmo instante, e defesa e troca de alvo acordariam fora de fase. O portão de equivalência não passaria.
- **Dormência também na hunt idle.** Descartada agora: muda a ordem da fila e o `bench:hunts` sem ganho de produto.
- **Shards de hunt compartilhados, como o Huntera** (`docs/reference/huntera-observed.md:791-801`). Descartada de novo (`huntera-observed.md:803-804`): o resultado da hunt idle não pode depender de quem mais está no mapa.
- **Fim de hunt desanexada volta ao mundo.** Descartada. O personagem chegaria sem visualizador, nunca passaria pela queda que dispara `presence-lost` e morreria sozinho na âncora.
- **Morte no mundo dentro da mesma sessão.** Descartada: diverge da tela de relogin do Canary sem motivo.
- **Manter no mundo o “fechar o navegador é seguro” do ADR 0001.** Descartada: personagem parado para sempre no mundo, disputando spawn, não é o Tibia. O AFK é a hunt idle.
- **O Canary literal, ou o TFS, na perda de conexão.** Descartadas. O Canary deixa o personagem vulnerável até 16 min depois de a luta acabar; o TFS deixa fugir de uma luta fechando o navegador.
- **Checkpoint a cada 10 s, ou um lote liquidado numa transação só.** Descartadas. A 10 s são 20 transações/s e 1,73 M linhas/dia por mundo. A atomicidade entre personagens só servirá quando houver troca ou item no chão.
- **Virada diária com recarga de conteúdo.** Descartada: o conteúdo é do processo (`main.ts:96-97`), e recarga a quente é outro ADR.
- **Snapshot do mundo.** Descartada pelo argumento de 0023:131-133, e porque o estado do mundo é efêmero no Tibia.
- **Mundo entre nós com estado no Redis.** Descartada: viola o invariante 9 (0023:128-130).
- **Recusar a entrada quando o mundo enche.** Descartada. Tiraria a hunt idle, que é a base econômica, de quem chegou depois do 200º.

## Consequências

**Fica possível** o que o dono pediu: andar, caçar e se encontrar num mapa do Tibia, com a mecânica do Canary, e continuar tendo a hunt que roda com o navegador fechado. A hunt continua acessível direto do login. A Cidade deixa de ser caso especial à medida que o mundo a substitui: `hz 0`, `onEvent` que lança, `#collectResting` e o relógio de processo no andar vão embora.

**Fica mais difícil:**
- fechar o navegador em luta passa a ser perigoso, como no Tibia;
- o `HuntRuleset` passa a servir dois donos, e a costura exige os portões de sempre em toda PR;
- o leque de saída vira o gargalo e precisa ser medido antes da flag em produção;
- até o continente, as bordas do recorte são paredes;
- deploy passa a acontecer na janela do save;
- numa queda, o mundo perde até 60 s.

**Economia.**
- O mesmo monstro paga no mundo, onde é disputado e o respawn trava com quem está à vista (`canary/src/creatures/monsters/spawns/spawn_monster.cpp:288-293`).
- E paga na hunt idle, onde todo spawn é só seu (`docs/product/hunt.md:339-355`).
- A stamina é o orçamento comum; o resto é pergunta do dono.

**Durabilidade.**
- Todo extrato ganha versão por personagem, e extrato atrasado nunca desfaz estado mais novo. Isso corrige também a janela Cidade → hunt → Cidade de hoje.
- Vida, mana e condições passam a sobreviver ao logout.

**Custo** (derivado, não medido).
- Thais não pesa.
- O continente sem dormência não cabe.
- O leque de saída e o Postgres são os riscos reais, medidos pelo `bench:world` no destino.

**Documentos.**
- `docs/product/city.md` vira `docs/product/world.md`.
- `hunt.md`, `party.md`, `stamina.md`, `death.md`, `training.md` e `docs/deploy.md` mudam junto com o código de cada marco.

## Invariantes afetados

| Invariante | Muda? | O quê |
|---|---|---|
| **3** | texto | `attached` decide só a taxa de atualização; a ativação no mundo é pela posição de personagens; perder a conexão entra como intenção do servidor; o porquê deixa de ser “idle-first” |
| **8** | texto | “mundo inclusive”; repouso é o personagem deslogado com posição e vitais; mundo↔instância por `succeed` sob `canLogout`; da instância só se volta ao mundo com alguém olhando; morrer no mundo leva ao repouso |
| **9** | acréscimo | a trava por mundo |
| **11** | porquê | a automação é central na hunt idle; no mundo se exige presença, não ausência de automação |
| **7** | não muda | a versão só muda por drenagem de deploy; o save diário não troca versão |
| **1, 2** | não mudam | zonas, `canLogout`, índice de espectadores e dormência são dado e evento do `sim` |
| **4** | não muda | presença perdida é intenção do servidor, e atacar jogador é recusado no servidor |
| **5** | não muda | mensagens novas só em `messages.ts` |
| **6** | não muda | zona é geometria, não arte; o artefato do continente tem ADR próprio |
| **10** | não muda | o checkpoint é o mesmo ledger com `(session_id, seq)`, e agora também em ordem por personagem |

## Emenda — 2026-10-01 (#833, OW-12): a costura tem quatorze membros, e a auditoria dos usos de `session.participants` mora em documento próprio

A decisão 4 lista o que a `SessionTopology` isola. A OW-12 a implementou (`packages/sim/src/rulesets/topology.ts`) e classificou cada uso de `session.participants` do `HuntRuleset`: **150 ocorrências do texto** em `00c70359` (a decisão contava 125 em `733a4e0c`; o arquivo cresceu), das quais 135 são código. A tabela, as quatro classes e o que ficou aberto estão em [`docs/session-topology-audit.md`](../session-topology-audit.md).

**Decisão da emenda:**
- **Os onze itens da decisão 4 entram como estão**: `creditKill`, `rewardEligible`, `lootRecipient`, `onEmpty`, `onLeaderGone`, `startsInstanceSchedules`, `placeOnEnter`, `onCharacterDied` e as chaves `runsRouteWalker`, `runsExitRules` e `burnsStaminaByTime`.
- **A auditoria achou três perguntas a mais**, que decidiam por "quantos estão aqui" e que a lista da decisão não nomeava: `leaderOf` (o líder presente, ou o mais antigo — a outra metade da liderança), `onExitFinished` (a saída concluída decide o que a morte decide, pela outra porta) e `namesOwnerInEvents` (o formato do `level-up`, do `bestiary-milestone`, do `bosstiary-level` e do `hazard-level-up` no extrato dependia de haver um só presente, e no mundo o número de presentes não pode decidir o que vai para o ledger).
- **`instanceTopology` é o código de antes, sem tocar numa condição**, e é o default. A topologia não vai no snapshot nem muda o formato dele.
- **A costura não estende a topologia a todo o roster.** Os usos de roster que só rodam com `partyOptions`, bolsa compartilhada, votação, rota ou líder ficam no ruleset, guardados — o mundo não os passa. Dez usos são roster de party **sem guarda** e ficam abertos, cada um com dono: a XP pelo roster e os `killers` do Bosstiary na OW-28; o alvo de cura de party, as magias de party, o teto de medo, o nível de hazard da party e o custo por golpe de `#armHealersOf` na OW-43. A extração do resto é a dívida registrada na decisão 4, nas OW-61 a OW-65.

**Efeito no que esta decisão escreveu:** nenhum. A decisão 4 continua valendo; esta emenda só registra que a lista de perguntas cresceu em três e onde mora a auditoria.

## Emenda — 2026-10-02 (#836, OW-15): as condições persistem como prazo restante, e a flag `OPEN_WORLD` nasce na primeira peça que precisa dela

A decisão 10.f manda persistir vida, mana e condições (`characters.health/mana/conditions`) e levá-las no ticket. A OW-15 as implementou (`docs/product/open-world.md`, "O personagem em repouso") e fechou quatro detalhes que a decisão deixava em aberto:

- **`conditions` guarda PRAZO RESTANTE, não instante de relógio.** `ConditionState.expiresAtMs` e `nextTickAtMs` são instantes do relógio lógico da sessão que os gravou, e o relógio de cada sessão nasce em zero (ADR 0020). O repouso não conta tempo — o Canary guarda os `ticks` que faltavam (`canary/src/creatures/combat/condition.cpp:300`) —, então a linha leva quanto faltava (`CharacterRuntime.conditionsAsRemaining()`), a condição que já venceu não vai, e quem entra traz o restante para o relógio da sessão que o recebe (`carryRestoredConditions`, antes de `Session.enter`, que não traduz o personagem do ticket). Gravar o instante da sessão ressuscitaria a condição no relógio errado, ou a daria por vencida na entrada de uma sessão que já andou.
- **A flag `OPEN_WORLD` nasce aqui, e não na OW-18.** A OW-15 é a primeira peça que muda o que o `api` e o `game` leem e escrevem, e o portão do plano diz que todo comportamento novo do mundo fica atrás dela. Ela só guarda o liga/desliga (`packages/server/src/config.ts`, default desligado); a recusa de subir com outro `game` vivo continua da OW-18. Com ela desligada nenhuma coluna nova é lida nem escrita, o ticket e o extrato são os de antes e o repouso é `'city'`.
- **Quem morreu grava a vida e a mana cheias, a posição nula e nenhuma condição** (`player.cpp:4226-4252`). A vida zero nunca chega à linha, e o ticket trata a que chegar como um morto que entra cheio.
- **O extrato só leva o mundo de quem o ticket trouxe.** A `town_id` viaja SEMPRE com a flag ligada e é a marca: sem ela o personagem nasceu de um ticket sem o mundo (a flag desligada no `api`, ou um `api` anterior numa implantação em rolagem), e gravar a posição nula ou a vida cheia apagaria o que a linha guarda.

O `upgrade-existing-schema.sql` não ganha as colunas, como não ganhou a `durable_version` (#823): é o upgrade único do schema anterior à FUN-11, e uma coluna que ele criasse faria a migração `0029` falhar ao rodar depois dele.

**Efeito no que esta decisão escreveu:** nenhum. A decisão 10.f continua valendo; esta emenda só registra o formato das condições, onde a flag nasce e as duas regras de segurança do extrato.

## Emenda — 2026-10-02 (#837, OW-16): o que é "sujo", o extrato que não pousou e a âncora da transição

A decisão 10d manda gravar a cada 60 s, e em saída, transição, morte e drenagem, um lote com todo personagem sujo, num `MULTI` só. A OW-16 o implementou no hospedeiro (`docs/product/open-world.md`, "O checkpoint do mundo") e fechou sete detalhes que a decisão deixava em aberto:

- **"Sujo" é o que o banco ainda não tem**, medido no personagem e na sessão, nunca num visualizador (invariante 3): mudou de posição absoluta, de vida, de mana ou de *chaves* de condição desde o último lote; rendeu algo (qualquer agregado além de `durationMs`, ou uma instância vendida); mudou o que carrega (a quantidade de uma pilha, uma instância que entrou ou saiu); ou mexeu em estado durável por uma intenção (`dirty`). O prazo de uma condição não suja — encolhe a cada segundo —, e o `goldDelta` também não, porque só é liquidado depois de gravar e um lote que falhou o deixaria sujo para sempre. O parado na PZ, sem render nada, não gera linha.
- **Toda saída grava uma linha, suja ou não.** A decisão 7 diz que toda saída grava o checkpoint; a saída leva o `reason` e a âncora, e é a única linha que o parado gera.
- **O extrato que `leave` e `checkpoint` emitem uma vez não pode morar só na pilha de quem falhou.** Os dois zeram o que o extrato leva ao emiti-lo. Se `saveBatch` falha, as linhas voltam inteiras — mesmo `seq`, mesma versão durável — para uma fila do hospedeiro (`CheckpointState.unsaved`) e vão na frente do lote seguinte; um `release` que falha não solta o personagem, e o seguinte as grava antes de soltá-lo. Repetir é seguro pela chave do Redis e pelo `UNIQUE (session_id, seq)` do ledger (invariante 10).
- **Os lotes de uma sessão são serializados, e o timer não empilha.** O lote seguinte só é montado depois que o anterior terminou, para o que falhou entrar nele e para a saída de um personagem esperar o lote em voo que pode levar o crédito dele.
- **O motivo da linha periódica é `'checkpoint'`**, só do hospedeiro (`ReceiptReason`): o `EndReason` do `sim` não tem como dizer "ninguém saiu", e acrescentá-lo arrastaria o protocolo e o cliente para uma issue de servidor. Vira o `type` `session-checkpoint` do ledger.
- **A âncora de saída é lida antes de o destino ser construído.** Numa transição o destino é construído antes de a origem encerrar, com o mesmo `CharacterRuntime` — a decisão 6 já dizia isso —, e depois disso o `position` dele é o da hunt. O checkpoint e a saída leem a posição absoluta de agora e a escrevem em `CharacterRuntime.worldPosition` antes de montar a linha; `#runTransition` a lê antes de `buildSession`.
- **O `acquired` cumulativo não basta para o inventário.** A sessão do mundo nunca termina, então todo item que o personagem pega nela leva o prefixo dela e entra na linha de todo checkpoint — e o ledger o insere sem tocar a linha que já existe. A *existência* da linha é idempotente; a *quantidade* não é: a pilha que o loot engordou ou o jogador comeu ficaria com a quantidade do primeiro checkpoint, e a que acabou voltaria no login (`Inventory.consumeOne` e `destroy` não passam por `removedInstances`). A linha do mundo leva, além do `acquired`, **`quantities`** (a quantidade de toda instância carregada, absoluta e inteira — o ledger só escreve absoluto de extrato mais novo, e um delta se perderia com o velho descartado) e um **`removedInstances` ampliado** com tudo o que estava no inventário do último extrato e já não está (`inventoryDeltaOf`, contra `CheckpointMark.items`). A hunt e a Cidade não os levam: o extrato delas não mudou.

O lote **não é fatiado**: um `MULTI` com todo o mundo é o que a decisão compra, e o tamanho do comando — cada linha leva o estado absoluto inteiro e o `acquired` da sessão — é número do `bench:world` (OW-35). A cadência é `WORLD_CHECKPOINT_MS` (`docs/runtime-configuration.md`), de 1 s a 1 h.

**Efeito no que esta decisão escreveu:** nenhum. A decisão 10d continua valendo; esta emenda só registra o que "sujo" quer dizer, onde mora o extrato que não pousou, e o que a transição precisa ler antes de construir o destino.
