# Party e matchmaking de hunt

**Status:** implementado — M13 (#185–#199, #203; ADR 0027), M15 (#358: kick do líder e nomes na
formação; #359: `shareCosts`/`splitLoot` na proposta) e **M20 (#391–#407, ADR 0035)**: dois eixos
mutáveis durante a hunt, coleta e venda automática com limite do personagem líder, bolsa com
reserva proporcional e OVERWEIGHT, elegibilidade por entrada, entrada na sessão em curso, sala
pública, Amigos e convites visíveis, follow de membro e cura com alvo. Matchmaking por vocação e
faixa de level (#199) entrou com a faixa desligada (`matchmakingLevelRange: 0`). **M26 (#501,
#503; ADR 0036)**: superfície própria da party (`PartyModal`), fim da aprovação pré-start, sala
com composição por vocação e busca filtrada no servidor, convite social e convite só fora de
hunt. **M28 (#525; ADR 0027 emenda 2026-09-24/25, ADR 0037 d.4):** XP compartilhada com a
fórmula e a elegibilidade do CANARY (não o TFS — as duas engines divergem, ver a emenda) —
"nenhuma" vocação CONTA como distinta, o desconto de 10 pontos é por TAMANHO da party (não por
vocações únicas), cota arredondada para cima, self-heal não conta como atividade, e o gate de
nível/alcance/atividade que desliga a divisão igual do abate inteiro quando falha.
**Última atualização:** 2026-09-25
**PRD:** §15, §43.2
**Épico:** E9

## Comportamento

Uma party de hunt é **uma sessão de hunt com N donos** (ADR 0027, decisão 1) — não um shard. Ela
tem extrato, snapshot e repouso como qualquer hunt; cada membro é dono do próprio
`CharacterRuntime` dentro dela, e a sessão é a única escritora dos N (invariante 9). Caça com zero
sockets abertos, como o solo: o membro que nunca abriu o navegador recebe a mesma cota (invariante
3). O caminho solo (`enter-hunt`, opcode 9) não mudou.

### Formação

A formação é do `api`, em Redis, transitória (chaves `party:{id}` com TTL de 30 min; convite com
TTL de 2 min). O fluxo NÃO é o do PRD §15.2 — não há proposta nem aprovação (ADR 0036; a
divergência está registrada em "Divergências do PRD") —: **procurar/criar → reunir → líder
configura → iniciar**, sobre HTTP (`POST /api/party`, `/invite`, `/join`, `/leave`, `/kick`,
`/configure`, `/publish`, `/unpublish`, `/start`, `GET /api/party/mine`; `/approve` foi removida
e `/propose` sobrevive só como shim da MESMA escrita de `/configure`). A tela é a superfície
própria da party (#503): o modal "Party" (`PartyModal`) com views `home` (sem party: Criar/
Buscar), `mine` (roster + configuração do líder) e `search` (salas que o servidor já filtrou),
aberto pela pill permanente "Party", pela engrenagem de `PartyMembers` e pelo "Encontrar Party"
do modal de caçadas — UMA instância no `Shell`. Ela só manda intenção e pergunta o estado a cada
2 s (polling único de `/mine` no `Shell`); desde o M20 o único opcode cliente→servidor da party
em tempo de hunt é `party-settings` (17), que muda os eixos e a config de loot **durante** a
hunt (ADR 0035 d.1).

- Quem cria é o líder. Só o líder convida (por id de personagem — e só FORA de hunt: quem está
  caçando recebe `inviter-in-hunt`), expulsa outros membros (`POST /api/party/:id/kick` com
  `targetId`; #358), configura a sala por `POST /api/party/:id/configure` — patch parcial
  `{ huntId, difficulty, minLevel, vocationTargets, shareCosts, splitLoot }`, cada eixo mudando
  sozinho —, abre e fecha as vagas (`/publish`/`/unpublish`, sem corpo) e inicia. Expulsar outro
  membro muda a composição (não há estado de aprovação a zerar — ADR 0036); nunca admite auto-
  kick (para isso existe `leave`) nem expulsar quem não é membro. Convidado entra por id da
  party; um personagem está em no máximo uma party (`party:by-char:{id}`), e o teto é
  `maxMembers` (8). No modal (`PartyMine`), o `×` de expulsar só aparece para o líder, num OUTRO
  membro — nunca em si mesmo, que já tem `leave`.
- A visão da party (`PartyMemberView`, #358) leva `characterId` e `name` — o campo `approved`
  saiu do contrato junto com a aprovação (ADR 0036). As vagas por vocação (`openSlots`) são
  calculadas pelo servidor a partir de `party:{id}:vocations`, não repetidas no membro.
- **Iniciar é do líder, sem aprovação** (ADR 0036): `POST /api/party/:id/start` exige ≥ 2
  membros, hunt e dificuldade existentes, todos na Cidade ou em repouso (invariante 8), e o
  progresso pendente de cada um liquidado. Aí o `api` escolhe **um nó** (o do líder) e emite um
  ticket por membro com o mesmo `sessionId`; se o k-ésimo ticket falhar, os k−1 anteriores são
  revogados. O primeiro ticket a chegar ao `game` cria a sessão com os N; o líder e quem mais
  estiver com o cliente aberto entram pelo ticket que o `api` devolveu, e quem não estiver entra
  quando abrir (`GET /api/party/mine` devolve o ticket pendente). No modal de caçadas, o líder
  tem "Iniciar com o time" (`shell/party-start.ts`, configure-then-start: o patch só sai se a
  configuração difere da seleção) e o membro não-líder vê o botão desabilitado com o motivo —
  NENHUM caminho manda `enter-hunt` solo.
- **Matchmaking** (#199) forma a party e nada mais: `POST /api/matchmaking/join` põe o personagem
  numa fila (`matchmaking:queue`, TTL de 10 min); o casamento roda no `join`, num script Lua só,
  e escolhe até `maxMembers − 1` companheiros compatíveis **preferindo vocações distintas** — o
  que o bônus de XP premia. Quem casou sai da fila no mesmo passo, o mais antigo lidera, e dali é
  o fluxo de sempre (configurar, iniciar). Faixa de level: `|level − meu level| ≤
  matchmakingLevelRange`; `0` desliga o filtro, e é o valor de hoje.

### Sala pública, Amigos e entrada em curso (M20, #402/#403/#404; sala v2 no M26, #501)

Três caminhos de formação e entrada, sobre o mesmo fluxo HTTP:

- **Sala pública** (`configure`/`publish`/`unpublish`/`rooms`): o líder configura a sala — caçada,
  dificuldade, `minLevel` e **composição por vocação** (`vocationTargets`: o TOTAL desejado de
  cada vocação, incluindo quem já está; chaves do catálogo ∪ `none`; soma ≤ `maxMembers` —
  recusa `composition-too-large` e `unknown-vocation`) — e publica com
  `POST /api/party/:id/publish` **sem corpo**: o que se publica é o estado que o `configure`
  gravou, e o servidor valida — caçada e dificuldade propostas (`nothing-proposed`), `minLevel
  ≥ 1` (`not-configured`) e pelo menos uma vaga pública (`no-vocation-slot`). Despublicar
  (`POST /api/party/:id/unpublish`) fecha as vagas sem desfazer a configuração. A listagem é
  `GET /api/party/rooms?characterId&huntId?` — **o FILTRO é do servidor**, calculado pelo
  candidato da query: só volta sala publicada, com `level ≥ minLevel`, lotação viva sob
  `maxMembers` e **vaga aberta para a vocação dele**; o `huntId` da query, quando vem, é
  casamento exato. Sala inelegível some da lista — não fica desabilitada. Cada sala volta como
  `RoomView` com `vocationTargets` e `openSlots` (vagas restantes por vocação); `maxLevel` saiu
  do contrato (lido, nunca escrito) — o que descreve a sala é a composição. O `join` **sem
  convite** só entra se a sala está publicada, no level e com vaga para a vocação dele — e é a
  **autoridade final**: o script Lua reconfere a vaga no MESMO passo, contando os membros no hash
  novo `party:{id}:vocations` (characterId → vocação), o que fecha a corrida — dois joins
  concorrentes pela última vaga da mesma vocação produzem um `no-vocation-slot`. Filtro de UI é
  conveniência, nunca segurança (invariante 4). Publicada ou não, a party continua aceitando
  convite — o convidado passa livre dos filtros públicos. O índice `party:rooms` (SET) sustenta a
  listagem. A fila de matchmaking (#199) **continua existindo como API e botão "Procurar party"**
  — a sala é o segundo caminho, e `matchmakingLevelRange` fica como está.
- **Amigos** (mínimo do §21): tabela `friend (character_id, friend_character_id, created_at)`,
  par único, sem pedidos nem bloqueios. `POST /api/friends { name }`,
  `DELETE /api/friends/:characterId` e `GET /api/friends` →
  `[{ characterId, name, vocationId, level, online, where: 'city' | 'hunt' | null }]` (`online`/
  `where` saem do `directory`, que conhece o tipo da sessão, não a hunt). **Convite tradicional**
  (com party): o convite fica visível ao convidado por um índice reverso
  (`party:invited:{characterId}`, TTL do convite); `GET /api/party/mine` devolve `invites[]`, e
  `POST /api/party/:id/decline` recusa. **Convite social** (M26, #502; sem party):
  `POST /api/party/invites/social` NÃO exige party — o aceite
  (`POST /api/party/invites/social/:inviteId/accept`) resolve em UM script Lua: usar a party do
  convidador (caso A), **criar uma com ele de líder** (caso B) ou recusar tipado — e dois
  aceites concorrentes não criam duas parties. Convites sociais expiram em 15 min
  (`SOCIAL_INVITE_TTL_MS`) e chegam no mesmo `invites[]` do `/mine`. **A régua do convidador é a
  MESMA para os dois caminhos: fora de hunt** (`inviter-in-hunt`, lida pelo `directory`, nunca
  pela coluna `characters.state`) — quem está caçando não é o ponto de partida de nenhuma party
  (invariante 8). O cliente pergunta `/mine` a cada 2 s em qualquer tela, e o diálogo "Convite
  para Party — Aceitar / Recusar" aparece onde o jogador estiver. `/invite` também recusa
  `party-full` quando a lotação viva chegou a `maxMembers`.
- **Entrada na instância em curso** (`join` com a party em `state: 'hunting'`): o `api` valida
  convite ou sala pública (level e **vaga por vocação**), lotação viva, personagem na Cidade/
  repouso e liquida o progresso pendente dele; **reserva a vaga ANTES de emitir o ticket**
  (`reserveSlot` em Lua) e faz rollback — `releaseSlot` + revogação do ticket — se a emissão
  falhar, para não deixar vaga ocupada por fantasma; resolve o nó **da sessão**
  (`directory.lookup(leaderId).nodeId`) e emite um ticket com `party: { sessionId, leaderId,
  join: true, members: [ele] }`. No `game`, o ticket de uma sessão hospedada cujo personagem
  ainda não é participante chama `hosted.session.enter(...)` no ciclo da sessão dona (invariante
  9), `configureBot` com o `botConfig` do ticket e `configureParty` com o premium dele; recusa
  (`party-full` / `no-vocation-slot` / `content-version` / `session-not-here`) fecha o socket com
  motivo e o `api` devolve o erro no `join`. No `sim`, `HuntRuleset.onEnter` recusa o
  `maxMembers + 1`-ésimo, emite `party-state` e rebalanceia a bolsa; o `Session` guarda
  `joinedAtMs` por participante e o extrato de quem entrou tarde filtra os eventos notáveis por
  `atMs >= joinedAtMs`. `enter-hunt` (opcode 9) continua o caminho solo.

A party **sobrevive ao `start`** (`state: 'hunting'`, `sessionId`) em Redis, com TTL longo
(`HUNTING_TTL_MS`, 24 h renovado a cada ação) — antes ela era apagada no `start`. O `DISBANDED`
passa a ser lazy: quando o `directory` não conhece mais a sessão, `/mine` e `rooms` apagam o
registro.

### XP (§15.3, emendado pelo ADR 0027 em 2026-09-24/25, #525, fidelidade CANARY do ADR 0037 d.4)

A XP de cada abate vem de um **pool por vocações únicas do ROSTER**, dividido por igual entre os
elegíveis (vivo, stamina > 0, presente na sessão) — quando a party inteira atende a
elegibilidade de XP compartilhada. A fórmula segue o **CANARY** (`Party:onShareExperience`,
`Party::getUniqueVocationsCount`, `Party::canUseSharedExperience`) — não o TFS: as duas engines
divergem aqui, e a decisão 4 do ADR 0037 é explícita sobre qual manda em fórmula.

```
n       = vocações únicas do ROSTER inteiro, capadas em 4 — "nenhuma" (sem vocação) CONTA
tamanho = quantos personagens há na party (roster inteiro, não só elegíveis)
percent = 10 × n² − 20 × n + 130
percent = tamanho ≥ 4 ? percent − 10 : percent
cota    = ceil(xp × percent / (100 × tamanho))     — arredonda PARA CIMA, não descarta o resto
```

Não é mais tabela: é `sharedExperiencePercent` em `packages/sim/src/party.ts`, a fórmula do
Canary copiada em código — o desconto por TAMANHO (não por vocações únicas) não cabe numa tabela
de uma dimensão só, e o número não é balanceamento, é mecanismo. Solo (um elegível) é 100 %, sem
ler a fórmula. **"Nenhuma" vocação (level < 8) CONTA como vocação distinta** —
`Party::getUniqueVocationsCount` (`src/creatures/players/grouping/party.cpp`) insere o `baseId`
de todo jogador sem excluir `VOCATION_NONE`; a vocação "None" é um `Vocation*` real, não um
ponteiro nulo. **O TFS diverge** e exclui — mas o Canary manda em fórmula. O bônus de Bestiário
de cada membro se aplica à **cota** dele, na ordem de sempre (`applyXpBonus` → `grantXp` →
`record`), e o abate conta no Bestiário de **todo** elegível (decisão 4), não só do matador.
Level up e marco de Bestiário são eventos notáveis que dizem de quem (`id/level`,
`id/monstro/marco`).

O desconto de −10 pontos é gatilhado pelo TAMANHO da party (`n` de personagens), não pela
contagem de vocações únicas — o comentário do próprio Canary fala em "todas as vocações
presentes", mas o código testa o tamanho. Uma party de 4 knights (uma vocação só) TAMBÉM
desconta, porque tem 4 membros; é o achado central da revisão que corrigiu esta emenda.

Exemplos com um monstro de 100 XP, com todos elegíveis para compartilhar:

| Composição | `n` | tamanho | % | cota por cabeça |
|---|---|---|---|---|
| 4 vocações distintas | 4 | 4 | `10×16−80+130−10` = 200 | `ceil(200/4)` = **50** |
| 2 knights | 1 | 2 | `10−20+130` = 120 | `ceil(120×2/200)` = **60** |
| knight + druid | 2 | 2 | `40−40+130` = 130 | `ceil(130×2/200)` = **65** |
| knight + sem vocação | 2 | 2 | 130 (mesmo que knight+druid — "nenhuma" É distinta) | **65** |
| 4 knights | 1 | 4 | `120 − 10` = **110** | `ceil(110×4/400)` = **28** |
| 2 knights + 2 druids | 2 | 4 | `130 − 10` = **120** (o TFS daria 130 — mesmo `n`, sem desconto por tamanho) | `ceil(120×4/400)` = **30** |
| 2 knights + 2 druids + 1 sorcerer | 3 | 5 | `160 − 10` = **150** | `ceil(150×5/500)` = **30** |

A linha "2 knights + 2 druids" é o exemplo que expõe a divergência TFS/Canary com mais clareza:
mesma contagem de vocações únicas (2), resultado diferente (120 % no Canary, 130 % no TFS)
porque só o Canary olha o TAMANHO da party.

#### Elegibilidade de XP compartilhada (`Party::canUseSharedExperience` — TFS e Canary concordam aqui)

A divisão igual acima só vale quando TODO membro do ROSTER (não só quem vai receber cota) atende,
ao mesmo tempo, três condições — falhar QUALQUER uma delas desliga a divisão igual para o abate
INTEIRO, não só para quem falhou:

- **Nível**: `level ≥ ceil(maiorLevel / 1,5)` — "2/3 do maior level da party". `maiorLevel` é o
  MAIOR level de TODO o roster (elegível ou não: um membro exausto ainda define a régua). O
  `1,5` é o `partyShareRangeMultiplier` do Canary (default) — o TFS fixa "2/3" no código; os dois
  concordam no valor observado.
- **Alcance**: até 30 tiles em x/y e 1 andar de diferença do LÍDER (nunca entre membros entre
  si) — `EXPERIENCE_SHARE_RANGE`/`FLOORS` do TFS, `Position::areInRange<30, 30, 1>` do Canary. Com
  hunts multiandar (#519), `z` vem da posição de cada personagem.
- **Atividade**: atacou, ou curou OUTRO PARTICIPANTE, nos últimos 2 minutos
  (`activityWindowMs`). **Curar a si mesmo NÃO conta** — `Player::isPartner` (TFS e Canary)
  exclui `player == this` antes de registrar atividade por cura; o HPS continua contando o
  self-heal, só a atividade de XP compartilhada exige um recipiente diferente. Segue o CANARY
  (`Party::isPlayerActive`, 2 minutos) por precedência do ADR 0037 d.4 — o TFS usa `pzLocked`
  (1 minuto por padrão), que é config de Proteção contra PK, não de party. Um membro que nunca
  agiu é INATIVO desde a entrada (equivalente a não ter entrada no `ticksMap` das engines de
  origem).

Quando a regra desliga, cada elegível recebe XP **pelo DANO que causou no abate**:
`floor(dano do membro / dano total × xp)` — igual ao `Creature::getGainedExperience` do
TFS/Canary, SEM o teto da cota compartilhada: quem causa 100 % do dano num abate leva o XP
INTEIRO do monstro, não uma fração dividida. Quem não bateu recebe zero; a party não "cobre" quem
ficou parado. `dano total` conta TODO `damageByActor`, inclusive de quem não é mais elegível
(morreu, saiu) — como o `damageMap` das engines de origem, que não filtra por quem ainda pode
receber XP.

**Na prática**, isto tem uma consequência visível: o PRIMEIRO abate de uma hunt costuma cair no
rateio por dano, porque ninguém teve tempo de "agir" ainda quando o golpe inicial (já
ENGATILHADO) mata o primeiro monstro — e um membro que nunca chega a atacar nem curar OUTRO
durante toda a hunt (sem bot configurado, por exemplo) desliga a divisão igual para a party
inteira o tempo todo, não só para ele. É o comportamento OBSERVADO (ou, no self-heal do Canary,
INTENCIONADO e confirmado pelo TFS funcional) nas engines de origem, não um efeito colateral do
Draconya: dividir igual com quem ficou parado seria dar XP de graça.

**Simplificação registrada**: as engines de origem checam elegibilidade e calculam `n`/tamanho
sobre o ROSTER inteiro da party (presente em qualquer lugar do mundo), continuamente, como um
estado que liga/desliga por evento (entrada, saída, ataque). O Draconya usa `session.participants`
como esse roster — que, nesta arquitetura, JÁ é "quem está na hunt": morrer em party é sair
(`#depart`), então não existe aqui o caso Tibia de um membro morto ainda contando como roster.
Uma extensão SÓ do Draconya, sem equivalente nas engines de origem, é a stamina: um membro
exausto continua no roster — conta para `n`, tamanho e nível/alcance/atividade — mas não está
entre os elegíveis e não recebe cota nenhuma, a mesma condição que sempre decidiu se o matador
recebia em solo.

### Dois eixos mutáveis de loot e custo (§4, §5, §15.4, §15.5)

O que era um modo único fixado na proposta virou **dois eixos independentes**, mutáveis pelo líder
em tempo de hunt (ADR 0035 d.1, emenda à decisão 5 do ADR 0027): `shareCosts` decide se o custo do
supply é rateado e `splitLoot` decide bolsa versus sorteio. O líder os muda por `configureParty`,
chamado pelo host entre avanços a partir de um opcode C2S `party-settings` (opcode 17) —
intenção, validada no servidor (líder, catálogo, limite; invariante 4). Recusa é
`system-message`; sucesso é o `party-state` novo, nunca o eco. Desligar `splitLoot` **liquida a
bolsa**. `mode` continua no fio e no snapshot como derivado dos dois (`shareCostsOf`/
`splitLootOf`); snapshot antigo migra na leitura, sem bump. As quatro combinações são válidas — o
`split` de sempre é `false/false`, e o `shared` de sempre é `true/true`.

**Custo** — com `shareCosts` ligado, cada uso de supply de preço `c` debita `floor(c / n)` de cada
membro presente e o resto do usuário, **na hora**; a munição paga entra no rateio (`#strike`,
`#ammoFor`), o que antes ficava de fora. Membro sem saldo para a cota paga o que tem e o usuário
cobre; se nem o usuário cobre, `not-enough-gold` para ele e ninguém é debitado. Cada um recebe
`goldSpent` pelo que pagou — o extrato já sai equalizado. Com `shareCosts` desligado, cada um paga
o próprio supply, como no solo. Anéis e colares são itens e ficam de fora (§15.4).

**Loot** — com `splitLoot` desligado, por monstro **um** membro elegível é sorteado (uniforme,
com o `Rng` da sessão, antes de `rollLoot`) e o loot — gold e itens — é rolado com a tabela como
ele a vê e vai para ele: mochila se couber, Caixa de Loot da Sessão dele se não. Sem last hit, sem
prioridade por dano. O sorteio só existe com ≥ 2 participantes: a sequência do RNG em solo é a de
sempre (FUN-63). Item em party tem id `sessionId:characterId:n` (em solo continua `sessionId:n`).

Com `splitLoot` ligado, ninguém é sorteado; gold e itens caem numa **bolsa da party**
(`party-bag`), sem modificador individual. O líder escolhe **o que coletar** (`collect: string[] |
null`; `null` = tudo) e **o que vender automaticamente** (`autoSell`), com um limite de tipos pelo
Premium do **personagem líder**:

- `collect` filtra **depois** de `rollLoot` (zero RNG a mais): item fora da lista **não é
  coletado** — fica no cadáver e não conta `itemsLooted`. Gold nunca é item: entra sempre.
- `autoSell` é subconjunto lógico da coleta: item na lista efetiva **não entra na bolsa** — vira
  `value × quantity` gold na hora, dividido entre os elegíveis com `splitEqually` (resto na ordem
  de entrada), creditado em `goldDelta`/`goldGained` de cada um. Emite `party-settlement` com
  `reason: 'auto-sell'` e `itemId`. Item com `value: 0` na lista de venda é ignorado (entra na
  bolsa como coletado).
- `autoSellLimit = premiumByCharacter[leaderId] ? premium : free`, números em
  `content/data/party/baseline.json` → `autoSellItemTypes: { free: 5, premium: 20 }`. A lista
  **guarda** mais que o limite; só os `limit` primeiros valem. `configureParty` recusa lista de
  venda com id fora do catálogo ou com `value: 0`, e aceita acima do limite.
- A capacidade da bolsa é a **soma das capacidades disponíveis** dos presentes
  (`capacity − inventory.weight`), não a total — bolsa e mochila contariam a mesma capacidade duas
  vezes. A reserva de cada membro é **proporcional**: `R_i = W × B_i / ΣB`, em ponto flutuante,
  sobre `available_i` (`reserveProportionally`). A reserva **desconta da mochila** por um `Wearer`
  derivado. `overweight = W > ΣB`: com a bolsa acima da capacidade disponível, item com peso não
  é coletado (fica no cadáver), mas autovenda e gold continuam. A transição de/para OVERWEIGHT
  vira uma linha `party-overweight` no extrato. Tudo é recalculado nos gatilhos do §13
  (`onEnter`, `onLeave`, entregas, level up, `#settle`, autovenda, `configureParty`) — **nunca por
  tick** (invariante 2).
- **Elegibilidade por entrada** (§16.1): cada item e cada gold da bolsa registram os **presentes
  no instante do abate** (`eligible = session.participants`). Toda venda — automática ou
  settlement — divide cada entrada só entre `eligible ∩ presentes`; quem entrou depois do drop não
  recebe daquela entrada, e quem sai entra no settlement (com ele incluído). A interseção nunca é
  vazia: a bolsa é liquidada a cada saída.
- **Settlement**: ao sair alguém (com quem sai incluído), ao encerrar e ao **desligar
  `splitLoot`**, a bolsa é vendida **entrada por entrada** e dividida entre os elegíveis
  presentes: `total = gold + Σ value × quantity`, cotas inteiras cuja soma **é** o total (o resto
  vai um gold por membro, na ordem de entrada). Item com `value: 0` não se vende: vai para a
  mochila do líder. O evento `party-settlement` (`total/presentes`, `reason:
  'leave' | 'end' | 'toggle' | 'auto-sell'`) é notável e chega ao cliente; a bolsa zera.

O líder é quem a party elegeu; se ele saiu, o mais antigo presente vira líder (`leaderId` mutável,
reescrito no `#flushLoss`), o limite de autovenda é recalculado e `party-state` avisa (ADR 0035
d.8).

### Sair, morrer e encerrar (§15.5, §13.9)

Sair e morrer são `leave`, não `end` (decisão 7): quem sai leva o **próprio extrato** — um
`Receipt` por membro, cada um com `seq` próprio, uma linha de ledger cada (invariante 10) — e a
cota do settlement; a sessão continua para os outros. Morte mantém a penalidade de hoje. Saída
pelo cliente é `leave-hunt` (opcode 10), como no solo; o `session-ended` que volta é o extrato de
quem saiu. Depois de uma saída, quem tem a regra `party-member-lost` no bot sai também, em cascata
e na ordem de entrada (`bot.md`). O último a sair encerra a sessão com o motivo dele; se a cascata
levou alguém, o motivo é `exit-rule`. Uma party que ficou com um membro vira, na prática, solo:
morte encerra, loot é do matador sem sorteio.

### Encerrar para todos exige o sim de todos (M20, #432, ADR 0032 d.14)

A nota do painel — "Parar no meio da caçada exige o sim de todos." — é literal. **Ninguém, nem o
líder, encerra a sessão da party para os outros** por um clique só:

- **Proposta do líder.** O líder manda `party-end-vote` (C2S, opcode 18) com `approve: true`; o
  `sim` abre uma votação com a aprovação DELE (quem propõe, aprova) e emite `party-end-vote`
  (S2C, opcode 31) para todos os visualizadores. Só o líder propõe; solo e não-líder recebem
  `system-message` com recusa tipada. Re-propor reinicia a janela e as aprovações.
- **Aprovação por membro, 60 s de relógio LÓGICO.** Cada membro presente aprova com
  `party-end-vote { approve: true }`; recusar (`false`) derruba a votação na hora e a sessão
  segue. O vencimento da janela é um evento da fila (`END_VOTE_EXPIRE`, `END_VOTE_WINDOW_MS =
  60_000`), nunca um contador por tick (invariante 2): a 1 Hz e a 10 Hz a proposta vence no
  mesmo instante lógico. Expirou sem todos os sins, nada muda.
- **Encerramento com settlement.** Quando **todos os presentes** aprovaram, a sessão encerra com
  `session.end('party-vote')`: o `onEnd` liquida a bolsa (settlement `reason: 'end'`) e cada
  membro leva o seu `Receipt` com `reason: 'party-vote'` — a mesma máquina do encerramento por
  morte/saída, com um motivo novo. Quem sair no meio da votação deixa de contar; se os que
  ficaram já tinham aprovado todo, a sessão encerra depois do extrato de quem saiu.
- **Sair sozinho continua livre.** `leave-hunt` (opcode 10) tira só quem pediu, com o extrato
  dele, e não abre votação nenhuma.
- **A votação atravessa o snapshot** (`endVote` no estado do ruleset, sem bump de
  `SNAPSHOT_FORMAT_VERSION`): quem reconecta no meio da janela recebe o estado pelo `party-end-vote`
  do attach e não perde quem já aprovou.

O ADR 0032 fixa a forma; a janela de 60 s é parâmetro e pode mudar sem ADR.

### O que o cliente vê

`session-state` leva `party` (líder, membros, vivos, vocação, level, manaPercent), `partySpending`
(gasto de cada um e a prévia de rateio) e, com `splitLoot` ligado, `partyBag`; `party-state` leva a
composição dos membros com HP, vocação (`vocationId`), level (`level`) e percentual de mana
(`manaPercent`), reenviado ao vivo sempre que qualquer um desses valores, a composição ou a
liderança mudam (via `sameParty` no host, #339). `party-bag`, `party-settlement` e
`party-spending` chegam a cada mudança (opcodes 24–26 e 29, só servidor→cliente), e
`party-end-vote` (opcode 31) leva o estado da votação de encerrar. Durante a hunt
a coluna esquerda mostra os companheiros com HP, vocação (abreviação de uma letra, colorida pela
vocação, com o id cru como reserva se o catálogo não reconhecer), level e mana — os dois últimos
só quando o `party-state` os manda —, num painel fixo (`PartyMembers`, #259, #347); com
`splitLoot` ligado, a bolsa aparece como a janela flutuante "Party loot" (`PartyLootWindow`, #316) sobre o
mundo, aberta por padrão durante a hunt e alternável pelo ▣ do cabeçalho da party; a engrenagem ⚙
do mesmo cabeçalho reabre a party durante a hunt na MESMA instância do modal "Party"
(`PartyModal`, view `mine`) que a pill "Party" e o "Encontrar Party" do modal de caçadas abrem
(#503); o analisador é por personagem (`analyzer.md`).

### Dois eixos mutáveis, bolsa v2 e seção PARTY (M20, #405)

O contrato v2 (ADR 0035) tornou visível no cliente o que antes era só dado no fio:

- **Os dois interruptores do líder** no rodapé de `PartyMembers` — "Rateio de custos" e
  "Dividir loot". Leem `party-state.shareCosts`/`splitLoot` (com `mode` como fallback derivado,
  nunca escrito à mão) e, para o líder, mandam `party-settings` (C2S, opcode 17) com o patch. O
  membro vê os dois desabilitados. O clique é intenção (invariante 4): a tela reflete o
  `party-state` que volta, nunca o valor otimista. O modo como texto saiu do rodapé.
- **A configuração de loot** em "Detalhes da caçada" (`HuntDetailsModal`): uma linha por item de
  loot possível, com PEGAR / VENDER e a linha "Venda automática: N / limite"
  (`party-state.loot.autoSell.length` / `autoSellLimit`). Só aparece com party e `splitLoot`
  ligado (DT-01), e só o líder edita. `value: 0` (ou ausente) desabilita VENDER (D2); desmarcar
  PEGAR de um item com `collect: null` ("coletar tudo") manda a lista explícita de todos MENOS
  ele, e limpa o `autoSell` junto.
- **Party loot v2** (`PartyBag`): valor total (`party-bag.value`), "sua capacidade reservada" (a
  entrada do personagem em `party-bag.reservations`, com o percentual; `available: 0` omite o %,
  nunca divide por zero) e o badge OVERWEIGHT quando `party-bag.overweight === true`. A janela
  passa a montar por `splitLoot`, não pelo `mode` derivado — com eixos independentes, a bolsa
  existe sse `splitLoot` está ligado.
- **A seção PARTY do analisador** (`Analyzer.tsx`), do `analyzer.party` / `session-state.partySummary`:
  jogadores, vocações únicas, bônus/multiplicador de XP, XP total e a XP do viewer, rateio e
  supplies totais, "Sua parte" (de `party-spending.shares[me].estimatedShare`, DT-03), divisão de
  lucro, valor/peso da bolsa e venda automática `N / limite`.
- **A votação de encerrar** no rodapé de `PartyMembers` (#432): o líder vê "Encerrar para todos" e
  manda `party-end-vote { approve: true }`; com a votação ativa, vê a contagem
  "Encerrando para todos · N/M aprovaram" e pode "Cancelar encerramento" (`approve: false`). O
  membro não-líder, com a votação ativa e sem ter aprovado, vê "Aprovar" / "Recusar"; depois de
  aprovar, "Você aprovou · aguardando os demais". O diálogo some com `active: false`. Tudo é
  intenção: quem decide se a proposta vale e se cada presente deu o sim é o servidor.

Campo ausente — nó `game` anterior ao #400, ou "não se aplica" — não monta a UI nova: a tela
continua exatamente o que era, nunca com um número fabricado (D8, invariante 4).

## Regras

- Party é uma sessão de hunt com N participantes; um personagem está em uma sessão só.
- Tamanho máximo: `maxMembers` (8). Início com ≥ 2, todos na Cidade — o LÍDER inicia, sem
  aprovação de membros (ADR 0036); entrada em sessão em curso aceita convite ou sala pública,
  com lotação viva ≤ `maxMembers` e vaga por vocação.
- Formação por HTTP no `api`, em Redis com TTL; matchmaking forma, não inicia. Sala pública com
  composição por vocação, publicada sem corpo e listada com FILTRO NO SERVIDOR
  (`rooms?characterId&huntId`); Amigos (`/api/friends`) com convite tradicional e convite social
  (sem party, aceite que cria a party) — os DOIS só fora de hunt (`inviter-in-hunt`); convites
  ficam visíveis em `/mine` com `decline` (sociais expiram em 15 min).
- A party sobrevive ao `start` (`state: 'hunting'`, `sessionId`, TTL de 24 h renovado por ação);
  `DISBANDED` é lazy.
- Um nó por party; um ticket por membro, mesmo `sessionId`; tudo ou nada na emissão. Quem entra em
  curso recebe um ticket com `join: true` e um membro só.
- XP: `floor(floor(xp × tabela[únicas] / 100) / elegíveis)`, resto descartado; solo é 100 %.
- Vocação nula conta como uma; Bestiário aplica-se à cota e conta o abate para todo elegível.
- Os dois eixos (`shareCosts`/`splitLoot`) são mutáveis pelo líder em tempo de hunt via
  `party-settings` (C2S 17); `mode` continua no fio como derivado (ADR 0035 d.1). O cliente só
  manda intenção (invariante 4).
- `splitLoot` desligado: um destinatário sorteado por monstro, loot com os modificadores dele.
- `splitLoot` ligado: bolsa com `collect`/`autoSell` do líder; capacidade = Σ disponíveis;
  reserva proporcional `R_i = W × B_i / ΣB`; OVERWEIGHT não coleta item com peso.
- Cada entrada da bolsa leva `eligible` (presentes no abate); a venda divide entre
  `eligible ∩ presentes`.
- `autoSellLimit` = `autoSellItemTypes.{free,premium}` = 5/20 do **personagem líder**.
- `itemSchema.value` é obrigatório; `0` é "não se vende" e vai para o líder.
- Sair e morrer são `leave` com extrato próprio; o último encerra; `party-member-lost` cascateia.
- Settlement ao sair, no fim e ao desligar `splitLoot`; `reason` no evento.
- Encerrar para todos exige o sim de todos (`party-end-vote`, C2S 18 / S2C 31): proposta do líder,
  aprovação de cada presente em 60 s lógicos, `session.end('party-vote')` só com todos os sins.
  Sair sozinho continua `leave-hunt` (10), livre.

## Parâmetros de balanceamento

| Parâmetro | Valor atual | Caminho |
|---|---|---|
| Tamanho máximo da party | 8 | `packages/content/data/party/baseline.json`, `maxMembers` (schema aceita 2–8) |
| Pool de XP por vocações únicas (%) | `{1: 125, 2: 150, 3: 175, 4: 200, 5: 200, 6: 200, 7: 200, 8: 200}` | `packages/content/data/party/baseline.json`, `xpPoolPercentByUniqueVocations` — chaves `1..maxMembers`, não decrescente, ≥ 100 |
| Limite de tipos na venda automática | `{ free: 5, premium: 20 }`, do personagem **líder** | `packages/content/data/party/baseline.json`, `autoSellItemTypes` |
| Faixa de level do matchmaking (fila cega, #199) | 0 (desligado, sem mudança no M20) | `packages/content/data/party/baseline.json`, `matchmakingLevelRange` |
| Level mínimo e composição da sala pública | `minLevel ≥ 1` e `vocationTargets` (soma ≤ `maxMembers`), escolhidos pelo líder no `configure` — não é número de conteúdo | `packages/server/src/api/party.ts` (`/configure`, `/publish`), `deps.limits` (`maxMembers`, `difficultiesOf`, `vocations`) |
| Preço de venda de cada item (bolsa) | por item — `bow` 130, `machete` 6, `cheese` 0 | `packages/content/data/items/*.json`, campo `value` (`itemSchema.value`, `packages/content/src/schemas.ts`) |
| TTL da party em formação | 30 min | `packages/server/src/party-store.ts`, `DEFAULT_TTL_MS` |
| TTL da party em hunt | 24 h, renovado a cada ação | `packages/server/src/party-store.ts`, `HUNTING_TTL_MS` |
| TTL do convite | 2 min | `packages/server/src/party-store.ts`, `DEFAULT_INVITE_TTL_MS` |
| TTL do convite social | 15 min | `packages/server/src/party-store.ts`, `SOCIAL_INVITE_TTL_MS` |
| TTL na fila de matchmaking | 10 min | `packages/server/src/party-store.ts`, `QUEUE_TTL_MS` |
| Raio de entrada do 2º+ membro | 3 tiles do ponto de entrada | `packages/sim/src/rulesets/hunt.ts`, `ENTRY_RADIUS` |
| Janela de aprovação da votação de encerrar | 60 000 ms (lógico) | `packages/sim/src/rulesets/hunt.ts`, `END_VOTE_WINDOW_MS` |
| Alcance provisório da poção com `target: 'friend'` | 1 tile | `packages/content/data/supplies/{health-potion,mana-potion}.json`, `effect.range` |
| Intervalo de polling de `/mine` | 2 000 ms | `packages/client/src/party/store.ts`, `PARTY_POLL_MS` — dono único do `setInterval`: `Shell.tsx` |
| Intervalo de polling da busca de salas | 2 000 ms, só com a view de busca montada | `packages/client/src/shell/PartyModal.tsx`, `ROOMS_POLL_MS` |

## Em aberto

- ~~[ABERTO] Fórmula numérica final do bônus de XP por vocações únicas (§15.3, §43.2)~~ →
  **Resolvido:** `min(100 + 25 × únicas, 200)` %, dividido por igual, em
  `packages/content/data/party/baseline.json` (ADR 0027, decisão 3).
- ~~[ABERTO] Momento contábil exato da equalização de gastos (§15.4)~~ → **Resolvido:** tempo
  real, a cada uso de supply, em `packages/sim/src/rulesets/hunt.ts` (`#sharedPurse`; ADR 0027,
  decisão 5) — quando `shareCosts` está ligado.
- ~~[ABERTO — valor provisório: 0, desligado] Critérios exatos de matchmaking de hunt por faixa
  de level (§43.2)~~ → **Resolvido:** a **sala pública** (D8/§7 do ADR 0035) passou a ser o
  caminho com filtro de entrada; no M26 (#501, ADR 0036) ela ficou `minLevel` + composição por
  vocação (`vocationTargets`), com o filtro correndo NO SERVIDOR em
  `GET /api/party/rooms?characterId&huntId` e a vaga reconferida em Lua — a faixa superior
  (`maxLevel`) saiu do contrato; a fila cega do #199 continua como caminho separado, ainda com
  `matchmakingLevelRange: 0`, em
  `packages/content/data/party/baseline.json`.

## Divergências do PRD

- **PRD dizia (§15.2):** o fluxo de party é "procurar/criar → reunir → líder propõe → membros
  aprovam → iniciar", e a formação morava na tela de seleção de hunt.
  **Implementado:** não há proposta nem aprovação — o líder configura a sala (caçada, dificuldade,
  `minLevel`, composição por vocação, os dois eixos) e inicia sozinho; a party tem superfície
  PRÓPRIA (modal "Party": Criar/Buscar, Minha Party, Busca de salas), e o modal de caçadas ficou
  com as duas pontes ("Encontrar Party" e "Iniciar com o time").
  **Motivo:** a aprovação era cerimônia sem decisão — o início sempre foi rota do líder, e com
  dois membros o "sim" da aprovação é o líder destravando o próprio botão (o estado `approved`
  mentia sobre quem decide). Superfície própria e fim da aprovação são o ADR 0036, emenda à
  decisão 8 do ADR 0027 e à decisão 6 do ADR 0029 — o acoplamento de localização vinha da
  referência Huntera (formação na seleção de caçada), e o produto decidiu o contrário.

- **PRD dizia (§15.3):** o sistema aceita uma tabela por número de membros **e** número de
  vocações únicas.
  **Implementado:** tabela indexada só por vocações únicas; o número de membros entra na
  divisão, não no pool.
  **Motivo:** ADR 0027 — com pool dividido por igual, a segunda dimensão seria coluna repetida.
  Consequência aceita: party de vocações iguais rende menos por cabeça que solo (125 % ÷ 2).

- **PRD dizia (§15.4):** gastos de supply equalizados entre os membros, momento contábil em
  aberto.
  **Implementado:** rateio em tempo real a cada uso (`floor(c/n)` de cada presente, resto do
  usuário) quando `shareCosts` está ligado; sem ele, cada um paga o seu. A munição paga entrou no
  rateio no M20.
  **Motivo:** ADR 0027 — settlement no fim pode deixar um membro negativo e exige tabela de
  transferências para auditar; ratear na hora custa o mesmo e o extrato de cada um já sai
  equalizado. Os dois eixos independentes são a emenda do ADR 0035 (d.1); quem não quer pagar a
  poção do outro tem onde ficar.

- **PRD dizia (§15.5):** mesma chance base para todos, sorteio de loot individual por personagem,
  cada um com os próprios modificadores (Prey, Bestiário).
  **Implementado:** com `splitLoot` desligado, **um** destinatário sorteado por monstro, e o loot
  é rolado uma vez, com a tabela como ele a vê; com `splitLoot` ligado, loot na bolsa sem
  modificador individual.
  Bestiário não modifica loot (só XP); Prey ainda não existe, e o gancho (`#lootTableFor`) entra
  depois do sorteio do destinatário.
  **Motivo:** ADR 0027 — rolar N vezes por monstro multiplica o loot por N; "sem last hit e sem
  prioridade por dano" está preservado no sorteio uniforme.

- **PRD dizia (§22.1):** autovenda limitada a 5 tipos de item (free) ou 20 (premium).
  **Implementado:** a venda **de party** (coleta + venda automática configurada pelo líder) foi
  implementada no M20, com o limite de tipos vindo do Premium do **personagem líder**
  (`autoSellItemTypes { free: 5, premium: 20 }`, D2/§23.1 do ADR 0035). A autovenda **individual**
  (fora de party) do §22.1 continua não implementada — ver `items.md`.
  **Motivo:** o limite de tipos sempre foi regra do que o jogador configura; no M20 quem configura
  é o líder, e o Premium que o define é do personagem dele, não da conta (ADR 0014 — `characters.
  premium_until` por personagem).

- **PRD dizia (§8/§42):** o limite de autovenda vem do "status da conta do líder".
  **Implementado:** o Premium é do **personagem líder** (`premiumByCharacter[leaderId]`), não da
  conta.
  **Motivo:** o schema tem `characters.premium_until` por personagem desde a Fase 1 e
  `monetization.md` §34 diz que Premium é comprado por personagem; renomear contrato persistido é
  caso do ADR 0014, e não há por quê (ADR 0035 d.2/D3).

- **PRD dizia (§25.1/§30):** "desconectado" e "offline" são alvos inválidos do follow e da cura.
  **Implementado:** "desconectado" **não existe** para o `sim` — a hunt roda sem socket
  (invariante 3). O alvo inválido é morto, ausente da sessão ou sem caminho no raio de
  `targetSearchRadius`; o runner marca `followInterrupted`, volta à rota e emite `follow-state
  { active: false, targetId, reason }` uma vez, sem escolher outro (ADR 0035 d.9).
  **Motivo:** o PRD §25.1/§30 lista conexão como estado de jogo, e conexão é apresentação, não
  simulação.

- **PRD dizia (§15):** sair pode deixar a bolsa acima da capacidade, e o OVERWEIGHT é resolvido
  por saída.
  **Implementado:** a bolsa é liquidada a **cada saída** (com quem sai incluído), no fim e ao
  desligar `splitLoot` — o cenário "bolsa acima da capacidade depois de uma saída" não acontece,
  porque a bolsa esvazia na saída. O OVERWEIGHT é um estado vivo da bolsa (`overweight = W > ΣB`),
  com item de peso não coletado enquanto durar.
  **Motivo:** ADR 0035 d.5 (mantido do ADR 0027) — é o que preserva "um extrato por saída"
  (invariante 10); divergência de mecanismo, não de resultado (nada se perde).

- **PRD dizia (§7/§14):** o que acontece com o item que não é coletado.
  **Implementado:** item fora da lista de coleta (ou com peso em OVERWEIGHT) **fica no cadáver**,
  não conta `itemsLooted` e não vai para caixa nenhuma.
  **Motivo:** ADR 0035 d.2/d.3 — "coletar com outro nome" era a alternativa descartada; o PRD não
  diz, e a decisão de produto é que não coletar é não coletar.

- **PRD dizia (§3.1):** a contagem de vocações únicas e a tabela de XP.
  **Implementado:** `null` continua contando como uma vocação ("nenhuma") com até 8 membros; o
  máximo de vocações únicas segue 5 (quatro reais + "nenhuma"), então as chaves `5..8` repetem
  200 %.
  **Motivo:** ADR 0027 d.3 e ADR 0035 d.12 — subir o teto de jogadores não sobe o teto de
  vocações únicas.

## Referências

PRD §15, §22.1, §43.2; ADR 0027 (decisões 1–9, d.5 emendada por #359 e pelo ADR 0035; d.8 e d.9
emendadas pelo ADR 0035; d.8 emendada de novo pelo ADR 0036), ADR 0035 (Party v2), **ADR 0036
(superfície própria, fim da aprovação, sala com composição e convite social)**, ADR 0032
(decisão 14 — DPS/HPS e o sim de todos),
ADR 0023 (sessão com muitos personagens),
ADR 0024 (repouso); `docs/party-hunt-plan.md` (M13) e `docs/party-vip-plan.md` (M20, desenho e
exemplos numéricos);
`packages/sim/src/party.ts` (`reserveProportionally`, `autoSellLimit`, `settleEntries`),
`packages/sim/src/rulesets/hunt.ts` (`configureParty`, `partySummary`, `proposeEnd`, `approveEnd`,
`cancelEnd`),
`packages/sim/src/session.ts` (`leave`, `Receipt`, `joinedAtMs`),
`packages/content/data/party/baseline.json`,
`packages/server/src/api/{party,friends}.ts`, `packages/server/src/party-store.ts`,
`packages/server/src/receipts.ts`, `packages/protocol/src/messages.ts` (17, 18, 24–26, 30, 31),
`packages/client/src/party/`, `packages/client/src/shell/{PartyModal,PartyMembers,PartyBag,
PartyActions,party-start}.ts{,x}`;
`bot.md` (§13.9, follow e cura com alvo), `analyzer.md`, `economy.md`, `bestiary.md`.
