# Plano do mundo aberto

> **Decisão:** ADR 0060 — *Mundo aberto do Tibia sem PvP: um mundo é uma sessão, nascida da Cidade de Thais; a hunt idle vira o adicional instanciado*. O número é atribuído ao pousar; hoje o próximo livre na `tibia-parity` é 0060.
> **Base:** `tibia-parity` (`733a4e0c`). **Épico:** `E19 · Mundo aberto` (label a criar). **Marcos:** M47–M51.
> **Chaves:** `OW-01`…`OW-66`. São usadas nas dependências até cada issue ganhar número.
> **Datas:** 2026-09-29; revisto em 2026-09-30, depois da crítica.
> **Citações:** `caminho:linha` sem prefixo é da `tibia-parity`; `canary/` é `things/sources/canary`.

O dono: *“o jogo deve ser igual o tibia, mundo aberto sem pvp mas com hunts. E com adicional das hunts idle afk”*. Em sistema, isso é:

- **o mundo do Tibia:** o mapa real do `otservbr.otbm`, os spawns do Canary, outros jogadores e o tipo de mundo `no-pvp`, com presença exigida, como no Tibia;
- **a hunt idle como adicional:** a sessão instanciada de hoje, dirigida pelo bot, que roda com o navegador fechado. Entra-se nela do mundo (sair do mundo) ou direto do login;
- **a regra para o resto:** mecânica do Canary (o TFS serve para comparar), exceto a barra de ações e a automação (ADR 0037). O que o Canary não responde, responde o Huntera; o que nenhum dos dois responde, responde o dono (§6).

## 1. O que existe hoje

| Peça | Estado | Evidência |
|---|---|---|
| **Espaço compartilhado** | A Cidade é um shard inerte: `shared`, `hz 0`, lança se receber evento, ninguém morre | `packages/sim/src/rulesets/city.ts:120, 124, 180-191`; ADR 0004:21-25 |
| **Mapa de Thais** | Recorte real do OTBM: x 32275–32458, y 32153–32291, z 4–7; o `Tilemap` guarda `source` | `packages/content/data/maps/thais.json`; `packages/content/src/map.ts:60` |
| **Motor do Tibia** | Combate, IA, spawner, campos e cadáveres numa classe de 11.794 linhas | `packages/sim/src/rulesets/hunt.ts:1703` |
| **Sessão = party** | Todo participante leva o abate; o loot é sorteado; a sessão acaba quando esvazia | `hunt.ts:9913, 9915-9917, 10504-10513, 2985-2996` |
| **Monstro ocioso** | Decide `idle`, mas reagenda o passo; os outros timers vencem calados | `hunt.ts:7802, 7819-7824, 3952-3955, 8342-8349, 8405-8412` |
| **Fila** | Cancelar reconstrói o heap; o empate sai pela ordem de inserção | `packages/sim/src/schedule.ts:145-179` |
| **Criatura passiva** | Não existe: 28 dos 67 spawns de z 4–7 são `hostile = false` no Canary; o schema não tem o campo | `canary/data-otservbr-global/monster/mammals/deer.lua:49`; `packages/content/src/schemas.ts:2679`; `hunt.ts:4096` |
| **Campo** | Sem dono; atinge todo participante que está sobre ele | `packages/sim/src/fields.ts:28-64`; `hunt.ts:6850-6861` |
| **Extratos** | Chave sobrescrita por `SET`; aplicados na ordem do `SCAN`/`SMEMBERS`; campos absolutos sem guarda de ordem | `packages/server/src/receipts.ts:215, 242, 263-264, 284-302`; `packages/server/src/jobs/ledger.ts:228-261, 303-324` |
| **Gold** | Dois canais, escolhidos por `ruleset.shared` em onze lugares | `hunt.ts:10617-10618`; `packages/server/src/game/host.ts:4596-4598, 4627-4632` |
| **Vitais** | Vida, mana e condições não persistem; o ticket nasce cheio | `packages/server/src/db/schema.ts:102-262`; `packages/server/src/game/sessions.ts:253, 265-266` |
| **Apresentação** | A AOI só vê jogador e ignora o andar; monstro e golpe vão para todos; codifica uma vez por visualizador; 512 na fila derruba | `packages/server/src/game/aoi.ts:80, 137-139`; `host.ts:3122-3130, 3399-3400`; `packages/server/src/game/viewer.ts:36, 87-95` |
| **Presença** | Cidade recolhida em 5 min; `logout` sem portão; fim de sessão sempre volta à Cidade | `host.ts:1072, 4328, 1491-1497, 4081-4089` |
| **Transições** | A Cidade é o centro do grafo | `packages/server/src/game/transitions.ts:24-31` |
| **Conteúdo** | Carregado uma vez por processo | `packages/server/src/main.ts:96-97, 111-116` |
| **Mundo inteiro** | 29.425 setores, só no explorador do cliente | ADR 0047:13-15, 34-36 |
| **Conteúdo de Thais** | 67 spawns em z 4–7 (13 espécies, todas no catálogo), +126 em z 8, e 1.267 (56 espécies) na caixa x 32200–32560, y 32100–32350; nenhum recorte de hunt ali | contagem sobre `canary/data-otservbr-global/world/otservbr-monster.xml`; `packages/content/data/monsters/generated/mammals.json:310-311` |

