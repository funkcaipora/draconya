# Hunt

**Status:** parcial — ruleset (entrada, sessão, encerramento), movimento com escritor único
(FUN-69), loot de gold e de item por abate (FUN-63, FUN-88) e a **seleção de hunt no cliente**
(FUN-79) implementados
**PRD:** §14
**Épico:** E3

## Comportamento

Hunts são instâncias isoladas: não existe disputa aberta por spawn nem necessidade de atravessar o mundo continuamente para chegar até elas. O jogador abre o menu de Hunt no client e escolhe entre as hunts disponíveis. Hunts base ficam acessíveis por padrão; hunts especiais podem exigir quest, conquista/controle de guilda, ou outro requisito futuro — mas Premium/VIP não deve, no MVP, ser usado como trava de acesso a uma hunt de loot superior. Na tela de seleção, o jogo mostra o level recomendado da hunt, mas não mostra estimativa oficial de XP/h ou gold/h antes da entrada.

Cada hunt tem uma rota única, fixa e predeterminada — o bot nunca escolhe caminhos alternativos. A rota forma um loop lógico, seja circular, seja por subidas e descidas que retornam ao ponto de origem. Os pontos de respawn de monstros são definidos por design, e a quantidade/composição de monstros em cada ponto é um dado da hunt e da dificuldade escolhida; não existe variação aleatória de densidade no MVP.

Existem três tamanhos de pull — Cauteloso, Ousado e Agressivo (FUN-123, cópia do Huntera; o PRD previa quatro dificuldades) — cada um aumentando a quantidade de monstros e podendo introduzir variantes mais fortes e tematicamente coerentes (por exemplo, uma hunt de vampiros pode reservar variantes cerimoniais/escuras para dificuldades mais altas). O jogador pode trocar de dificuldade durante sua jornada, mas isso encerra a instância atual e cria uma nova — não existe alteração dinâmica de dificuldade dentro da mesma instância. Em party, a troca de dificuldade exige votação/aprovação dos membros.

A hunt termina por ação manual do jogador, por uma regra automática de saída configurada no bot, por morte, ou por outras condições de sessão que venham a ser adicionadas depois. Stamina chegando a zero, isoladamente, não encerra a hunt (ver `stamina.md`).

## Escolher a hunt (FUN-79, #259)

