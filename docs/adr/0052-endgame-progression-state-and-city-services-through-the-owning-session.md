# 0052 — Estado de progressão do endgame e serviços de Cidade passam pela sessão dona e pelo extrato

**Status:** proposto — decorre do [ADR 0037](0037-tfs-canary-fidelity-except-action-bar-and-automation.md)
decisão 1 (o Tibia é a regra) e do [ADR 0024](0024-hot-state-and-hosted-session-are-not-the-same-thing.md)
(a fronteira é "quente", não "sessão"); generaliza o caminho que [ADR 0048](0048-corpse-loot-and-per-character-quick-loot-filter.md)
d.8 abriu para vender e descartar; é o ADR-mãe de [0053](0053-bestiary-xp-line-kept-and-charms-added.md)
a [0059](0059-training-session-and-offline-training-bank.md)
**Data:** 2026-09-27
**Contexto técnico:** `packages/server` (`tickets.ts`, `receipts.ts`, `jobs/ledger.ts`,
`db/schema.ts`), `packages/sim` (`rulesets/city.ts`, `rulesets/hunt.ts`, `CharacterRuntime`),
`packages/protocol` (intenções novas), `packages/content` (perfil de combate)
**Issues:** M38–M44 inteiros (#598–#632, #643); plano em `docs/endgame-plan.md`

## Contexto

Sete milestones (M38–M44) trazem os sistemas de progressão do Tibia 13.x que ainda não existem
aqui: Charms, Imbuements, Wheel of Destiny, Prey, Task Hunting, Concoctions, Forja da Exaltação,
Loyalty, Bosstiary, aprender magia, treino. Todos têm em comum três coisas que o Draconya ainda
não tinha decidido de uma vez:

1. **Estado durável novo por personagem** — pontos de Charm gastos e runas atribuídas, slots de
   Prey, tarefas em andamento, alocação da Roda, dust e histórico da Forja, magias aprendidas,
   banco de treino offline, nível de hazard. Hoje o único padrão parecido é `characters.bestiary`
   / `skills` / `supplyStock`: `jsonb` lido inteiro na emissão do ticket, escrito inteiro pela
   transação do ledger a partir do extrato, e o `game` nunca toca a linha.
2. **Ações que no Tibia são diálogo com NPC ou uso de objeto na cidade** — o Santuário de
   Imbuement, a Forja, a compra de Charm, a compra de magia, o reroll de Prey. As issues do
   inventário de 2026-09-25 escreveram "acontecem na Cidade pela `api`, e o gold passa pelo
   ledger". Isso conflita com o invariante 9: gold, inventário (inclusive o overlay do ADR 0046) e
   a alocação que o combate lê são **estado quente** do `CharacterRuntime` enquanto o personagem
   está numa sessão hospedada — e a Cidade é uma (ADR 0023). Um endpoint `api` escrevendo a linha
   do Postgres enquanto a sessão de Cidade segura o `CharacterRuntime` é exatamente o segundo
   escritor que o invariante 9 proíbe.
3. **Rolagem aleatória e tempo de parede.** Imbuir tem chance de falha; forjar tem chance de
   sucesso; a Prey dura 2 h "online"; o reroll grátis volta a cada 20 h. O `sim` é puro
   (invariante 1) e o RNG da hunt é contrato de conformance (ADR 0031): um sorteio novo dentro da
   hunt muda a ordem de todos os seguintes.

Sem uma decisão única, cada uma das 36 issues escolheria o próprio caminho, e os sete sistemas
chegariam com sete formas de persistir, sete lugares para debitar gold e sete relógios.

## Decisão

1. **Todo estado de progressão do endgame é um registro `jsonb` por sistema na linha do
   personagem**, no padrão de `bestiary`: `charms`, `prey`, `taskHunting`, `wheel`, `forge`,
   `learnedSpells`, `training`, `hazard`, `bosstiary` (um por ADR filho, nomes fixados neles). O
   registro é lido **inteiro** na emissão do ticket, viaja no `CharacterRuntime` da sessão dona,
   sai **inteiro** no extrato e é escrito pela transação do ledger em `jobs` — última escrita
   vence, escopada por personagem, na mesma transação da linha `(session_id, seq)`. O `game`
   nunca escreve a linha (invariante 9); a `api` só escreve quando o personagem está em repouso
   (sem sessão), e só o que se calcula fora de sessão (decisão 5). Cada registro carrega
   `version` interna, como `botConfig`, para migrar sem coluna nova (ADR 0014).

2. **Serviço de Cidade é intenção C2S tratada pela sessão de Cidade, nunca endpoint `api`.**
   Desbloquear ou atribuir Charm, imbuir, forjar, alocar a Roda, aprender magia, gerir Prey e
   Task Hunting, ativar Concoction, escolher a skill de treino offline — cada um é um opcode em
   `protocol/` (invariante 5), validado pelo ruleset de Cidade como **ação de evento sem laço**
   (o mesmo espírito do ADR 0044 d.2 para conjuração na Cidade). O efeito fica no
   `CharacterRuntime`; a Cidade continua sem simular nada (invariante 8). O cliente manda a
   intenção e recebe o resultado, nunca o resultado (invariante 4).

3. **Gold, item e overlay usam os canais de extrato que já existem.** Gold: `goldDelta` +
   `session.credit(...)`, que vira a linha do ledger (invariante 10; retry não duplica porque a
   chave `(session_id, seq)` recusa). Material consumido: `removedInstances` (ADR 0048 d.8).
   Item criado (core da Forja, exercise weapon comprada): `acquired`. Imbuement e tier: `overlays`
   (ADR 0046). **Nenhum canal novo de valor** — o que este ADR acrescenta ao extrato são só os
   registros da decisão 1.

4. **Rolagem de serviço usa o `session.rng` da Cidade, e nenhum serviço com rolagem roda na
   hunt.** A Cidade não tem contrato de conformance, então o sorteio de imbuir e de forjar não
   perturba nada; a hunt mantém a ordem de RNG intacta. É também o que o Tibia faz: santuário e
   forja ficam em zona de proteção. Um serviço **sem** rolagem que o Tibia permite fora de PZ
   (aprender magia, ver o Cyclopedia) pode ser aceito também na hunt, desde que não toque o RNG.

5. **Entradas calculadas fora de sessão viajam no ticket e ficam fixadas na sessão**, como a
   versão de conteúdo (invariante 7): bônus de Loyalty (idade da conta), criatura boosted do dia,
   nível de hazard escolhido na entrada, Premium, e o resultado do treino offline. O `sim` nunca
   lê relógio de parede nem conta (invariante 1); quem calcula é a `api` na emissão do ticket, com
   o personagem em repouso — o único momento em que a linha não tem dono quente.

6. **Dois relógios, nomeados.** Duração "online" do Tibia (Prey 2 h, Concoction 1 h, decaimento
   de imbuement, banco de treino offline) é consumida por **tempo de sessão de hunt** — evento
   agendado na fila, nunca por tick nem por haver visualizador (invariantes 2 e 3); a Cidade
   equivale a offline (ADR 0043 d.2). Cooldown de parede (reroll grátis 20 h, Concoction 24 h,
   familiar 30 min entre lançamentos fora de hunt) é um **carimbo** persistido no registro e
   comparado na hora da intenção com o `nowMs` que o servidor passa como dado — o `sim` recebe o
   instante, não o relógio.

7. **Um perfil de combate para o endgame inteiro, `combat-v4`.** Charms (#603), imbuements
   (#606), Roda (#609), procs de tier (#617), sorteio de stack de Forja no spawn (#616), bônus de
   Prey (#612) e Hazard (#632) mudam resultado ou ordem de RNG e exigem perfil `breaking` (ADR
   0031, ADR 0040 d.3). Enquanto a `tibia-parity` for a branch de integração, todos emendam o
   mesmo `combat-v4` — um estágio declarado por issue, na ordem do Canary, documentado em
   `docs/product/combat-conformance.md`. O perfil congela no merge na `main` (ADR 0040 d.3).

## Alternativas

- **Endpoints `api` para os serviços de Cidade** (o que as issues de 2026-09-25 escreveram).
  Descartada pelo invariante 9: o personagem na Cidade está numa sessão hospedada com gold,
  inventário e alocação quentes; um segundo escritor exigiria lock e reconciliação que o
  invariante existe para não precisar.
- **Motor de diálogo de NPC.** Descartada (ADR 0042, questão 2): tela de serviço é o padrão já
  recomendado para promoção e bênçãos, e nenhum dos sete sistemas ganha mecânica com diálogo.
- **Uma tabela relacional por sistema** (`character_charm`, `character_prey_slot`…). Descartada
  pela mesma razão de `bestiary`: o dado é lido inteiro e escrito inteiro, uma vez por sessão;
  tabela só paga quando alguém consulta por linha, e ninguém consulta.
- **Rolar imbuement e forja na hunt, onde o jogador está a maior parte do tempo.** Descartada:
  inseriria sorteios no fluxo de RNG da hunt (ADR 0031) por uma conveniência que o Tibia também
  não dá — santuário e forja são de cidade.
- **Um perfil de combate por milestone (v4, v5, v6…).** Descartada: são sete milestones na mesma
  branch de integração; ADR 0040 d.3 permite emendar o perfil vivo, e sete perfis congelados em
  sequência seriam código morto no dia do merge.
- **Escrever o extrato da Cidade a cada compra** (em vez de só no `release`). Não adotada agora:
  o `api` liquida pendências antes de qualquer ticket (ADR 0028 d.5), então nada se perde entre a
  compra e a próxima hunt. Registrada como opção se a perda de uma compra por queda de nó (gold e
  efeito somem juntos, atomicamente) vier a incomodar.

## Consequências

- As 36 issues de M38–M44 ganham um caminho único: intenção → ruleset → `CharacterRuntime` →
  extrato → ledger. Os ADRs 0053–0059 só dizem **o que** cada sistema guarda e faz; **como**
  persiste e cobra é daqui.
- `receipts.ts` ganha um campo por registro (decisão 1); `tickets.ts` o lê; `jobs/ledger.ts` o
  escreve. Migração aditiva por coluna `jsonb` nulável, ausente = "personagem novo".
- Uma compra na Cidade fica durável no `release` do personagem (#154), não no clique. Como o
  `api` liquida antes de emitir ticket, o personagem nunca entra numa hunt sem o que comprou; se
  o nó cair antes, compra e débito somem juntos — nunca um sem o outro.
- O cliente nunca vê endpoint HTTP para serviço de jogo: tudo é WebSocket, como o resto do
  jogo. As telas (Cyclopedia, santuário, forja, roda) montam-se sobre `session-state` e
  respostas de intenção.
- O que piora: a Cidade passa a ter RNG com efeito de valor (decisão 4). Não é conformance, mas
  o teste do ruleset de Cidade precisa passar a fixar semente como o da hunt já faz.

## Invariantes afetados

Nenhum muda de texto. O **9** é a razão da decisão 2 (sessão dona, não `api`); o **10** é a
decisão 3 (tudo pelo ledger, `(session_id, seq)`); o **7** é estendido em espírito pela decisão 5
(boosted, loyalty e hazard fixados como a versão de conteúdo); o **1** é a razão da decisão 6 (o
`sim` recebe instantes, não lê relógio); o **8** é a razão de a Cidade tratar tudo como evento.