## 2. O que se constrói

### Topologia

- Um mundo é uma sessão `type: 'world'`, compartilhada e com relógio, num processo `game`. É o `Game` único do Canary (`canary/src/game/game.hpp:95, 927`).
- O personagem pertence ao mundo escolhido na criação (`characters.world_id`).
- Escala-se com mais mundos e mais nós de instância, nunca cortando um mundo por geografia.
- Nunca se corta em z 7/8 (`canary/src/creatures/creature.cpp:76-81`).
- O teto (`capacity`) vale só para quem entra do repouso; quem volta de instância sempre entra.
- Mundo cheio põe o jogador na fila do Canary (`canary/src/server/network/protocol/protocolgame.cpp:1005-1008`) ou o leva direto a uma hunt idle.

### Ordem de construção

1. O shard da Cidade vira o primeiro mundo, no recorte de Thais, atrás de `OPEN_WORLD`.
2. Os recortes passam a derivar escadas da regra do mundo, com uma regra só de caminhabilidade.
3. O mundo cresce para z 8 e para a caixa dos arredores.
4. Depois vira o mapa em setores, em coordenada absoluta.

A coordenada persistida é absoluta desde o primeiro dia, então o caminho por Thais não custa migração.

### Estados

Um personagem está em repouso (deslogado, com posição, cidade e vitais), na sessão do mundo ou numa sessão instanciada. `'world'` é o centro do grafo de transições.

| De → para | Regra |
|---|---|
| Mundo → hunt idle | só com `canLogout` (`canary/src/creatures/players/player.cpp:6960-6979`) |
| Repouso → hunt idle | direto, sem passar pelo mundo |
| Instância → mundo, com visualizador | vai para a âncora (`player.cpp:12332-12336`) |
| Instância → repouso, sem visualizador | vai para a âncora |
| Morte (na hunt ou no mundo) | templo (`player.cpp:4041`) |

### Presença

- `logout` passa por `canLogout`.
- Perder a conexão, ou chegar ao mundo sem visualizador, vira intenção no instante lógico:
  - o alvo é solto e a automação para;
  - aos 60 s o personagem tenta sair;
  - se estiver em luta, tenta de novo quando a luta acaba;
  - o idle kick é o teto (`player.cpp:2321-2338, 8636-8647`).
- O AFK é a hunt idle.

### Regras do mundo

- No-pvp no portão de combate do `sim` (`canary/src/creatures/combat/combat.cpp:326-345, 428-430, 551-565, 1207-1218, 2594-2640`).
- Criatura passiva segue e foge, nunca ataca (`canary/src/creatures/monsters/monster.cpp:1491-1496, 2095-2105`).
- Zonas do OTBM entram como camada por andar.
- A XP se reparte pela fatia de dano; o cadáver é de quem mais bateu (`creature.cpp:604-657, 1168-1193`; `monster.cpp:3305-3318`).
- A morte leva ao repouso no templo, com a tela de relogin (`player.cpp:4034-4041, 4226-4252`).
- Proteção de login de 10 s em toda colocação.
- Ferramenta de andar (corda, pá) funciona como no Canary.

### Stamina e “online”