A escolha é um modal ("Escolha uma caçada", #259), aberto pela pill "Escolher caçada" sobre o
mundo (na Cidade) ou pelo ícone Hunts do topo (nos dois estados); durante a hunt a pill vira
"Sair da caçada". Mostra por hunt: nome, **level recomendado** e as dificuldades que ELA define —
não obrigatoriamente as quatro. A formação da party (ADR 0027) é a coluna direita do mesmo modal;
os companheiros DURANTE a hunt são um painel fixo próprio na coluna esquerda (`PartyMembers`,
DS-14).

**Detalhes da caçada, durante a hunt (#325).** A pill "ⓘ Detalhes da caçada" abre um modal com o
nome, o nível recomendado e as dificuldades da hunt ativa — a mesma regra de "level recomendado é
conselho" vale aqui. A identidade da hunt ativa hoje só é conhecida quando o jogador ENTROU por
este `HuntsModal`, nesta aba do navegador: uma hunt sobrevive ao navegador fechado (idle-first),
mas o servidor ainda não diz, depois que a instância já começou, qual `catalogue.hunts[]` é essa
— reabrir o jogo no meio de uma caçada existente não traz o nome de volta, e o modal diz isso em
vez de inventar. Monstros, loot possível e descrição aparecem no kit e ainda não têm dado no
servidor (M15: SV-02, SV-19, SV-21); a pill "Despachar loot" do kit espera o épico E5. "Seu
recorde" (XP/h, gp/h) nunca aparece — mesma regra de "não mostra estimativa oficial" já descrita
abaixo.

**Level recomendado aparece; estimativa de XP/h e gold/h não.** A regra é de produto e virou
estrutura: a mensagem `hunt-catalogue` não tem campo onde guardar a estimativa. Um comentário
pedindo para não mandar seria esquecido; um campo que não existe não pode ser preenchido por
engano. Um número oficial de XP/h vira a métrica pela qual toda hunt é julgada, e a partir daí só
existe uma hunt boa — o jogo passa a ter uma escolha, não quatro.

**Recomendação não é trava.** Abaixo do level recomendado a linha fica em âmbar e o botão
continua lá: quem decide se a entrada vale é o servidor, e no MVP ele não recusa por level.
Esconder o botão transformaria um conselho em regra que ninguém escreveu.

**Não existe "trocar de dificuldade".** Existe sair e existe entrar: trocar encerra a instância e
cria outra (§14.7), então a tela oferece as duas ações que de fato acontecem.

O catálogo chega **uma vez**, logo depois do `welcome` e pela fila normal — a versão de conteúdo é
fixada na sessão (invariante 7), então ele não muda enquanto ela vive.

## Regras

- Rota fixa e única por hunt; sem pathfinding dinâmico do bot dentro da hunt.
- Rota forma loop lógico (circular ou com retorno ao ponto de origem).
- Pontos de spawn e composição por dificuldade são dados de conteúdo, não aleatórios no MVP.
- Três tamanhos de pull: Cauteloso, Ousado, Agressivo — `monsterCount` total de 2/5/8 na Rat Cellars.
- Trocar de dificuldade encerra a instância atual e cria uma nova; sem mudança dinâmica na mesma instância.
- Em party, troca de dificuldade exige aprovação dos membros.
- Tela de seleção mostra level recomendado; não mostra XP/h nem gold/h estimados.
- Premium/VIP não trava acesso a hunt de loot superior no MVP.
- Encerramento por: ação manual, regra automática de saída, morte, ou outras condições futuras de sessão.

## O monstro, e por que ele é simples de propósito

Comportamento previsível, inspirado no Tibia (§17.1). IA sofisticada para mob comum **não** é
objetivo — e isso não é economia de esforço: previsível é o que deixa o jogador planejar, e é o
que faz uma hunt AFK render sem supervisão.

O movimento é **guloso** e cabe em três linhas: tenta o tile que mais aproxima do alvo;
bloqueado, tenta os dois vizinhos daquela direção; nada, espera este tick.

**Ele empaca em concavidade, e isso está certo.** É o comportamento do Tibia, os jogadores
reconhecem como correto, e "consertar" com busca de caminho custaria o que vem a seguir: como
o monstro **não guarda caminho**, não existe invalidação de rota — pôr uma parede no meio do
mapa custa **zero**, porque não há nada guardado para invalidar. É isso que torna magic wall
barato na Fase 5 ([ADR 0009](../adr/0009-fixed-hunt-route-without-pathfinding.md)).

O monstro **mantém o alvo** até ele morrer ou passar do raio de desistência, em vez de
reprocurar a cada tick. Numa instância com 48 monstros, procurar sempre é trabalho jogado fora
dezenas de vezes por segundo — e trocar de alvo porque outro jogador passou um tile mais perto
não é o que os jogadores esperam.

### Custo medido

`pnpm bench:monster`, com 48 monstros, 4 jogadores e paredes espalhadas para exercitar o desvio:

| | |
|---|---|
| por monstro por tick | **0,081 µs** |
| instância cheia (48 monstros) | 3,88 µs por tick |
| a 10 Hz | 0,039 ms de CPU por segundo, por instância |

Nessa ordem de grandeza, 5.000 instâncias a 10 Hz custariam cerca de 0,2 s de CPU por segundo —
um quinto de um núcleo. É o número que a projeção de custo usa e que a FUN-46 vai cobrar de novo
em escala; o valor aqui é a linha de base para detectar regressão de ordem de grandeza antes de
ela virar conta de servidor.

## A rota, e por que ela não tem pathfinding

Cada hunt tem **uma** rota, fixa e predeterminada, formando um laço (§14.4). O bot não escolhe
caminhos alternativos, e isso não é simplificação temporária: sem pathfinding, percorrer é
avançar um índice numa lista, e é isso que torna a hunt barata o bastante para milhares delas
rodarem desanexadas.

O personagem percorre, para para lutar, e **retoma no mesmo índice**. Reiniciar do começo faria
ele refazer o trecho já limpo, e a hunt renderia menos sem nenhuma razão visível para quem
está olhando o extrato.

O índice **entra no snapshot**: uma sessão retomada depois de queda de nó (FUN-28) continua de
onde estava, em vez de voltar ao começo da rota e render menos que a sessão que substituiu.

Se o personagem sair da rota — empurrado, teleportado, o que for —, ele volta pelo **tile mais
próximo**, achado por busca linear na lista. Não é A*: a rota tem dezenas de tiles, e procurar
o mais próximo numa lista dessas custa menos que montar a estrutura que um pathfinder pediria.

**Quando** parar e retomar é decisão do bot (Fase 2). O que existe hoje é só a execução:
avançar, parar, retomar, dar a volta.

### Movimento e rota: um escritor só (FUN-69)

Desde a FUN-69 **ninguém escreve posição de criatura fora de `packages/sim/src/movement.ts`**, e
o `pnpm source-policy` reprova quem tentar. Bot, monstro e o `walk` do socket passam pelo mesmo
caminho — `canOccupy` → `move` — e recebem a **mesma razão de recusa**: `out-of-bounds`,
`tile-blocked`, `tile-occupied`, `not-adjacent` ou `same-tile`. É o padrão do §8 do documento
de referência OpenTibia, e é conceitual: *validar → commit atômico → evento*.

Três consequências que o jogador sente:

- **A rota bloqueada por monstro segura o índice** (`RouteWalker.hold`) em vez de avançar e
  pular o tile na volta seguinte. O trecho que o personagem existia para limpar é limpo.
- **Um passo manual tira o personagem da rota, e o bot reentra** pelo tile mais próximo no
  vencimento seguinte, em vez de travar segurando um índice que nunca mais fica adjacente.
- **Todo passo produz `CreatureMoved`, haja ou não quem olhe** (§12). Quem está anexado recebe
  `creature-move` — um por passo, com origem, destino e duração, e o cliente interpola. A hunt
  desanexada produz exatamente os mesmos eventos e não serializa nenhum. Antes disto a hunt
  **não transmitia mundo**: os 42,8 bytes/s medidos na FUN-45 eram handshake e `ping`.

A colocação inicial passa pela mesma legalidade. O personagem nasce no `entryPoint` do mapa da
Cidade — conteúdo, validado no boot contra `isBlocked` — e não mais no literal `(0,0)`, que é
parede na borda de qualquer tilemap (FUN-60).

A duração do passo é **uma função** (`movementDuration`), usada por humano, bot e monstro. Desde
a FUN-119 (ADR 0025) ela é a fórmula do Tibia: `chão × 1000 / speed`, com a velocidade do chão
do tile de **destino**, arredondada para cima em múltiplos de 50 ms, e a **diagonal custa 3×**
antes do arredondamento — os números medidos no Huntera (speed 292 em chão 130/160/200 → 450/
550/700 ms; diagonal 2.100) são a fixture de `movement.test.ts`. A cadência de quem parou é a de
um passo dali. A Cidade não usa nada disso: anda a um passo fixo (`city.json`), porque é
navegação e não simulação.

**O mapa tem andares** (FUN-119): `floors` por `z`, e pisar numa escada (`floorChanges`) é um
passo cujo destino está em outro andar — como no Tibia, o tile de chegada pode não ser o
adjacente. O monstro não usa escada: para quem não carrega `z`, o degrau é parede. A rota fica
num andar só, e o carregador recusa rota que pise em escada.

## Spawn: densidade é dado, composição é sorteio

Os pontos de respawn são definidos por design, na rota. Quantos monstros a instância mantém
vivos — o `monsterCount` TOTAL do pull escolhido, como o Huntera conta (FUN-123) — **não varia**:
o §14.5 é explícito que não há variação aleatória de densidade no MVP. O total é ESPALHADO
pelos pontos de spawn da rota (`Spawner`): o lugar `i` fica no ponto `⌊i × pontos / total⌋`,
determinístico — com menos monstros que pontos eles cobrem o laço inteiro em intervalos iguais,
com mais cada ponto recebe a mesma quantidade. Na Rat Cellars, 2/5/8 ratos sobre 14 pontos: o
Cauteloso nasce nos pontos 0 e 7, o Agressivo em oito dos catorze. O `radius` de cada ponto é
até onde o monstro procura tile livre para nascer.

O único sorteio do spawn é **qual** monstro, dentro dos pesos da composição. Peso zero é
permitido e significa "não sai": é como se desliga uma variante sem apagar a linha, e apagar
linha é como se perde o histórico de balanceamento.

**A posição também não sorteia.** O monstro nasce sempre no mesmo tile livre mais próximo do
ponto. Uma hunt cujo spawn "anda" a cada respawn é uma hunt que o jogador não consegue
planejar — e planejar é justamente o que se ganha ao tornar o monstro previsível (§17.1).

O respawn tem **prazo configurável por hunt**. Instantâneo faria a rota deixar de importar: o
personagem mataria tudo parado num ponto só. Longo demais faz ele dar voltas em mapa vazio.

**O monstro não nasce colado num participante** (#236): `spawnClearRadius` da hunt é a menos de
quantos tiles de um participante vivo o tile é recusado. O spawn **adia** — tenta de novo a cada
segundo, no evento que já existia — e nunca cancela: a densidade continua sendo a da
dificuldade, que é o que a referência (§29) exige ao mandar não copiar a supressão do TFS. Sem
isso, com `respawnDelayMs` igual ao intervalo de ataque, o rato nascia e morria no mesmo
instante, e o cliente desenhava o dano num tile vazio. `0` desliga.

Os três pulls — Cauteloso, Ousado, Agressivo — são **dados**, não código. Trocar `monsterCount`
e a composição no JSON muda densidade e variedade sem tocar em lógica; há teste afirmando
exatamente isso, porque se um pull novo exigisse código o formato estaria errado.

## O ruleset, e por que ele é o molde dos outros cinco

Um ruleset define **quatro** coisas, e são as mesmas para hunt, treino, quest, boss e guild war:

| | Hunt |
|---|---|
| como entra | pelo menu, com dificuldade escolhida; instância criada na entrada |
| o que encerra | ação manual, regra automática de saída, ou morte (§14.8) |
| o que a morte faz | encerra, cobra a penalidade de XP (§26.2) e devolve à PZ curado |
| como a recompensa é calculada | loot (gold) e XP por abate, com level up, bloqueados quando a stamina zera (§10.2) |

Se a Guild War não couber nessa mesma interface depois, ela terá sido modelada em cima de hunt —
e descobrir isso na Fase 5 custa semanas. É por isso que a hunt **não pediu método novo** em
`Ruleset`: tudo o que ela precisa cabe em `onEnter`, `onEvent`, `onCreatureDied`, `onEnd` e no
par `getState`/`restore`, exatamente os mesmos que a Cidade usa.

**Entrar cria a instância.** Mapa, rota e spawns da dificuldade escolhida nascem na entrada, e a
versão de conteúdo é congelada ali (invariante 7). O personagem entra no primeiro tile da rota,
não na posição que trouxe da cidade.

**O personagem não persegue.** Ele percorre a rota, para quando há monstro ao alcance, e retoma
no mesmo índice. Quem se desloca até ele é o monstro — e é isso que dispensa pathfinding dos dois
lados.

**Uma instância hospeda um personagem, e recusa o segundo em voz alta.** Party divide a rota e
pede um caminhante por participante; aceitar o segundo em silêncio hoje o deixaria parado no tile
de entrada a hunt inteira, rendendo zero, sem nada explicando.

**Todo encerramento produz extrato**, inclusive o que acontece sem ninguém assistindo. O extrato
diz o motivo, e no caso de regra automática diz **qual** regra: "sua hunt encerrou por uma regra
de saída" sem dizer qual é a mensagem que faz o jogador desconfiar do bot que ele mesmo
configurou.

**As regras de saída vêm da configuração do jogador** (FUN-86). São `hp-below`, `out-of-gold` e
`party-member-lost`, com teto de 4 slots, avaliadas a cada 250 ms — e o extrato registra **qual**
delas encerrou, com o percentual no id quando é de HP. O encerramento é `exit-rule`, nunca
`manual-exit`: o jogador não pediu para sair, a regra dele decidiu, e o extrato tem que dizer a
verdade sobre isso. Ver [`bot.md`](./bot.md) para o vocabulário.

**Gold zerado NÃO encerra a hunt sozinho** (§20.3). Sem a regra `out-of-gold`, o personagem fica,
não consegue pagar supply e pode morrer — e a primeira recusa por falta de gold vira uma linha no
extrato, uma só. Com a regra, ele sai antes. A diferença entre os dois comportamentos é uma linha
na configuração, e é assim de propósito.

**Trocar de dificuldade encerra e cria outra** (§14.7). Não existe alteração dinâmica: mudar a
densidade no meio deixaria monstros da densidade antiga vivos ao lado dos novos, e o jogador
veria uma dificuldade que não é nenhuma das duas.

**Stamina zero não encerra a hunt** (§10.2). É a regra que mais parece bug para quem implementa.
O personagem continua caçando, matando e apanhando; o que ele deixa de ganhar é a recompensa —
loot e XP. O abate continua contando no extrato — o jogador matou, e dizer que não seria mentira.

### Morte e recompensa são um pipeline (FUN-63)

Morte de monstro e morte de personagem passam pelo **mesmo** caminho, copiado do §30 da
referência OpenTibia: `HP <= 0` → congela a criatura (os eventos dela saem da fila) → resolve
quem matou → **consequência do ruleset** → recompensa → despawn/respawn. A consequência é do
ruleset, nunca da criatura: a hunt encerra em PZ, a guild war vai respawnar, o boss vai variar por
dificuldade. Antes eram dois caminhos separados dentro da hunt, e cada ruleset novo precisaria de
mais um.

**Todo golpe registra atribuição** — `damageByActor` e `lastHitBy` na criatura, serializados no
snapshot. Hoje a recompensa vai ao **último golpe**; o maior dano fica guardado para party, boss e
bestiário lerem depois, sem migração. Dividir entre participantes é regra de produto, e entra com
party.

**O loot cai** — em gold e em item. A tabela do monstro separa moeda de item (`loot.gold` e
`loot.items`), porque gold é campo no personagem e não item; desde a FUN-76/FUN-88 `items` é
conferido contra o catálogo de itens e o item cai de verdade (ver [`economy.md`](./economy.md)).
O sorteio usa o `Rng` da sessão — a mesma semente rende o
mesmo loot, antes e depois de uma retomada — e uma linha com `chance: 0` não consome sorteio, para
desabilitar uma linha não mudar o que as outras rendem. O gold vira `goldDelta` no personagem e
`goldGained` no extrato, que o ledger leva à linha do personagem (invariante 10). Sem item de
loot no chão e sem caixa de loot: o produto rejeita isso de propósito (§26 da referência); o
cadáver que fica é só visual (FUN-123, ver "Divergências").

### Abate comum não é evento notável

`notableEvents` é a lista curta da tela de retorno (§16.2). Uma hunt de oito horas com uma linha
por rato não é lista, é log — e ninguém lê log ao voltar. Entram ali a entrada, o **level up**, a
morte, a penalidade de XP cobrada, a troca de dificuldade, a regra de saída que disparou e o
encerramento.

Level up é notável justamente por contraste com o abate: é a única coisa que aconteceu numa hunt
de oito horas que o jogador quer ver ao voltar.

## Como se entra numa hunt

Pelo menu, e a entrada é uma **transição de estado do personagem** (§6), não uma criação de
sessão solta. A Cidade é o centro: sai-se dela para hunt, treino, quest, boss ou guild war, e
qualquer uma delas volta para ela. **Não se vai de hunt direto para boss.**

Permitir tudo para tudo pareceria mais flexível e custaria caro: cada par novo de estados vira
um caminho de transição que ninguém testou, e a transição é justamente o único momento em que o
estado quente troca de dono. Passar pela Cidade dá a cada troca um ponto de parada conhecido,
onde o personagem está curado, sem instância e sem nada em voo.

**A troca é uma operação só.** O registro no diretório muda de sessão atomicamente, então não
existe o instante em que o personagem está em duas sessões nem o instante em que ele não está em
nenhuma. Isso importa além da arrumação: o estado exclusivo é também o controle de concorrência
sobre o estado quente (invariante 9) — não há lock sobre o gold porque nunca há duas fontes de
escrita ao mesmo tempo, e essa frase só é verdade enquanto a transição for de fato exclusiva. Um
furo aqui não apareceria como bug de sessão; apareceria meses depois como gold duplicado.

**A sessão de destino é construída ANTES de a antiga ser encerrada.** Se a hunt não existe, ou
se a dificuldade não é uma das que ela define, o personagem fica exatamente onde estava — em vez
de ficar sem sessão porque a antiga já tinha sido fechada.

**Duas transições disputadas: exatamente uma vence**, e a outra recebe uma recusa em vez de ficar
esperando. Sem isso, as duas leriam a mesma sessão de origem e a segunda tentaria trocar um
registro que a primeira já trocou — e o caminho de recusa da troca solta o personagem, ou seja,
perder a corrida derrubaria o jogador do jogo.

**Recusa é produto.** "Você não pode fazer isso" é a mensagem que faz alguém achar que o jogo
travou; cada recusa diz o que fazer em seguida, e o socket não cai — o cliente pediu algo
inválido, não algo malicioso.

A dificuldade chega como texto e é validada contra o **conteúdo**, não contra uma lista no
protocolo: uma hunt define as dificuldades que fazem sentido para ela, não obrigatoriamente as
quatro, e repetir a lista no protocolo criaria um segundo lugar para ela divergir.

## O que muda entre 10 Hz e 1 Hz, medido

A hunt roda a **10 Hz anexada e 1 Hz desanexada** (ADR 0003). A pergunta que importa é se isso
muda o que o jogador ganha. Dez minutos de hunt, mesmo conteúdo, mesma semente:

| | 1 Hz | 2 Hz | 5 Hz | 10 Hz | 20 Hz |
|---|---|---|---|---|---|
| abates, um monstro por ponto | 19 | 19 | 19 | 19 | 19 |
| abates, três monstros por ponto | 142 | 142 | 142 | 142 | 142 |
| dano sofrido, um monstro por ponto | 370 | 370 | 370 | 370 | 370 |

**Nada muda.** Desde a FUN-68 as três linhas são idênticas nas cinco taxas, e isso deixou de ser
uma propriedade que cada fórmula precisa preservar para virar uma propriedade da estrutura: quem
decide quando cada ação acontece é a fila de eventos da sessão, e o tamanho da janela em que os
eventos são despachados não muda quais eventos vencem, nem em que instante, nem em que ordem.

Vale guardar de onde se veio, porque é a justificativa da FUN-68 e porque as duas linhas de baixo
eram limites, não igualdades:

| medida | antes (1 Hz → 10 Hz) | agora |
|---|---|---|
| abates, três por ponto | 132 → 128, ~3% de folga | igualdade exata |
| dano sofrido | 530 → 350, **1,51x** | igualdade exata |

O dano sofrido era o pior dos dois: quem caçava desanexado — o modo **padrão** do jogo — apanhava
metade a mais. A causa era granularidade de *espaço*, não de tempo. Num tick de 1 s o personagem
andava dois tiles de uma vez, o monstro também, e a adjacência era conferida uma única vez no
fim: eles passavam mais ticks colados do que passariam a 10 Hz, e é enquanto estão colados que o
ataque avança. O tick em lote não tinha como expressar "os dois andaram em t+500 e nesse instante
não estavam adjacentes".

O comentário que vivia aqui dizia que corrigir "pediria subdividir o tick, o que gasta o que cair
para 1 Hz economiza". Era uma falsa escolha, e a FUN-68 mediu os dois lados — ver
[ADR 0020](../adr/0020-logical-session-scheduler.md).

**Dois defeitos separados viveram aqui e foram corrigidos.**

A **FUN-67**: o monstro aplicava UMA ação por tick mesmo quando o acumulador concedia várias, e
andava e batia menos quanto mais lento fosse o tick. Com um rato de 500 ms a diferença medida era
de **2,00x menos dano a 1 Hz**. Não é mais representável: a decisão do monstro devolve uma ação,
sem quantidade, e a quantidade saiu do tipo.

A **FUN-68**, além da granularidade: o cooldown de ataque **congelava enquanto não havia alvo**,
porque o acumulador só era consultado quando havia um. Na prática o personagem era punido pelo
tempo entre um monstro e o outro, e o ciclo de encontro ficava mais longo do que o intervalo de
ataque explica. Agora o cooldown corre em tempo de parede e o golpe fica *engatilhado*: quem
passou o intervalo inteiro sem alvo bate no instante em que um entra no alcance, e não no próximo
múltiplo de um relógio.

**Isto mexe no balanceamento, e o número está medido.** Na sala de teste do critério de saída da
Fase 1 — 2×2 tiles, respawn de 1 s, rato de 20 de vida morto em um golpe — o ciclo de encontro
caiu de ~5 s para ~2,25 s. O personagem mata mais rápido *e* apanha mais, porque enfrenta mais
monstros por minuto. Em `packages/content/data` a Rat Cellars segue confortável para um level 1
(seis minutos, 91 abates, vida praticamente cheia), mas o número a vigiar quando a curva de
dificuldade for desenhada é este, e ele importa para a FUN-38.

Registro de um caminho tentado e descartado, que continua valendo como aviso: trocar o acumulador
de ataque por **timestamp absoluto** dentro do modelo de tick parecia resolver e piorava — os
abates passavam a divergir entre taxas (299 a 20 Hz contra 277 a 1 Hz), porque um ataque que
ficava pronto no meio do tick disparava atrasado e o resto era descartado. O que resolveu não foi
trocar a representação do tempo dentro do tick, foi tirar o tick do meio.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Tamanhos de pull | 3 (Cauteloso, Ousado, Agressivo — `cautious`/`bold`/`reckless`) | `data/hunts/*.json`, campo `difficulties` |
| Monstros vivos por pull (Cauteloso / Ousado / Agressivo) | 2 / 5 / 8 na Rat Cellars, TOTAL da instância, espalhado pelos pontos do laço (cópia do Huntera) | `data/hunts/*.json`, campo `monsterCount` |
| Rota | lista ordenada de tiles, fixa por hunt | `data/routes/*.json`, apontada pelo `routeId` da hunt |
| Prazo de respawn | 2 s em Rat Cellars `[ABERTO — valor provisório; na captura do Huntera um rato novo aparece 1,0–2,5 s depois de um sumir]` | `data/hunts/*.json`, campo `respawnDelayMs` |
| Raio livre do spawn | 3 tiles em Rat Cellars `[ABERTO — valor provisório; o bow alcança 6]`; `0` desliga | `data/hunts/*.json`, campo `spawnClearRadius` (#236) |
| Prazo do cadáver no chão (só visual) | 10 s em Rat Cellars `[ABERTO — valor provisório; a captura não fechou um par appear→disappear]` | `data/hunts/*.json`, campo `corpseTtlMs`; a arte em `appearances.corpses` |
| Ambiente da cena (só apresentação) | `cavern` em Rat Cellars — o cliente escurece o mundo; ausente é superfície (FUN-121) | `data/hunts/*.json`, campo `ambience` |
| Passo manual (`walk` do jogador) | um por vez, por personagem: o hospedeiro recusa o que chega antes de o passo anterior acabar (FUN-122); o passo do bot conta a partir dele | `packages/server/src/game/host.ts` (`#walkingUntil`), `packages/sim/src/rulesets/hunt.ts` (`requestMove`) — mecanismo |
| Personagem desarmado (ataque, intervalo, alcance, armadura, esquiva) | [ABERTO — valor provisório: 25 / 2000 ms / 1 tile / 4 / 5%] | `data/combat/baseline.json`, bloco `player` |
| Velocidade do personagem (escala do Tibia) | 278 no level 1, +2 por level [ABERTO — valor provisório, lido do Huntera] | `data/progression/baseline.json`, `startingSpeed` / `speedPerLevel` |
| Duração do passo | `ceil50(chão × 1000 / speed)` ms, diagonal × 3; chão sem velocidade declarada vale 150 | `packages/sim/src/movement.ts` (`movementDuration`) — mecanismo, não balanceamento |
| O rato (números do mapa real, Canary) | 20 HP, 5 XP, ataque 0–8 sorteado por golpe, armadura 1, speed 172; o `defense 5` do Canary fica `[ABERTO]` — o motor só tem `armor` | `data/monsters/rat.json` |
| Loot por abate | Rat: gold 100 %, 1–4; queijo 39,4 % (`items/cheese.json`, aparência 3607) | `data/monsters/*.json`, bloco `loot` |

## Em aberto

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema. Os dois da tabela acima são deste
projeto, não do PRD: o personagem precisa de números de ataque e de velocidade para a hunt render,
e o PRD é silencioso sobre os dois porque assume equipamento — que ainda não existe. A densidade de referência (2/4/8/12) é explicitamente descrita como ponto de partida, não como número final — cada hunt define sua própria composição em conteúdo.

## Divergências do PRD

~~**Loot é só gold, por enquanto.**~~ → **Resolvido (FUN-76, FUN-88):** o loot de item
existe — a tabela do monstro confere `items` contra o catálogo, e o item cai de verdade, na
mochila se couber ou na Caixa de Loot da Sessão se não. Detalhe em
[`economy.md`](./economy.md#divergências-do-prd). A moeda continua creditada como campo, não
como item: gold nunca vira uma linha de `loot.items`.

**A hunt hospeda um personagem por instância.** Party é da Fase 3; até lá, entrar com o segundo
personagem é erro, não silêncio.

**Três tamanhos de pull, não quatro dificuldades** (ADR 0025, M11, em vigor desde a FUN-123).
O §14.5 prevê Iniciante/Profissional/Herói/Lendário; a decisão é copiar o Huntera —
Cauteloso/Ousado/Agressivo (`cautious`/`bold`/`reckless`), com um `monsterCount` total (2/5/8 na
Rat Cellars) como o número que o jogador vê.

**Cadáver no chão, só visual** (decisão do usuário, 2026-09-11; FUN-123). O abate deixa o
cadáver do monstro no tile — `ground-item-appear`, com a arte de `appearances.corpses` — por
`corpseTtlMs`, e ele some sozinho (`ground-item-disappear`); não carrega loot — o loot continua
indo direto à caixa da sessão. Quem reanexa vê os cadáveres que ainda estão lá
(`session-state.world.groundItems`). Monstro sem linha na tabela não deixa nada.

**A Rat Cellars é o bueiro de ratos de Rookgaard** (FUN-123), como no Huntera: o recorte real
importado (118×80, andar 8, 2 043 tiles andáveis, `ambience: cavern`), a rota traçada por
`pnpm route:trace` sobre ele — um laço de 160 tiles com 14 pontos de spawn onde o mapa real põe
rato —, e o rato do Tibia (20 HP, 5 XP, 0–8 de ataque, speed 172, gold e queijo). A entrada
continua pelo menu, abrindo uma instância — sem portal na cidade (ADR 0025).
