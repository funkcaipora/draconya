# Hunt

**Status:** parcial — ruleset (entrada, sessão, encerramento), movimento com escritor único
(FUN-69), loot de gold e de item por abate (FUN-63, FUN-88) e a **seleção de hunt no cliente**
(FUN-79) implementados
**PRD:** §14
**Épico:** E3

## Comportamento

Hunts são instâncias isoladas: não existe disputa aberta por spawn nem necessidade de atravessar o mundo continuamente para chegar até elas. O jogador abre o menu de Hunt no client e escolhe entre as hunts disponíveis. Hunts base ficam acessíveis por padrão; hunts especiais podem exigir quest, conquista/controle de guilda, ou outro requisito futuro — mas Premium/VIP não deve, no MVP, ser usado como trava de acesso a uma hunt de loot superior. Na tela de seleção, o jogo mostra o level recomendado da hunt, mas não mostra estimativa oficial de XP/h ou gold/h antes da entrada.

Cada hunt tem uma rota única, fixa e predeterminada — o bot nunca escolhe caminhos alternativos. A rota forma um loop lógico, seja circular, seja por subidas e descidas que retornam ao ponto de origem. Os pontos de spawn de monstros são definidos por design, na rota: cada um declara o próprio monstro e o próprio prazo de respawn; não existe variação aleatória de densidade no MVP, e não existe mais escolha de tamanho — ver "Spawn: todo ponto nasce, sem pull", abaixo.

