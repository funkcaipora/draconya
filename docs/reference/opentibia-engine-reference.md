# Draconya Engine Construction Reference
## Estudo da engine OpenTibia (TFS + Canary) e arquitetura de referência para o Plano 2

**Status:** referência arquitetural para replanejamento  
**Data da pesquisa:** 2026-09-09  
**Destinatário principal:** Claude Code trabalhando no repositório Draconya  
**Estratégia adotada:** manter a engine Draconya em TypeScript e usar OpenTibia como referência de arquitetura, comportamento, pipelines e casos de borda — sem incorporar o runtime C++ ao produto.

---

# 0. Como usar este documento

Este documento não é uma lista de features e não é uma ordem automática de implementação.

Ele deve ser usado pelo Claude Code como **referência arquitetural e de domínio** antes de refazer o plano de construção do Draconya.

Antes de criar novas issues, PRs ou alterar código:

1. audite o checkout atual do repositório;
2. compare o estado atual com os contratos descritos aqui;
3. preserve tudo que já cumpra os contratos;
4. refatore somente onde a arquitetura atual aumentaria o custo futuro;
5. não reimplemente uma mecânica de MMORPG sem primeiro consultar a seção correspondente deste documento;
6. diferencie:
   - **mecanismo de engine**, que tende a ser reutilizável;
   - **regra de produto**, que pertence ao Draconya;
7. não trate “igual ao Tibia” como licença para copiar código;
8. qualquer código novo deve continuar obedecendo às restrições do Draconya:
   - simulação server-authoritative;
   - `packages/sim` puro, sem I/O;
   - sessão independente da conexão;
   - snapshot/restauração;
   - determinismo;
   - Hunt barata e executável sem viewer;
   - regras e números dirigidos por `content/`.

O objetivo do Plano 2 é:

> **Usar a experiência acumulada das engines OpenTibia para definir os mecanismos fundamentais do Draconya, implementando-os de forma original em TypeScript e adaptada ao modelo idle/instanciado, em vez de descobrir novamente problemas que TFS/Canary já resolveram.**

---

# 1. Fontes de referência e escopo da pesquisa

Foram usadas duas engines como referências principais.

## 1.1 The Forgotten Server (TFS)

Referência analisada:

```text
Repository: otland/forgottenserver
Branch: master
Commit: 70793fdc1972d328cc2e9bc018112951a3cbcd21
Data do commit: 2026-08-30
```

O TFS é uma implementação relativamente direta da arquitetura clássica OpenTibia. Ele é útil para entender os mecanismos fundamentais:

- `Game`
- `Thing`
- `Tile`
- `Map`
- `Creature`
- `Player`
- `Monster`
- `Combat`
- `Condition`
- `Spell`
- `Weapon`
- `Item`
- `Container`
- `Action`
- `Movement`
- `Spawn`
- `Dispatcher`
- `Scheduler`
- `ProtocolGame`
- persistência e scripting

O código-base confirma que esses sistemas são componentes separados da engine, embora muitos sejam coordenados pelo objeto global `Game`.[^tfs-cmake]

## 1.2 Canary

Referência analisada:

```text
Repository: opentibiabr/canary
Branch: main
Commit: d34733e1336f0e4f396b45b4bfb93b681407d0bb
Data do commit: 2026-09-09
```

Canary é uma evolução moderna do ecossistema OpenTibia, em C++20 + Lua. Ele é especialmente importante para estudar:

- modularização mais recente;
- lifetime/ownership;
- gargalos reais de monster AI;
- fairness de scheduler;
- trabalho visível vs background;
- computação paralela de intenções;
- revalidação antes de commits;
- filas limitadas e backpressure.

O próprio Canary documenta explicitamente seus contratos de performance/lifetime e um roadmap recente de paralelização da AI de monstros.[^canary-performance][^canary-parallel]

## 1.3 O que esta pesquisa NÃO propõe

Este documento **não propõe**:

- incorporar TFS/Canary como dependência;
- portar C++ para TypeScript linha por linha;
- reproduzir todas as fórmulas oficiais de Tibia;
- manter todos os sistemas históricos de OTServer;
- transformar Draconya num clone de Tibia;
- usar o protocolo de rede Tibia;
- usar MySQL ou a persistência OpenTibia;
- reproduzir ground loot/corpses se o produto Draconya deliberadamente não os usa;
- abandonar a arquitetura de sessão AFK já construída.

---

# 2. Nota de licença — regra obrigatória para Claude Code

TFS e Canary são distribuídos sob **GNU GPL v2**.[^tfs-license][^canary-license]

Portanto:

> **Este documento deve ser usado como estudo de arquitetura, comportamento e contratos. Não copie, traduza ou adapte código-fonte GPL linha por linha para o Draconya sem uma decisão explícita sobre licenciamento.**

Para o Plano 2:

- estudar algoritmos, fluxos, abstrações e casos de borda;
- escrever implementação original;
- documentar o comportamento esperado;
- usar testes próprios;
- evitar copiar corpos de funções, estruturas extensas ou implementações literais;
- se em algum momento reutilização direta de código for desejada, interromper a implementação e pedir uma decisão explícita de licença.

Isto não é aconselhamento jurídico.

---

# 3. Conclusão arquitetural da pesquisa

A principal conclusão é:

> O Draconya deve copiar **os limites e pipelines conceituais** da engine OpenTibia, mas não o seu runtime global.

OpenTibia já demonstra que uma engine MMORPG robusta precisa separar pelo menos:

```text
World / Map
Tile legality
Creature state
Movement
Navigation
Targeting
Combat
Conditions
Abilities
Items / Inventory
Spawn
Death / attribution
Rules / events
Scheduling
Networking
Persistence
```

O erro a evitar no Draconya é criar funcionalidades diretamente dentro de:

```text
HuntRuleset
Bot
MonsterRuntime
Session.tick()
```

até esses objetos virarem versões reduzidas de `Game` e `Player`.

A arquitetura recomendada é:

```text
                          DRACONYA PLATFORM
             API / auth / DB / Redis / session directory
                              │
                              ▼
                      SessionHost / Node
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│                         packages/sim                          │
│                                                               │
│  Session + logical time + deterministic scheduler             │
│                         │                                     │
│                         ▼                                     │
│                      SessionWorld                             │
│                         │                                     │
│        ┌────────────────┼─────────────────┐                   │
│        ▼                ▼                 ▼                   │
│    Creatures         World/Tiles       Ruleset                │
│        │                │                                     │
│        ├── Controller   ├── Movement                          │
│        ├── Targeting    ├── Visibility                        │
│        ├── Conditions   └── Navigation                        │
│        └── Stats                                              │
│                                                               │
│        Commands → Validate → Resolve → Commit → Events         │
│              │          │         │            │              │
│              ▼          ▼         ▼            ▼              │
│           Combat     Abilities  Inventory     Death           │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

Humanos, bots e monstros não possuem regras paralelas.

Todos produzem **intenções/comandos** para a mesma engine.

---

# 4. Visão geral da engine OpenTibia

A engine clássica OpenTibia pode ser entendida em cinco camadas.

## 4.1 Entrada

Origem de intenções:

```text
network packet
Lua event
scheduled event
monster AI
server event
```

Por exemplo, no TFS o protocolo interpreta um pacote de ataque e não altera diretamente o alvo; ele agenda uma tarefa no dispatcher que chama `Game::playerSetAttackedCreature`.[^tfs-protocol]

## 4.2 Coordenação serializada

TFS possui:

```text
Scheduler → Dispatcher → Game
```

O `Scheduler` cuida de tarefas temporais; quando vencem, elas são passadas ao `Dispatcher`. O dispatcher executa alterações de estado do jogo numa sequência controlada.[^tfs-tasks][^tfs-scheduler]

Isso reduz a quantidade de locks que seriam necessários se cada conexão, monstro ou timer pudesse alterar o mundo simultaneamente.

## 4.3 Modelo de mundo

```text
Map
 └ Tile
     ├ Ground
     ├ Items
     └ Creatures
```

O tile concentra regras locais:

- bloqueio;
- pathing;
- zonas;
- teleports;
- fields;
- floor changes;
- objetos e criaturas presentes.

## 4.4 Entidades e sistemas

```text
Creature
├ Player
├ Monster
└ NPC
```

Todos compartilham:

- posição;
- velocidade;
- movimento;
- target/follow;
- HP;
- conditions;
- combate;
- morte;
- callbacks.

## 4.5 Conteúdo e extensibilidade

Dados e regras são carregados de:

- XML;
- OTB;
- Lua;
- banco;
- arquivos de mapa.

A engine contém mecanismos genéricos e o datapack define conteúdo.

Essa separação é uma das principais ideias que o Draconya deve preservar, embora usando JSON/TypeScript schemas em vez do formato histórico do TFS.

---

# 5. Lifecycle e bootstrap do servidor OpenTibia

O bootstrap do TFS é importante porque mostra a ordem de dependências da engine.

O fluxo atual carrega aproximadamente:

```text
Dispatcher
Scheduler
Config
RSA
Database
Database migrations/tasks
Vocations
Item definitions
Script systems
Lua
Monster definitions
Monster scripts
Outfits
World type
Map
Houses/market state
Network protocols
Game runtime
```

O `Game` só passa ao estado normal após conteúdo e mundo serem carregados.[^tfs-bootstrap]

## Lição para Draconya

`packages/content` deve continuar sendo validado **antes** de uma sessão poder iniciar.

O Draconya já possui uma boa regra:

> conteúdo inválido deve falhar no boot, não no meio de uma Hunt.

Manter.

### Não copiar

TFS possui singletons globais como:

```text
g_game
g_monsters
g_vocations
g_scheduler
g_dispatcher
```

Isso faz sentido num mundo global tradicional.

No Draconya, a unidade de isolamento é `Session`.

Portanto:

```text
TFS:
global Game

