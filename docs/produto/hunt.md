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
