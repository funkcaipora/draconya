# Morte

**Status:** implementado (penalidade de XP e volta à PZ)
**PRD:** §26
**Épico:** E2

## Comportamento

Na morte em PvE normal, a hunt é encerrada, o personagem volta para a área inicial/PZ com HP e Mana totalmente restaurados, sem debuff temporário, sem sistema de bless, e sem perder item ou equipamento algum — morte no Draconya nunca é uma perda material.

O que a morte de fato custa é XP: a penalidade base é 60% da quantidade de XP necessária para completar o level atual, reduzida para 54% em personagens Premium. Essa penalidade pode causar perda de level, mas o personagem nunca cai abaixo do level 8 por conta dela — esse piso é uma proteção fixa.

## Regras

- Morte encerra a hunt e devolve o personagem à PZ.
- HP e Mana são restaurados totalmente.
- Sem debuff temporário, sem perda de item/equipamento, sem sistema de bless.
- Penalidade de XP: 60% da XP necessária para completar o level atual (Free).
- Penalidade de XP reduzida: 54% (Premium).
- A penalidade pode causar perda de level, mas nunca abaixo do level 8.

## O piso do level 8 protege, e nunca promove

A penalidade é 60% da XP necessária para completar o level atual (54% com Premium), tirada do
**total acumulado**. O level é recalculado a partir dele, e é assim que a queda de level — e a
cascata por mais de um — sai de graça, sem laço escrito à mão.

O piso do level 8 é a parte que engana. Escrito como um `max` puro contra a XP do level 8, ele
**levantaria** a XP de quem está no level 5 — um castigo que dá level. O correto é: a penalidade
nunca deixa o personagem abaixo do que ele já tinha, e nunca o leva abaixo do piso. Quem já está
sob o piso não perde nada.

O piso é de **XP**, não só de level: parar no level 8 com XP negativa é um estado impossível que
dá erro estranho três sistemas adiante.

**Com a curva de hoje, a cascata nunca acontece acima do piso.** Cascatear exige
`0,6 × f(L) > f(L-1)`, e com `exponent: 2` isso só valeria abaixo do level 6 — onde o piso do 8
já protege. O código trata cascata mesmo assim, e há teste com uma curva mais íngreme, porque a
curva é conteúdo e vai ser rebalanceada.

**A penalidade sai na morte, não no encerramento.** Uma hunt que termina por saída manual ou por
regra automática não custa XP nenhuma — quem paga é quem morre. A perda entra no extrato como
número negativo, porque o extrato é o que vira linha de ledger: creditar a XP ganha sem descontar
a perdida daria ao jogador uma XP que ele não tem.

**Nunca perde item** (§3.8), e o teste disso é a ausência: a penalidade mexe em XP, level e stats
derivados, e em mais nada. É o que elimina a necessidade de qualquer sistema de recuperação.

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
penalidade já mexeu no level e na XP quando a transição acontece; reconstruir a partir de dados
duráveis ainda não gravados devolveria o personagem de antes de morrer, e a penalidade sumiria
sem ninguém ligar uma coisa à outra.

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
| Penalidade de XP — Free | 60% da XP necessária para o level atual | `packages/content/data/progression/baseline.json`, `deathPenalty.fraction` |
| Penalidade de XP — Premium | 54% da XP necessária para o level atual | `packages/content/data/progression/baseline.json`, `deathPenalty.premiumFraction` |
| Piso de proteção de level | 8 | `packages/content/data/progression/baseline.json`, `deathPenalty.levelFloor` |

## Em aberto

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema.

## Divergências do PRD

**A penalidade mora em `progression/baseline.json`, não num arquivo de economia.** Ela é definida
COMO fração da curva de XP, e separar as duas é como as duas divergem numa rebalanceada.

**O §43 segue aberto sobre o que exatamente acontece ao morrer desanexado.** A implementação
assume o comportamento acima — encerra, credita, cobra a penalidade e devolve à PZ — e o extrato
é a única forma de o jogador descobrir o que houve ao voltar.