Draconya:
SessionWorld por sessão
```

---

# 6. Dispatcher, Scheduler e modelo de tempo

Este é um dos subsistemas mais importantes da pesquisa.

## 6.1 TFS não é simplesmente “um tick global”

A engine usa diferentes mecanismos:

```text
creature think
walk event
attack check
condition execution
spawn check
decay
scheduled callbacks
network command
```

Eventos temporais são agendados pelo `Scheduler`, enquanto alterações de mundo passam pelo `Dispatcher`.[^tfs-tasks][^tfs-scheduler]

O TFS também distribui checks de criaturas em grupos: a definição atual usa 10 grupos, think de 1000 ms e intervalos de check de 100 ms.[^tfs-creature][^tfs-creature-check]

Isso evita acordar todas as criaturas simultaneamente.

## 6.2 Problema do modelo atual do Draconya

O Draconya originalmente modelou muita coisa como:

```ts
tick(dtMs)
```

Isso é atraente para sessões AFK, mas começa a gerar bugs quando cada subsystem precisa inventar sua própria regra de “catch-up”.

Exemplo já encontrado na análise anterior:

```text
monster cooldown informa que cabem 2 ações
monster decision retorna somente 1
```

Resultado:

```text
10 Hz != 1 Hz
```

## 6.3 Arquitetura recomendada: relógio lógico por sessão

Adotar:

```ts
type LogicalTimeMs = number;
```

Cada sessão possui:

```ts
interface SessionClock {
  now: LogicalTimeMs;
}
```

O relógio lógico:

- começa em 0 ou outro valor serializável;
- só avança quando a simulação avança;
- não é `Date.now()`;
- não é `performance.now()`;
- não pertence ao processo;
- é serializado no snapshot.

### Por quê

Uma sessão restaurada em outro processo deve continuar com o mesmo domínio temporal.

Isso elimina o bug de timestamps monotônicos antigos sobrevivendo ao restart.

## 6.4 Scheduler determinístico por sessão

Adicionar uma fila:

```ts
interface ScheduledEvent {
  dueAt: LogicalTimeMs;
  priority: number;
  sequence: number;
  kind: ScheduledEventKind;
  payload: SerializablePayload;
}
```

Ordenação:

```text
1. dueAt
2. priority
3. sequence
```

Nunca depender:

- de ordem de `Map` JS acidental;
- de wall clock;
- de ordem de timers Node;
- de timing de socket;
- de threads.

## 6.5 `advanceBy`

A API conceitual:

```ts
session.advanceBy(elapsedSimulationMs)
```

Exemplo:

```text
advanceBy(1000)
```

processa cronologicamente todos os eventos de gameplay que vencem entre:

```text
logicalTime
e
logicalTime + 1000
```

### Invariante obrigatório

Quando não existe uma regra que dependa explicitamente da granularidade:

```text
10 × advanceBy(100)
```

e:

```text
1 × advanceBy(1000)
```

devem chegar ao mesmo estado lógico.

Esse é o mecanismo correto para o idle Draconya.

## 6.6 Diferença entre “avanço intencional” e “scheduler atrasado”

Canary traz uma regra moderna importante:

> se o scheduler real atrasou por overload, não liberar uma rajada de ataques/movimentos apenas para “recuperar ticks perdidos”.[^canary-parallel]

Isso não contradiz `advanceBy(1000)`.

São situações diferentes.

### Caso A — Hunt desanexada

O host deliberadamente representa 1000 ms de tempo simulado.

Então eventos que deveriam ocorrer aos:

```text
+500
+1000
```

devem ser processados.

### Caso B — servidor saturado

Uma sessão que deveria estar sendo executada em tempo real ficou 1000 ms sem CPU.

Não devemos automaticamente transformar atraso operacional em burst de gameplay.

Portanto o `SessionHost` precisa definir explicitamente quanto **tempo de simulação** está avançando.

Nunca derivar essa decisão implicitamente de um timer atrasado.

## 6.7 Downtime de processo

O ADR atual do Draconya escolhe descartar o gap entre snapshot e retomada.

Isso fica simples:

```text
snapshot logicalTime = 51_200

processo morre

3 minutos reais depois

restore logicalTime = 51_200
```

O tempo lógico simplesmente não avançou.

Não existe rebase de cooldown.

---

# 7. Ownership, identidade e mutabilidade

TFS histórico usa muito ponteiro de objeto. Canary vem modernizando os contratos de lifetime.

Canary documenta uma regra muito útil:

> cruzou uma fronteira assíncrona? use ownership forte ou identidade estável; não carregue um ponteiro emprestado para o futuro.[^canary-performance]

## Regra para Draconya

Dentro do `packages/sim`, entidades devem ser referenciadas por IDs estáveis:

```ts
type EntityId = string;
type CreatureId = EntityId;
type ItemInstanceId = string;
```

Eventos agendados armazenam:

```text
creatureId
targetId
itemId
```

e nunca uma referência mutável para o objeto.

Na hora de executar:

```ts
const creature = world.creatures.get(event.creatureId);
if (!creature) return; // stale event
```

## Single writer

Dentro de uma sessão:

> somente o `SessionWorld`/pipeline de commit altera estado autoritativo.

Mesmo se no futuro pathfinding/AI usar workers:

```text
worker calcula intenção
↓
retorna IDs + worldRevision
↓
session revalida
↓
session commita
```

Essa é também a direção explícita do Canary moderno.[^canary-parallel]

---

# 8. Thing/Cylinder — o padrão mais útil do TFS para movimentos atômicos

Uma das soluções mais maduras do TFS é o contrato usado para mover objetos.

`Thing`, `Tile`, `Container` e `Player` participam de uma interface de consulta e commit:

```text
queryDestination
queryAdd
queryMaxCount
queryRemove
↓
commit
↓
postAddNotification
postRemoveNotification
```

[^tfs-thing][^tfs-container]

O `Game::internalMoveCreature` primeiro pergunta ao tile se a criatura pode entrar antes de mover.[^tfs-move-creature]

O movimento de item segue padrão semelhante, incluindo destino, quantidade, remoção, inserção e notifications.[^tfs-move-item]

## O que copiar conceitualmente

Não é necessário recriar a hierarquia OO do TFS.

Copiar o princípio:

> **VALIDATE → COMMIT ATÔMICO → EMITIR EVENTOS**

Exemplo Draconya:

```ts
const result = movement.validate(command, world);

if (!result.ok) {
  return reject(result.reason);
}

movement.commit(result.plan, world);

events.emit(...result.events);
```

## Regra obrigatória

Não permitir:

```ts
creature.position = newPosition;
```

espalhado pelo código.

Não permitir:

```ts
inventory.items.push(item);
```

fora do `InventorySystem`.

Isso evita dezenas de edge cases.

---

# 9. Map, Tile e regras espaciais

## 9.1 TFS

O `Tile` representa simultaneamente:

- posição;
- ground;
- items;
- creatures;
- flags;
- zonas;
- bloqueio;
- teleport;
- magic field;
- floor transition.

Flags incluem, entre outras:

```text
floor change
protection zone
no-PvP
PvP
no-logout
teleport
magic field
block solid
block path
```

[^tfs-tile]

O `Map` fornece:

- lookup de tile;
- place/move creature;
- spectators;
- line of sight;
- throw checks;
- walkability;
- A*;
- cache espacial;
- múltiplos floors.[^tfs-map]

## 9.2 Draconya recomendado

Separar:

```ts
interface TileDefinition {
  position: Position;
  groundId: string;
  flags: TileFlags;
  movementCost: number;
  zone: Zone;
}

interface TileRuntime {
  creatures: CreatureId[];
  dynamicItems: ItemInstanceId[];
  fields: FieldInstance[];
}
```

### Por quê

Em milhares de hunts:

- geometria é majoritariamente imutável;
- ocupação é pequena e mutável.

Isso permite compartilhar `TileDefinition` entre várias instâncias do mesmo mapa sem duplicar tudo em memória.

## 9.3 Índice espacial

TFS usa quadtree porque possui um mundo muito grande e compartilhado.[^tfs-map]

Não copiar automaticamente.

Para uma Hunt pequena:

```text
array/map por coordenada
```

é mais simples.

Para Cidade com centenas de players, usar depois:

```text
grid cells / AOI buckets
```

A estrutura deve ser escolhida pelo workload, não pela fidelidade ao TFS.

---

# 10. Movimento

Movimento é mais do que alterar coordenada.

O pipeline recomendado:

```text
MoveCommand
↓
resolve destination
↓
validar floor/adjacência
↓
validar tile
↓
validar ocupação
↓
validar blockers/fields/zones
↓
calcular duração
↓
commit
↓
step-out hooks
↓
step-in hooks
↓
visibility events
↓
controller/path follow update
```

O TFS centraliza a legality do tile e as notifications ao redor do move.[^tfs-move-creature][^tfs-movement-events]

## 10.1 Duração de passo

`Creature` no TFS possui:

- base speed;
- speed modifiers;
- last step;
- step duration;
- walk delay;
- direção/diagonal.

[^tfs-creature]

Draconya deve possuir uma única função:

```ts
movementDuration(creature, from, to): number
```

Ela deve ser usada por:

- humano;
- bot;
- monstro;
- auto-walk.

## 10.2 Push

Guild War do Draconya torna push uma mecânica importante.

Não implementar push como:

```ts
target.position = ...
```

Deve usar o mesmo `MovementSystem`, com:

```text
actor
target
forced movement
destination
legality policy
```

---

# 11. Navigation e pathfinding

Este ponto corrige uma interpretação anterior do projeto.

## 11.1 TFS usa pathfinding

A engine TFS contém A* no `Map`, incluindo custos diferentes para movimento normal e diagonal e regras configuráveis de range/LOS.[^tfs-map]

`Creature` possui `getPathTo`, follow path e parâmetros de busca.[^tfs-creature]

`Monster` possui follow e comportamento de distância e pode solicitar paths.[^tfs-monster]

Portanto:

> “passo guloso sem pathfinding é como o Tibia” não deve ser usado como afirmação técnica geral.

## 11.2 Draconya pode continuar com greedy

Para Hunt comum, o produto explicitamente quer:

```text
barato
previsível
sem pathfinding pesado
```

Isso é válido.

Mas deve ser nomeado:

```text
GreedyChasePolicy
```

e documentado como **simplificação deliberada Draconya**.

## 11.3 Strategies recomendadas

Criar uma interface:

```ts
interface NavigationPolicy {
  nextIntent(context: NavigationContext): NavigationIntent;
}
```

Implementações:

```text
FixedRoutePolicy
GreedyChasePolicy
KeepDistancePolicy
AStarPolicy
FleePolicy
```

### Uso

```text
Hunt bot:
FixedRoutePolicy