- O teto de 720 min fica (ADR 0043, revisão de 2026-09-25).
- No mundo, a stamina queima como no Canary, quando se ganha XP (`canary/data/events/scripts/player.lua:98-135, 532-557`).
- Só recupera em repouso (`canary/data/scripts/creaturescripts/player/regenerate_stamina.lua:3-28`).
- A PZ do mundo é online, e o banco de treino offline cresce com o tempo de mundo.
- A regeneração de vida e mana no mundo é a da hunt até o dono responder.

### Simulação

- O mundo é o `HuntRuleset` com uma `SessionTopology`: a de instância é a de hoje, byte a byte; a de mundo é nova.
- Relógio fixo a 10 Hz.
- Monstro ocioso dorme só no mundo:
  - todos os timers dele saem da fila e voltam na mesma fase;
  - a fila do mundo desempata sem depender da inserção;
  - um teste de equivalência compara com “todos ativos”.
- A fila ganha cancelamento preguiçoso.

### Durabilidade

- Extrato com chave por `seq` e `durable_version` por personagem, liquidado em ordem, com todo campo absoluto guardado pela versão.
- Um canal de gold por sessão.
- Checkpoint do mundo a cada 60 s, e em saída, transição, morte e drenagem, num `MULTI` só.
- Sem linha de ledger quando nada de valor se moveu.
- Vida, mana e condições persistidas.

### Apresentação

- AOI v2, com andar e toda entidade.
- Cada mensagem é serializada uma vez por ciclo; os visualizadores ficam indexados por personagem.
- O `bench:world` é o portão da flag em produção e roda o mundo junto com as hunts idle no mesmo processo, com a liquidação no Postgres.

### Versão, save e escala

- O conteúdo muda só por deploy, que drena.
- O save das 06:00 reinicia o estado efêmero do mundo por `succeed`, na mesma versão, sem desconectar quem está olhando.
- O deploy de produção vai para a janela do save.
- Um nó até o `bench:world` pedir mais. Com o segundo processo `game`, entram a trava `world:{id}:owner`, o ticket ao dono, a carga medida por jogador e nós de mundo separados dos de instância.

## 3. Marcos, em ordem

### M47 · Mundo aberto — decisão e alicerces

A decisão pousa, e os alicerces que não mudam o jogo entram sozinhos, cada um com o seu portão.

| Chave | Issue | Pacote | Tamanho | Prioridade | Depende de |
|---|---|---|---|---|---|
| OW-01 | ADR, `AGENTS.md` e emendas | docs | S | P0 | — |
| OW-02 | Extrato por `seq`, em ordem por personagem, com `durable_version` | server | M | P0 | — |
| OW-03 | `progress` separado de `shared`; `Session.checkpoint` | sim | M | P0 | — |
| OW-04 | Um canal de gold: auditoria dos onze ramos de `ruleset.shared` | server | S | P0 | OW-03 |
| OW-05 | Campo com dono | sim | M | P0 | — |
| OW-06 | Fila com cancelamento preguiçoso e desempate estável opcional | sim | M | P1 | — |
| OW-07 | `bench:city` mede CPU, bytes e fila | tools | S | P1 | — |

**Pronto quando:**
- o ADR está assinado;
- extratos fora de ordem não desfazem estado (teste com Postgres);
- o campo de jogador não fere jogador;
- a auditoria de gold está mesclada sem mudança de comportamento;
- `progress`/`checkpoint` e a fila passaram no `bench:hunts` sem regressão;
- o `bench:city` publica bytes e fila por visualizador.

### M48 · Mundo aberto v0 — Thais pacífica

O shard da Cidade vira o mundo, sem monstros. Prova presença, durabilidade, vitais e transições sem risco de combate.

