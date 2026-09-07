# Prey

**Status:** não implementado
**PRD:** §19, §43.4
**Épico:** E7

## Comportamento

O personagem tem slots de Prey: um liberado gratuitamente, mais um para quem é Premium, mais um desbloqueável com Coins, com teto de três slots no total. Cada slot recebe uma rolagem gratuita a cada 24 horas; um reroll adicional custa 10.000 gold.

O sorteio escolhe entre monstros dentro de uma faixa de level recomendado próxima à do personagem — aproximadamente 70 levels abaixo ou acima do level atual (um personagem level 200, por exemplo, sorteia dentro de um pool de monstros recomendados para aproximadamente 130 a 270). O tipo de bônus sorteado é aleatório entre quatro opções, mas a intensidade é sempre a mesma: +10% de XP contra a criatura, +10% de loot da criatura, +10% de dano causado à criatura, ou -10% de dano recebido dela. Cada bônus dura 4 horas.

## Regras

- Slots: 1 (Free) + 1 (Premium) + 1 (via Coins) = máximo de 3.
- Rolagem gratuita: 1 a cada 24 horas, por slot.
- Reroll adicional: custa 10.000 gold.
- Pool de sorteio: monstros com level recomendado entre aproximadamente -70 e +70 levels em relação ao level do personagem.
- Bônus possíveis (tipo sorteado, intensidade fixa em todos): +10% XP contra a criatura, +10% loot da criatura, +10% dano causado à criatura, -10% dano recebido da criatura.
- Duração de cada bônus: 4 horas.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Slots — Free | 1 | caminho previsto: `packages/content/prey` |
| Slots — Premium (adicional) | +1 | caminho previsto: `packages/content/prey` |
| Slots — via Coins (adicional) | +1 | caminho previsto: `packages/content/prey` |
| Máximo de slots | 3 | caminho previsto: `packages/content/prey` |
| Rolagem gratuita | 1 a cada 24h por slot | caminho previsto: `packages/content/prey` |
| Custo de reroll adicional | 10.000 gold | caminho previsto: `packages/content/prey` |
| Faixa de level recomendado no sorteio | ±70 levels | caminho previsto: `packages/content/prey` |
| Magnitude dos bônus (todos os 4 tipos) | 10% | caminho previsto: `packages/content/prey` |
| Duração do bônus | 4 horas | caminho previsto: `packages/content/prey` |

## Em aberto

- Se as 4 horas de duração consomem tempo real ou apenas tempo efetivo de hunt/combate contra a criatura sorteada — a camada técnica deve evitar fixar essa semântica no código antes da decisão (§19.5, §43.4).
- Regras comerciais finais do terceiro slot, desbloqueável com Coins (§43.4).

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