Rat comum:
GreedyChasePolicy

Archer mob:
KeepDistancePolicy

Quest click-to-walk:
AStarPolicy

Boss especial:
configurável
```

## 11.4 Workers no futuro

Canary demonstra um modelo moderno:

```text
immutable nav snapshot
↓
worker calcula path candidate
↓
resultado retorna com revision
↓
dispatcher revalida cada commit
```

[^canary-parallel]

Não precisamos disso no MVP.

Mas construir a interface de pathfinding separada evita ter de reescrever combat/monster depois.

---

# 12. Visibility, spectators e interest management

No OpenTibia, “spectator” é qualquer criatura/player que precisa observar uma mudança.

`Map` contém consultas e caches de spectators.[^tfs-map]

Movimento pode gerar fanout para:

```text
old spectators
new spectators
```

Esse fanout é um hot path real documentado no Canary.[^canary-performance]

## Draconya

Separar:

```text
gameplay event
```

de:

```text
viewer event
```

Exemplo:

```text
CreatureMoved
```

é produzido independentemente de haver viewer.

Depois:

```text
PresentationAdapter
```

decide se deve gerar pacote.

### Hunt sem viewer

```text
CreatureMoved
↓
aggregates/state updated
↓
NO socket serialization
```

### Cidade

AOI define quais viewers recebem.

## Não fazer

Não colocar dentro do `sim`:

```ts
if (session.hasViewer) {
  ...
}
```

alterando matemática.

Viewer afeta somente:

- frequência com que o host acorda a sessão;
- quantidade de mensagens;
- interpolation/presentation;
- eventualmente prioridade operacional.

Nunca regra de gameplay.

---

# 13. Creature — a abstração central

A classe `Creature` do TFS concentra capacidades comuns a Player, Monster e NPC.[^tfs-creature]

Ela contém aproximadamente:

```text
identity
position
direction
speed
health
outfit
visibility
walk/follow
attacked target
armor/defense
conditions
master/summons
damage map
death
experience callbacks
think/attack/walk lifecycle
```

## Draconya

Não copiar uma classe gigantesca.

Criar composição:

```ts
interface CreatureState {
  id: CreatureId;
  kind: "player" | "monster" | "npc";
  position: Position;
  direction: Direction;

  resources: ResourceState;
  stats: CreatureStats;

  target?: CreatureId;
  follow?: CreatureId;

  conditions: ConditionStoreState;
  contribution: ContributionState;

  flags: CreatureFlags;
}
```

Módulos separados operam sobre ela:

```text
MovementSystem
TargetingSystem
CombatSystem
ConditionSystem
DeathSystem
```

## Vantagem

Humanos e monstros passam pela mesma legality.

Não criar:

```text
PlayerDamage
MonsterDamage
BotDamage
```

Criar:

```text
CombatSystem.resolve(attacker, defender, ability)
```

com policies específicas quando necessário.

---

# 14. Player — o que aprender e o que NÃO copiar

`Player` no TFS é enorme. Ele agrega:

- Creature;
- protocol;
- inventory;
- containers;
- vocation;
- guild;
- party;
- trade;
- market;
- VIP;
- skills;
- stamina;
- bank;
- depot;
- offline training;
- outfits;
- social state;
- persistence.

[^tfs-player]

Isso é uma consequência histórica de um servidor monolítico.

## Draconya não deve fazer isso

Não criar um `PlayerRuntime` de 3000 linhas.

Separar:

```text
CreatureState
PlayerProgression
Inventory
Equipment
Skills
Account-owned resources
Guild membership
Party state
Session context
```

## Separar viewer

TFS `Player` possui ponte direta para `ProtocolGame`.[^tfs-player][^tfs-protocol]

No Draconya isso seria errado.

O princípio fundamental é:

```text
PlayerRuntime survives socket
```

Portanto:

```text
Viewer ≠ Player
Viewer ≠ Session
```

Manter a arquitetura atual do Draconya.

---

# 15. MonsterDefinition vs MonsterRuntime

TFS separa definição do tipo de monstro (`MonsterType`) da instância runtime (`Monster`).[^tfs-monsters][^tfs-monster]

A definição contém:

- HP;
- speed;
- defense;
- armor;
- XP;
- immunities;
- resistances;
- attack spells;
- defense spells;
- target distance;
- flee threshold;
- summon configuration;
- loot;
- flags.

A instância contém:

- target list;
- friends;
- current target/follow;
- timers;
- spawn;
- current HP;
- AI state.

## Adotar no Draconya

```ts
interface MonsterDefinition {
  id: string;
  appearanceId: number;

  baseStats: CreatureStats;
  resistances: ResistanceTable;
  immunities: ImmunitySet;

  attacks: MonsterAbilityDefinition[];
  behavior: MonsterBehaviorDefinition;

  lootTableId: string;
  experience: number;
}

interface MonsterRuntime {
  creature: CreatureState;
  definitionId: string;
  controllerState: MonsterControllerState;
  spawnSlotId?: string;
}
```

Nenhuma regra de balanceamento hardcoded no runtime.

---

# 16. Monster AI

O TFS `Monster` não toma uma única decisão “andar ou atacar”.

Ele mantém estado:

```text
target list
friend list
attacked creature
follow creature
idle
flee
spawn range
attack timers
defense timers
target change timers
```

[^tfs-monster]

Isso evita rediscoveries desnecessárias.

## Pipeline recomendado

```text
Observe
↓
maintain target candidates
↓
select target if needed
↓
choose intention
  ├ attack
  ├ move
  ├ flee
  ├ ability
  └ idle
↓
submit command
↓
central systems revalidate
```

## Controller

Criar:

```ts
interface Controller {
  nextCommands(ctx: ControllerContext): GameCommand[];
}
```

Implementações:

```text
MonsterController
BotController
```

Human input entra pelo servidor como os mesmos `GameCommand`s; não precisa ser um controller persistente dentro do `sim`.

## Idle monsters

TFS remove monstros ociosos de parte dos checks até algo relevante ocorrer.[^tfs-monster]

Adotar conceito:

> se nenhum evento pode mudar o monstro antes de `T`, ele não precisa receber `think()` repetidamente.

No scheduler lógico, apenas agendar quando necessário.

---

# 17. Targeting

Não espalhar checks de target dentro de cada habilidade.

Criar `TargetingSystem`.

TFS verifica, em diferentes camadas:

- criatura válida;
- attackable;
- visibility;
- floor;
- zones;
- PvP restrictions;
- range;
- LOS.

[^tfs-combat][^tfs-monster]

## Draconya

```ts
interface TargetQuery {
  actorId: CreatureId;
  targetId: CreatureId;
  purpose: "attack" | "heal" | "follow" | "use";
  abilityId?: string;
}
```

Resultado:

```ts
type TargetResult =
  | { ok: true; actor: CreatureState; target: CreatureState }
  | { ok: false; reason: TargetRejectReason };
