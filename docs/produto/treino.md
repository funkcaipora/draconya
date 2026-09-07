# Treino

**Status:** não implementado
**PRD:** §11
**Épico:** E8

## Comportamento

O jogador escolhe o modo Treino no menu e é enviado para uma instância dedicada, onde dois Trainer Monks o atacam continuamente. Esses ataques não causam dano efetivo — o objetivo não é simular perigo, é permitir que o personagem mantenha evolução de shielding/defesa e treine skills de forma segura e sem risco.

Todos os supplies consumidos durante o treino — poções, runas, munição — são infinitos e não custam gold. É, por design, a atividade mais barata do jogo: um personagem pode ficar "estacionado" em treino sem gerar custo nenhum.

Com o client ativo, o personagem treina normalmente. Ao desconectar, o treino continua offline até um limite de tempo: 6 horas para contas Free, 12 horas para Premium. Depois desse limite, o treino offline para. Durante todo o tempo de treino elegível — online ou offline, dentro do limite — a stamina recupera na proporção normal de 1:1, já que treino conta como "fora de hunt".

## Regras

- Dois Trainer Monks atacam o personagem continuamente durante o treino.
- Os ataques dos Trainer Monks não causam dano efetivo.
- Supplies consumidos no treino (poções, runas, munição) são infinitos e gratuitos.
- Treino online: continua enquanto o client estiver ativo.
- Treino offline: continua até o limite da conta (Free ou Premium).
- Free: até 6 horas de treino offline.
- Premium: até 12 horas de treino offline.
- Após o limite offline, o treino para.
- Stamina recupera 1:1 durante todo o tempo de treino elegível.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Quantidade de Trainer Monks | 2 | caminho previsto: `packages/content/treino` |
| Dano efetivo dos Trainer Monks | 0 | caminho previsto: `packages/content/treino` |
| Limite de treino offline — Free | 6h | caminho previsto: `packages/content/economia` (premium) |
| Limite de treino offline — Premium | 12h | caminho previsto: `packages/content/economia` (premium) |
| Taxa de recuperação de stamina em treino | 1:1 | caminho previsto: `packages/content/economia` |

## Em aberto

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema.

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
