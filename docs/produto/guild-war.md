# Guild War

**Status:** não implementado
**PRD:** §30, §43.8
**Épico:** E12

## Comportamento

A Guild War é o único PvP estruturado do MVP: times de 15 jogadores por lado, com uma guilda podendo montar vários times simultaneamente — Líder e Vice-líder escolhem os integrantes de cada um. Não há level mínimo inicialmente; tiers por level podem ser adicionados no futuro. Os times são pareados por matchmaking de acordo com o level médio dos jogadores de cada time.

O mapa é predeterminado e o trono ocupa um único tile: dominar exige que um jogador fique exatamente sobre esse tile, e como só um personagem pode ocupá-lo por vez, push, bloqueio e posicionamento são centrais ao modo. Permanecer 60 segundos contínuos sobre o trono vale 1 ponto; se o ocupante sair, morrer ou for empurrado antes de completar os 60 segundos, a contagem zera, e uma nova contagem só começa do zero quando alguém voltar a ocupar o tile. Há uma regra de corte explícita para o caso de borda: se o timestamp dos 60 segundos for atingido antes do evento de morte/push ser processado, o ponto conta como válido.

A cada 5 pontos — em 5, 10 e 15 — o trono muda para outra posição predeterminada no mapa. Vence o primeiro time a chegar a 20 pontos; não existe duração máxima de partida nem empate possível, a partida continua até alguém vencer.

Durante a partida, morrer não custa XP: o jogador aguarda 5 segundos e reaparece na base do próprio time, com HP e Mana cheios, podendo morrer e retornar quantas vezes for necessário. Só ao final da partida a penalidade de XP se aplica, e só ao time derrotado — equivalente à penalidade de uma morte normal (60% Free / 54% Premium da XP do level atual, respeitando o piso do level 8). O time vencedor recebe, pelos personagens que efetivamente participaram (não por todos os membros da guilda), um bônus de 24 horas de +10% XP e +10% loot.

A Guild War é um evento diário; o horário exato ainda não foi decidido — 20h e 21h foram discutidos como referência inicial.

## Regras

- Times de 15 jogadores (15x15); uma guilda pode ter múltiplos times.
- Líder e Vice-líder escolhem os integrantes do time.
- Sem level mínimo inicial.
- Matchmaking por level médio do time.
- Trono ocupa um único tile; domínio exige ocupação exclusiva e exata desse tile.
- 60 segundos contínuos no trono = 1 ponto; sair/morrer/ser empurrado antes zera a contagem.
- Nova ocupação sempre reinicia a contagem em 0.
- Se os 60s completam antes do evento de morte/push ser processado, o ponto é válido.
- Troca de posição do trono em 5, 10 e 15 pontos.
- Vitória em 20 pontos; sem empate possível, sem duração máxima.
- Sem perda de XP por morte durante a partida.
- Respawn em 5 segundos, na base do próprio time, com HP/Mana cheios.
- Ao final: time derrotado sofre penalidade de XP equivalente a uma morte normal (60% Free / 54% Premium, piso level 8).
- Time vencedor: participantes efetivos recebem +10% XP e +10% loot por 24 horas.
- Evento diário, horário ainda não definido.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Tamanho do time | 15 (15x15) | caminho previsto: `packages/content/guildwar` |
| Segundos contínuos no trono por ponto | 60s | caminho previsto: `packages/content/guildwar` |
| Pontos de troca de posição do trono | 5, 10, 15 | caminho previsto: `packages/content/guildwar` |
| Pontos para vitória | 20 | caminho previsto: `packages/content/guildwar` |
| Tempo de respawn após morte | 5s | caminho previsto: `packages/content/guildwar` |
| Penalidade de XP ao time derrotado (Free / Premium) | 60% / 54% da XP do level atual, piso level 8 (mesma regra de `morte.md`, §26.2) | caminho previsto: `packages/content/guildwar` |
| Bônus ao time vencedor | +10% XP e +10% loot por 24h, só para participantes efetivos | caminho previsto: `packages/content/guildwar` |
| Horário diário do evento | `[ABERTO]` (20h/21h discutidos como referência) | caminho previsto: `packages/content/guildwar` |

## Em aberto

- Horário diário exato do evento — 20h/21h foram discutidos como referência, sem decisão final (§30.7, §43.8).
- Faixa/tolerância de matchmaking por level médio (§30.2, §43.8).
- Proteção contra rematch entre os mesmos times (§30.2, §43.8).
- Tratamento de quantidade ímpar de times na fila (§30.2, §43.8).
- Possibilidade ou não de times da mesma guilda se enfrentarem (§43.8).
- Regra final de substituição/entrada no roster após o início da partida — a recomendação de produto é roster fechado ao iniciar, mas isso não foi confirmado explicitamente (§30.8, §43.8).

Todos os itens acima bloqueiam o épico E12 (`docs/arquitetura-tecnica.md` §20).

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