```

Bot e cliente devem receber a mesma razão de rejeição quando fizerem a mesma ação.

---

# 18. Combat — o pipeline que não deve ser reinventado por feature

TFS possui um `Combat` genérico separado de Weapon, Spell e Monster AI.[^tfs-combat]

`CombatParams` suporta:

- damage type;
- origin;
- conditions;
- dispel;
- armor/shield blocking;
- resistances;
- effects;
- area;
- callbacks.

A arquitetura importa mais que a fórmula.

## Pipeline Draconya recomendado

Todo dano/heal deve passar por:

```text
1. Command eligibility
2. Actor resolution
3. Target resolution
4. Session/ruleset legality
5. Zone legality
6. Floor/range/LOS
7. Cooldown
8. Resource / weapon / ammunition / supply check
9. Raw effect calculation
10. Defender mitigation
11. Damage modifiers / dodge / resistances
12. Apply resource delta
13. Apply conditions
14. Track contribution
15. Emit combat events
16. Check death
17. Death pipeline
```

## 18.1 Resolver atual de damage

O `packages/sim/src/combat/damage.ts` atual pode ser preservado.

Mas deve passar a representar:

```text
stage 9–11
```

e não “o sistema de combate inteiro”.

## 18.2 Regra Draconya: player always hits

O design atual diz:

```text
ataques do jogador sempre acertam
Dodge reduz dano recebido em 50%
```

Isso é regra de produto.

Manter.

Não copiar hit chance do Tibia se o PRD não quer isso.

## 18.3 Armor/defense/resistance

TFS oferece hooks separados de defense, armor e immunities; Player e Monster podem customizar bloqueio.[^tfs-creature][^tfs-block]

O Draconya deve ter etapas explícitas, mesmo que inicialmente algumas sejam identity functions:

```ts
damage = applyDefense(...)
damage = applyArmor(...)
damage = applyResistance(...)
damage = applyDodge(...)
```

Isso evita reescrever o pipeline quando itens e buffs chegarem.

---

# 19. Area Combat

TFS possui `AreaCombat`, com matrizes/formas usadas para determinar tiles afetados.[^tfs-combat]

Draconya deveria criar desde cedo uma abstração pequena:

```ts
type AreaShape =
  | { kind: "single" }
  | { kind: "radius"; radius: number }
  | { kind: "beam"; length: number; width: number }
  | { kind: "cone"; length: number; spread: number }
  | { kind: "ring"; inner: number; outer: number };
```

Resolver:

```text
origin + direction/target
↓
affected tiles
↓
entities
↓
combat legality por alvo
```

Não hardcode cada magia com loops próprios.

---

# 20. Conditions — um dos sistemas mais importantes para copiar conceitualmente

TFS modela status temporários com uma classe genérica `Condition` e subclasses.[^tfs-condition]

Existem conditions para:

- damage over time;
- regeneration;
- speed;
- attributes;
- invisibility;
- outfit;
- light;
- cooldown;
- spell group cooldown;
- drunk;
- outros.

Cada condition possui ciclo:

```text
start
execute
merge/update
end
serialize
unserialize
```

## Draconya precisa de Condition Engine

Antes de implementar muitas magias, criar:

```ts
interface ConditionInstance {
  id: string;
  type: ConditionType;
  sourceId?: EntityId;

  startedAt: LogicalTimeMs;
  expiresAt?: LogicalTimeMs;

  nextTickAt?: LogicalTimeMs;
  payload: SerializableConditionPayload;

  stackingKey: string;
}
```

## Políticas de stacking

```ts
type ConditionMergePolicy =
  | "replace"
  | "refresh"
  | "extend"
  | "strongest"
  | "stack"
  | "ignore-weaker";
```

A decisão deve ser por definição de condition/ability.

## Eventos

```text
ConditionAdded
ConditionRefreshed
ConditionTicked
ConditionRemoved
```

## Vantagem

Sem isso, cada feature inventará:

```text
poison timer
haste timer
paralyze timer
ring buff timer
spell cooldown timer
imbuement timer
```

com regras incompatíveis.

---

# 21. Cooldowns

TFS modela cooldown de spell e spell group como conditions específicas.[^tfs-condition][^tfs-spells]

O Draconya não precisa necessariamente tratar cooldown literalmente como `Condition`, mas deve copiar dois princípios:

1. cooldown é estado serializável;
2. cooldown individual e de grupo são coisas distintas.

## Recommended

```ts
interface CooldownBook {
  abilityReadyAt: Record<string, LogicalTimeMs>;
  groupReadyAt: Record<string, LogicalTimeMs>;
}
```

Para o bot:

```text
Healing category
Potion category
Attack Spell category
Rune category
Support category
```

podem ser groups distintos se essa é a regra de produto.

## Nunca guardar

```ts
performance.now() + cooldown
```

em snapshot.

Guardar:

```text
logical dueAt
```

---

# 22. Spells e abilities

TFS separa:

```text
Spell
├ InstantSpell
└ RuneSpell
```

e o spell possui metadados como:

- level;
- magic level;
- mana;
- vocation;
- cooldown;
- group cooldown;
- range;
- target requirement;
- weapon requirement;
- LOS;
- aggressive;
- PZ lock.

[^tfs-spells]

## Draconya

Criar um conceito mais genérico:

```ts
interface AbilityDefinition {
  id: string;
  kind: "spell" | "rune" | "weapon" | "item";

  requirements: AbilityRequirements;
  targeting: TargetingDefinition;

  cost: AbilityCost;
  cooldown: AbilityCooldown;

  effect: AbilityEffectDefinition;
}
```

### AbilityRequirements

```text
level
vocation
promotion
weapon class
skill
mode restrictions
```

### TargetingDefinition

```text
self
target creature
target tile
direction
area
range
LOS
same floor
```

### AbilityCost

```text
mana
gold-backed supply
charges
ammunition
other resources
```

## Bot

O bot só seleciona:

```text
useAbility(abilityId, target)
```

Quem valida é a engine.

---

# 23. Weapons

TFS possui um subsistema próprio de Weapons e especializações Melee, Distance e Wand.[^tfs-weapons]

Ele faz:

```text
weapon eligibility
ammo
range
formula
element
cost
charges
combat
```

## Draconya

Não criar `KnightAttackSystem`, `ArcherAttackSystem`, etc.

Criar:

```text
WeaponDefinition
↓
BasicAttackAbility
↓
CombatSystem
```

Diferenças de classe ficam em:

```text
weapon data
stats
formulas
abilities
```

---

# 24. Items — definition vs instance

TFS distingue dados de item de atributos da instância.[^tfs-item]

Uma instância pode possuir:

- charges;
- duration;
- owner;
- text;
- attack;
- defense;
- armor;
- custom attributes;
- decay state.

## Draconya

Separar:

```ts
interface ItemDefinition {
  id: string;
  appearanceId: number;
  category: ItemCategory;
  weight: number;
  stackSize: number;
  equipRules?: EquipRules;
  baseStats?: ItemStats;
}

interface ItemInstance {
  id: ItemInstanceId;
  definitionId: string;
  quantity: number;
  charges?: number;
  remainingMs?: number;
  modifiers?: ItemModifier[];
  provenance?: ItemProvenance;
}
```

Isso será importante para:

- legendary;
- imbuement;
- ring duration;
- necklace charges;
- provenance;
- market.

---

# 25. Inventory e Container

TFS usa `Container` como destino que sabe:

- capacity;
- item count;
- weight;
- add/remove legality;
- nested containers;
- notifications.

[^tfs-container]

O Draconya não precisa reproduzir toda a complexidade de backpack dentro de backpack se o PRD não exigir.

Mas precisa copiar:

> movimentação de item é uma transação, não duas mutações soltas.

## `InventoryTransaction`

Exemplo:

```text
equip ring
↓
validate source ownership
validate slot
validate level/vocation
validate current equipment
validate destination for old ring
↓
commit all changes
↓
emit EquipmentChanged
```

Se qualquer etapa falhar:

```text
zero mudança
```

Isso é fundamental para bot server-side com troca automática de ring.

---

# 26. Ground items, stack position e corpses — o que rejeitar

OpenTibia possui forte semântica de:

```text
ground
down items
top items
creatures
stack position
corpse container
```

Isso é necessário para o cliente/protocolo Tibia.

O Draconya deliberadamente simplifica loot:

- item não precisa cair fisicamente;
- auto-sell pode transformar direto em gold;
- loot session box existe;
- cadáver como container não é requisito.

Portanto:

> **não reproduzir o sistema de stackpos/corpse como requisito de engine.**

Manter apenas o que for necessário para:

- render layering;
- tile blocking;
- field effects;
- interactive objects.

---

# 27. Actions e UseItem

TFS possui `Actions` com checks separados para:

- item use;
- far use;
- floor;
- LOS;
- target.

[^tfs-actions]

## Draconya

Criar:

```text
UseItemCommand
↓
ItemActionResolver
↓
target legality
↓
effect
```

Itens não devem possuir callbacks arbitrários espalhados.

Um registry:

```ts
itemActions.register("teleport-scroll", handler)
```

pode existir, mas o handler precisa receber APIs limitadas da engine.

---

# 28. Movement Events e Domain Hooks

TFS possui eventos:

```text
STEP_IN
STEP_OUT
EQUIP
DEEQUIP
ADD_ITEM
REMOVE_ITEM
```

[^tfs-movement-events]

Esse padrão é excelente.

## Draconya

Criar domain hooks tipados:

```text
OnCreatureMoved
OnStepIn
OnStepOut
OnEquipped
OnUnequipped
OnDamageApplied
OnHealApplied
OnConditionAdded
OnConditionRemoved
OnCreatureDied
OnCreatureKilled
OnSpawned
OnLootRolled
```

## Regra

Callbacks:

- têm ordem determinística;
- não fazem I/O;
- não acessam socket;
- só operam via context da engine;
- produzem comandos/events quando possível.

---

# 29. Spawn

TFS modela spawn como slots/blocos com:

- posição;
- tipos possíveis;
- last spawn;
- interval;
- direction;
- occupant tracking.

[^tfs-spawn]

## Draconya

A estrutura atual de `hunt/spawner.ts` já está próxima de uma boa abstração.

Preservar:

```text
SpawnPointDefinition
DifficultyComposition
SpawnSlot
occupantId
```

Alterar timing para scheduler lógico:

```text
monster dies
↓
slot becomes empty
↓
schedule SpawnDue(slotId, logicalTime + respawnDelay)
```

Não manter polling desnecessário.

## Diferença de produto

TFS pode suprimir/alterar spawn por proximidade de players.

Hunt Draconya possui densidade fixa por design.

Não copiar suppression aleatória.

---

# 30. Death, damage attribution e kill credit

A `Creature` do TFS mantém damage contribution e, na morte, distingue ao menos:

- last hit;
- most damage.

O fluxo então pode produzir corpse/loot/death callbacks.[^tfs-death][^tfs-creature]

## Mesmo sem corpse, Draconya deve manter attribution

Criar:

```ts
interface ContributionState {
  damageByActor: Record<CreatureId, number>;
  lastHitBy?: CreatureId;
  lastDamageAt?: LogicalTimeMs;
}
```

Porque futuramente isso serve para:

- XP;
- party;
- boss reward eligibility;
- kill attribution;
- analytics;
- PvP;
- bestiary.

## Death pipeline

```text
HP <= 0
↓
DeathDetected
↓
freeze further actions
↓
resolve killer/contributors
↓
ruleset-specific death consequences
↓
loot/reward
↓
XP/credit
↓
despawn/respawn/session transition
↓
events
```

### Ruleset define consequência

```text
Hunt:
end session → PZ

