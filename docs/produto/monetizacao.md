# Monetização — Coins e Premium

**Status:** não implementado
**PRD:** §7.2, §7.3, §33.3, §34, §35
**Épico:** E13

## Comportamento

Coins são a moeda premium do jogo, compradas com dinheiro real via PIX ou criptomoeda; pertencem à conta, não a um personagem específico. O detalhe de provedores, custódia, blockchain e fluxo financeiro fica a cargo do handoff técnico/comercial. Coins também podem ser vendidas no Market por gold, criando uma ponte oficial entre dinheiro real e a economia de gold (ver `economia.md`, §33.3).

Premium, por outro lado, é adquirido por personagem — mesmo que a moeda usada para comprá-lo (Coins) esteja na conta — em pacotes de 7, 30 ou 90 dias. Um personagem Premium recebe: +10% de XP; treino offline de até 12 horas em vez de 6; até 20 tipos de item configuráveis na autovenda em vez de 5; um segundo slot de Prey; e penalidade de morte reduzida de 60% para 54% da XP necessária para o level atual. Um terceiro slot de Prey pode ser desbloqueado separadamente com Coins, independente do segundo slot Premium, conforme regras comerciais ainda não fechadas.

A filosofia declarada é que Premium tenha vantagens reais de progressão/conveniência, mas o produto precisa monitorar o impacto dessa diferença entre Free e Premium — todos os valores permanecem configuráveis para ajuste contínuo.

Fora do MVP, mas já com preparação de dados exigida: a Fase 2 prevê um marketplace de dinheiro real para itens lendários e para venda de personagens completos (com transferência definitiva de conta preservando identidade e progresso). No MVP essas transações não são habilitadas — a UI pode mostrar "Em breve" —, mas o modelo de dados precisa preservar proveniência e transferibilidade desde já, para não exigir migração destrutiva depois.

## Regras

- Coins pertencem à conta; Premium é adquirido por personagem.
- Coins compráveis via PIX ou criptomoeda.
- Coins vendáveis no Market por gold (ver `economia.md`).
- Pacotes de Premium: 7, 30 ou 90 dias.
- Benefícios Premium: +10% XP; 12h de treino offline (vs 6h Free); 20 tipos de autovenda (vs 5 Free); +1 slot de Prey; penalidade de morte de 54% (vs 60% Free).
- Terceiro slot de Prey desbloqueável com Coins, independente do slot Premium.
- Marketplace de dinheiro real para lendários e personagens: fora do MVP, UI "Em breve", mas proveniência e transferibilidade precisam existir no modelo de dados desde o início.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Pacotes de Premium (dias) | 7 / 30 / 90 | caminho previsto: `packages/content/economia` (premium) |
| Bônus de XP Premium | +10% | caminho previsto: `packages/content/economia` (premium) |
| Limite de treino offline — Premium | 12h (Free: 6h) | caminho previsto: `packages/content/economia` (premium) |
| Limite de autovenda — Premium | 20 tipos (Free: 5) | caminho previsto: `packages/content/economia` (premium) |
| Slots de Prey — Premium | +1 (2º slot) | caminho previsto: `packages/content/economia` (premium) |
| Penalidade de morte — Premium | 54% (Free: 60%) | caminho previsto: `packages/content/economia` (premium) |

## Em aberto

- Regras comerciais finais do terceiro slot de Prey, desbloqueável via Coins (§34.4, §43.4).
- Detalhe de provedores, custódia, blockchain e fluxo financeiro da compra de Coins — explicitamente delegado ao handoff técnico/comercial, não ao game design (§34.1).

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
