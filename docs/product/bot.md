# Bot

**Status:** não implementado
**PRD:** §13, §43.3
**Épico:** E4

## Comportamento

A automação é parte oficial do produto e roda inteiramente no servidor — o jogador configura regras, e a hunt continua funcionando mesmo com o client fechado. Do level 1 ao 49, o personagem usa um bot simplificado, inspirado na experiência do Huntera. A partir do level 50, o bot avançado é liberado, adicionando ferramentas como lure dinâmico e ring swap.

O bot é organizado em cinco categorias independentes, cada uma com seus próprios slots: Cura, Potions, Magias de ataque, Runas e itens, e Magias de suporte. Não existe prioridade global entre categorias — cada uma avalia seus próprios slots de cima para baixo, e a primeira regra válida encontrada é executada; as demais regras daquela categoria não executam naquele ciclo. Por exemplo, numa categoria de Cura configurada como "HP<=30% → cura forte", "HP<=55% → cura média", "HP<=80% → cura fraca", se a primeira regra for válida, as outras duas nem são avaliadas.

Cada categoria tem um cooldown próprio de 1 segundo, independente das outras — uma ação de Potion não consome o cooldown de Runa, por exemplo — além do cooldown específico da magia ou item usado, quando houver.

O bot também administra targeting: mirar no alvo mais próximo, no de menor ou maior HP, priorizar ou ignorar criaturas específicas, seguir o alvo, ficar parado, ou manter uma distância configurada.

O bot avançado (level 50+) adiciona duas máquinas de estado sobre o mesmo motor. A primeira é o lure dinâmico: o jogador define um intervalo mínimo/máximo de monstros — por exemplo, mínimo 4 e máximo 8 — e o personagem alterna entre percorrer a rota acumulando inimigos (quando a contagem está abaixo do mínimo) e parar para limpar o grupo (quando atinge o máximo), retomando o percurso quando a contagem volta a cair abaixo do mínimo. A segunda é o ring swap: uma máquina de estados para Energy Ring e anéis semelhantes, com limiares de entrada e saída propositalmente diferentes para evitar troca repetitiva perto do mesmo percentual (por exemplo: equipar com HP < 50%, retirar com HP >= 60%, ou retirar por Mana < 10%). Ao retirar, o jogador escolhe entre restaurar o anel anteriormente equipado ou deixar o slot vazio.

Por fim, o jogador pode configurar duas regras automáticas de saída da hunt: sair se algum membro da party sair ou morrer, e sair se o próprio gold acabar. Se a segunda regra não estiver ativa e o gold acabar, o personagem permanece na hunt, incapaz de pagar supplies, e pode morrer.

## Regras

- Bot básico: do level 1 ao 49. Bot avançado: a partir do level 50.
- Cinco categorias independentes, cada uma com cooldown próprio de 1 segundo (além do cooldown da magia/item usado, se houver).
- Sem prioridade global entre categorias; dentro de cada categoria, avaliação de cima para baixo, primeira regra válida executa e interrompe a avaliação daquela categoria naquele ciclo.
- Uma ação de uma categoria não consome, por padrão, o cooldown de outra categoria.
- Condições da categoria Cura: HP e Mana, com operadores `<`, `>`, `<=`, `>=`.
- Potions: 2 slots de vida e 2 de mana; Spirit Potion pode ser elegível para ambas as categorias.
- Targeting suportado: mais próximo, menor HP, maior HP, priorizar específicas, ignorar específicas, seguir alvo, permanecer parado, manter distância configurada.
- Lure dinâmico: intervalo mínimo/máximo de monstros configurável; abaixo do mínimo percorre a rota acumulando, no máximo para e limpa, retoma quando cai abaixo do mínimo de novo.
- Ring swap: limiares de entrada e saída distintos (histerese); ao retirar, jogador escolhe restaurar o anel anterior ou deixar o slot vazio.
- Regras de saída configuráveis: (1) sair se membro da party sair/morrer; (2) sair se o próprio gold acabar. Sem a regra (2) ativa, gold zerado não tira o personagem da hunt.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Level máximo do bot básico | 49 (avançado a partir de 50) | caminho previsto: `packages/content/bot` |
| Slots — Cura | 3 | caminho previsto: `packages/content/bot` |
| Slots — Potions | 4 (2 vida + 2 mana) | caminho previsto: `packages/content/bot` |
| Slots — Magias de ataque | 10 | caminho previsto: `packages/content/bot` |
| Slots — Runas e itens | 10 | caminho previsto: `packages/content/bot` |
| Slots — Magias de suporte | 10 | caminho previsto: `packages/content/bot` |
| Cooldown por categoria | 1s | caminho previsto: `packages/content/bot` |
| Teto de ações por segundo por personagem | 5 (derivado: 5 categorias × 1 cooldown cada — não é número do PRD, é consequência calculada em `docs/technical-architecture.md` §5) | caminho previsto: `packages/content/bot` |
| Lure dinâmico — mín/máx de exemplo | mín 4 / máx 8 (exemplo ilustrativo do PRD, não é valor final) | caminho previsto: `packages/content/bot` |
| Ring swap — limiares de exemplo | equipar HP<50%, retirar HP>=60%, retirar Mana<10% (exemplo ilustrativo do PRD, não é valor final) | caminho previsto: `packages/content/bot` |

## Em aberto

- Subconjunto exato de opções disponíveis no bot básico (pré-level 50) — deve ser definido a partir do bot completo (§13.2, §43.3). Bloqueia a última tarefa do épico E4 (`docs/technical-architecture.md` §20).
- Vocabulário final de todas as condições possíveis do bot (§43.3).

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
