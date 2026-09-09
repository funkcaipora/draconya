# Hunt

**Status:** ruleset implementado (entrada, sessão e encerramento); item e loot ainda não
**PRD:** §14
**Épico:** E3

## Comportamento

Hunts são instâncias isoladas: não existe disputa aberta por spawn nem necessidade de atravessar o mundo continuamente para chegar até elas. O jogador abre o menu de Hunt no client e escolhe entre as hunts disponíveis. Hunts base ficam acessíveis por padrão; hunts especiais podem exigir quest, conquista/controle de guilda, ou outro requisito futuro — mas Premium/VIP não deve, no MVP, ser usado como trava de acesso a uma hunt de loot superior. Na tela de seleção, o jogo mostra o level recomendado da hunt, mas não mostra estimativa oficial de XP/h ou gold/h antes da entrada.

Cada hunt tem uma rota única, fixa e predeterminada — o bot nunca escolhe caminhos alternativos. A rota forma um loop lógico, seja circular, seja por subidas e descidas que retornam ao ponto de origem. Os pontos de respawn de monstros são definidos por design, e a quantidade/composição de monstros em cada ponto é um dado da hunt e da dificuldade escolhida; não existe variação aleatória de densidade no MVP.

Existem quatro dificuldades — Iniciante, Profissional, Herói e Lendário — cada uma aumentando a quantidade de monstros e podendo introduzir variantes mais fortes e tematicamente coerentes (por exemplo, uma hunt de vampiros pode reservar variantes cerimoniais/escuras para dificuldades mais altas). O jogador pode trocar de dificuldade durante sua jornada, mas isso encerra a instância atual e cria uma nova — não existe alteração dinâmica de dificuldade dentro da mesma instância. Em party, a troca de dificuldade exige votação/aprovação dos membros.

A hunt termina por ação manual do jogador, por uma regra automática de saída configurada no bot, por morte, ou por outras condições de sessão que venham a ser adicionadas depois. Stamina chegando a zero, isoladamente, não encerra a hunt (ver `stamina.md`).

## Regras

- Rota fixa e única por hunt; sem pathfinding dinâmico do bot dentro da hunt.
- Rota forma loop lógico (circular ou com retorno ao ponto de origem).
- Pontos de spawn e composição por dificuldade são dados de conteúdo, não aleatórios no MVP.
- Quatro dificuldades: Iniciante, Profissional, Herói, Lendário.
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

A duração do passo é **uma função** (`movementDuration`), usada por humano, bot e monstro. Hoje a
diagonal custa o mesmo que a reta; mudar isso é balanceamento, e muda num lugar só.

## Spawn: densidade é dado, composição é sorteio

Os pontos de respawn são definidos por design, na rota. Quantos monstros nascem em cada ponto
vem da **dificuldade escolhida** e **não varia** — o §14.5 é explícito que não há variação
aleatória de densidade no MVP.

O único sorteio do spawn é **qual** monstro, dentro dos pesos da composição. Peso zero é
permitido e significa "não sai": é como se desliga uma variante sem apagar a linha, e apagar
linha é como se perde o histórico de balanceamento.

**A posição também não sorteia.** O monstro nasce sempre no mesmo tile livre mais próximo do
ponto. Uma hunt cujo spawn "anda" a cada respawn é uma hunt que o jogador não consegue
planejar — e planejar é justamente o que se ganha ao tornar o monstro previsível (§17.1).

O respawn tem **prazo configurável por hunt**. Instantâneo faria a rota deixar de importar: o
personagem mataria tudo parado num ponto só. Longo demais faz ele dar voltas em mapa vazio.

As quatro dificuldades — Iniciante, Profissional, Herói, Lendário — são **dados**, não código.
Trocar `perSpawnPoint` e a composição no JSON muda densidade e variedade sem tocar em lógica;
há teste afirmando exatamente isso, porque se uma dificuldade nova exigisse código o formato
estaria errado.

## O ruleset, e por que ele é o molde dos outros cinco

Um ruleset define **quatro** coisas, e são as mesmas para hunt, treino, quest, boss e guild war:

| | Hunt |
|---|---|
| como entra | pelo menu, com dificuldade escolhida; instância criada na entrada |
| o que encerra | ação manual, regra automática de saída, ou morte (§14.8) |
| o que a morte faz | encerra, cobra a penalidade de XP (§26.2) e devolve à PZ curado |
| como a recompensa é calculada | XP por abate, com level up, bloqueada quando a stamina zera (§10.2) |

Se a Guild War não couber nessa mesma interface depois, ela terá sido modelada em cima de hunt —
e descobrir isso na Fase 5 custa semanas. É por isso que a hunt **não pediu método novo** em
`Ruleset`: tudo o que ela precisa cabe em `onEnter`, `onTick`, `onDeath`, `onEnd` e no par
`getState`/`restore`, exatamente os mesmos que a Cidade usa.

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

**Trocar de dificuldade encerra e cria outra** (§14.7). Não existe alteração dinâmica: mudar a
densidade no meio deixaria monstros da densidade antiga vivos ao lado dos novos, e o jogador
veria uma dificuldade que não é nenhuma das duas.

**Stamina zero não encerra a hunt** (§10.2). É a regra que mais parece bug para quem implementa.
O personagem continua caçando, matando e apanhando; o que ele deixa de ganhar é XP. O abate
continua contando no extrato — o jogador matou, e dizer que não seria mentira.

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
| Quantidade de dificuldades | 4 (Iniciante, Profissional, Herói, Lendário) | `data/hunts/*.json`, campo `difficulties` |
| Densidade de referência por ponto de spawn (Iniciante / Profissional / Herói / Lendário) | ~2 / 4 / 8 / 12 monstros (referência inicial discutida; a composição real é definida por hunt) | `data/hunts/*.json`, campo `perSpawnPoint` |
| Rota | lista ordenada de tiles, fixa por hunt | `data/routes/*.json`, apontada pelo `routeId` da hunt |
| Prazo de respawn | 30 s em Rat Cellars | `data/hunts/*.json`, campo `respawnDelayMs` |
| Personagem desarmado (ataque, intervalo, alcance, armadura, esquiva) | [ABERTO — valor provisório: 25 / 2000 ms / 1 tile / 4 / 5%] | `data/combat/baseline.json`, bloco `player` |
| Velocidade de passo do personagem | [ABERTO — valor provisório: 500 ms por tile] | `data/progression/baseline.json`, `stepDurationMs` |

## Em aberto

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema. Os dois da tabela acima são deste
projeto, não do PRD: o personagem precisa de números de ataque e de velocidade para a hunt render,
e o PRD é silencioso sobre os dois porque assume equipamento — que ainda não existe. A densidade de referência (2/4/8/12) é explicitamente descrita como ponto de partida, não como número final — cada hunt define sua própria composição em conteúdo.

## Divergências do PRD

**Loot ainda não cai.** O §14 fala em XP *e* loot por abate; hoje só o XP é creditado, com level
up e com a penalidade de morte da FUN-37 já no lugar. Não é
escolha de design: não existe item, nem inventário, nem capacidade — e creditar "gold" fingindo
que a moeda é um item resolvido criaria um caminho econômico que ninguém desenharia de propósito.
O bloqueio por stamina já está no lugar e vale para o loot no dia em que ele existir.

**A hunt hospeda um personagem por instância.** Party é da Fase 3; até lá, entrar com o segundo
personagem é erro, não silêncio.