| Chave | Issue | Pacote | Depende de |
|---|---|---|---|
| OW-08 | `data/worlds/main.json` mínimo: tipo, mapa, cidade, templo, teto | content | OW-01 |
| OW-09 | Camada `zones` a partir de `TILE_FLAGS` | content | OW-01 |
| OW-10 | Zona por tile e `canLogout` | sim | OW-09 |
| OW-11 | O mundo no protocolo | protocol | OW-01 |
| OW-12 | Costura `SessionTopology` (L) | sim | — |
| OW-13 | Topologia de mundo e `createWorldSession` | sim | OW-03, OW-08, OW-10, OW-12 |
| OW-14 | Saída do Tibia no `sim` | sim | OW-10, OW-13 |
| OW-15 | Colunas de mundo e vitais em `characters` | server | OW-02, OW-08 |
| OW-16 | Checkpoint do mundo no hospedeiro | server | OW-02, OW-03, OW-04, OW-15 |
| OW-17 | Liquidação do checkpoint no `jobs` | server | OW-02, OW-15 |
| OW-18 | `WorldShard` atrás de `OPEN_WORLD` | server | OW-13, OW-16 |
| OW-19 | Presença no hospedeiro | server | OW-14, OW-18 |
| OW-20 | Mundo ↔ hunt idle, com volta só assistida | server | OW-18, OW-19 |
| OW-21 | Entrada pelo repouso, hunt idle direta e mundo cheio | server | OW-18 |
| OW-22 | Leque barato | server | OW-07 |
| OW-23 | Sessão `world` no cliente | client | OW-11, OW-18, OW-21 |
| OW-24 | Roteiro de aceite e `docs/product/world.md` | docs | OW-17, OW-19, OW-20, OW-21, OW-22, OW-23 |

**Pronto quando**, com `OPEN_WORLD=1` no staging:
- dois navegadores entram no templo e se veem andar em qualquer andar do recorte;
- loja e depósito funcionam num tile PZ e recusam fora dele;
- logout a 10 HP e relogin volta com 10 HP no mesmo tile;
- fechar o navegador fora da PZ tira o personagem aos 60 s;
- entrar numa hunt idle do templo e voltar ao mesmo tile;
- fechar o navegador durante a hunt deixa o personagem, no fim dela, em repouso no tile de saída, e não no mundo;
- do login, entrar direto numa hunt idle;
- com a flag desligada, tudo funciona como hoje.

### M49 · Thais viva — monstros do Canary, sem PvP

| Chave | Issue | Pacote | Depende de |
|---|---|---|---|
| OW-25 | Spawns do Canary no mundo | content | OW-08, OW-09 |
| OW-26 | Criatura passiva (`hostile` do Canary) | sim | — |
| OW-27 | Portão no-pvp | sim | OW-05, OW-10 |
| OW-28 | Crédito do Canary | sim | OW-12, OW-13 |
| OW-29 | Índice de espectadores | sim | OW-13 |
| OW-30 | Monstro dormente com todas as fases e a equivalência (L) | sim | OW-06, OW-29 |
| OW-31 | Spawn e respawn contra todo personagem | sim | OW-25, OW-26, OW-29 |
| OW-32 | Morte no mundo como no Canary e proteção de login | sim | OW-13, OW-14 |
| OW-33 | AOI v2 para criaturas | server | OW-22 |
| OW-34 | AOI v2 para combate, efeitos, campos, cadáveres e tiles | server | OW-33 |
| OW-35 | `bench:world` com hunts idle no mesmo processo e liquidação no Postgres | tools | OW-17, OW-30, OW-31, OW-34 |
| OW-36 | Combate e morte no mundo, no cliente | client | OW-23, OW-27, OW-28, OW-32 |
| OW-37 | Roteiro de aceite | docs | OW-32, OW-35, OW-36 |

**Pronto quando:**
- dois jogadores batem no mesmo lobo e a XP sai pela fatia de cada um;
- o cadáver abre só para quem mais bateu até apodrecer;
- coelho e cervo fogem e não atacam;
- magia em área e fire field de um não ferem o outro;
- morrer leva à tela de morte e ao templo;
- fechar o navegador em luta deixa o personagem ali até a luta acabar;
- o `bench:world` passa com 200 personagens mais as hunts idle no mesmo processo.

### M50 · Thais cresce — esgotos, arredores, party e o save diário

| Chave | Issue | Pacote | Tamanho | Prioridade | Depende de |
|---|---|---|---|---|---|
| OW-38 | Escadas derivadas e uma regra de caminhabilidade nos recortes | tools | — | — | — |
| OW-39 | Corda e pá como no Canary, no mundo | sim | — | — | OW-13, OW-38 |
| OW-40 | Região de Thais ampliada | tools | — | — | OW-25, OW-38 |
| OW-41 | `floorChangeToward` espacial | content | — | — | — |
| OW-42 | A* com andar no mundo | sim | L | — | OW-13, OW-41 |
| OW-43 | Party no mundo | sim | L | — | OW-14, OW-28 |
| OW-44 | Atravessar jogador | sim | — | P2 | OW-13 |
| OW-45 | Save diário sem desconectar | server | — | P2 | OW-16, OW-18 |
| OW-46 | Stamina, online e regeneração no mundo | sim | — | — | OW-28 |
| OW-47 | Idle kick por intenção do cliente | server | — | — | OW-19; pergunta 1 |
| OW-48 | Personagens por conta | server | — | — | OW-21; pergunta 2 |
| OW-49 | Carga por jogador | server | — | P2 | — |
| OW-50 | Escolha de mundo na criação e segundo mundo | server | — | P2 | OW-15, OW-21, OW-49 |
| OW-51 | Roteiro de aceite | docs | — | — | OW-39, OW-40, OW-42, OW-43, OW-45, OW-46 |

