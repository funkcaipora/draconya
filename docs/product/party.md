# Party e matchmaking de hunt

**Status:** não implementado
**PRD:** §15, §43.2
**Épico:** E9

## Comportamento

Uma party de hunt admite no máximo 4 jogadores. O matchmaking forma a party, mas não escolhe nem inicia a hunt automaticamente: jogadores procuram outros interessados, o matchmaking reúne quem é compatível, o líder escolhe a hunt, os participantes aprovam, e só então a party inicia. Uma party pode começar com menos de 4 jogadores se todos os membros atuais aprovarem iniciar naquela composição.

A composição de vocações afeta o XP do grupo: vocações repetidas não geram bônus adicional, mas cada vocação única a mais aumenta o bônus coletivo. A XP é calculada a partir de um pool coletivo e dividida entre os membros. A regra qualitativa está decidida; o multiplicador exato por número de membros e número de vocações únicas ainda não foi fechado, e o sistema técnico precisa aceitar essa tabela como configuração.

Os gastos de supplies abstratos (poções, runas, munições pagas em gold) são equalizados entre os membros da party: se dois jogadores consomem 50k e 100k de supply, o custo total de 150k deve ser repartido igualmente, resultando em 75k efetivos para cada um. Anéis e colares consumíveis ficam de fora dessa equalização — cada jogador arca com os próprios.

No loot, não existe prioridade por last hit nem por maior dano: todo membro parte da mesma chance base, cada jogador aplica seus próprios modificadores individuais (Prey, Bestiário), e o sorteio é individual por personagem. Se um membro sair ou morrer, os demais podem continuar normalmente na instância — cada personagem decide previamente, via bot, se quer sair automaticamente nessas situações (ver `bot.md`, §13.9).

## Regras

- Tamanho máximo de party de hunt: 4.
- Matchmaking forma o grupo; não escolhe nem inicia a hunt.
- Fluxo de início: buscar → reunir → líder escolhe hunt → membros aprovam → iniciar.
- Party pode iniciar com menos de 4 membros, mediante aprovação unânime dos presentes.
- Vocações repetidas não somam bônus adicional; cada vocação única a mais aumenta o bônus coletivo de XP.
- XP calculada a partir de pool coletivo, dividida entre os membros.
- Gastos de supply são equalizados igualmente entre os membros da party.
- Anéis e colares consumíveis não entram na equalização de gastos.
- Loot: mesma chance base para todos, sem prioridade por last hit ou dano; sorteio individual por personagem, com modificadores individuais aplicados (Prey, Bestiário).
- Saída ou morte de um membro não interrompe os demais; cada personagem decide previamente sua própria regra de saída.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Tamanho máximo de party (hunt) | 4 | caminho previsto: `packages/content/party` |
| Fórmula de bônus de XP por vocação única | `[ABERTO]` — tabela por (nº de membros, nº de vocações únicas) | caminho previsto: `packages/content/party` |
| Exemplo de equalização de gastos | 50k + 100k = 150k → 75k por membro (ilustrativo) | caminho previsto: `packages/content/party` |

## Em aberto

- Fórmula numérica final do bônus de XP por vocações únicas — a regra qualitativa está decidida, mas o multiplicador exato ainda não; a conversa teve exemplos numéricos conflitantes (§15.3, §43.2). Bloqueia a tarefa de bônus de XP por vocação do E9 (`docs/technical-architecture.md` §20).
- Momento contábil exato da equalização de gastos — tempo real ou settlement periódico/final, desde que o resultado econômico seja idêntico e auditável (§15.4).
- Critérios exatos de matchmaking de hunt por faixa de level (§43.2).

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