Guild War:
respawn according to match rules

Boss:
difficulty-specific consequence

City/PZ:
normally no death
```

Não codificar isso dentro de `Creature`.

---

# 31. Loot

TFS coloca loot na definição do monstro, com chance/count e nested loot blocks.[^tfs-monsters]

Draconya deve ter uma tabela própria:

```ts
interface LootTable {
  rolls: LootRoll[];
}
```

## Pipeline

```text
monster death
↓
eligibility
↓
stamina gate
↓
RNG roll
↓
item result
↓
destination policy
   ├ auto-sell
   ├ inventory
   └ session loot box
↓
aggregates
```

## Importante

O Linear atual contém `FUN-63 — Loot por abate não existe, e a FUN-43 fechou sem ele`.

O replanejamento deve tratar loot como parte do **Death/Reward pipeline**, não uma adição isolada ao HuntRuleset.

---

# 32. Vocation, stats e progressão

TFS `Vocation` contém dados para:

- HP gain;
- mana gain;
- cap gain;
- regen;
- attack speed;
- base speed;
- damage multipliers;
- skill requirements;
- magic progression.

[^tfs-vocation]

## Draconya

`progression.ts` e content-driven stats devem ser preservados.

Não copiar fórmulas do Tibia automaticamente.

Adotar o princípio:

```text
engine owns mechanism
content owns numbers
```

Exemplo:

```ts
levelUp(character, vocationDefinition)
```

nunca:

```ts
if (vocation === "knight") hp += 20;
```

---

# 33. Skills

TFS Player possui skill progression e tries.[^tfs-player]

Draconya decidiu skills “como Tibia”, por uso.

Criar um subsystem explícito:

```ts
interface SkillProgression {
  skillId: string;
  level: number;
  tries: bigint;
}
```

Combat/movement/action gera:

```text
SkillPracticeEvent
```

ProgressionSystem decide ganho.

Isso evita colocar skill-up dentro de Weapon.

---

# 34. Stamina e offline time

TFS possui stamina e offline training no Player.[^tfs-player]

Draconya possui regras diferentes:

- máximo 24 h;
- consumo em Hunt;
- recuperação 1:1 fora;
- 0 stamina não encerra Hunt;
- sem XP/loot/bestiary a 0.

## Arquitetura

Não implementar stamina como “tick a cada segundo”.

Usar função temporal/closed-form quando possível:

```text
staminaAt(t)
```

ou atualizar somente em transitions.

Separar:

```text
session logical time
```

de:

```text
wall-time progression permitida pelo produto
```

Stamina recuperada fora de Hunt pode precisar de wall clock persistente; esse cálculo pertence à camada de progressão/persistência, não ao scheduler de combate.

---

# 35. Scripting e BaseEvents

TFS possui um framework extenso de events/Lua.[^tfs-baseevents]

Lua é usado para:

- spells;
- actions;
- movement;
- monsters;
- callbacks;
- quests;
- conteúdo.

## Draconya

Não adicionar Lua agora.

A primeira versão deve ser:

```text
JSON/Zod data
+
typed registries
+
TypeScript handlers
```

Por exemplo:

```ts
interface EnginePlugin {
  onEvent(event: DomainEvent, ctx: EngineContext): void;
}
```

## Quando considerar scripting

Somente quando houver evidência de que:

- conteúdo está exigindo deploy para mudanças triviais;
- designers precisam de custom logic;
- quests/bosses estão ficando impraticáveis em data-only.

Se adicionar scripting futuramente:

- sandbox;
- deterministic APIs;
- no I/O;
- no wall clock;
- no unrestricted randomness;
- versioned API.

---

# 36. Protocol e networking — referência e anti-referência

`ProtocolGame` do TFS:

- parseia comandos;
- conhece Player;
- envia tiles;
- envia creatures;
- sends stats;
- cooldowns;
- inventory;
- containers;
- chat;
- etc.

[^tfs-protocol]

## O padrão útil

```text
network input
↓
parse
↓
stable IDs / command
↓
serialized game mutation
```

## O que rejeitar

No TFS:

```text
ProtocolGame ↔ Player
```

No Draconya:

```text
ViewerAdapter → GameCommand
Session → DomainEvent → ViewerAdapter
```

O viewer pode desaparecer e voltar sem destruir runtime.

---

# 37. Persistence

TFS possui loaders e serializers próprios para player/map/item/world state.

O Draconya já tem uma arquitetura mais adequada:

```text
Postgres
Redis snapshots
ledger
session directory
```

Não copiar persistência OpenTibia.

## O que aprender

Persistir estados que realmente alteram a continuidade:

- conditions;
- cooldowns;
- RNG;
- target/follow se relevante;
- scheduler logical events;
- spawn slots;
- inventory/equipment;
- contributions quando necessários;
- ruleset state.

Snapshot não deve conter:

- socket;
- viewer;
- Node timer;
- `performance.now()`;
- callback closure;
- object pointer/reference.

---

# 38. Snapshot architecture recomendada

```ts
interface SessionSnapshot {
  formatVersion: number;
  contentVersion: string;

  sessionId: string;
  type: SessionType;

  logicalTimeMs: number;
  scheduler: SchedulerSnapshot;

  rng: RngState;

  world: WorldSnapshot;
  ruleset: RulesetSnapshot;

  aggregates: SessionAggregates;
  notableEvents: NotableEvent[];

  ledgerSeq: number;
}
```

## SchedulerSnapshot

```ts
interface SchedulerSnapshot {
  nextSequence: number;
  events: SerializableScheduledEvent[];
}
```

## Regra

Depois de:

```text
snapshot → JSON stringify → parse → restore
```

o resultado da simulação deve continuar idêntico.

---

# 39. Content versioning

Draconya já fixa content version na sessão.

Essa é uma excelente decisão.

O Linear atual também registra uma questão em `FUN-57`:

> hash de conteúdo estrito pode encerrar Hunts mesmo quando uma mudança é compatível.

Isso merece evolução futura.

## Modelo possível

Separar:

```text
contentHash
```

de:

```text
simulationCompatibilityVersion
```

Exemplo:

```json
{
  "contentVersion": "sha256:...",
  "simulationCompatibility": 17
}
```

Mudança de nome/visual:

```text
hash muda
compatibility permanece
```

Mudança de fórmula/monster stats usados pela sessão:

```text
compatibility muda
```

Não implementar necessariamente agora, mas o novo plano deve considerar.

---

# 40. Canary moderno — performance e lifetime

Canary possui documentação extremamente relevante porque o projeto já enfrentou gargalos de monster-heavy workload.

Os hotspots documentados incluem:

- movement;
- spectator fanout;
- monster AI;
- pathfinding;
- task lifecycle;
- pointer lifetime overhead.

[^canary-performance]

## 40.1 Lição 1 — pathfinding não é sempre o maior custo

Em stress, Canary encontrou forte custo em:

```text
task allocation
dispatcher churn
movement
spectators
target list updates
```

Não otimizar exclusivamente A*.

## 40.2 Lição 2 — trabalho visível primeiro

Canary distingue lanes como:

```text
ProtocolInput
PlayerWalk
PlayerAction
WorldCommit
VisibleMonster
BackgroundMonster
VisibleMonsterAI
MonsterAI
Deferred
Maintenance
```

[^canary-dispatcher]

A engine protege latência do player sem deixar background morrer completamente.

## 40.3 Lição 3 — workers calculam intenção

Direção explícita:

```text
worker:
compute candidates / path / ranking

dispatcher:
re-resolve
revalidate
RNG
commit state
damage
effects
Lua
network
```

[^canary-parallel]

## 40.4 Lição 4 — bounded work

Todas as filas precisam ter:

- capacity;
- budget;
- overflow semantics;
- cancellation/stale handling.

## 40.5 Lição 5 — no catch-up burst por overload

Já discutido na seção de tempo.

---

# 41. Estratégia de concorrência para Draconya

Antes de paralelizar dentro de uma Hunt:

> paralelize **entre sessões**.

Uma Hunt possui:

```text
1–4 players
10–40 monsters
map pequeno
```

É uma ótima unidade single-writer.

Arquitetura:

```text
Process
├ Session A
├ Session B
├ Session C
...
```

Cada sessão pode ser executada isoladamente.

No futuro:

```text
worker/thread/process partition
```

por sessão ou batch de sessões.

## Só paralelizar dentro da sessão se profiling provar necessidade

Se um boss/mapa complexo precisar:

```text
pathfinding background
AI ranking background
```

seguir modelo Canary:

```text
snapshot immutable
→ worker
→ result
→ revalidation
→ commit
```

---

# 42. Controller architecture — humano, bot e monstro

Este é um dos principais objetivos do Plano 2.

## 42.1 Anti-pattern

```text
Human combat path
Bot combat path
Monster combat path
```

## 42.2 Recomendado

```text
        Human input
            │
        BotController
            │
     MonsterController
            │
            ▼
       GameCommand
            │
            ▼
        Game Engine
