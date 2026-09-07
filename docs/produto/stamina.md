# Stamina

**Status:** não implementado
**PRD:** §10
**Épico:** E2 (stamina como função do tempo decorrido, sem tick); E3 (bloqueio de XP, loot e Bestiário com stamina zero)

## Comportamento

Todo personagem tem uma reserva de stamina que funciona como o freio econômico do tempo de caça efetivo. Ela se esgota enquanto o personagem está em hunt e se recupera enquanto ele está fora de hunt — inclusive enquanto está em treino, que conta como "fora de hunt" para esse efeito.

Quando a stamina chega a zero, a hunt não é interrompida: o personagem continua dentro dela, continua andando, continua atacando, continua consumindo supplies e gastando gold, e pode morrer normalmente. O que muda é que a partir desse ponto ele para de progredir de verdade: não recebe XP, não recebe loot e os abates não contam para a Bestiário. Ou seja, stamina zero transforma a hunt em uma atividade que ainda tem custo mas não tem mais benefício de progressão — o jogador (ou o bot, via regra de saída configurada) é quem decide encerrar.

## Regras

- Stamina máxima: 24 horas.
- Recuperação fora de hunt: 1 minuto de tempo real recupera 1 minuto de stamina (proporção 1:1).
- Treino conta como "fora de hunt" para fins de recuperação de stamina.
- Em stamina zero, dentro da hunt: personagem continua se movendo, atacando, consumindo supplies/gold e pode morrer; não recebe XP; não recebe loot; abates não contam para a Bestiário.
- Stamina zero, por si só, nunca encerra a hunt automaticamente.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Stamina máxima | 24h | caminho previsto: `packages/content/economia` |
| Taxa de recuperação fora de hunt | 1:1 (1 min = 1 min) | caminho previsto: `packages/content/economia` |
| Taxa de recuperação em treino | 1:1 (1 min = 1 min) | caminho previsto: `packages/content/economia` |

## Em aberto

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema.

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