**Pronto quando:**
- descer aos esgotos e sair nos arredores sem trocar de sessão;
- subir por um ponto de corda com a corda na mochila;
- clicar a 25 tiles do outro lado de uma escada e chegar;
- a party do mundo reparte a XP;
- o save das 06:00 no staging não derruba ninguém que está olhando.

### M51 · O mundo inteiro — geometria por setor, coordenada absoluta e trava de mundo

Só começa depois da resposta à pergunta 4. É a fase 6 do `docs/world-map-plan.md`.

| Chave | Issue | Pacote | Tamanho | Prioridade | Depende de |
|---|---|---|---|---|---|
| OW-52 | ADR do artefato de geometria | docs | — | — | OW-01; pergunta 4 |
| OW-53 | Artefato de setores do servidor | tools | L | — | OW-38, OW-52 |
| OW-54 | Interface `TileGeometry` | sim | — | — | — |
| OW-55 | Geometria setorizada esparsa | sim | — | — | OW-53, OW-54 |
| OW-56 | `world-enter` em coordenada absoluta | protocol | — | — | OW-01 |
| OW-57 | `createWorldScene` no jogo | client | — | — | OW-56 |
| OW-58 | O mundo em coordenada absoluta | server | L | — | OW-40, OW-55, OW-57 |
| OW-59 | Trava de mundo e papéis de nó | server | — | P2 | OW-49 |
| OW-60 | Registro desmaterializado, se o bench pedir | sim | — | P2 | OW-30, OW-35 |
| OW-61 | Núcleo, parte 1: pipeline de combate | sim | — | P2 | OW-12 |
| OW-62 | Núcleo, parte 2: IA de monstro | sim | — | P2 | OW-61 |
| OW-63 | Núcleo, parte 3: spawner | sim | — | P2 | OW-62 |
| OW-64 | Núcleo, parte 4: campos e cadáveres | sim | — | P2 | OW-61 |
| OW-65 | Núcleo, parte 5: ocupação e mundo de movimento | sim | — | P2 | OW-54, OW-61 |
| OW-66 | Roteiro de aceite | docs | — | — | OW-58 |

**Pronto quando:**
- o mundo é o mapa em setores, em coordenada absoluta, com regiões habilitadas por conteúdo;
- cada recorte versionado é reproduzido pelo artefato no CI;
- com dois nós, o ticket de mundo vai ao dono da trava.

## 4. Portões que não se negociam

- **Instância byte-idêntica.** Toda PR que toca `hunt.ts`, `session.ts`, `schedule.ts` ou `fields.ts` passa por:
  - as sequências do FUN-63;
  - 1 Hz = 10 Hz (`docs/product/hunt.md:692-706`);
  - o `bench:hunts` sem regressão.
  A exceção declarada é a OW-26, correção de paridade com estágio de perfil. A hunt idle é a base econômica (ADR 0020:88-89).
- **Equivalência da dormência.** Dormência ligada e todos forçados ativos dão o mesmo fluxo de eventos de domínio e os mesmos agregados.
- **Ordem dos extratos.** Liquidar fora de ordem nunca desfaz estado absoluto (teste com Postgres).
- **Um canal de gold.** No mundo, 100 de loot + 50 de venda, dois checkpoints e um logout dão exatamente 150 no ledger.
- **`bench:world` antes da flag em produção**, com as hunts idle no mesmo processo e a liquidação do `jobs`, medido na arquitetura de destino (ADR 0013:41-45).
- **`/compliance`** em toda PR de `sim`, `protocol` e `content`.

## 5. O que fica fora (e por quê)

