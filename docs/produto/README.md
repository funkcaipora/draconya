# Documentação funcional viva

O PRD (`Draconya_PRD_Consolidado_v0.9.md`) é um **instantâneo**: descreve o que se pretendia em
07/09/2026, com `[ABERTO]` espalhado por toda parte. Esta pasta é o **documento vivo**: o que
existe de fato, hoje, no código. Hoje as duas coisas estão quase idênticas — nada foi implementado
ainda —, e por isso cada arquivo aqui nasce como um esqueleto honesto: reorganiza o que o PRD
especifica por sistema, marca o status como `não implementado`, e já estrutura as duas seções que
vão importar de verdade conforme cada sistema sai do papel — **Parâmetros de balanceamento** (onde
cada número mora em `packages/content`) e **Em aberto** (quais decisões de produto, herdadas do
PRD, ainda faltam fechar).

O PRD não deve ser editado para refletir a implementação — ele é histórico, a foto de um momento.
Toda mudança de comportamento real entra aqui.

## Quando atualizar um arquivo

Sempre que um sistema sair do papel — ou seja, sempre que uma tarefa de algum épico do
`docs/arquitetura-tecnica.md` §17 for implementada e mesclada. Nesse momento (idealmente via skill
`/produto`, descrita em `docs/plano-harness.md` §3.4):

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

| Sistema | Arquivo | Status | Épico | PRD |
|---|---|---|---|---|
| Onboarding e tutorial | [`onboarding.md`](./onboarding.md) | não implementado | E14 | §7.4, §8 |
| Progressão, vocações e level | [`progressao.md`](./progressao.md) | não implementado | E2, E7 | §4.1, §9, §43.1 |
| Stamina | [`stamina.md`](./stamina.md) | não implementado | E2, E3 | §10 |
| Treino | [`treino.md`](./treino.md) | não implementado | E8 | §11 |
| Combate | [`combate.md`](./combate.md) | não implementado | E2 | §12 |
| Bot | [`bot.md`](./bot.md) | não implementado | E4 | §13, §43.3 |
| Hunt | [`hunt.md`](./hunt.md) | não implementado | E3 | §14 |
| Party e matchmaking | [`party.md`](./party.md) | não implementado | E9 | §15, §43.2 |
| Analisador de hunt | [`analisador.md`](./analisador.md) | não implementado | E6 | §16, §43.10 |
| Bestiário | [`bestiario.md`](./bestiario.md) | não implementado | E7 | §18 |
| Prey | [`prey.md`](./prey.md) | não implementado | E7 | §19, §43.4 |
| Economia, supply e Market | [`economia.md`](./economia.md) | não implementado | E5, E13 | §20, §32, §33, §43.5 |
| Itens, equipamento e inventário | [`itens.md`](./itens.md) | não implementado | E5, E7, E11 | §21-§23, §25, §43.6 |
| Morte | [`morte.md`](./morte.md) | não implementado | E2 | §26 |
| Bosses | [`bosses.md`](./bosses.md) | não implementado | E11 | §27, §43.7 |
| Quests | [`quests.md`](./quests.md) | não implementado | E11 | §28 |
| Guildas | [`guildas.md`](./guildas.md) | não implementado | E12 | §29 |
| Guild War | [`guild-war.md`](./guild-war.md) | não implementado | E12 | §30, §43.8 |
| Monetização — Coins e Premium | [`monetizacao.md`](./monetizacao.md) | não implementado | E13 | §7.2, §7.3, §33.3, §34, §35 |
