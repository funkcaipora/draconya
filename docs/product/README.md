# Documentação funcional viva

O PRD (`Draconya_PRD_Consolidado_v0.9.md`) é um **instantâneo**: descreve o que se pretendia em
07/09/2026, com `[ABERTO]` espalhado por toda parte. Esta pasta é o **documento vivo**: o que
existe de fato, hoje, no código. Alguns blocos da espinha dorsal já saíram do papel, então os
arquivos podem estar como `não implementado`, `parcial` ou `implementado`. Cada sistema registra
**Parâmetros de balanceamento** (onde cada número mora em `packages/content`) e **Em aberto**
(quais decisões de produto, herdadas do PRD, ainda faltam fechar).

O PRD não deve ser editado para refletir a implementação — ele é histórico, a foto de um momento.
Toda mudança de comportamento real entra aqui.

## Quando atualizar um arquivo

Sempre que um sistema sair do papel — ou seja, sempre que uma tarefa de algum épico do
`docs/technical-architecture.md` §17 for implementada e mesclada. Nesse momento (idealmente via skill
`/product`, descrita em `docs/harness-plan.md` §3.4):

1. Atualiza **Status** (`não implementado` → `parcial` ou `implementado`).
2. Reescreve **Comportamento** e **Regras** com o que o sistema *de fato* faz, não com o que o PRD
   pedia.
3. Resolve os itens de **Em aberto** que a implementação fechou — o item sai dali e o valor
   escolhido entra em **Regras**.
4. Atualiza **Parâmetros de balanceamento**, trocando o caminho previsto pelo caminho real do
   arquivo em `packages/content`.
5. Registra em **Divergências do PRD** qualquer ponto em que o código ficou diferente do que o PRD
   especificava, com o motivo.

O item 4 é a razão prática da pasta existir: quando alguém for balancear a hunt daqui a três meses,
a pergunta vai ser "onde fica esse número", não "qual era a regra".

## Sistemas

> **O status desta tabela é o do cabeçalho de cada arquivo, e não uma segunda opinião.** Ele ficou
> seis linhas atrás da realidade entre a M3 e a M5 — os arquivos foram atualizados a cada entrega
> e a tabela não —, e um índice que diz "não implementado" sobre coisa entregue faz alguém
> reimplementar. Ao mudar o `**Status:**` de um arquivo, mude a linha aqui no mesmo commit.

| Sistema | Arquivo | Status | Épico | PRD |
|---|---|---|---|---|
| Contas, autenticação e personagens | [`accounts-and-characters.md`](./accounts-and-characters.md) | parcial | E0 | §7.1–§7.4 |
| Onboarding e tutorial | [`onboarding.md`](./onboarding.md) | parcial | E14 | §7.4, §8 |
| Progressão, vocações e level | [`progression.md`](./progression.md) | parcial | E2, E7 | §4.1, §9, §43.1 |
| Stamina | [`stamina.md`](./stamina.md) | implementado | E2, E3 | §10 |
| Treino | [`training.md`](./training.md) | não implementado | E8 | §11 |
| Combate | [`combat.md`](./combat.md) | parcial | E2 | §12 |
| Bot | [`bot.md`](./bot.md) | parcial | E4 | §13, §43.3 |
| Hunt | [`hunt.md`](./hunt.md) | parcial | E3 | §14 |
| Cidade | [`city.md`](./city.md) | parcial | E1 | §6, §37 |
| Chat | [`chat.md`](./chat.md) | parcial | E1 | — |
| Party e matchmaking | [`party.md`](./party.md) | não implementado | E9 | §15, §43.2 |
| Analisador de hunt | [`analyzer.md`](./analyzer.md) | parcial | E6 | §16, §43.10 |
| Bestiário | [`bestiary.md`](./bestiary.md) | não implementado | E7 | §18 |
| Prey | [`prey.md`](./prey.md) | não implementado | E7 | §19, §43.4 |
| Economia, supply e Market | [`economy.md`](./economy.md) | parcial | E5, E13 | §20, §32, §33, §43.5 |
| Itens, equipamento e inventário | [`items.md`](./items.md) | parcial | E5, E7, E11 | §21-§23, §25, §43.6 |
| Morte | [`death.md`](./death.md) | implementado | E2 | §26 |
| Bosses | [`bosses.md`](./bosses.md) | não implementado | E11 | §27, §43.7 |
| Quests | [`quests.md`](./quests.md) | não implementado | E11 | §28 |
| Guildas | [`guilds.md`](./guilds.md) | não implementado | E12 | §29 |
| Guild War | [`guild-war.md`](./guild-war.md) | não implementado | E12 | §30, §43.8 |
| Monetização — Coins e Premium | [`monetization.md`](./monetization.md) | não implementado | E13 | §7.2, §7.3, §33.3, §34, §35 |