| Fora | Por quê | Quando volta |
|---|---|---|
| Casas (993) | Subsistema durável sem dono único: leilão, aluguel, `tile_store` | ADR próprio |
| Raids, spawn de dia/noite, luz | Exigem relógio de mundo injetado como dado (`canary/src/creatures/monsters/monsters.cpp:35-45`) | Depois do M51 |
| Diálogo de NPC (1.036 scripts) e 1.503 teleportes por script | Conteúdo Lua que o Draconya não tem; o serviço fica por menu em tile PZ | Marco de NPC |
| Item no chão, troca, cadáver de jogador, liquidação atômica entre personagens | O ledger ainda não modela valor entre personagens | Com o Market (E13) |
| Recarga de conteúdo a quente | O conteúdo é do processo (`packages/server/src/main.ts:96-97`); a versão nova chega por deploy | ADR próprio |
| Arena PvP | O dono pediu mundo sem PvP; `PVPZONE` é tratado como no-pvp | Se o dono pedir |
| Barco entre regiões | Só existe uma região até o M51 | Com a segunda região |
| Boss raro (17 entradas de 14.402 s) | Não há nenhum na região de Thais | Quando uma região os cobrir |
| Teto global da Forja e monstro influenciado no mundo | O ADR 0056 segue por sessão, na hunt | Depois do M51 |
| Fronteira contínua entre nós | Invariante 9 | Não volta |

## 6. Perguntas ao dono (e o que vale enquanto não respondem)

1. **Automação no mundo, desanexada e sob idle kick.**
   - O que já está resolvido pela regra “copie do Huntera”: com o jogador presente, o bot roda no mundo inteiro (targeting, barra de ações e caminhada oportunista, sem rota fixa). O Huntera caça assim em mapa compartilhado (`docs/reference/huntera-observed.md:791-801, 819-821`).
   - O que falta: o comportamento desanexado e o idle kick com o bot rodando.
   - Default: desanexado, toda automação para; o idle kick conta só intenção do cliente.
   - Bloqueia a OW-47.
2. **Personagens por conta.**
   - Default: continuam 2 ativos, no máximo 1 no mundo.
   - Bloqueia a OW-48.
3. **Economia entre os modos.**
   - Default: as mesmas taxas; a stamina como orçamento comum; a hunt idle continua cópia privada mesmo quando o mundo cobrir o lugar dela.
   - Não bloqueia nada até o M50.
4. **Até onde vai o mundo.**
   - O risco jurídico já está decidido pelo ADR 0025 d.2; sobra escopo e operação.
   - Default: parar na região de Thais ampliada.
   - Bloqueia o M51.
5. **Regeneração de vida e mana no mundo.**
   - Default: como na hunt, PZ inclusive.
   - A OW-46 usa o default até a resposta.

## 7. Riscos que o plano aceita

- **Fechar o navegador em luta passa a matar**, como no Tibia. Muda o que o jogador da Cidade conhece.
- **A costura de topologia no `HuntRuleset` é o ponto mais arriscado.** Um uso de `session.participants` esquecido dá loot a estranhos. A auditoria dos 125 usos vai na PR da OW-12.
- **As bordas do recorte são paredes invisíveis até o M51.** O M50 as põe em barreira natural.
- **O leque de saída e o Postgres podem ceder antes da CPU.** Por isso OW-17, OW-22, OW-33, OW-34 e OW-35 vêm antes da flag em produção.
- **Uma queda perde até 60 s de todo mundo que está no mundo.** Monstros, cadáveres e campos recomeçam, como no Canary.
- **Deploy de produção fica preso à janela do save.** Correção urgente fora dela drena o mundo inteiro, como hoje drena a Cidade.
- **A OW-26 muda o comportamento de dog, pig e rabbit** na Minotaur Camp e na Rat Cellars. É correção de paridade, com estágio declarado.


## Respostas do dono (2026-09-30)

Registradas no [ADR 0060](adr/0060-tibia-open-world-without-pvp.md), seção "Respostas do dono": bot no mundo só com o jogador presente e idle kick do Canary contando só ação do jogador; 2 personagens ativos por conta, no máximo 1 no mundo; economia no default (mesmas taxas, stamina comum); o mundo é o **otservbr inteiro**, com as áreas sem conteúdo fechadas por região até ficarem prontas (o M51 deixa de ser opcional); regeneração como na hunt em todo o mundo, PZ inclusive.