```

Comandos:

```ts
type GameCommand =
  | MoveCommand
  | AttackCommand
  | FollowCommand
  | UseAbilityCommand
  | UseItemCommand
  | EquipCommand
  | InteractCommand;
```

## Bot

O bot pode decidir:

```text
HP < 50%
→ UseAbility("exura-gran-like")

3 monsters near
→ UseAbility("aoe-rune")

route available
→ Move(nextRouteTile)
```

Mas nunca:

```text
player.hp += 200
```

---

# 43. Event architecture

Depois de um commit, engine emite domain events.

Exemplo:

```ts
type DomainEvent =
  | CreatureMoved
  | CreatureTurned
  | DamageApplied
  | HealApplied
  | ConditionAdded
  | ConditionRemoved
  | AbilityUsed
  | ItemConsumed
  | EquipmentChanged
  | CreatureDied
  | LootGranted
  | ExperienceGranted
  | LevelChanged
  | Spawned;
```

Consumidores:

```text
Ruleset
Session aggregates
Notable events
Protocol adapter
Metrics
Replay/debug trace
```

## Regra

Um event não é a fonte de verdade.

Estado autoritativo permanece em `SessionWorld`.

---

# 44. Ruleset

O conceito atual de Ruleset do Draconya deve ser mantido.

Mas Ruleset não deve virar engine.

Ruleset responde:

```text
quais sistemas estão ativos?
quais transições são permitidas?
o que acontece na morte?
quais recompensas existem?
quando termina?
```

Não deve implementar:

```text
movement legality
damage formula
condition ticking
inventory movement
targeting
```

## Exemplos

### HuntRuleset

```text
fixed route
spawn config
AFK bot
stamina reward gate
end rules
death → PZ
```

### CityRuleset

```text
no combat
shared world
manual movement
chat/interactions
```

### GuildWarRuleset

```text
PvP enabled
match scoring
respawn rules
no normal death penalty
```

---

# 45. O que manter do `packages/sim` atual

A análise do snapshot fornecido anteriormente mostra que o `packages/sim` ainda é pequeno e refatorável.

O Claude deve auditar o checkout atual, porque o Linear avançou desde esse snapshot.

## Manter conceitualmente

### `session.ts`

Manter:

- Session;
- ruleset;
- participants;
- aggregates;
- notable events;
- snapshot;
- RNG;
- viewer count como metadata operacional.

Mudar:

```text
lastTickMs / rebase clock
```

para:

```text
logicalTimeMs / deterministic scheduler
```

### `rng.ts`

Manter RNG determinístico.

Garantir:

- state serializado;
- mesma sequência após restore;
- nenhuma chamada a `Math.random()` dentro do sim.

### `combat/damage.ts`

Manter fórmulas existentes.

Reposicionar como estágio do Combat pipeline.

### `progression.ts`

Manter content-driven stats/progression.

### `route/walker.ts`

Manter:

- route index;
- loop;
- stop/resume;
- rejoin semantics.

Refatorar para produzir comandos de movimento, em vez de ser um mini scheduler independente.

### `hunt/spawner.ts`

Manter:

- difficulty composition;
- spawn slots;
- deterministic selection.

Integrar com scheduler e world occupancy.

### Rulesets

Manter conceito e snapshots.

---

# 46. O que refatorar do `packages/sim`

## `cooldown.ts`

Substituir qualquer timestamp baseado em processo por logical time.

Evitar dois modelos temporais independentes:

```text
until
accumulated
```

se scheduler puder ser a fonte única.

## `character.ts`

Evoluir para:

```text
CreatureState
+
Player-specific state
```

sem virar monólito.

## `monster/monster.ts`

Separar:

```text
MonsterRuntime
MonsterController
MonsterDefinition
```

## `monster/step.ts`

Renomear conceitualmente para:

```text
GreedyChasePolicy
```

Remover documentação que o trate como comportamento geral fiel ao TFS.

## Session tick

Remover dependência semântica de:

```text
“cada sistema precisa calcular o que aconteceu em dtMs”
```

Migrar gradualmente para eventos lógico-temporais.

---

# 47. Target package architecture

Uma estrutura possível:

```text
packages/sim/src/

  core/
    ids.ts
    time.ts
    scheduler.ts
    commands.ts
    events.ts
    result.ts
    errors.ts

  session/
    session.ts
    snapshot.ts
    ruleset.ts
    aggregates.ts

  world/
    position.ts
    tile.ts
    world.ts
    occupancy.ts
    zones.ts
    visibility.ts

    movement/
      movement-system.ts
      movement-policy.ts

    navigation/
      navigation-policy.ts
      fixed-route.ts
      greedy-chase.ts
      keep-distance.ts
      astar.ts

  creatures/
    creature.ts
    player.ts
    monster.ts
    stats.ts
    targeting.ts
    contribution.ts

  controllers/
    controller.ts
    monster-controller.ts

    bot/
      bot-controller.ts
      rule-evaluator.ts
      lure-policy.ts
      targeting-policy.ts

  combat/
    combat-system.ts
    legality.ts
    targeting.ts
    damage.ts
    mitigation.ts
    area.ts
    death.ts

  conditions/
    condition.ts
    condition-store.ts
    merge-policy.ts
    builtins/

  abilities/
    ability.ts
    spell.ts
    weapon.ts
    costs.ts
    cooldowns.ts

  items/
    definition.ts
    instance.ts
    inventory.ts
    equipment.ts
    transaction.ts
    loot.ts

  progression/
    level.ts
    skills.ts
    vocation.ts
    stamina.ts

  hunt/
    hunt-ruleset.ts
    route.ts
    spawn.ts

  city/
    city-ruleset.ts

  guild-war/
    guild-war-ruleset.ts
