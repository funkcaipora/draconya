# Analisador de hunt

**Status:** não implementado
**PRD:** §16, §43.10
**Épico:** E6

## Comportamento

Durante a hunt, o jogador tem acesso a um painel de análise em tempo real, que pode ser minimizado sem fechar. O painel mostra, no mínimo, tempo de sessão, XP obtida e XP/h, gold obtido e gold/h, gastos e gasto/h, saldo e saldo/h, inimigos mortos, loot obtido, supplies consumidos, o maior hit do ataque básico, e o maior hit registrado de cada skill utilizada.

Quando o jogador reanexa o client a uma hunt que continuou rodando sem visualizador — o caso comum do idle/AFK —, ele recupera o estado atual do personagem e os agregados acumulados da sessão inteira, não um replay de eventos. A arquitetura de referência recomenda também uma lista de eventos notáveis (subiu de level, item raro, quase morreu, morreu, saiu por qual regra) e notificações para fim de sessão, morte e stamina zerada — mas os canais exatos dessas notificações e o escopo completo de eventos notáveis ainda não foram fechados.

## Regras

- O painel do analisador fica disponível durante toda a hunt e é minimizável.
- Métricas mínimas exibidas: tempo de sessão, XP obtida, XP/h, gold obtido, gold/h, gastos, gasto/h, saldo, saldo/h, inimigos mortos, loot obtido, supplies consumidos, maior hit do ataque básico, maior hit por skill utilizada.
- Reanexar a uma sessão devolve o estado atual completo mais os agregados acumulados da sessão — nunca um replay de eventos.

## Parâmetros de balanceamento

Este sistema não define parâmetros numéricos de balanceamento — é uma especificação de quais campos o painel precisa expor. A tabela abaixo registra apenas onde essa especificação deve morar como dado, para não virar texto fixo na UI.

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Lista de métricas mínimas do painel | ver seção "Regras" acima | caminho previsto: `packages/content/analisador` (ou definição fixa em `protocol/`, a decidir na implementação) |
| Lista de eventos notáveis do snapshot | subiu de level, item raro, quase morreu, morreu, saiu por qual regra (recomendação da arquitetura, não fechada como obrigatória) | caminho previsto: `packages/content/analisador` |

## Em aberto

- Canais e escopo exatos de eventos notáveis e notificações de fim de sessão/morte/stamina (§16.2).
- Canais e eventos que geram push/alerta fora do jogo (§43.10).

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
