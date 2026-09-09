# Hunt

**Status:** não implementado
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

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Quantidade de dificuldades | 4 (Iniciante, Profissional, Herói, Lendário) | caminho previsto: `packages/content/hunts` |
| Densidade de referência por ponto de spawn (Iniciante / Profissional / Herói / Lendário) | ~2 / 4 / 8 / 12 monstros (referência inicial discutida; a composição real é definida por hunt) | caminho previsto: `packages/content/hunts` |
| Rota | lista ordenada de tiles, fixa por hunt | caminho previsto: `packages/content/hunts` |

## Em aberto

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema. A densidade de referência (2/4/8/12) é explicitamente descrita como ponto de partida, não como número final — cada hunt define sua própria composição em conteúdo.

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
