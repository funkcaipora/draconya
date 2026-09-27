# Morte

**Status:** implementado (penalidade do Tibia — XP, skill tries e mana gasta; volta à PZ)
**PRD:** §26
**Épico:** E2

## Comportamento

Na morte em PvE normal, a hunt é encerrada, o personagem volta para a área inicial/PZ com HP e
Mana totalmente restaurados, sem debuff temporário e sem perder item ou equipamento algum — a
perda de item do Tibia real (Amulet of Loss, `Blessings.LossPercent`) é a #571, ainda não
implementada; até lá, morte no Draconya continua sem perda material.

O que a morte de fato custa é **o mesmo percentual do Tibia real** (`Player::death`,
`Player::getLostPercent`, #521/#569, ADR 0037), aplicado a três coisas ao mesmo tempo: a XP
acumulada, os tries de CADA skill (podendo derrubar o nível dela) e a mana gasta — modelada aqui
como os pontos da skill `magic`, sem um campo próprio para "mana gasta" (ver "Skill e mana gasta
usam o mesmo mecanismo", abaixo). **Não há piso de level** (#569): o Tibia real nunca protegeu
level nenhum, e o Draconya alinhou a isso — o personagem pode cair até o level 1.

## Regras

- Morte encerra a hunt e devolve o personagem à PZ.
- HP e Mana são restaurados totalmente (ao entrar na Cidade, não pela penalidade).
- Sem debuff temporário. Perda de item é a #571 (ainda não implementada).
- Abaixo do level 24 (`cubicFromLevel`): perde 10% da XP acumulada (`flatFraction`).
- A partir do level 24: perde a fórmula cúbica clássica do Tibia, função do level efetivo.
- O MESMO percentual tira também tries de skill (cada skill pode cair de nível) e mana gasta.
- Quem está "abençoado" (`premium`, mapeia o conceito de bênção — #570 substitui por bênção de
  verdade) reduz a perda em até 56%, tetado em 50% abaixo do level 24.
- Quem está promovido (`promoted`, ainda sem estado de personagem — #566/ADR 0042) reduziria a
  perda em mais 30%, aditivo e nunca tetado — o parâmetro já existe em `applyDeathPenalty` como
  ponto de extensão, mas nada ainda o aciona.
- Sem piso de level: a penalidade pode derrubar o personagem até o level 1.

## A fórmula é a do Tibia, e o MESMO percentual paga três contas

Abaixo de `cubicFromLevel` (24) a perda é uma fração FIXA da XP acumulada (`flatFraction`, 10%);
a partir dali é a fórmula cúbica clássica — `((L+50) / 100) × 50 × (L² − 5L + 8)`, com `L`
incluindo a fração de progresso dentro do level corrente, para a perda não saltar na fronteira.
As duas contam sobre a XP ACUMULADA, não sobre `xpToCompleteLevel` — o modelo antigo (uma fração
de UM level, 60%/54%) media perda errado porque não é assim que o Tibia mede; a #521 corrigiu
isso, e este documento estava desatualizado citando os números antigos até a #569.

`Player::death` do Canary não calcula essa fração três vezes — calcula UMA vez
(`deathLossPercent`) e a aplica a três somas diferentes: a XP acumulada, a soma de tudo que já
foi preciso para chegar em cada skill (mais o progresso corrente dela) e a soma equivalente para
mana gasta. O Draconya faz o mesmo (`applyDeathPenalty`, `packages/sim/src/progression.ts`):
a MESMA fração (`lossFraction`, já com bênção e promoção descontadas) multiplica o total
acumulado de XP e o de CADA skill do catálogo.

## Skill e mana gasta usam o mesmo mecanismo

O Tibia trata "perder mana gasta" como uma skill a mais — `manaSpent` é o "tries" do magic
level, com o próprio `getReqMana` fazendo o papel de `getReqSkillTries`. O Draconya já modelava
magic level exatamente assim antes desta issue (`skills.ts`, `gain.on === 'spell-cast'`: a
skill `magic` sobe por MANA GASTA, não por lançamento), então a penalidade de morte não precisou
inventar um segundo acumulador — perder tries da skill `magic` **é** perder mana gasta, e o
`DeathPenalty.skillLosses` devolve os dois no mesmo formato, uma entrada por skill do catálogo.

Cada skill perde na MESMA fração que a XP, sobre o total acumulado DELA (o custo de todo nível
já ultrapassado mais o progresso corrente) — nunca sobre o progresso corrente sozinho, que
subestimaria a perda de quem tem nível alto e pouco progresso no atual. Perder mais tries do que
a skill tem no nível corrente derruba o nível dela — igual à XP —, e reabastece os tries com o
custo cheio do nível novo antes de descontar o resto, exatamente como o Tibia faz. O piso é o
`startingLevel` de CADA skill: 10 para as corpo a corpo (fist/club/sword/axe, #567/#568) e 0 para
`magic` — o mesmo "não desce mais" do Tibia, sem precisar de um caso especial para magia.

**A skill nunca desce fora da morte.** `Skills.merge` (usado para reconciliar extratos)
continua assumindo que skill só sobe, e a morte quebra essa monotonicidade de propósito — a
mesma janela que já existia para XP (que também cai na morte sem passar por merge nenhum).

## Sem piso de level (#569)

O piso do level 8 que o Draconya tinha desde antes da #521 **não existe no Tibia real**
(confirmado na TibiaPlan, "Tibia Death Penalty", 2026-09-24, e em `Player::death`/
`Player::getLostPercent` do Canary): todo mundo perde XP, skill tries e mana gasta, mesmo abaixo
do level 8, e pode continuar caindo até o level 1. Era decisão de PRODUTO do Draconya — proteger
quem acabou de escolher vocação —, e a #569 removeu essa proteção para alinhar ao jogo real; ver
"Divergências do PRD" para o registro histórico.

**A penalidade sai na morte, não no encerramento.** Uma hunt que termina por saída manual ou por
regra automática não custa XP, skill nem mana nenhuma — quem paga é quem morre. A perda de XP
entra no extrato como número negativo, porque o extrato é o que vira linha de ledger; a perda de
skill e mana gasta é só estado do personagem (não passa por ledger, como skill nunca passou).

**Nunca perde item** ainda (§3.8; a #571 muda isso), e o teste disso é a ausência: a penalidade
mexe em XP, skill, level e stats derivados, e em mais nada.

## Termo de promoção e bênção são pontos de extensão (#570, #566)

`applyDeathPenalty` já aceita `options.promoted` (redução aditiva de 30%, nunca tetada) e
`progression.deathPenalty.promotionReduction` (30%, o `percentReduction += 0.30` de
`Player::getLostPercent`) — mas `CharacterRuntime` ainda não tem um campo `promoted`: a
promoção em si é a #566/ADR 0042, ainda aberta. Da mesma forma, `options.premium` continua sendo
o binário "está abençoado" que o repo já tinha antes da #521; a #570 vai substituí-lo por uma
contagem real de bênçãos (`Blessings`, sete PvE do Canary), reduzindo a perda de skill/XP/mana
ainda mais. Os dois parâmetros já existem por isso: para a #566 e a #570 ligarem sem precisar
tocar na fórmula.

## Morrer desanexado é o caso que importa

O jogador não está lá quando o personagem morre numa hunt AFK — e é a maior parte das mortes.
Se a sequência só funcionasse com alguém assistindo, o invariante 3 estaria quebrado, e o jeito
de descobrir seria um personagem preso numa sessão encerrada até a próxima conexão.

A sucessão roda no **ciclo do nó**, junto com o tick, e não numa mensagem de cliente. A ordem é
o assunto todo, e cada troca tem consequência:

1. **o extrato é gravado antes de qualquer aviso** — morrer e o processo cair em seguida deixa o
   crédito no Redis esperando o `jobs`, que é a metade certa de perder;
2. **o `session-ended` sai antes do estado novo** — ver a cidade aparecer e só depois descobrir
   que morreu é a ordem errada de contar a mesma notícia;
3. **a sessão nova é registrada no diretório antes de substituir a local** — registrar depois
   deixaria o personagem apontando para uma sessão que o nó já esqueceu;
4. **a cura vem com a Cidade, e a Cidade vem depois do encerramento** — restaurar HP antes de
   encerrar gravaria no extrato uma sessão que "terminou com vida cheia".

**O personagem que atravessa é o mesmo objeto**, não uma cópia reconstruída do banco. A
penalidade já mexeu no level, na XP e nas skills quando a transição acontece; reconstruir a
partir de dados duráveis ainda não gravados devolveria o personagem de antes de morrer, e a
penalidade sumiria sem ninguém ligar uma coisa à outra.

**Quem estava olhando vai junto.** O visualizador acompanha o personagem, não a sessão: fechar o
socket porque a hunt acabou daria uma desconexão a quem estava assistindo, em vez da volta à
cidade.

**A morte é marco de snapshot** (FUN-27), gravado na hora e não no próximo intervalo. Perder a
transição entre dois snapshots é o pior caso possível: o jogador volta vivo, ainda na hunt, e a
penalidade aparece do nada um pouco depois.

**A troca no diretório é atômica.** Soltar e registrar de novo, em dois comandos, deixaria o
personagem sem registro no meio — e "só por alguns milissegundos" é exatamente o tamanho da
janela que a retomada usa para decidir que uma sessão está órfã. Se o registro trocou de dono no
caminho, o nó **solta** em vez de insistir: escrever por cima de um dono que já não é o nosso
produziria duas cópias da mesma sessão, o que dobra XP e loot e é pior que uma sessão perdida.

**Sair da hunt também devolve à cidade**, não só morrer. Todo personagem está em exatamente uma
sessão (invariante 8): "a hunt acabou" nunca pode significar "ficou sem sessão".

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Penalidade — fração fixa (< level 24) | 10% da XP/skill/mana acumulada | `packages/content/data/progression/baseline.json`, `deathPenalty.flatFraction` |
| Penalidade — limiar da fórmula cúbica | level 24 | `packages/content/data/progression/baseline.json`, `deathPenalty.cubicFromLevel` |
| Redução de quem está abençoado (`premium`) | 56% (tetada em 50% abaixo do level 24) | `packages/content/data/progression/baseline.json`, `deathPenalty.blessedReduction` |
| Redução de quem está promovido (`promoted`) | 30%, aditiva e nunca tetada — parâmetro sem estado ainda (#566) | `packages/content/data/progression/baseline.json`, `deathPenalty.promotionReduction` |
| Piso de proteção de level | **removido pelo #569** | — |

## Em aberto

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema.

- **Perda de item na morte** `[ABERTO]`: o [ADR 0042](../adr/0042-tibia-death-promotion-blessings-and-item-loss.md)
  propõe destruir o item perdido e registrar no extrato (invariante 10), em vez de "nunca perde
  item" (§3.8 acima). A resposta do dono de 2026-09-25 ("copie do Huntera") não encontrou nenhuma
  morte de personagem em `docs/reference/huntera-observed.md` — o documento nunca captura uma
  morte —, então esta questão não tem evidência do Huntera para se apoiar e segue exatamente como
  o ADR 0042 a deixou: em aberto, aguardando decisão do dono, não uma captura. `docs/tibia-parity-plan.md`
  §6 lista o que uma captura de morte precisaria mostrar, se uma acontecer.
- **Bênção de verdade (#570)** e **promoção como estado do personagem (#566)** são os dois
  parâmetros que a #569 deixou como extensão (`options.premium`, `options.promoted`) sem
  implementar o mecanismo por trás deles.

## Divergências do PRD

**A penalidade mora em `progression/baseline.json`, não num arquivo de economia.** Ela é definida
COMO fração da curva de XP, e separar as duas é como as duas divergem numa rebalanceada.

**O §43 segue aberto sobre o que exatamente acontece ao morrer desanexado.** A implementação
assume o comportamento acima — encerra, credita, cobra a penalidade e devolve à PZ — e o extrato
é a única forma de o jogador descobrir o que houve ao voltar.

~~**§26.2 — piso de level da penalidade de morte (levelFloor, #521, ADR 0037).**~~ →
**Removido pelo #569:** o Draconya protegia o level 8 contra a própria penalidade, e o Tibia real
não tem esse piso (TibiaPlan, "Tibia Death Penalty", 2026-09-24: todo mundo perde XP, skill tries
e mana gasta, mesmo abaixo do level 8). Era decisão de produto para não punir com perda de level
quem acabou de escolher vocação; a #569 alinhou o comportamento ao Tibia real e removeu o campo
`deathPenalty.levelFloor` do conteúdo.