```

Isso é referência, não obrigação de nomes/pastas exatos.

---

# 48. Dependências internas permitidas

Objetivo:

```text
core
↑
world
↑
creatures
↑
systems
↑
rulesets/controllers
```

Evitar circularidade.

Exemplo:

```text
CombatSystem pode usar CreatureState e Condition APIs
Condition não deve importar HuntRuleset
MonsterController pode usar NavigationPolicy
Navigation não deve importar MonsterController
```

`sim` continua sem importar:

- server;
- Redis;
- Postgres;
- WebSocket;
- React;
- filesystem.

---

# 49. Replanejamento recomendado

O Linear atual avançou significativamente desde o ZIP usado na primeira análise.

Na consulta de 2026-09-09, já aparecem como `Done`, entre outras:

- FUN-30
- FUN-36
- FUN-37
- FUN-38
- FUN-39
- FUN-43
- FUN-44
- FUN-45
- FUN-47
- FUN-52
- FUN-53
- FUN-54
- FUN-55
- FUN-56

e surgiram issues novas como:

- FUN-57
- FUN-58
- FUN-59
- FUN-60
- FUN-62
- FUN-63
- FUN-65
- FUN-66

Portanto:

> não reabrir ou invalidar issues automaticamente.

O Claude Code deve primeiro verificar o código atual e criar um **plano de migração da engine**, relacionando trabalho novo às entregas existentes.

---

# 50. Fase R0 — Audit e behavior freeze

Antes de refatorar:

1. executar toda suíte;
2. mapear interfaces públicas do `sim`;
3. mapear quem chama `Session.tick/advance`;
4. mapear snapshots atuais;
5. registrar behavior tests dos fluxos já entregues;
6. identificar quais issues `Done` precisam apenas de adaptação interna;
7. confirmar estado atual de FUN-26;
8. revisar FUN-57 como lista de decisões contestáveis;
9. mapear bugs FUN-58, FUN-60, FUN-63 e FUN-66 para os novos systems.

Saída:

```text
ENGINE_MIGRATION_BASELINE.md
```

---

# 51. Fase R1 — Logical Time + Scheduler

Prioridade máxima.

Criar:

```text
SessionClock
SessionScheduler
SerializableScheduledEvent
```

Migrar:

- cooldowns;
- movement cadence;
- monster action cadence;
- respawn;
- periodic conditions quando existirem.

## Acceptance

```text
10 × 100 ms == 1 × 1000 ms
```

para uma simulação equivalente.

Snapshot/restore com host clock totalmente diferente deve manter:

- readiness;
- conditions;
- RNG;
- scheduled events.

Nenhum timer de gameplay usa `performance.now()`.

---

# 52. Fase R2 — World + Tile + Movement

Criar fonte única de verdade para movimento.

Cobrir:

- walk;
- walk-to;
- tile blocking;
- creature occupancy;
- diagonal;
- z/floor validation;
- zone hooks;
- move events;
- push foundation.

Isso é diretamente relevante para `FUN-58`.

## Acceptance

Nenhum código externo ao MovementSystem altera posição diretamente.

---

# 53. Fase R3 — Creature + Controller separation

Extrair CreatureState compartilhado.

Separar Monster data/runtime/controller.

Introduzir GameCommand.

Adaptar Bot para emitir GameCommand.

## Acceptance

Mesma sequência de comandos humanos vs bot produz mesmo resultado.

---

# 54. Fase R4 — Combat + Conditions + Abilities

Transformar o damage resolver atual num pipeline completo.

Construir Condition Engine antes de proliferarem timers de spells/status.

Adicionar Ability definitions.

## Acceptance

- range/LOS/floor/cooldown/resource checks centralizados;
- damage pipeline único;
- conditions serializáveis;
- cooldown group;
- combat events determinísticos.

---

# 55. Fase R5 — Monster AI + Navigation

Manter greedy para mobs de Hunt.

Adicionar interfaces para:

- target maintenance;
- keep distance;
- flee;
- A* onde necessário;
- idle/wake.

## Acceptance

MonsterController não move criatura diretamente.

Ele emite intenção.

---

# 56. Fase R6 — Inventory + Equipment + Loot + Progression

Criar transações atômicas.

Integrar:

- equipment;
- rings;
- necklaces;
- supply;
- auto-sell;
- loot box;
- loot per kill;
- XP;
- skills;
- stamina gates.

`FUN-63` deve ser resolvida aqui como parte do pipeline normal.

---

# 57. Fase R7 — Hunt vertical slice reconstruída sobre a engine comum

Reimplementar/adaptar Hunt usando:

```text
Ruleset
BotController
FixedRoutePolicy
SpawnSystem
MonsterController
Combat
Loot
Progression
Death
```

Nenhuma regra duplicada.

## Acceptance

Fluxo completo:

```text
enter hunt
→ bot moves
→ mob sees player
→ mob moves
→ combat
→ condition/cooldown if any
→ monster dies
→ loot
→ XP
→ spawn
→ route resumes
→ snapshot
→ browser closes
→ continues
→ restore
```

---

# 58. Fase R8 — Quest, Boss e Guild War

Só depois da engine comum.

Isso força os systems a provar que não são específicos da Hunt.

### Quest/Boss

Exercitam:

- A*;
- manual input;
- LOS;
- mechanics;
- area spells;
- conditions;
- death variations.

### Guild War

Exercita:

- PvP;
- push;
- respawn;
- scoring;
- multiple players;
- real-time priority.

---

# 59. Fase R9 — City / AOI

Completar:

- shared world;
- visibility;
- AOI;
- chat events;
- many players;
- movement fanout.

Só implementar quadtree ou estrutura mais sofisticada se profiling pedir.

---

# 60. Fase R10 — Performance e produção

`FUN-46` deve ser o início, não o fim, de performance testing.

Medir:

```text
cost/session
cost/scheduled event
memory/session
events/s
viewer bytes/s
snapshot bytes
restore latency
```

Separar benchmarks:

```text
5000 cold detached hunts
attached hunts
city
boss
guild war
```

## Hardware

FUN-57 registra que números atuais foram medidos em Apple M2.

Repetir em hardware alvo antes de validar capacidade de produção.

---

# 61. Test contract obrigatório

A nova engine deve ter testes por propriedade/invariante, não apenas examples.

## 61.1 Determinism

Mesmos:

```text
content version
seed
commands
logical time
```

produzem snapshot byte-equivalent/canonical-equivalent.

## 61.2 Frequency invariance

```text
1 × advanceBy(1000)
```

vs:

```text
10 × advanceBy(100)
```

para casos apropriados.

## 61.3 Restore invariance

```text
run → snapshot → restore → run
```

igual a:

```text
run continuously
```

## 61.4 Different host clock

Restore com wall/monotonic clock completamente diferente não altera resultado.

## 61.5 Scheduler order

Eventos com mesmo `dueAt` obedecem priority + sequence determinísticos.

## 61.6 Bot/human parity

Mesmo GameCommand:

```text
bot source
human source
```

→ mesmo resultado.

## 61.7 Movement legality

Tabela de casos:

- blocked tile;
- creature occupied;
- diagonal;
- floor mismatch;
- zone;
- force movement;
- push.

## 61.8 Inventory atomicity

Falha em qualquer check não produz estado parcial.

## 61.9 Conditions

Cobrir:

- add;
- refresh;
- replace;
- strongest;
- expire;
- periodic tick;
- snapshot.

## 61.10 Combat

Cobrir ordem de:

```text
eligibility
target
range
LOS
cooldown
cost
damage
mitigation
condition
death
```

## 61.11 RNG

Mudança de granularidade temporal não deve alterar quantidade/ordem de draws quando outcome lógico é o mesmo.

## 61.12 Snapshot compatibility

Snapshot incompatível nunca é apagado/resetado silenciosamente.

---

# 62. Observability da engine

Criar tracing opcional determinístico para testes/debug:

```ts
interface SimulationTraceEntry {
  logicalTime: number;
  sequence: number;
  kind: string;
  entityId?: string;
  details: unknown;
}
```

Exemplo:

```text
1000 Spawn rat-1
1500 Move rat-1 3,4 → 4,4
2000 Attack rat-1 → player
2000 Damage 22
```

Isso torna bugs de determinismo comparáveis.

Não habilitar trace pesado por padrão em produção.

---

# 63. Performance guardrails desde o design

## Não fazer O(all entities) por tick sem necessidade

Perguntar sempre:

> o que acorda esta entidade?

Se resposta for apenas “o tick chamou”, revisar.

## Scheduler

Heap/priority queue ou calendar structure simples basta inicialmente.

5000 sessions × poucos eventos não exige arquitetura complexa antes de benchmark.

## Avoid allocations in hot loops

Canary encontrou allocator/task churn como custo real.[^canary-performance]

No TS:

- evitar objetos temporários gigantes em loops;
- reutilizar arrays/context quando seguro;
- não otimizar cedo demais;
- medir GC.

---

# 64. Tabela — adotar, adaptar ou rejeitar

| OpenTibia | Draconya |
|---|---|
| Creature base mechanics | **ADOTAR conceito**, por composição |
| Player/Monster share mechanics | **ADOTAR** |
| Global `Game` singleton | **REJEITAR** |
| Global shared map | **ADAPTAR** para SessionWorld |
| Tile legality | **ADOTAR** |
| Query → commit → notify | **ADOTAR fortemente** |
| A* | **ADOTAR como strategy**, não sempre |
| Greedy only | **DRACONYA-specific** para Hunt |
| Scheduler + dispatcher | **ADAPTAR** para logical scheduler + single writer |
| Conditions | **ADOTAR** |
| Spell/group cooldown | **ADOTAR conceito** |
| Generic Combat pipeline | **ADOTAR** |
| Tibia formulas | **NÃO assumir** |
| MonsterType vs Monster runtime | **ADOTAR** |
| Target/follow state | **ADOTAR** |
| Damage attribution | **ADOTAR** |
| Ground loot/corpse | **REJEITAR por produto** |
| Container transaction | **ADOTAR simplificado** |
| Lua scripting | **ADIAR** |
| Protocol owns Player | **REJEITAR** |
| Login/logout lifecycle == player lifecycle | **REJEITAR** |
| MySQL persistence model | **REJEITAR** |
| Spectator/AOI model | **ADAPTAR** |
| Worker computes intention, serial commit | **ADOTAR quando necessário** |
| Visible/background scheduler priority | **ADOTAR futuramente** |
| Stable IDs across async boundaries | **ADOTAR** |

---

# 65. Checklist antes de implementar qualquer nova mecânica

Claude Code deve responder:

### Mundo

- altera posição?
- altera tile occupancy?
- possui zone/LOS/floor implications?
- passa pelo Movement/World system?

### Tempo

- quando vence?
- usa logical time?
- precisa sobreviver snapshot?
- qual clock scope?

### Combat

- é Ability?
- passa pelo Combat pipeline?
- aplica Condition?
- altera contribution/death?

### Items

- é definition ou instance?
- operação é atômica?
- qual destino do item?
- precisa de charges/duration?

### Bot

- o bot só escolhe comando?
- existe qualquer mutação exclusiva do bot?

### Performance

- isso cria polling periódico?
- poderia ser event-driven?
- acorda entidades sem necessidade?

### Snapshot

- o novo estado é serializado?
- possui versioning?
- restore é determinístico?

---

# 66. Instrução para refazer o plano de construção

Depois de auditar o checkout atual, Claude Code deve produzir um novo plano com:

```text
Epic: Engine Foundation v2 — OpenTibia-informed TypeScript engine
```

O plano deve:

1. listar componentes atuais reutilizados;
2. listar refactors necessários;
3. preservar behavior já entregue;
4. relacionar cada tarefa a issues existentes;
5. não criar duplicatas;
6. criar migration tests antes de grandes mudanças;
7. priorizar Logical Time/Scheduler;
8. depois World/Movement;
9. depois Creature/Controller;
10. depois Combat/Condition/Ability;
11. depois Inventory/Loot;
12. só depois expandir conteúdo.

## Cada issue nova precisa conter

```text
Context
Reference pattern
Draconya adaptation
Non-goals
Files likely affected
Migration strategy
Acceptance tests
Performance implications
Snapshot implications
Related Linear issues
```

---

# 67. Regras de implementação para Claude Code

## MUST

- manter TypeScript para first-party code;
- manter `sim` puro;
- manter server-authoritative;
- manter conteúdo data-driven;
- usar IDs estáveis;
- usar logical time para gameplay;
- snapshotar estado temporal;
- centralizar legality;
- centralizar commits;
- usar mesma ação para humano/bot;
- escrever teste antes de corrigir bug arquitetural;
- rodar `pnpm check`, testes e build.

## MUST NOT

- copiar código GPL;
- criar segundo combat path para bot;
- usar `Date.now`/`performance.now` dentro de estado serializável;
- alterar position/inventory diretamente fora dos systems;
- esconder regra de produto em controller;
- fazer networking dentro do sim;
- adicionar A* em toda Hunt sem necessidade;
- criar polling global de todos os monsters por conveniência;
- apagar snapshot incompatível silenciosamente;
- atrelar player lifecycle ao socket.

---

# 68. Pontos atuais do Linear que o novo plano deve absorver

## FUN-57

Revisar especialmente:

- resting city session vs invariant de “sempre em sessão”;
- ledger zero-value rows;
- materialized `character.gold` reconciliation;
- strict content-hash compatibility;
- benchmark Apple M2;
- API + jobs ownership de settlement.

Esses pontos devem virar decisões arquiteturais/ADRs, não hacks locais.

## FUN-58

`walk`, `walk-to` e `say` chegam ao socket e não são tratados.

`walk` e `walk-to` devem ser resolvidos pelo novo command/movement pipeline.

`say` pertence a messaging/world events, não ao MovementSystem.

## FUN-59

Jobs/orphan observability deve entrar em operational metrics, fora do sim.

## FUN-60

Spawn `(0,0)` numa parede é exemplo de por que placement deve usar `World/Tile legality`.

## FUN-62

Testes dependentes de real sleep/TTL indicam necessidade de clocks injetáveis nas camadas externas também.

## FUN-63

Loot por abate deve ser parte de Death/Reward pipeline.

## FUN-66

Character selection com progresso atrasado é problema de durable projection/materialization, não de sim.

---

# 69. Onde a engine OpenTibia é superior como referência

Ela já prova a necessidade de:

- base comum para creatures;
- legality central;
- target/follow state;
- generic combat;
- conditions;
- spell/weapon abstractions;
- item/container transaction;
- movement hooks;
- spawn lifecycle;
- death attribution;
- event-driven scheduling;
- separation between data definition and runtime instance.

Esses são problemas que não devemos redescobrir.

---

# 70. Onde o Draconya deve ser superior ao OpenTibia clássico

O Draconya tem a oportunidade de evitar dívida histórica:

- sem global `Game`;
- sem `Player` monolítico;
- sem socket dentro de Player;
- sem wall-clock timers serializados;
- sem raw pointers;
- sem Lua como requisito de toda feature;
- sem ground item complexity desnecessária;
- sem world-wide scheduler como unidade principal;
- snapshot desde o início;
- determinism desde o início;
- content versioning desde o início;
- session isolation desde o início;
- bot como controller oficial;
- no-browser execution como propriedade arquitetural.

---

# 71. Definition of Done da nova engine foundation

Não considerar a refatoração concluída só porque o código compila.

Ela termina quando existe um vertical slice que prova:

```text
Session logical clock
↓
scheduler
↓
spawn monster
↓
monster controller
↓
movement
↓
bot controller
↓
combat
↓
condition/cooldown
↓
death
↓
loot + XP
↓
respawn
↓
snapshot
↓
restore
```

e:

```text
attached simulation
==
detached simulation
```

para a mesma linha de tempo lógica.

---

# 72. Resumo final para o replanejamento

A decisão do Plano 2 pode ser resumida em:

> **OpenTibia será nossa especificação de domínio; Draconya continuará sendo nossa engine.**

Usar TFS para perguntar:

```text
Que objetos e pipelines uma engine Tibia-like precisa?
Quais validações acontecem antes de um movimento?
Como creature, monster e player compartilham comportamento?
Como combat, condition, spell, weapon e item se conectam?
Quais estados precisam persistir?
```

Usar Canary para perguntar:

```text
Onde essa arquitetura quebra sob carga?
Como evitar que monster work mate a latência do jogador?
Como cruzar async boundaries com segurança?
Como paralelizar intenção sem paralelizar commits?
```

E usar o PRD do Draconya para decidir:

```text
Quais dessas regras nós realmente queremos?
O que simplificamos?
O que removemos?
O que precisa ser otimizado para milhares de sessões AFK?
```

O resultado não deve ser “TFS em TypeScript”.

Deve ser:

> **uma engine TypeScript server-authoritative, deterministic, session-scoped e idle-first, construída com os limites de domínio que OpenTibia já provou serem necessários.**

---

# 73. Referências primárias

[^tfs-cmake]: The Forgotten Server, source inventory / CMake, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/CMakeLists.txt

[^tfs-bootstrap]: The Forgotten Server, server bootstrap (`otserv.cpp`), commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/otserv.cpp

[^tfs-tasks]: The Forgotten Server, Dispatcher/Task model (`tasks.h`), commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/tasks.h

[^tfs-scheduler]: The Forgotten Server, Scheduler (`scheduler.h`), commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/scheduler.h

[^tfs-thing]: The Forgotten Server, `Thing` receiver/query contract, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/thing.h

[^tfs-tile]: The Forgotten Server, Tile flags and legality, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/tile.h

[^tfs-map]: The Forgotten Server, Map / spectators / LOS / A*, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/map.h

[^tfs-creature]: The Forgotten Server, Creature abstraction, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/creature.h

[^tfs-creature-check]: The Forgotten Server, staggered creature check scheduling (`game.cpp`), commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/game.cpp

[^tfs-player]: The Forgotten Server, Player state/capabilities, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/player.h

[^tfs-monster]: The Forgotten Server, Monster runtime/AI, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/monster.h

[^tfs-monsters]: The Forgotten Server, MonsterType, spells and loot definitions, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/monsters.h

[^tfs-combat]: The Forgotten Server, generic Combat API/params/area, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/combat.h

[^tfs-block]: The Forgotten Server, blocking/mitigation implementations (`creature.cpp`, `player.cpp`, `monster.cpp`), commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/creature.cpp

[^tfs-condition]: The Forgotten Server, Condition hierarchy and serialization, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/condition.h

[^tfs-spells]: The Forgotten Server, Spells / cooldown groups / rune spells, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/spells.h

[^tfs-weapons]: The Forgotten Server, Weapon subsystem, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/weapons.h

[^tfs-item]: The Forgotten Server, Item instances/attributes, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/item.h

[^tfs-container]: The Forgotten Server, Container transaction receiver, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/container.h

[^tfs-actions]: The Forgotten Server, item Actions and legality, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/actions.h

[^tfs-movement-events]: The Forgotten Server, step/equip/move event model, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/movement.h

[^tfs-spawn]: The Forgotten Server, Spawn lifecycle, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/spawn.h

[^tfs-vocation]: The Forgotten Server, Vocation data model, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/vocation.h

[^tfs-protocol]: The Forgotten Server, ProtocolGame command/network model, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/protocolgame.h

[^tfs-baseevents]: The Forgotten Server, BaseEvents scripting framework, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/baseevents.h

[^tfs-move-creature]: The Forgotten Server, `Game::internalMoveCreature`, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/game.cpp

[^tfs-move-item]: The Forgotten Server, `Game::internalMoveItem`, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/game.cpp

[^tfs-death]: The Forgotten Server, Creature death/kill attribution flow, commit `70793fdc`: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/src/creature.cpp

[^tfs-license]: The Forgotten Server, GNU GPL v2 license: https://github.com/otland/forgottenserver/blob/70793fdc1972d328cc2e9bc018112951a3cbcd21/LICENSE

[^canary-performance]: Canary, Performance and lifetime roadmap, commit `d34733e1`: https://github.com/opentibiabr/canary/blob/d34733e1336f0e4f396b45b4bfb93b681407d0bb/docs/systems/performance-lifetime/README.md

[^canary-parallel]: Canary, Parallel monster AI and dispatcher fairness roadmap, commit `d34733e1`: https://github.com/opentibiabr/canary/blob/d34733e1336f0e4f396b45b4bfb93b681407d0bb/docs/systems/performance-lifetime/parallel-monster-ai-roadmap.md

[^canary-dispatcher]: Canary, dispatcher lanes/execution modes, commit `d34733e1`: https://github.com/opentibiabr/canary/blob/d34733e1336f0e4f396b45b4bfb93b681407d0bb/src/game/scheduling/dispatcher_types.hpp

[^canary-license]: Canary, GNU GPL v2 license: https://github.com/opentibiabr/canary/blob/d34733e1336f0e4f396b45b4bfb93b681407d0bb/LICENSE

---

# 74. Referências auxiliares para navegação do Claude Code

## TFS

Repository:

```text
https://github.com/otland/forgottenserver
```

Componentes que devem ser consultados quando surgir uma nova feature:

```text
src/game.*
src/thing.*
src/tile.*
src/map.*
src/creature.*
src/player.*
src/monster.*
src/monsters.*
src/combat.*
src/condition.*
src/spells.*
src/weapons.*
src/item.*
src/container.*
src/actions.*
src/movement.*
src/spawn.*
src/vocation.*
src/protocolgame.*
src/tasks.*
src/scheduler.*
```

## Canary

Repository:

```text
https://github.com/opentibiabr/canary
```

Para engine:

```text
src/game/
src/creatures/
src/items/
src/lua/
```

Para performance/concurrency:

```text
docs/systems/performance-lifetime/
src/game/scheduling/
```

---

# 75. Pergunta obrigatória antes de “inventar” qualquer subsystem

Antes de criar uma solução nova, Claude Code deve procurar neste documento e nas referências:

> **Como TFS e Canary estruturam este problema?**

Depois responder:

```text
1. Qual é o mecanismo genérico?
2. Quais edge cases já são reconhecidos?
3. Quais partes pertencem especificamente ao Tibia?
4. Quais partes conflitam com o Draconya?
5. Qual versão original e mínima desse mecanismo devemos implementar?
```

Só então escrever código.

Isso é o propósito principal deste documento.