**Não existe mais tamanho de pull** (#583, ADR 0039; histórico — ver "Divergências do PRD"). Até esta issue existiam três tamanhos — Cauteloso, Ousado e Agressivo (FUN-123, cópia do Huntera) —, removidos porque o Tibia real não tem essa escolha: todo ponto de spawn nasce, sempre. O campo `difficulty` sobrevive no protocolo só por compatibilidade (`enter-hunt.difficulty`, #584) e é ignorado pelo servidor.

A hunt termina por ação manual do jogador, por uma regra automática de saída configurada no bot, por morte, ou por outras condições de sessão que venham a ser adicionadas depois. Stamina chegando a zero, isoladamente, não encerra a hunt (ver `stamina.md`).

## Escolher a hunt (FUN-79, #259)

A escolha é um modal ("Escolha uma caçada", #259), aberto pela pill "Escolher caçada" sobre o
mundo (na Cidade) ou pelo ícone Hunts do topo (nos dois estados); durante a hunt a pill vira
"Sair da caçada". Mostra por hunt: nome, **level recomendado** e as dificuldades que ELA define —
não obrigatoriamente as quatro. A formação da party (ADR 0027) é a coluna direita do mesmo modal;
os companheiros DURANTE a hunt são um painel fixo próprio na coluna esquerda (`PartyMembers`,
DS-14).

**Detalhes da caçada, durante a hunt (#325, #349, SV-13).** A pill "ⓘ Detalhes da caçada" abre
um modal de duas colunas com o nome, o nível recomendado e as dificuldades da hunt ativa — a mesma
regra de "level recomendado é conselho" vale aqui. A identidade da hunt ativa vem do servidor
(SV-05, #341: `session-state` e `instance-enter` trazem `huntId`/`difficulty`), não de uma
lembrança do `HuntsModal` nesta aba — reabrir o jogo no meio de uma caçada existente, ou reanexar
num nó diferente, também traz o nome de volta. O modal ainda omite a identidade, numa frase curta,
nos dois casos que sobram sem resposta: um nó `game` anterior à SV-05 que não manda o campo, ou o
catálogo (trocado por uma reconexão) sem mais aquela hunt. Tamanhos de pull com contagem
("Ousado · 4", SV-19, #355), criaturas com vida e experiência e o loot possível — cada item uma vez,
com sprite e nome, sem gold e sem raridade (SV-02, #338) — aparecem quando o catálogo os traz; o
catálogo de monstros nunca traz outfit, e o lugar do sprite de cada criatura fica tracejado, como na
Cyclopedia. A descrição (SV-21, #357, `hunt.description` no conteúdo) aparece quando a hunt tem o
parágrafo escrito — Rat Cellars tem — e a seção some, em vez de mostrar um traço, quando não tem.
A pill "Despachar loot" do kit espera o épico E5. "Seu recorde" (XP/h, gp/h) nunca aparece — mesma
regra de "não mostra estimativa oficial" já descrita abaixo.

**A área da hunt aparece no mundo (#327, #348, SV-12).** O overlay do canto superior mostra
"`<nome da hunt>` · `<dificuldade>`" antes da contagem de criaturas no alcance, pela mesma
identidade da hunt (SV-05) do parágrafo acima — e some, deixando só a contagem, nos mesmos dois
casos em que o modal de detalhes omite o nome.

**A contagem e o painel Batalha são do MESMO andar, sempre (#527).** Numa hunt privada não há
AOI (FUN-33): o hospedeiro manda TODOS os monstros vivos da instância pelo `session-state`, dos
três andares da Darashia Dragon Lair inclusive, porque o mundo espacial precisa deles para
desenhar o que se vê através de escada e vão (ADR 0034). `battleRows`
(`packages/client/src/shell/BattlePanel.tsx`) e a contagem do `WorldOverlay` filtram por
`creature.position.z === própria posição` antes de contar — sem isto, quem estava em z10 via
"35 criaturas no alcance" com Dragon Lords de z11/z12 somados, embora o bot (`countTargets`,
`packages/sim/src/targeting.ts`) já contasse certo, só por andar, desde o #519. O mundo
continua desenhando andares vizinhos (ADR 0034); só a LISTA de batalha e o contador são
por andar — no Tibia a battle list também só mostra quem está no mesmo andar.

**Level recomendado aparece; estimativa de XP/h e gold/h não.** A regra é de produto e virou
estrutura: a mensagem `hunt-catalogue` não tem campo onde guardar a estimativa. Um comentário
pedindo para não mandar seria esquecido; um campo que não existe não pode ser preenchido por
engano. Um número oficial de XP/h vira a métrica pela qual toda hunt é julgada, e a partir daí só
existe uma hunt boa — o jogo passa a ter uma escolha, não quatro.

**Monstros e loot possível chegam pelo catálogo, sem raridade** (SV-02, #338). Cada hunt leva
`monsters: [{id, name}]` — os monstros que aparecem em QUALQUER dificuldade dela, deduplicados —
e `loot: [{itemId, name}]` — o loot possível, também deduplicado. A raridade não vem: a mecânica
não existe (E5). Gold nunca entra em `loot`: não é item, é campo do personagem — quem quer saber
se a hunt solta gold já tem isso em `lootDrops`. `catalogue.monsters[]` (a lista para o
Bestiário) ganha `health` e `experience` de cada monstro — nunca XP/h nem gold/h por hora, que
continua fora por decisão de produto (parágrafo acima).

**`difficultyDetails`/`difficulties` são vestígio de protocolo, não produto** (SV-19, #355; fim
do pull no #583). Sem pull nenhum, o catálogo manda um nome só (`"default"`) com
`monsterCount` igual ao total de pontos de spawn da rota — a tela deixa de mostrar "Ousado · 4"
e passa a mostrar só a hunt, sem seletor de tamanho (#584 remove os dois campos do protocolo por
completo quando o cliente parar de precisar deles).

**Recomendação não é trava.** Abaixo do level recomendado a linha fica em âmbar e o botão
continua lá: quem decide se a entrada vale é o servidor, e no MVP ele não recusa por level.
Esconder o botão transformaria um conselho em regra que ninguém escreveu.

**Não existe "trocar de dificuldade".** Existe sair e existe entrar: trocar encerra a instância e
cria outra (§14.7), então a tela oferece as duas ações que de fato acontecem.

O catálogo chega **uma vez**, logo depois do `welcome` e pela fila normal — a versão de conteúdo é
fixada na sessão (invariante 7), então ele não muda enquanto ela vive.

## Saída da hunt (#360)

A saída da hunt pode ocorrer de duas maneiras principais quando não decorre de morte: por **regra automática de saída** (configurada nas opções de saída do bot, como `hp-below` ou `out-of-gold`) ou por **solicitação manual** (`ruleset.requestExit(session, characterId)` — o que o `leave-hunt` do socket chama desde o #802, ver abaixo).

- **Contagem regressiva (`exitDelayMs`)**: Quando configurado na hunt (`exitDelayMs` em `packages/content`), tanto o disparo de uma regra automática de saída quanto a solicitação manual iniciam uma contagem regressiva (o Huntera usa 5 s, `hunt-leave-pending`; nenhuma hunt do Draconya declara o campo hoje, ver o último item desta lista). Durante esse intervalo, o personagem continua no mundo e sujeito ao combate. Se `exitDelayMs` estiver ausente — o caso de todas as hunts de `data/hunts/` —, a saída é imediata (só a trava de combate abaixo pode atrasá-la).
- **Registro do evento**: O evento notável (`exit-rule`) é registrado no instante exato do disparo do gatilho (`t`), enquanto o encerramento da sessão ou a partida do participante é diferida para `t + exitDelayMs`.
- **Múltiplos disparos**: Novas solicitações de saída durante uma contagem já em andamento são ignoradas e não reiniciam o timer.
- **Preservação em snapshot**: Se o estado for serializado no meio da contagem regressiva, o timer agendado e o motivo de saída pendente (`pendingExit`) são preservados na retomada.
- **Exceção para `party-member-lost`**: A regra de saída em cascata quando um membro do grupo sai ou morre (`party-member-lost`) permanece **imediata**, sem passar pelo atraso de `exitDelayMs`.
- **Trava de combate (#625, janela do `CONDITION_INFIGHT`/`pzLocked` do Canary, 60 s)**: depois de vencer o `exitDelayMs`, a saída — manual ou por regra do bot, as duas — só **conclui** se o personagem estiver fora de combate: nenhum ataque dado nem recebido nos últimos 60 000 ms. Em combate, o `pendingExit` fica marcado e a saída aguarda; um novo ataque durante a espera empurra o prazo para 60 s depois DELE, como no Tibia. **A definição de "em combate" é uma aproximação por dano aplicado, não o `CONDITION_INFIGHT` inteiro:** o carimbo (`lastCombatActionAtMs`) só é escrito quando um golpe é aplicado, dado ou recebido. O Canary também renova a condição quando um monstro escolhe o jogador como alvo (sem ter batido ainda), em toda magia agressiva conjurada (acertando ou não), no tiro sem linha de visão e no dano de campo/DoT — nesses instantes o Canary recusaria o logout e o Draconya conclui a saída. Alargar os carimbos é acompanhamento do #625 (muda também o decaimento de imbuement, #606), e não foi feito no #802. "Em combate" tem uma definição só no motor (`isInFight`, `packages/sim/src/combat/in-fight.ts`), que também alimenta o decaimento de imbuement fora de combate (#606). A cascata `party-member-lost` continua isenta — ela nunca passa por essa trava.
- **O `leave-hunt` do jogador pede a saída ao ruleset (#802).** Até o #802 o opcode 10 encerrava a sessão direto no hospedeiro (`session.end`/`session.leave`), e o `exitDelayMs` e a trava de combate só valiam para a saída automática do bot. Agora `SessionHost#requestLeaveHunt` chama `requestExit`, e a sessão termina quando o ruleset conclui (`#finishExit`) — depois do `exitDelayMs` e fora da janela de 60 s. Concluir é o mesmo caminho de sempre: solo encerra a sessão (`manual-exit`, extrato, Cidade); numa party o membro SAI com o extrato dele (`member-left`) e a hunt segue para os outros. **Idle-first (invariante 3):** a espera é um evento da fila do `sim`, então vence com ou sem visualizador — pedir a saída e fechar a aba sai do mesmo jeito, no mesmo instante lógico. **Morte, `party-member-lost` e a drenagem do nó continuam encerrando direto**: nenhuma carrega a intenção de sair.
- **O cliente vê a espera (`exit-pending`, S2C 45) e pode desistir (`cancel-exit`, C2S 34).** O servidor manda `{ active, reason, phase, remainingMs }` por PERSONAGEM: `phase: 'countdown'` (a contagem do `exitDelayMs`) ou `'in-combat'` (a trava de 60 s — o `remainingMs` é uma previsão que cada golpe novo empurra, e a mensagem é reenviada quando ele muda); `active: false` é o fim da espera. Sai também no `session-attach`, com o que falta AGORA. A pill "Sair da caçada" vira "Saindo em N s · Cancelar" / "Em combate · saindo em N s · Cancelar" (`HuntExitPending.tsx`). **Só a saída MANUAL se cancela** (`ruleset.cancelExit`): a de uma regra do bot reaparece no ciclo seguinte enquanto a condição valer, então a tela só a mostra. Cancelar cancela o `EXIT_COUNTDOWN` agendado — pedir de novo logo depois recomeça a contagem inteira. **Divergência do Canary, que não é regra de caça:** o Canary não tem logout pendente — recusa na hora (`RETURNVALUE_YOUMAYNOTLOGOUTDURINGAFIGHT`) e o jogador tenta de novo; a espera (e o cancelar) são a forma do Draconya de fazer esse "tenta de novo" por um jogo idle-first, no molde do `hunt-leave-pending` do Huntera (`docs/reference/huntera-observed.md`, Parte II §15). Nenhuma regra de combate nem a janela de 60 s mudam.
- **Sem `exitDelayMs` no conteúdo, o atraso é só a trava.** Nenhuma hunt de `data/hunts/` declara `exitDelayMs` hoje (o campo existe no schema, opcional): fora de combate o `leave-hunt` conclui na hora, como antes do #802; em combate espera os 60 s. O Huntera atrasa 5 s (`hunt-leave-pending { remainingMs: 5000 }`); declarar `exitDelayMs: 5000` nas hunts é uma linha por arquivo, mas muda também a saída por regra do bot em todas elas — decisão de balanceamento, fora do #802.
- **Um bot que luta sem parar mantém o personagem em combate.** A trava lê o último golpe dado OU recebido: numa hunt densa, com o bot atacando e os monstros respawnando, a saída manual pode ficar pendente por muito tempo (é para isso que o "Cancelar" existe). Fazer o bot recolher a iniciativa enquanto há uma saída manual pendente não é regra do Canary e não foi feito aqui — acompanhamento de automação, não de caça.

## Regras

- Rota fixa e única por hunt; sem pathfinding dinâmico do bot dentro da hunt.
- Rota forma loop lógico (circular ou com retorno ao ponto de origem).
- Pontos de spawn são dados de conteúdo, não aleatórios no MVP: cada um declara o próprio
  monstro e o próprio prazo de respawn, e todos nascem juntos, na entrada (#583).
- Sem tamanho de pull (#583): não existe mais Cauteloso/Ousado/Agressivo nem escolha de
  densidade — Rat Cellars nasce com os 56 pontos do recorte real do Canary vivos (#586, não mais
  2/5/8), Rotworm Caves com os 42.
- Respawn segue `blockable` do monstro (#583): quem é `blockable` espera a vista limpar (janela
  de ±11 tiles) e reinicia o relógio se alguém está por perto; quem não é nasce sempre, com um
  atraso de telegraph de 4200 ms.
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

O monstro **mantém o alvo** até ele morrer, **sair da área de visão do monstro** (#655 — o
`aggroRadius`, o quadrado de 11 tiles do `Creature::canSee` do Canary) ou passar do raio de
desistência, em vez de reprocurar a cada tick. Numa instância com 48 monstros, procurar sempre é
trabalho jogado fora dezenas de vezes por segundo — e trocar de alvo porque outro jogador passou
um tile mais perto não é o que os jogadores esperam. O corte pela visão é o do Canary: o alvo que
sai do `canSee` sai da `targetList` (`Creature::onCreatureMove` → `onCreatureDisappear`), e é o
que esvazia a lista e manda o monstro de volta ao spawn (abaixo). Antes do #655 o monstro
perseguia para sempre (o raio de desistência é zero em todo o catálogo).

**Sem alvo à vista, ele volta ao spawn e fica ocioso lá (#655, TFS/Canary `Monster::
updateIdleStatus`/`doWalkBack`, `monster.cpp:1521-1560`, `2501-2526`).** A "lista de alvos" do
Canary é quem está na área de visão do monstro — aqui, algum participante VIVO (ou invocação de
personagem viva) dentro do `aggroRadius`, no mesmo andar ou não (`canSee` com as regras de andar do
Canary). Com ela vazia e o monstro fora do `home`, ele LIGA a volta e caminha até lá pelo passo
guloso de sempre, um tile por vencimento, sem sortear nada; se o guloso empaca numa concavidade
fora do `home`, a volta passa a pedir cada passo à busca de caminho limitada até chegar (o Canary
usa A* aqui; ADR 0009, emenda de 2026-09-29) — o monstro sempre chega em casa quando há caminho. No
`home`, com a lista vazia e sem nenhuma condição ativa (fogo, veneno, haste…), ele fica **ocioso**
(`isIdle`): nenhum passo — e, ao ficar ocioso, esquece quem bateu nele (`Creature::onIdleStatus`: a
atribuição de dano zera) e **não usa defesa, não troca de alvo e não invoca** (o Canary o tira do
`onThink`; os timers seguem reagendando, mas vencem sem rolar). Uma condição ativa impede o ocioso,
como no Canary (`conditions.empty()`) — exceto a provocação do Challenge, que no Canary é um
contador e não uma `Condition`. A volta persiste ligada até o monstro chegar ou não achar passo —
um alvo que aparece no meio dela não a desliga.

**Com alvo à vista mas sem passo até ele, ele anda ao acaso (#655, `Monster::doRandomStep`/
`getRandomStep`, `monster.cpp:2494-2499`, `2552`).** É o "preso" do parágrafo seguinte, e também o
monstro que foge encurralado, e o que tem alguém à vista que não é alvo (invisível, outro andar).
Quando o último passo dele foi há pelo menos 1000 ms de tempo lógico (`RANDOM_STEP_INTERVAL_MS`),
as quatro direções cardinais (nunca diagonal) são embaralhadas com o `Rng` da sessão — três
sorteios por tentativa, como o `std::ranges::shuffle` — e a primeira com tile livre vence
(`Monster::canWalkTo`: sem criatura no tile MESMO que empurrável, sem escada nem teleporte, com o
campo respeitando `canWalkOnFieldType`, dentro de 50 tiles do spawn — `deSpawnRadius`). O estado
`randomStepping` liga aqui e só desliga quando a perseguição volta a rodar
(`Monster::doFollowCreature`).

**Ele evita campo de fogo, veneno e energia que não pode atravessar (M29-05, TFS/Canary
`Monster::canWalkOnFieldType`).** `canWalkOnFire`/`canWalkOnPoison`/`canWalkOnEnergy` são
booleanos por monstro, ausentes é `true` — o default do Canary, o mesmo que 632/1.601 monstros
do bestiário real sobrescrevem para `false` (é a base de Fire Field e GFB controlarem posição).
Imune ao elemento, o monstro sempre pisa, como no Canary. O predicado vale igual no passo guloso
e na fuga — e, por construção, em qualquer decisão futura de movimento que reaproveite o mesmo
`Blocked` (ex.: uma postura de manter distância, ainda não implementada neste motor): um tile com
o campo proibido conta como bloqueado, exatamente como parede — sem caminho guardado para
invalidar (ADR 0009), então a checagem é O(1) pelo índice numérico de `Fields`.

**Preso atrás de um campo que ele não pode cruzar, ele anda ao acaso do lado de cá — e só cruza
se apanhar.** É o `ignoreFieldDamage` do TFS/Canary: levar dano ENQUANTO preso (a decisão de
movimento não achou passo, nem aproximando nem fugindo) OU andando ao acaso (`randomStepping`,
#655 — o segundo gatilho da condição do Canary, `monster.cpp:3450`, que este motor não tinha
porque o monstro dele nunca andava sem alvo) concede uma passagem TEMPORÁRIA pelo campo. A
concessão é consumida pela decisão de perseguição ou de volta ao spawn seguinte, tenha ela
precisado ou não; o passo aleatório e o ocioso NÃO a gastam (o Canary só a zera em
`doFollowCreature`/`doWalkBack`). Sem dano, o monstro preso oscila atrás do fogo para sempre — o
comportamento certo.

**Ele empurra quem bloqueia o passo, em vez de tratar todo tile ocupado como parede (M29-08,
TFS/Canary `Monster::pushCreatures`) — mas só sob `combat-v3`.** `canPushCreatures`, `pushable` e
`canPushItems` são booleanos por monstro; ausentes são, respectivamente, `false`, `true` e
`false` — os defaults do Canary. Rato e rotworm não declaram nenhum dos três. **Dragon e Dragon
Lord declaram os três** no Canary (`dragon.lua`/`dragon_lord.lua`: `pushable = false,
canPushItems = true, canPushCreatures = true`), mas o conteúdo autoral de hoje
(`data/monsters/generated/dragons.json`, regenerado pelo #581) ainda não carrega o campo — os
dois continuam nos defaults do schema até o valor real chegar (fora do escopo desta issue, o
mesmo trabalho do leitor de bestiário, #578). Um monstro `canPushCreatures` que encontra o
próprio caminho ocupado por outro monstro `pushable` o empurra para um tile CARDINAL livre (nunca
diagonal), sorteado sem reposição pelo `Rng` da sessão — a mesma ordem embaralhada do Canary
(`{norte, oeste, leste, sul}`). Sem nenhum cardinal livre, o empurrado morre no lugar, sem
atacante: não paga XP a ninguém, e o loot segue a regra de "sem dono" que já vale para um abate
cujo matador sumiu. `canPushItems` está no schema, validado, mas SEM EFEITO — não existe item
móvel no chão (o cadáver é só visual, ADR 0048), então não há o que empurrar. **O jogador nunca é
empurrado nem esmagado** — a checagem só considera outros monstros; um monstro parado no tile de
um jogador continua bloqueando exatamente como antes. **Sob `combat-v1`/`v2` o tile ocupado
continua parede, incondicionalmente** (ADR 0031/0040, a mesma regra que já governa o crítico de
item e o hit chance de distância, #551/#555): o empurrão consome `session.rng` e move outra
criatura, e as duas coisas mudariam o que uma hunt congelada nesses perfis rende — então o
mecanismo inteiro (decisão e commit) sai sem efeito algum fora de `combat-v3`, mesmo que um
monstro futuro declare `canPushCreatures: true`.

**Monstro de facção caça o de facção inimiga, e o herói não precisa estar por perto (#619, Canary
`monster.faction`/`enemyFactions`).** O Deepling ataca o Deathling, a Lion e os Usurpers se caçam:
quem tem `faction` passa a considerar OPONENTE o monstro cuja facção está na sua `enemyFactions`,
além do jogador, e a briga acontece pelo mesmo golpe, pela mesma defesa e pela mesma atribuição de
dano de sempre. É só quem a hunt PODE gerar que paga o custo — uma hunt sem nenhum monstro de facção
(todas as de hoje) roda o caminho de antes, bit a bit. O que o monstro vê e quem ele mira são duas
perguntas (a Lion enxerga o herói e nunca o ataca), e o jogador (facção 1) é preferido a qualquer
monstro inimigo na escolha do alvo: a briga de facções é a que sobra quando o herói está fora da
vista. O que vale "sem jogador" é a posição dos participantes da sessão — nunca quem olha (invariante
3). Mecanismo, tabela de perguntas do Canary e o que não foi modelado: "Facções de monstro" em
[`combat.md`](./combat.md).

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
`tile-blocked`, `tile-occupied`, `not-adjacent`, `same-tile` ou `unreachable` (#763, só de um
`walk-to` distante — ver abaixo). É o padrão do §8 do documento de referência OpenTibia, e é
conceitual: *validar → commit atômico → evento*.

Três consequências que o jogador sente:

- **A rota bloqueada por monstro segura o índice** (`RouteWalker.hold`) em vez de avançar e
  pular o tile na volta seguinte. O trecho que o personagem existia para limpar é limpo.
- **Um passo manual tira o personagem da rota, e o bot reentra** pelo tile mais próximo no
  vencimento seguinte, em vez de travar segurando um índice que nunca mais fica adjacente.
- **Todo passo produz `CreatureMoved`, haja ou não quem olhe** (§12). Quem está anexado recebe
  `creature-move` — um por passo, com origem, destino e duração, e o cliente interpola. A hunt
  desanexada produz exatamente os mesmos eventos e não serializa nenhum. Antes disto a hunt
  **não transmitia mundo**: os 42,8 bytes/s medidos na FUN-45 eram handshake e `ping`.

#### `walk-to` distante: caminho no servidor e pausa do bot (#763)

Até a #763, `requestMove` só aceitava um tile ADJACENTE — clicar num cadáver a mais de um tile
mandava um único `walk-to` com o destino final (o cliente, que só manda intenção, espera o
personagem chegar sozinho: `corpse-approach.ts`/`tile-approach.ts`) e o servidor recusava
`not-adjacent` na hora; o personagem nunca chegava, e "selecionar quais itens pegar do loot"
não funcionava na prática.

Um `to` NÃO-adjacente agora calcula um caminho com o mesmo BFS limitado do follow do bot (#527,
`boundedPath`, `packages/sim/src/route/pathfind.ts`) — a mesma legalidade de
`canOccupy`/`MovementWorld`, com a exceção de uma porta FECHADA do overlay de cenário (#728):
o caminho a trata como passável, porque o personagem a abre sozinho ao encontrá-la, a mesma
automação que já existe para a rota autorada. Sem caminho dentro do raio (parede genuína, fora
do raio, ou um interativo que não é porta), a recusa é `unreachable` — tipada, para o cliente
nunca ficar esperando uma resposta que não vem.

Enquanto o caminho está em curso, o personagem consome um tile por vencimento (invariante 2) e
**não anda pela rota nem persegue alvo — com PRIORIDADE ACIMA do combate-stop de sempre**
(achado de QA ao vivo na Darashia Dragon Lair, Sorcerer level 200): um destino distante numa
masmorra cheia de dragões nunca terminava de andar, porque o combate-stop de sempre segurava o
personagem no primeiro dragão ao alcance e nunca soltava, já que o alvo nunca morria nem saía de
alcance. O personagem que clicou um destino distante já expressou a intenção de IR até lá; ele
continua batendo em quem estiver ao alcance NO CAMINHO (`#armPlayerAttack`), só não gruda para
lutar. Ao chegar — ou direto de qualquer intenção manual, mesmo sem `walk-to` nenhum antes (outro
achado de QA ao vivo: abrir um cadáver já adjacente não armava pausa nenhuma, e o bot levava o
personagem embora antes do `take-loot` seguinte) —, o bot fica PAUSADO por dez segundos,
RE-INICIADOS por qualquer intenção manual nova (abrir cadáver, pegar loot, usar item, usar no
mapa); combate continua valendo cheio durante a pausa — "atacar de onde está" é aceitável, só
ANDAR é suprimido. É a janela para o jogador agir antes de a rota retomar sozinha, pelo tile mais
próximo (o mecanismo que já existe). Um pedido de passo adjacente novo (seta, ou outro clique a
um tile) cancela um caminho em curso — é intenção nova, sobrepõe a anterior.

O CLIENTE (`corpse-approach.ts`/`tile-approach.ts`) desiste depois de um prazo se o personagem
nunca chegar — mas o prazo FIXO de dez segundos expirava antes de terminar de andar até um
cadáver realmente distante (onze tiles, no mesmo QA). O prazo agora é PROPORCIONAL à distância
conhecida no instante do clique: dez segundos de base mais um segundo por tile
(`corpseApproachDeadline`/`tileApproachDeadline`, `packages/client/src/world/`), resolvido uma
vez no pedido e nunca recalculado depois.

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
adjacente. O monstro não usa escada: para quem não carrega `z`, o degrau é parede.

**A rota pode atravessar andares** (#519, a Darashia Dragon Lair): `validateRoute` aceita um
passo que pisa exatamente no tile registrado em `floorChanges`, e a posição EFETIVA para julgar o
passo seguinte é o destino da escada — nunca o tile autorado, porque `move()` nunca deixa ninguém
parado nela. `scripts/trace-route.ts` traça isso sozinho: de um estado `(x, y, z)`, o vizinho que
é uma escada não vira um tile a mais no caminho, a busca CONTINUA a partir do destino dela. O
monstro, mesmo passando a carregar o PRÓPRIO andar (`position.z`, para saber onde nasceu — ver
"Spawn" abaixo), continua sem a CAPACIDADE de usar escada: o `z` na posição dele é identidade,
nunca permissão (`Movable.crossesFloors`, só o personagem tem). Todo lugar que compara alvo,
área ou proximidade confere o andar antes da distância — os três andares da Darashia Dragon Lair
compartilham a mesma caixa `(x, y)`, e um Dragon Lord de z11 pode ter coordenada idêntica à de um
Dragon em z10, um andar acima; sem a checagem, o monstro perseguiria e a magia acertaria através
do chão.

## Spawn: todo ponto nasce, sem pull (#583, ADR 0039)

**Fim do pull por dificuldade.** Até o #583, a instância mantinha vivo um `monsterCount` TOTAL —
2/5/8 na Rat Cellars, Cauteloso/Ousado/Agressivo — espalhado pelos pontos de spawn da rota. Esse
modelo era uma característica OBSERVADA do Huntera (FUN-123), não do Canary/Tibia real: no jogo
de verdade não existe escolha de tamanho de pull, e nenhuma hunt tem "densidade configurável".
O #583 remove o modelo inteiro: **toda hunt nasce direto dos pontos de spawn da rota, um
monstro por ponto, e TODOS os pontos nascem ao mesmo tempo, na entrada.** Rat Cellars e Rotworm
Caves ainda usavam, na época do #583, os 14/13 pontos genéricos que a rota já tinha traçado (sem
`monsterId` por ponto) com o `rat`/`rotworm` fixo como fallback de composição — um meio-termo,
não o modelo final. O #586 (M36-05) terminou a conversão: rodou o importador de spawns do Canary
(`pnpm catalog:spawns`, #582) sobre o recorte real das duas hunts, e a densidade e a composição
finais são as do XML `otservbr-monster.xml`, não uma contagem escolhida à mão — **Rat Cellars
sobe para 56 pontos** (48 `rat`, 3 `spider`, 2 `rabbit`, 2 `bug`, 1 `cave-rat` — o Canary povoa o
bueiro com a fauna inteira da zona, não só rato) **e Rotworm Caves para 42** (35 `rotworm`, 7
`terramite`). É uma mudança real de densidade E de composição, deliberada (ADR 0039 decisão 3) —
não um efeito colateral a corrigir.

Cada ponto de spawn **declara o próprio monstro**: `monsterId` fixo, ou `monsters` — uma lista
de candidatos com peso, para o caso (raro) do Canary em que dois `<monster>` do mesmo `<spawn>`
caem exatamente na mesma posição (#582). Um dos dois é obrigatório — não existe mais composição
de dificuldade para cair como fallback quando o ponto não declara nada. O único sorteio do
spawn continua sendo **qual** monstro, entre os candidatos DO PONTO (nunca entre pontos
vizinhos); peso zero continua significando "não sai", sem apagar a linha.

**A posição não sorteia.** O monstro nasce sempre no mesmo tile livre mais próximo do ponto —
até o `radius` que a rota autora. Uma hunt cujo spawn "anda" a cada respawn é uma hunt que o
jogador não consegue planejar (§17.1).

Cada ponto também declara o próprio `respawnDelayMs` — o `spawntime` do Canary, por posição, não
por zona nem por dificuldade — também obrigatório desde o #583.

**O respawn segue o `SpawnMonster` do Canary, por `blockable` — não mais por
`spawnClearRadius`.** O campo da hunt que segurava o respawn perto de qualquer participante
(`spawnClearRadius`, #236) foi REMOVIDO do conteúdo; o que decide agora é uma propriedade do
MONSTRO, `blockable` (#519, o `isBlockable` do TFS/Canary — já existia desde a issue anterior,
só a regra que o consome mudou):

- **`blockable: true`** — o respawn espera nenhum participante VIVO, no MESMO
  andar do ponto, dentro da janela de visão (`±11` tiles Chebyshev — a aproximação quadrada do
  viewport retangular do Canary, `Spectators::find`/`MAP_MAX_VIEW_PORT_X`/`_Y`, a mesma
  simplificação que o resto do motor já faz para distância). Enquanto há alguém à vista, o
  relógio **reinicia inteiro** — a próxima checagem só vence dali a `respawnDelayMs` de novo,
  nunca um retry curto. Sem ninguém à vista, nasce na hora (sujeito só a parede/ocupação). Rat e
  Rotworm declararam `true` até o #586 — um override (`data/monsters/overrides/rat.json`/
  `rotworm.json`) preservando o comportamento OBSERVADO do Huntera, não do Canary (o `rat.lua`/
  `rotworm.lua` reais já são `isBlockable: false`) — enquanto as duas hunts ainda usavam pontos de
  spawn genéricos e dependiam do `spawnClearRadius` antigo. Nenhum monstro do catálogo real
  declara isto hoje: desde o #586, esta é uma exceção sem nenhum membro.
- **`blockable: false`** (o default — 1.640 dos 1.656 monstros do bestiário do Canary, Rat,
  Rotworm, Dragon e Dragon Lord inclusive) — nasce DE QUALQUER FORMA, ignorando quem
  está no ponto, mas só depois de um atraso de telegraph de 4200 ms (3× o intervalo de teleporte
  do Canary, `NONBLOCKABLE_SPAWN_MONSTER_INTERVAL`) depois que o `respawnDelayMs` do ponto vence.
  O efeito visual de teleporte que o Canary mostra nesse intervalo é apresentação — fica para o
  protocolo/cliente (#584/M36-03); o que existe hoje é só o atraso.

Parede e tile ocupado continuam adiando (nunca cancelando) com retry curto — o mecanismo de
sempre, sem mudança.

Esta hunt (a Darashia Dragon Lair) já usava `spawnPoints[i].monsterId`/`at`/`respawnDelayMs` por
ponto desde o #519; o #583 só torna esse formato obrigatório para toda hunt, em vez de um caso
especial só dela.

## O roteiro para importar uma hunt nova do Tibia (#587, M36-06)

O primeiro lote de hunts reais por faixa de level — seis áreas novas, além das três que já
existiam (Rat Cellars, Rotworm Caves, Darashia Dragon Lair) — proveu o fluxo ponta a ponta e
deixou o roteiro abaixo repetível. As seis: **Dwarf Mines** (nível 8, faixa 8–30), **Cyclopolis**
(nível 34, faixa 30–60), **Minotaur Camp** (nível 60, faixa 60–100), **Bone Crypt** (nível 100,
faixa 100–150), **Hydra Mountain** (nível 150, faixa 150–250) e **Hellhound Den** (nível 250,
faixa 250+) — `data/hunts/{dwarf-mines,cyclopolis,minotaur-camp,bone-crypt,hydra-mountain,hellhound-den}.json`,
cada uma com o `_open` citando o comando exato usado e a fonte do `recommendedLevel`.

### Escolher a área

1. Liste candidatos por faixa de level com `Bestiary.Locations` do monstro no Canary
   (`$CANARY_DIR/data-otservbr-global/monster/**/*.lua`) — o campo cita os nomes reais de área do
   Tibia (ex. `dragon.lua`: "Darashia Dragon Lair", "Edron Dragon Lair"…).
2. Confira se o monstro está no catálogo LOCAL (`packages/content/data/monsters/generated/*.json`,
   campo `"id"`) — só entra quem já foi promovido (#580); o relatório
   `docs/reference/catalog/monsters-promotion-report.md` diz o que falta.
3. Ache onde esse monstro nasce DE VERDADE no `otservbr-monster.xml`
   (`$CANARY_DIR/data-otservbr-global/world/otservbr-monster.xml`, elemento raiz `<monster
   centerx centery centerz radius>` por zona, filhos `<monster name x y z spawntime>`) — agrupe
   por proximidade geográfica (mesmo `z`, distância Chebyshev pequena) para achar o AGRUPAMENTO
   real, não um monstro solto. Um agrupamento denso (dezenas de pontos próximos) é uma masmorra
   de verdade; um espalhado por um mapa inteiro é terreno de superfície, mais difícil de recortar
   (ver nota do Cyclopolis abaixo).
4. O `recommendedLevel`: TibiaWiki (WebSearch) quando existir um Gate ou "Recommended Levels by
   Vocation" claro para aquela área — use o MENOR requisito por vocação, como a Darashia Dragon
   Lair usa o "Gate of Expertise" (nível 40). Sem fonte clara, caia no monstro mais forte da
   composição (regra que o próprio #587 já previa) — documente no `_open` que é estimativa, não
   fato de fonte.

### Recortar o mapa

```
pnpm map:import --id <id> --x <xmin>..<xmax> --y <ymin>..<ymax> --z <z>
```

Comece com uma caixa generosa em torno do agrupamento de spawns. **Duas armadilhas medidas nas
seis hunts:**

- **`--keep-from x,y,z` (poda ao componente andável conectado a partir da semente) é ótimo para
  DESCOBRIR o formato natural da área, mas o `pnpm map:import --check` relê o OTBM BRUTO da
  região salva, sem reaplicar `--keep-from`.** Se a caixa final ainda contiver, no OTBM real,
  algum pedaço andável desconexo do componente (uma salinha vizinha, um corredor paralelo), o
  `--check` volta "DESATUALIZADO" para sempre — a comparação nunca reconstrói o filtro que só
  `--keep-from` sabe fazer. Duas saídas, as duas usadas no lote: (a) apertar a caixa até a
  bounding box do componente não sobrar nada fora dele (Dwarf Mines: cortar as linhas do topo
  que continham uma salinha trancada por porta, desconexa); ou (b) mais simples e o que as
  outras cinco usaram — **descubra a região com `--keep-from` numa caixa larga, depois faça o
  IMPORT FINAL sem `--keep-from` nenhum, com `--x`/`--y` batendo EXATAMENTE a região final
  reportada.** Um recorte reto (sem poda) bate com `--check` por construção, porque os dois
  lados leem o mesmo OTBM bruto na mesma caixa — o preço é que conteúdo desconexo dentro da
  caixa (se houver) entra no mapa, inerte (a rota nunca o visita; ver abaixo).
- **`--entry x,y,z` precisa ser um tile ANDÁVEL exato**, não a média de um agrupamento (que cai
  numa parede com frequência). Depois do import sem `--entry`, procure o `.` mais próximo do
  centro do agrupamento na grade (`packages/content/data/maps/<id>.json`, `floors[z].grid`) e
  reimporte com esse ponto.

### Traçar a rota e importar os spawns reais

Sem waypoints manuais: uma rota gerada por vizinho-mais-próximo sobre os PONTOS DE SPAWN REAIS
(filtrados da mesma forma que `pnpm catalog:spawns` filtra — dentro da `region` que
`map:import` gravou), fechada com o BFS de `scripts/trace-route.ts` (`traceRoute`), cobre a área
inteira sem exigir um humano desenhando tile a tile. Se a caixa final não usou `--keep-from` (e
por isso pode ter pedaço desconexo), filtre os alvos ao componente alcançável A PÉ a partir da
entrada antes de montar o tour — ponto de spawn fora do alcance ainda ganha `spawnPoint` (fica
ancorado no tile de rota mais próximo por `anchorSpawnPoints`), só nunca é visitado pelo bot.

```
pnpm route:trace --id <id> --map <id> --z <z> --via <entrada> <resto do tour>
pnpm catalog:spawns --map <id>       # regrava spawnPoints com o XML real do Canary
pnpm catalog:spawns --map <id> --check
```

`catalog:spawns` relata (não falha) todo monstro do agrupamento que o catálogo local ainda não
tem — Scarab apareceu assim na Bone Crypt (2 pontos descartados, 22 escritos de 24). A hunt NÃO
é monotemática: cada recorte real do Canary traz a fauna inteira da zona (Dwarf Guard + Dwarf
Soldier + Dwarf Geomancer nas Dwarf Mines; Minotaur + Pig + Smuggler no Minotaur Camp), a mesma
regra que já valia para a Rat Cellars/Rotworm Caves (#586, ADR 0039 decisão 3).

### A hunt e o resto do lote

1. `data/hunts/<id>.json`: `id`, `name`, `recommendedLevel`, `mapId`, `routeId`, `ambience`
   (`cavern` para masmorra/caverna), `description` (narrativa curta) e `_open` citando o comando
   exato do recorte e a fonte do `recommendedLevel` — o schema não tem mais `difficulties` desde
   o #583.
2. Some `pnpm catalog:spawns --map <id> --check` à linha `check` do `package.json` raiz, ao lado
   da que já existia para a Darashia Dragon Lair.
3. `HuntsModal` (cliente) não precisa de registro manual: hunts são descobertas por diretório
   (`packages/content/src/load.ts`, `readJsonDir('hunts')`) — o catálogo que o cliente lista é o
   que `loadContent` devolve.
4. Um teste curto no padrão de `rat-cellars.test.ts`: entra, percorre a rota real e mata, com XP
   e (quando a sorte ajudar) loot — `packages/server/src/game/tibia-parity-hunts.test.ts` cobre
   as seis com `describe.each`. Um herói no `recommendedLevel` exato, DESARMADO, morre antes de
   acertar um golpe contra a maioria destas seis (medido: nível 8 contra os Dwarf Guard reais
   mata em ~2,4 s) — os `spawnPoints` nascem TODOS ao mesmo tempo (ADR 0039 decisão 3), sem pull
   que espalhe o encontro, e o personagem de teste não tem o kit/talento que um personagem real
   do `recommendedLevel` levaria. O teste usa um nível de prova bem acima (`TEST_LEVEL`, medido
   para garantir ao menos um abate antes de morrer) — o ponto é provar mapa/rota/spawn, não
   balancear o combate de cada faixa.

## Boosted Creature do dia (#615, ADR 0054 decisão 7)

Uma vez por dia, na hora de virada (`boosted.rolloverHourUtc`, conteúdo), o `jobs` sorteia um
monstro entre todos os que têm ficha de Bestiário (`content.bestiary.entries`) e grava a linha em
`world_daily` (Postgres, uma por dia) mais uma cópia em Redis para a `api` — a primeira tarefa
diária real do esqueleto do `jobs` (`packages/server/src/jobs/boosted.ts`,
`packages/server/src/world-daily.ts`). O sorteio é IDEMPOTENTE no mesmo dia: rodar o ciclo de novo
não sorteia de novo, porque `day` é a chave primária e o `INSERT` é `ON CONFLICT DO NOTHING`.

A `api` lê o cache do Redis ao emitir um ticket e o inclui em `InitialCharacter.boostedMonsterId`.
A partir daí a boosted é FIXADA no personagem — como a versão de conteúdo (invariante 7) — e
carregada por toda transição Cidade↔hunt daquele login; a hunt que atravessa a virada continua com
a boosted com que nasceu, mesmo que o mundo já tenha sorteado outra. Uma hunt criada direto de um
ticket de party lê o valor do TICKET DO LÍDER; a transição de Cidade para hunt (sem ticket novo)
lê o valor já fixado no personagem.

Efeitos, só para o monstro que É a boosted do dia (`packages/sim/src/rulesets/hunt.ts`):

- **`spawntime / 2`** em todo ponto em que ele nasce (`#respawnDelayFor`) — a mesma regra do
  `SpawnMonster::addMonster` do Canary, sem o `rateSpawn` global que o Draconya não tem.
- **XP ×2**, dobrado na BASE do pool antes da divisão por vocações únicas e do bônus de
  Bestiário/level (`#grantPartyXp`) — o dobro vale para todo elegível na mesma proporção que a
  XP normal já dividia.
- **Um roll extra de loot inteiro** (`#rollLootFor`, `ondroploot_boosted.lua`, `factor 1.0`): a
  MESMA tabela sorteada de novo, logo depois do sorteio normal, na mesma ordem — nunca uma
  chance maior na mesma rolagem.

Sem `boosted/baseline.json` no conteúdo, ou sem `content.bestiary`, o `jobs` não sorteia nada e
nenhum efeito liga — é o conteúdo de teste que não fala de engajamento diário.

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

**As regras de saída vêm da configuração do jogador** (FUN-86). São `hp-below`, `out-of-gold`,
`party-member-lost` e `out-of-capacity`, com teto de 4 slots, avaliadas a cada 250 ms — e o extrato
registra **qual** delas encerrou, com o percentual no id quando é de HP. O encerramento é
`exit-rule`, nunca `manual-exit`: o jogador não pediu para sair, a regra dele decidiu, e o extrato
tem que dizer a verdade sobre isso. Ver [`bot.md`](./bot.md) para o vocabulário.

**Gold zerado NÃO encerra a hunt sozinho** (§20.3). Sem a regra `out-of-gold`, o personagem fica,
não consegue pagar o próximo supply nem o próximo tiro e pode morrer — e a primeira recusa por
falta vira uma linha no extrato, uma só. Com a regra, ele sai antes. A diferença entre os dois
comportamentos é uma linha na configuração, e é assim de propósito.

**O consumo debita gold no ato** (AB-04, ADR 0032 d.6/d.7). Usar um supply chama `useSupply`, que
debita o `price` do saldo e leva o gasto a `aggregates.goldSpent`; cada tiro de arma de distância
debita o `price` da munição escolhida da família. Não há pilha a repor nem lote a comprar — o
limitador é o saldo. O débito é um evento no caminho da ação (invariante 2), então a hunt
desanexada a 1 Hz debita no mesmo instante lógico que a anexada a 10 Hz. Ver
[`items.md`](./items.md) e [`economy.md`](./economy.md).

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
`goldGained` no extrato, que o ledger leva à linha do personagem (invariante 10). Desde o ADR
0048 o loot cai no **cadáver** do monstro, não mais direto na mochila: no mesmo abate, sem
plateia (invariante 3), o dono coleta o que o próprio filtro de Quick Loot aceita e cabe; o resto
fica no cadáver até ele decair — a decisão que o §26 da referência rejeitava ("cadáver como
container") foi revertida por este ADR, com fidelidade ao `quickLootFilter`/`autoLoot` do Canary
(ver "Divergências").

A tabela escolhe **como** é sorteada, pelo campo `loot.rollModel` (#685):

- **Ausente — o modelo FUN-63.** `rng.chance(fração)` decide o drop e, se cair, um
  `rng.integer(min, max)` independente dá a quantidade; `chance: 0` e `min === max` não consomem
  sorteio. Era o modelo dos quatro monstros autorais (Rat, Rotworm, Dragon, Dragon Lord) até o
  #581 os regenerar pelo importador — os quatro passaram para `rollModel: "canary"` junto com o
  resto do bestiário, e uma hunt retomada de um snapshot anterior ao #581 ainda usa a semente
  como estava (o `rollModel` é lido do conteúdo a cada sorteio, nunca guardado no snapshot).
- **`canary` — o `generateLootRoll` do Canary**, que o leitor de monstros (#578) grava em toda
  tabela gerada. Cada linha consome SEMPRE dois sorteios, mesmo com `chance: 0`: um fator
  `integer(95, 105) / 100` multiplica a chance em cem-milésimos (`round(fração × 100000)`), e a
  linha cai se uma rolagem inteira em `[0, 100000]` ficar **abaixo** da chance ajustada. A
  quantidade sai da MESMA rolagem — `rolagem % (max − min + 1) + min` —, então ela é
  correlacionada com a sorte do drop. Consequência: uma linha "100 %" cai só **~98,6 %** das
  vezes (fator abaixo de 1, e a rolagem inclui o 100000). O `buildContent` recusa, numa tabela
  `canary`, a linha de item com `max > 1` cujo item não é `stackable` — o Canary daria 1.
  O `factor` do Canary (prey de loot, wealth, boosted creature, charm Gut) é fixo em 1 até esses
  sistemas existirem; `unique` e o filtro de reward boss ficam com o sistema de boss.

**O rate de loot** (`progression.rates.loot`, #691) multiplica a chance de cada linha, com teto 1
(`max(1, rate)`, como o `getLootRandom` do Canary), no modelo FUN-63. No modelo `canary` ele
DIVIDE a rolagem em vez de multiplicar a chance — o `getLootRandom` literal —, e a quantidade sai
da rolagem já dividida (truncada); rate 2 dobra a chance efetiva e rate 1 é bit a bit o de sempre.
Nos dois modelos, `0` desliga o loot sem consumir sorteio nenhum, para o loot desligado não
deslocar a sequência do resto da hunt. Os rates de vida,
defesa e ataque de monstro e de boss também moram lá — ver [`progression.md`](./progression.md),
"Rates do servidor".

**O monstro que morre nas mãos de outro monstro (#619, facções) não paga o jogador.** O Canary paga
pelo mapa de dano, não pelo golpe final: só quem está nele como jogador recebe
`floor(dano ÷ dano total × XP)` e conta o abate — o dano do monstro, mesmo o do que já morreu, entra no
total. Uma morte só de monstro não dá XP, não conta abate (a invocação de monstro também não) e deixa um
cadáver sem dono, e sem loot (ADR 0048: cadáver sem dono não guarda loot); com dano do herói antes do
golpe final ele leva a fatia dele, e o cadáver é de quem causou MAIS dano entre os que ainda existem —
se for um participante, mesmo que o último golpe tenha sido de um monstro; se um monstro vivo bateu
mais, o herói que deu o último golpe leva a XP mas não o loot. Ver `combat.md`, "Facções de monstro".

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
| Tamanhos de pull | NENHUM desde o #583 (ADR 0039) — removido; era 3 (Cauteloso/Ousado/Agressivo), cópia do Huntera, sem correspondente no Canary | histórico — `data/hunts/*.json` não tem mais o campo `difficulties` |
| Monstros vivos, por hunt | um por ponto de spawn da rota, TODOS os pontos nascem (#583) — Rat Cellars 56 (48 rat, 3 spider, 2 rabbit, 2 bug, 1 cave-rat), Rotworm Caves 42 (35 rotworm, 7 terramite), Darashia Dragon Lair 47 (era 2/5/8 na Rat/Rotworm até o #583, e 14/13 pontos genéricos entre o #583 e o #586, que rodou o importador de spawns sobre o recorte real) | `data/routes/*.json`, `spawnPoints.length` |
| Rota | lista ordenada de tiles, fixa por hunt | `data/routes/*.json`, apontada pelo `routeId` da hunt |
| Prazo de respawn (`respawnDelayMs`, por PONTO desde o #583) | Desde o #586, o `spawntime` REAL do Canary por ponto: 90 s em 55/56 pontos de Rat Cellars e nos 42/42 de Rotworm Caves, 60 s no ponto restante de Rat Cellars — não mais os 2 s fixos que as duas hunts adotavam por comparação com a faixa 1,0–2,5 s que a captura do Huntera registrou (histórico, Parte II §15 + Cyclopedia Parte V §32, 2026-09-22; #510, PR #512); 90 s em cada ponto da Darashia Dragon Lair (`spawntime="90"` do Canary) | `data/routes/*.json`, campo `respawnDelayMs` de `spawnPoints` |
| Janela de visão do respawn `blockable` (#583) | ±11 tiles Chebyshev — a aproximação quadrada do viewport do Canary (`MAP_MAX_VIEW_PORT_X`/`_Y`); substitui o `spawnClearRadius` por hunt (removido) | `packages/sim/src/rulesets/hunt.ts`, `SPAWN_VISIBILITY_RADIUS` — mecanismo, não conteúdo |
| Telegraph do respawn não-`blockable` (#583) | 4200 ms (3× `NONBLOCKABLE_SPAWN_MONSTER_INTERVAL` do Canary) antes de o monstro materializar, mesmo com participante em cima do ponto | `packages/sim/src/rulesets/hunt.ts`, `NONBLOCKABLE_SPAWN_TELEGRAPH_MS` — mecanismo, não conteúdo |
| Monstro espera a vista limpar para respawnar (`blockable`, o `isBlockable` do TFS/Canary) | `false` (não espera) é o default e o comportamento de 1.640/1.656 do bestiário do Canary — a MESMA proporção que Rat e Rotworm seguem desde o #586 (o `rat.lua`/`rotworm.lua` reais já são `isBlockable: false`; só o override de Draconya divergia). Até o #586, Rat e Rotworm declaravam `true` por um override (`data/monsters/overrides/rat.json`/`rotworm.json`), preservando o comportamento observado no Huntera (#519) enquanto as duas hunts dependiam do `spawnClearRadius` antigo; o #586 apagou os dois arquivos ao converter as hunts para os spawns reais | `data/monsters/generated/*.json`, campo `blockable` |
| Monstro e `spawntime` por ponto de spawn (#519, o formato do Canary) | Obrigatório em todo ponto desde o #583 — Rat Cellars declara `rat`/`spider`/`rabbit`/`bug`/`cave-rat`, Rotworm Caves declara `rotworm`/`terramite`, todos lidos do recorte real (#586); a Darashia Dragon Lair declara os 47 (`dragon`/`dragon-lord`, 90 000 ms cada) | `data/routes/*.json`, campos `monsterId`/`at`/`respawnDelayMs` de `spawnPoints` |
| Prazo do cadáver no chão | 670 s (670000 ms) em rat, rotworm, spider, rabbit, bug, cave-rat, terramite, dragon e dragon-lord — a soma da cadeia real `duration`/`decayTo` do Canary `items.xml`, campo do MONSTRO desde o #585 (era 30 s em Rat Cellars/Rotworm Caves, cópia do Huntera que só olhava o primeiro estágio da cadeia) | `data/monsters/*.json`, campo `corpseTtlMs`; a arte em `appearances.corpses` |
| Atraso da saída solo (`exitDelayMs`) | ausente — nenhuma hunt declara, saída imediata fora de combate (#802); 5 000 ms é o do Huntera, decisão de balanceamento aberta (SV-24) | `data/hunts/*.json`, campo `exitDelayMs` |
| Ambiente da cena (só apresentação) | `cavern` em Rat Cellars e em Rotworm Caves — o cliente escurece o mundo; ausente é superfície (FUN-121) | `data/hunts/*.json`, campo `ambience` |
| Hora de virada da Boosted Creature (#615, `boosted.rolloverHourUtc`) | `0` (meia-noite UTC) — o mesmo instante do server-save do Canary | `data/boosted/baseline.json`, campo `rolloverHourUtc` |
| Texto de apresentação (`description`, só apresentação) | Rat Cellars e Rotworm Caves têm; as demais hunts (quando existirem) ganham o texto na própria issue de conteúdo que as criar | `data/hunts/*.json`, campo `description` |
| Passo manual (`walk` do jogador) | um por vez, por personagem: o hospedeiro recusa o que chega antes de o passo anterior acabar (FUN-122); o passo do bot conta a partir dele | `packages/server/src/game/host.ts` (`#walkingUntil`), `packages/sim/src/rulesets/hunt.ts` (`requestMove`) — mecanismo |
| Personagem desarmado (ataque, intervalo, alcance, armadura, esquiva) | [ABERTO — valor provisório: 25 / 2000 ms / 1 tile / 4 / 0%]. A esquiva do PRD saiu no `combat-v4` (#603): `dodgeChance` vale 0 e o resolver não a lê — o único Dodge é o charm (ver `combat.md`, "Charms em combate") | `data/combat/baseline.json`, bloco `player` |
| Velocidade do personagem (escala do Tibia) | 220 no level 1, +2 por level — o TFS clássico, RESOLVIDO pelo #527 (ADR 0037 decisão 4): mesma escala do passo abaixo e da velocidade de monstro | `data/progression/baseline.json`, `startingSpeed` / `speedPerLevel` |
| Duração do passo | `ceil50(chão × 1000 / speed)` ms, diagonal × 3; chão sem velocidade declarada vale 150 | `packages/sim/src/movement.ts` (`movementDuration`) — mecanismo, não balanceamento |
| O rato (regenerado pelo importador, #581 — `data-otservbr-global/monster/mammals/rat.lua`) | 20 HP, 5 XP, ataque 0–8 sorteado por golpe, armadura 1, `defense 5`, speed 134; +20 % de dano de terra e sagrado, −10 % de gelo e morte (sinais invertidos em relação ao provisório do Huntera que valia antes do #581); `aggroRadius`/`targetDistance` 11/1 | `data/monsters/generated/mammals.json` |
| Loot por abate (Rat Cellars) | Rat: gold 100 %, 1–4; queijo 39,41 % (`items/cheese.json`, aparência 3607) — mesmas linhas de antes, agora sorteadas pelo `rollModel: "canary"` (dois sorteios por linha, ver acima). Desde o #586 o recorte também traz spider (gold 65,15 %, 1–5; spider fangs 0,96 %), rabbit (meat 85,62 %, 1–2, sem gold), bug (gold 51,17 %, 1–6, sem item) e cave-rat (gold 85 %, 1–2; queijo 30 %; worm 9,7 %, 1–2) | `data/monsters/generated/mammals.json`/`vermins.json`, bloco `loot` |
| O rotworm (regenerado pelo importador, #581 — `data-otservbr-global/monster/vermins/rotworm.lua`) | 65 HP, 40 XP, ataque 0–40 sorteado por golpe, armadura 8, `defense 10`, speed 116; sem elementos (o Canary não declara nenhum); `aggroRadius`/`targetDistance` 11/1 | `data/monsters/generated/vermins.json` |
| Loot por abate (Rotworm Caves) | Rotworm: gold 71,76 %, 1–17; sword 3 %; mace 4,5 %; meat 20 %; ham 20,12 %; worm 3 % (1–3 un.); lump of dirt 10 %; legion helmet 1,89 % — mesmas linhas de antes, agora `rollModel: "canary"`. Desde o #586 o recorte também traz terramite (gold 97,52 %, 1–45; terramite shell 7,73 %; terramite legs 14,88 %) | `data/monsters/generated/vermins.json`, bloco `loot` |
| O Dragon (regenerado pelo importador, #581 — `data-otservbr-global/monster/dragons/dragon.lua`) | 1000 HP, 700 XP, melee 0–120, armadura 25, `defense 30`, `defenseMitigation 0,99`, speed 172 (a escala do Canary — igual à do TFS para este monstro); terra +80 %, energia +20 %, gelo −10 % (vulnerável), fogo IMUNE; `aggroRadius 11` (§75, era 8 antes do #527), `targetDistance 1`, `staticAttack 80 %` (aceito, não ligado ao passo — ver `combat.md`), `runOnHealth 300`, troca de alvo 4 s/10 % | `data/monsters/generated/dragons.json` |
| Abilities do Dragon (CMB-06/#518, regeneradas pelo #581) | bola de fogo (alvo, alcance 7, círculo raio 4, centrada no alvo): 60–140, 15 %; onda de fogo (comprimento 8, sem alvo): 100–170, 10 %; cura própria: +40–70, 15 % — mesmos números de antes do #581 | `data/monsters/generated/dragons.json`, blocos `abilities`/`defenses` |
| O Dragon Lord (regenerado pelo importador, #581 — `data-otservbr-global/monster/dragons/dragon_lord.lua`) | 1900 HP, 2100 XP, melee 0–230, armadura 34 (era 35, um palpite de antes do #581 — 34 é o número real do Canary), `defense 34`, `defenseMitigation 1,29`, speed 200; mesmos elementos do Dragon; `aggroRadius 11` | `data/monsters/generated/dragons.json` |
| Abilities do Dragon Lord (#581) | bola de fogo: 100–220, 30 % (era 100–200, 20 % — o intervalo e a chance do #581 são os do Canary; o hand-authored de antes tinha um palpite mais conservador); campo de fogo: 10 %; onda de fogo (comprimento 8): 150–270, 22 % (era 150–230, 15 %); cura própria: +57–93, 15 % (sem mudança) | `data/monsters/generated/dragons.json` |
| Campo de fogo do Dragon Lord | queimadura: 20 de dano a cada 10 s, por até 70 s (a cadeia de decaimento 2118→2119→2120 do Canary `items.xml` simplificada num campo só, com os números do estágio mais forte — ver `combat.md`) | `data/monsters/generated/dragons.json`, `abilities[].field` |
| Loot do Dragon (18 linhas, #581) | gold 89,92 %, 1–102; dragon ham 66,27 % (1–2); steel shield 15,65 %; dragon's tail 9,68 %; crossbow 9,12 %; longsword 3,83 %; steel helmet 3,49 %; broadsword 2,7 %; plate legs 2,029 %; double axe 1,58 %; green dragon leather 1,07 %; green dragon scale 1,01 %; wand of inferno 0,56 %; small diamond 0,45 %; serpent sword 0,23 %; dragon hammer 0,23 %; dragonbone staff 0,17 %; life crystal 0,17 %; dragon shield 0,11 % — `burst arrow` e `strong health potion` saíram: o importador só produz `itemId`, e os dois são munição/suprimento abstratos do Draconya (`ammunitionId`/`supplyId`), sem entidade own no catálogo de itens real; a linha é removida e contada em `docs/reference/catalog/monsters-promotion-report.md`, nunca creditada como item fantasma | `data/monsters/generated/dragons.json`, bloco `loot` |
| Loot do Dragon Lord (16 linhas, #581) | gold 95,3 %, 1–237; dragon ham 79,79 % (1–2); green mushroom 12,03 %; royal spear 9,38 % (1–3); small sapphire 5,59 %; energy ring 4,55 %; golden mug 3,31 %; red dragon scale 1,94 %; red dragon leather 1,15 %; life crystal 0,65 %; strange helmet 0,52 %; tower shield 0,41 %; fire sword 0,35 %; royal helmet 0,26 %; dragon slayer 0,22 %; dragon lord trophy 0,13 %; dragon scale mail 0,09 % — `book`, `power bolt` e `strong health potion` saíram pelo mesmo motivo do Dragon (munição/suprimento abstrato, ou item sem entidade no catálogo real ainda) | `data/monsters/generated/dragons.json`, bloco `loot` |
| Bestiário do Dragon/Dragon Lord (#520) | toKill 1000, firstUnlock 50, secondUnlock 500, charmsPoints 25, stars 3, occurrence 0 — ainda sem tela (ver `bestiary.md`) | `data/bestiary/baseline.json`, `entries` |
| A hunt Darashia Dragon Lair (#520 fase 2) | `recommendedLevel` 40 (Gate of Expertise, TibiaWiki); sem dificuldade nenhuma desde o #583 — os 47 `spawnPoints` nascem todos, cada um exatamente uma vez; `corpseTtlMs` saiu do hunt e mora em `dragon`/`dragon-lord` desde o #585 (670000 ms cada, a mesma soma da cadeia de decaimento do Canary `items.xml`: dead dragon/dead dragon lord, 10 s → 300 s → 300 s → 60 s até `decayTo` sumir); Dragon e Dragon Lord são `blockable: false` (o default), então nascem com o telegraph de 4200 ms, nunca esperando a vista limpar; `spawnClearRadius` ausente (0, desligado — a referência pede não copiar a supressão do TFS) | `data/hunts/darashia-dragon-lair.json` |
| As seis hunts do primeiro lote por faixa de level (#587, M36-06) | Dwarf Mines (nível 8, 83 `spawnPoints`), Cyclopolis (34, 7), Minotaur Camp (60, 39), Bone Crypt (100, 24), Hydra Mountain (150, 21), Hellhound Den (250, 18) — cada `recommendedLevel` sourced de TibiaWiki quando existia um Gate/tabela de vocação clara (Dwarf Mines, Cyclopolis, Hydra Mountain), ou o piso da faixa que o #587 pedia por fallback (Minotaur Camp, Bone Crypt, Hellhound Den — sem Gate/wiki específico achado); roteiro completo em "O roteiro para importar uma hunt nova do Tibia" acima | `data/hunts/{dwarf-mines,cyclopolis,minotaur-camp,bone-crypt,hydra-mountain,hellhound-den}.json` |
| Rate de loot e escala de monstro/boss (#691) | neutros (1); o conteúdo real não declara | `data/progression/baseline.json`, `rates.loot` / `rates.monster` / `rates.boss`; `data/monsters/*.json`, `boss` |
| Monstro evita campo de fogo/veneno/energia (M29-05, `canWalkOnFieldType` do TFS/Canary) | `true` (anda por cima) é o default, como no Canary; nenhum dos quatro monstros do catálogo hoje declara `false` — Dragon e Dragon Lord declaram `true` explicitamente (`dragon.lua`/`dragon_lord.lua`, conferidos em 2026-09-25), rato e rotworm não declaram nada | `data/monsters/*.json`, campos `canWalkOnFire`/`canWalkOnPoison`/`canWalkOnEnergy` |
| Área de visão do monstro (#655, `Creature::canSee` do Canary — a lista de alvos que decide ocioso, volta e passo aleatório, e o corte da retenção de alvo) | O `aggroRadius` do monstro — 11 tiles em TODO o catálogo (o `MAP_MAX_VIEW_PORT_X`/`_Y` do Canary); no mesmo andar é Chebyshev ≤ raio, entre andares valem as regras do Canary (superfície não vê subsolo; subsolo até ±2 andares; a caixa desliza 1 tile por andar) | `data/monsters/*.json`, campo `aggroRadius`; a regra em `packages/sim/src/monster/step.ts` (`canSeePoint`) |
| Intervalo mínimo do passo aleatório (#655, `Monster::doRandomStep`) | 1000 ms de tempo lógico desde o último passo do monstro | `packages/sim/src/monster/monster.ts`, `RANDOM_STEP_INTERVAL_MS` — mecanismo, não conteúdo |
| Raio de spawn do passo aleatório (#655, `Monster::isInSpawnRange`) e da busca de caminho da volta | ±50 tiles em torno do `home` (`deSpawnRadius` padrão do Canary, `config.lua.dist:612`); a busca de caminho da volta ao spawn usa o mesmo número como raio a partir do monstro; o teleporte de volta de `Monster::onThink` para quem passa dele NÃO existe aqui | `packages/sim/src/monster/monster.ts`, `DESPAWN_RADIUS` — mecanismo, não conteúdo |

## Em aberto

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema. Os dois da tabela acima são deste
projeto, não do PRD: o personagem precisa de números de ataque e de velocidade para a hunt render,
e o PRD é silencioso sobre os dois porque assume equipamento — que ainda não existe. A densidade de referência (2/4/8/12) é explicitamente descrita como ponto de partida, não como número final — cada hunt define sua própria composição em conteúdo.

**A margem de sobrevivência do pull Cauteloso na Rotworm Caves é estreita, e ficou mais estreita
com o recorte de Darashia (#515).** O recorte anterior (#511) media 8–30 HP de folga (de 185) em
dez minutos desarmado, sem morrer; o recorte de Darashia — menor, por construção do próprio
Huntera (Parte VI §38) — morreu em simulação de trial entre 272 s e 357 s de dez, mesmo com o
laço desenhado para maximizar o tempo de caminhada tranquila entre encontros. `monsterCount`,
`respawnDelayMs` e os números do monstro são de outras decisões (ADR 0025) e não mudam aqui; contra
o mapa REAL e com o bot padrão do personagem (cura automática, FUN-114) — o cenário que o Huntera
de fato usa —, o teste de dez minutos sobrevive, com HP mínimo 74/165, próximo do 116/170 que o
Druid observado mediu (Parte VI §36).

## Divergências do PRD

~~**Loot é só gold, por enquanto.**~~ → **Resolvido (FUN-76, FUN-88, ADR 0048):** o loot de item
existe — a tabela do monstro confere `items` contra o catálogo, o item cai no cadáver e o dono
coleta o que o filtro de Quick Loot dele aceita e cabe; o resto fica no cadáver, sem Caixa de
Loot da Sessão. Detalhe em [`economy.md`](./economy.md#divergências-do-prd). A moeda continua
creditada como campo, não como item: gold nunca vira uma linha de `loot.items`.

**A hunt hospeda um personagem por instância.** Party é da Fase 3; até lá, entrar com o segundo
personagem é erro, não silêncio.

~~**Três tamanhos de pull, não quatro dificuldades**~~ → **Superado (#583, ADR 0039):** o §14.5
previa Iniciante/Profissional/Herói/Lendário; entre a FUN-123 (ADR 0025, M11) e o #583 a decisão
foi copiar o Huntera — Cauteloso/Ousado/Agressivo (`cautious`/`bold`/`reckless`), com um
`monsterCount` total (2/5/8 na Rat Cellars) escolhido pelo jogador. Nenhum dos dois é o que o
Tibia real faz: ele não pergunta tamanho, todo ponto de spawn nasce, sempre — ver "Spawn: todo
ponto nasce, sem pull" acima. O campo `difficulty` sobrevive no protocolo só por compatibilidade
(#584) e o servidor o ignora; a UI que ainda mostra "Ousado · 4" (SV-19, #355, linha 35 acima) é
dívida da #584, não deste registro.

~~**Cadáver no chão, só visual.**~~ → **Revertido (ADR 0048, 2026-09-26; FUN-123).** O abate
deixa o cadáver do monstro no tile — `ground-item-appear`, com a arte de `appearances.corpses` —
por `corpseTtlMs`, e ele some sozinho (`ground-item-disappear`), levando junto o que ninguém
coletou. **O cadáver CARREGA o loot e tem dono**: no mesmo abate, o dono coleta o que o filtro de
Quick Loot dele aceita e cabe; o resto fica esperando até o cadáver decair — é a fidelidade ao
`quickLootFilter`/`autoLoot` do Canary que a decisão original de 2026-09-11 tinha rejeitado. Quem
reanexa vê os cadáveres que ainda estão lá (`session-state.world.groundItems`), com o que sobrou
dentro. Monstro sem linha na tabela não deixa nada; monstro sem `corpseTtlMs` (o campo é do
MONSTRO desde o #585, era da hunt) também não — o loot sorteado para um destinatário sem cadáver
simplesmente não é entregue.

**A Rat Cellars é o bueiro de ratos de Rookgaard** (FUN-123), como no Huntera: o recorte real
importado (118×80, andar 8, 2 043 tiles andáveis, `ambience: cavern`), a rota traçada por
`pnpm route:trace` sobre ele — um laço de 160 tiles — e o rato do Tibia (20 HP, 5 XP, 3–4 de
ataque, speed 172, gold e queijo). **Os pontos de spawn são os reais do #586**: até então a rota
tinha 14 pontos genéricos traçados por heurística, sem `monsterId` próprio; `pnpm catalog:spawns
--map rat-cellars` (#582) leu `otservbr-monster.xml` pelo recorte da região importada e regravou
os 56 pontos que o Canary de fato usa ali — 48 rato, 3 spider, 2 rabbit, 2 bug, 1 cave-rat, cada
um com o próprio `respawnDelayMs` (90 s em 55 deles, 60 s no restante). O override que fixava
`blockable: true` no rato (preservando o comportamento do Huntera) foi apagado junto: o rato cai
no `blockable: false` real do `rat.lua`. A entrada continua pelo menu, abrindo uma instância —
sem portal na cidade (ADR 0025).

**A Rotworm Caves é a caverna de rotworms de Darashia do Huntera** (#515), a segunda hunt do
Draconya: o recorte real importado (88×101→88×73, andar 8, 902 tiles andáveis em duas
componentes — 823 na principal e 79 num corredor isolado que a rota nunca visita — `ambience:
cavern`, ADR 0025 emenda, Parte VI §38), a rota traçada por `pnpm route:trace` sobre ele — um
laço de 444 tiles — e o rotworm do Canary v3.6.1 (65 HP, 40 XP, 24–30 de ataque, armadura 8,
speed 180). É a primeira hunt do Draconya com loot de verdade além do gold: sete itens (`sword`,
`mace`, `meat`, `ham`, `worm`, `lump-of-dirt`, `legion-helmet`), com `value` de TibiaWiki
provisório para as três peças de equipamento e `0` para as quatro de comida/curiosidade (sem NPC
de venda ainda). **Os pontos de spawn são os reais do #586**: até então a rota tinha 13 pontos
genéricos escolhidos dentro da componente principal, evitando um funil estreito que prendia o
combate corpo a corpo; `pnpm catalog:spawns --map rotworm-caves` regravou os 42 pontos reais —
35 rotworm, 7 terramite, todos com `respawnDelayMs` 90 s. O override que fixava `blockable: true`
no rotworm foi apagado junto: o rotworm cai no `blockable: false` real do `rotworm.lua`. A
entrada continua pelo menu, abrindo uma instância — sem portal na cidade (ADR 0025), como a Rat
Cellars.

**A Darashia Dragon Lair é a primeira hunt MULTIANDAR, e a primeira copiada do Canary em vez do
Huntera** (#519, ADR 0025 emenda, ADR 0037): o recorte real importado (86×121, z10–z12 — 2.036
andáveis em z10, 1.849 em z11, 173 em z12), a rota traçada por `pnpm route:trace` — estendido
nesta issue para atravessar `floorChanges` — sobre ele: um laço de 1.494 tiles pelos três
andares, com os 47 pontos de spawn do Canary (`data-otservbr-global/world/otservbr-monster.xml`)
ancorados na coordenada EXATA, distância zero. Os 19 pontos de z10 são `dragon`, os 28 de
z11+z12 são `dragon-lord` — cada um com `respawnDelayMs: 90000`, o `spawntime="90"` do XML, por
PONTO, não por dificuldade. **Os dois conectores entre andares são degraus reais do Canary**:
cruzados por item id contra `items.xml` (id 469, `stairs`, `floorchange="down"`; id 7544/7729–7736,
`ramp`, `floorchange="west"`/`"down"`) e resolvidos pelo deslocamento de pouso que
`Tile::queryDestination` aplica — não uma coincidência geométrica de overlap (ver o detalhe,
inclusive a correção de uma revisão adversarial que pegou o pouso errado numa primeira tentativa,
em ADR 0025). **Os monstros (Dragon e Dragon Lord) e o arquivo da hunt fecharam o laço na #520**:
`data/hunts/darashia-dragon-lair.json` aponta o mesmo `mapId`/`routeId`, `ambience: cavern`,
`recommendedLevel: 40` (o "Gate of Expertise" que trava a entrada da lair real, TibiaWiki) e uma
dificuldade só (`monsterCount: 47` — o mesmo total de `spawnPoints`, para cada ponto nascer
exatamente uma vez; o Tibia real não tem tamanho de pull aqui). `corpseTtlMs: 670000` (670 s) é a
vida útil TOTAL do cadáver no Canary — corrigido numa revisão da #536, achado [major]: a primeira
versão tinha lido só os 10 s do PRIMEIRO estágio de decaimento (`items.xml` id 5973/5984, "dead
dragon"/"dead dragon lord", `duration="10"`) e confundido isso com o tempo total no chão, quando
na verdade o item decai (`decayTo`) para o próximo estágio em vez de sumir. A cadeia completa —
idêntica em forma para os dois monstros — é 10 s → 300 s → 300 s → 60 s até o último `decayTo="0"`
(aí some de fato): 10+300+300+60 = 670 s = 670 000 ms (segundos × 1000). NÃO os 30 000 ms que Rat
Cellars/Rotworm Caves copiavam do Huntera (também corrigidas pelo #585 — ver abaixo): ADR 0037
d.6 pede a caçada idêntica ao Tibia real em toda hunt, e o fato real é a soma da cadeia, não o
primeiro estágio dela. **Desde o #585, o campo é do MONSTRO, não da hunt** — o importador de
catálogo (`scripts/catalog/monsters.ts`) soma a cadeia a partir de `monster.corpse` e grava
`corpseTtlMs` em `dragon.json`/`dragon-lord.json` (e nos outros dois autorais, `rat.json`/
`rotworm.json`, todos com a mesma soma de 670000 ms); a hunt não declara mais o campo. O motor
não modela decaimento em múltiplos estágios, só a soma total. Testado contra o
CONTEÚDO REAL (`packages/server/src/game/darashia-dragon-lair.test.ts`): uma party de quatro
level 200 (Knight/Paladin/Sorcerer/Druid) que entra vê os 47 nascerem — 19 Dragon em z10, 24
Dragon Lord em z11, 4 em z12 —, cada um na coordenada exata do próprio ponto, e o respawn de um
ponto abatido acontece 90 s depois, nunca antes, com o mesmo `monsterId` na mesma vizinhança. A
entrada continua pelo menu (ADR 0025).
