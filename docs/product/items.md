# Itens, equipamento e inventário

**Status:** parcial — catálogo em conteúdo e `item_instance` com identidade própria (FUN-76);
inventário, equipamento, loot de item e Caixa de Loot ainda não existem
**PRD:** §21, §22, §23, §25, §43.6
**Épico:** E5 (inventário, autovenda, Caixa de Loot); E7 (imbuement, durabilidade de anéis/colares); E11 (proveniência de lendário)

## Comportamento

Equipamentos completos só são obtidos por drop de monstro ou por recompensa/drop de boss — não existe craft de equipamento completo no MVP. Cada item tem atributos base fixos, sem rolagem aleatória: um item melhor é um item diferente, não uma versão evoluída infinitamente do mesmo item. Os requisitos de uso seguem o paradigma do Tibia — level e vocação —, sem exigir atributos adicionais como força ou inteligência. Os atributos base ficam enxutos de propósito; efeitos mais avançados entram via imbuement e sistemas paralelos.

A maioria dos equipamentos não tem durabilidade. As exceções são anéis, consumíveis por tempo, e colares, consumíveis por carga (um colar defensivo com N cargas consome uma carga cada vez que a condição de uso ocorre). Ao esgotar, o item é destruído permanentemente. Se houver mais unidades do mesmo item na mochila/stack, o sistema repõe automaticamente o item consumido; quando a pilha acabar, não há mais reposição.

O inventário segue o paradigma de capacidade do Tibia, com stack máximo de 100 por item, e não existem itens físicos largados no chão do mundo. Quando um item é obtido e o personagem não tem espaço ou capacidade para ele, o item vai para a Caixa de Loot da Sessão — consultável e resgatável assim que houver espaço, disponível por 30 minutos após o encerramento da sessão, expirando depois disso.

O jogador pode configurar tipos de item para autovenda: ao dropar, o item é vendido automaticamente e o gold é creditado direto, sem passar pela mochila. O limite é 5 tipos configuráveis para contas Free e 20 para Premium. Itens que caem sem estar configurados para autovenda tentam entrar no inventário normalmente e, faltando espaço, seguem para a Caixa de Loot da Sessão.

O sistema de imbuement usa o Tibia como referência funcional: slots fixos por tipo de equipamento, efeito temporário com duração de 24 horas de tempo efetivo de hunt (o relógio não corre fora de hunt), aplicação exigindo materiais e uma taxa em gold, com suporte a múltiplos tiers de efeito. Os materiais devem cair de monstros de diferentes faixas de level, com o objetivo de que personagens de level baixo produzam materiais relevantes para personagens avançados — mantendo demanda por conteúdo antigo e girando o mercado.

Itens lendários vêm de monstros ou de recompensa individual de boss, nunca são craftados, nunca ficam soulbound, continuam negociáveis mesmo depois de usados/equipados e não têm limite semanal de negociação. Todo lendário precisa registrar permanentemente, desde o MVP, quem o obteve originalmente, data, horário e a origem relevante (monstro/boss) — esse histórico sustenta o marketplace de dinheiro real da Fase 2 (`monetization.md`, §35) e o valor histórico do item.

## Regras

- Equipamentos vêm só de drop de monstro/boss; sem craft de equipamento completo.
- Atributos base fixos; sem random roll.
- Requisitos de uso: level e vocação, sem força/inteligência.
- Equipamentos comuns não têm durabilidade.
- Anéis: consumíveis por tempo. Colares: consumíveis por carga.
- Item esgotado é destruído permanentemente.
- Reposição automática a partir da mesma pilha, enquanto houver unidades disponíveis.
- Stack máximo por item: 100.
- Sem itens físicos no chão.
- Item sem espaço/capacidade vai para a Caixa de Loot da Sessão.
- Caixa de Loot da Sessão expira 30 minutos após o fim da sessão.
- Autovenda: até 5 tipos configuráveis (Free) ou 20 (Premium); fluxo drop → venda automática → gold, sem passar pela mochila.
- Imbuement: slots fixos por tipo de item; duração de 24h de tempo efetivo de hunt; relógio parado fora de hunt; exige materiais + taxa em gold.
- Lendários: nunca soulbound, sempre negociáveis, sem limite semanal de negociação; proveniência (personagem original, data, horário, origem) registrada permanentemente desde o drop.

## O que já existe (FUN-76)

Duas metades, e a divisão entre elas é o ponto: **a definição é conteúdo, a instância é banco.**

`packages/content/data/items/*.json` traz a definição — id, `appearanceId`, tipo, slot, peso,
atributos, requisitos, se empilha. `appearanceId` é a **única** ligação com arte (invariante 6,
ADR 0008), e o teste que varre os arquivos de dados atrás de caminho de imagem cobre esta pasta
como cobre as outras.

**Atributos base são fixos** (§21.2): duas espadas do mesmo id são idênticas. Não há rolagem por
instância, e item melhor é item **diferente**. O que distingue uma instância da outra é
identidade e proveniência, não número.

A tabela `item_instance` guarda **este** item: id próprio, o id do catálogo, o dono, a quantidade
(para empilhável), a **origem** e quando nasceu. A `docs/technical-architecture.md` §9 explica por
que ela nasce assim e não como contador: *sem identidade, lendário não tem proveniência*. Um
inventário guardado como `{itemId: n}` é barato até o dia em que alguém pergunta de onde veio
aquela espada — e nesse dia a resposta não existe para item nenhum, retroativamente. Por isso a
coluna `origin` existe **antes** de existir lendário.

Não há chave estrangeira de `item_id` para tabela nenhuma: o catálogo é conteúdo, e espelhá-lo no
banco criaria dois lugares para a mesma verdade, divergindo no primeiro deploy em que só um dos
dois subisse.

`loot.items` do monstro deixou de ser recusado por princípio e passou a ser **conferido**: um
`itemId` que existe no catálogo é aceito; um fantasma derruba o boot, como antes.

**Nada disto dá item a ninguém ainda.** Loot de item por abate, inventário e Caixa de Loot são as
issues seguintes do marco, e é por isso que a regra de bot `item` continua recusada — agora com o
motivo certo: não falta catálogo, falta inventário.

`charges` e `durationMs` estão declarados no schema e **ninguém os consome** (§21.3). A forma
entra agora para o catálogo não mudar quando a mecânica existir.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Stack máximo por item | 100 | caminho previsto: `packages/content/items` |
| Expiração da Caixa de Loot da Sessão | 30 minutos após o fim da sessão | caminho previsto: `packages/content/items` |
| Autovenda — tipos configuráveis (Free) | 5 | caminho previsto: `packages/content/economia` (premium) |
| Autovenda — tipos configuráveis (Premium) | 20 | caminho previsto: `packages/content/economia` (premium) |
| Duração de imbuement | 24h de tempo efetivo de hunt | caminho previsto: `packages/content/imbuement` |
| Catálogo de efeitos/materiais/valores/compatibilidade de imbuement | `[ABERTO]` | caminho previsto: `packages/content/imbuement` |

## Em aberto

- Catálogo de imbuement — efeitos, materiais, valores e compatibilidade exata por slot/equipamento (§23.4, §43.6). Bloqueia o épico E7 (`docs/technical-architecture.md` §20).

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
