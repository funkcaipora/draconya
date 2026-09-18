# Party e matchmaking de hunt

**Status:** implementado — M13 (#185–#199, #203; ADR 0027), M15 (#358: kick do líder e nomes na formação). Matchmaking por vocação e faixa de
level (#199) entrou com a faixa desligada (`matchmakingLevelRange: 0`)
**Última atualização:** 2026-09-17
**PRD:** §15, §43.2
**Épico:** E9

## Comportamento

Uma party de hunt é **uma sessão de hunt com N donos** (ADR 0027, decisão 1) — não um shard. Ela
tem extrato, snapshot e repouso como qualquer hunt; cada membro é dono do próprio
`CharacterRuntime` dentro dela, e a sessão é a única escritora dos N (invariante 9). Caça com zero
sockets abertos, como o solo: o membro que nunca abriu o navegador recebe a mesma cota (invariante
3). O caminho solo (`enter-hunt`, opcode 9) não mudou.

### Formação

A formação é do `api`, em Redis, transitória (chaves `party:{id}` com TTL de 30 min; convite com
TTL de 2 min). O fluxo é o do PRD §15.2 — **procurar/criar → reunir → líder propõe → membros
aprovam → iniciar** — sobre HTTP (`POST /api/party`, `/invite`, `/join`, `/leave`, `/kick`, `/propose`,
`/approve`, `/start`, `GET /api/party/mine`). Nenhum opcode novo cliente→servidor: a tela
(`PartyPanel`, dentro da seleção de hunt) só manda intenção e pergunta o estado a cada 2 s.

- Quem cria é o líder. Só o líder convida (por id de personagem), expulsa outros membros (`POST
  /api/party/:id/kick` com `targetId`; #358), propõe `{ huntId, difficulty, mode }` e inicia.
  Expulsar outro membro desaprova a proposta corrente (a composição mudou), nunca admite auto-kick
  (para isso existe `leave`) nem expulsar quem não é membro. Convidado entra por id da party; um
  personagem está em no máximo uma party (`party:by-char:{id}`), e o teto é `maxMembers` (4).
- A visão da party (`PartyMemberView`, #358) inclui o nome do personagem (`name`, além de
  `characterId` e `approved`) resolvido a partir da conta do membro na party.
- **Iniciar exige**: ≥ 2 membros, todos aprovaram a proposta atual (trocar a proposta zera as
  aprovações), hunt e dificuldade existentes, todos na Cidade ou em repouso (invariante 8), e o
  progresso pendente de cada um liquidado. Aí o `api` escolhe **um nó** (o do líder) e emite um
  ticket por membro com o mesmo `sessionId`; se o k-ésimo ticket falhar, os k−1 anteriores são
  revogados. O primeiro ticket a chegar ao `game` cria a sessão com os N; o líder e quem mais
  estiver com o cliente aberto entram pelo ticket que o `api` devolveu, e quem não estiver entra
  quando abrir (`GET /api/party/mine` devolve o ticket pendente).
- **Matchmaking** (#199) forma a party e nada mais: `POST /api/matchmaking/join` põe o personagem
  numa fila (`matchmaking:queue`, TTL de 10 min); o casamento roda no `join`, num script Lua só,
  e escolhe até `maxMembers − 1` companheiros compatíveis **preferindo vocações distintas** — o
  que o bônus de XP premia. Quem casou sai da fila no mesmo passo, o mais antigo lidera, e dali é
  o fluxo de sempre (propor, aprovar, iniciar). Faixa de level: `|level − meu level| ≤
  matchmakingLevelRange`; `0` desliga o filtro, e é o valor de hoje.

### XP (§15.3)

A XP de cada abate vem de um **pool por vocações únicas**, dividido por igual entre os elegíveis
(vivo, stamina > 0, presente na sessão) — ADR 0027, decisão 3:

```
pool  = floor(xp × tabela[vocações únicas entre os elegíveis] / 100)
cota  = floor(pool / elegíveis)          — o resto é descartado
```

A tabela é `{ 1: 125, 2: 150, 3: 175, 4: 200 }` % — 100 + 25 por vocação única, teto 200. Solo
(um elegível) é 100 %, sem tabela. Personagem sem vocação (level < 8) conta como uma vocação
("nenhuma"). O bônus de Bestiário de cada membro se aplica à **cota** dele, na ordem de sempre
(`applyXpBonus` → `grantXp` → `record`), e o abate conta no Bestiário de **todo** elegível
(decisão 4), não só do matador. Level up e marco de Bestiário são eventos notáveis que dizem de
quem (`id/level`, `id/monstro/marco`).

Exemplos com um monstro de 100 XP: quatro vocações distintas → 200 / 4 = **50 cada**; dois
knights → 125 / 2 = **62 cada** (menos que os 100 do solo — decidido e aceito: é o que "repetidas
não somam" significa quando o pool é dividido); knight + druid + um morto → 150 / 2 = 75 cada, o
morto nada.

### Dois modos de loot e custo (§15.4, §15.5)

O modo é proposto pelo líder, **fixado na sessão** (`party.mode` no ticket e no snapshot) e não
muda no meio — ADR 0027, decisão 5.

**`split` (dividido)** — cada um paga o próprio supply, como no solo. Por monstro, **um** membro
elegível é sorteado (uniforme, com o `Rng` da sessão, antes de `rollLoot`) e o loot — gold e
itens — é rolado com a tabela como ele a vê e vai para ele: mochila se couber, Caixa de Loot da
Sessão dele se não. Sem last hit, sem prioridade por dano. O sorteio só existe com ≥ 2
participantes: a sequência do RNG em solo é a de sempre (FUN-63). Item em party tem id
`sessionId:characterId:n` (em solo continua `sessionId:n`).

**`shared` (compartilhado)** —

- *Custo*: cada uso de supply de preço `c` debita `floor(c / n)` de cada membro presente e o resto
  do usuário, **na hora**. Membro sem saldo para a cota paga o que tem e o usuário cobre; se nem
  o usuário cobre, `not-enough-gold` para ele e ninguém é debitado. Cada um recebe `goldSpent`
  pelo que pagou — o extrato já sai equalizado. Anéis e colares são itens e ficam de fora (§15.4).
- *Loot*: ninguém é sorteado; gold e itens caem numa **bolsa da party** (`party-bag`), sem
  modificador individual, com capacidade igual à **soma das capacidades dos presentes** —
  calculada na hora, então cresce com level up e cai quando alguém sai, sem descartar nada. O
  que não cabe vai para a Caixa de Loot do **líder**. `itemsLooted` conta para todos.
- *Settlement*: ao sair alguém (com quem sai incluído) e ao encerrar, a bolsa é vendida e
  dividida entre os presentes: `total = gold + Σ value × quantity`, cotas inteiras cuja soma **é**
  o total (o resto vai um gold por membro, na ordem de entrada). Item com `value: 0` não se
  vende: vai para a mochila do líder, ou para a caixa dele. O evento `party-settlement`
  (`total/presentes`) é notável e chega ao cliente; a bolsa zera.

O líder é quem a party elegeu; se ele saiu, o mais antigo presente (`party-state` avisa).

### Sair, morrer e encerrar (§15.5, §13.9)

Sair e morrer são `leave`, não `end` (decisão 7): quem sai leva o **próprio extrato** — um
`Receipt` por membro, cada um com `seq` próprio, uma linha de ledger cada (invariante 10) — e a
cota do settlement; a sessão continua para os outros. Morte mantém a penalidade de hoje. Saída
pelo cliente é `leave-hunt` (opcode 10), como no solo; o `session-ended` que volta é o extrato de
quem saiu. Depois de uma saída, quem tem a regra `party-member-lost` no bot sai também, em cascata
e na ordem de entrada (`bot.md`). O último a sair encerra a sessão com o motivo dele; se a cascata
levou alguém, o motivo é `exit-rule`. Uma party que ficou com um membro vira, na prática, solo:
morte encerra, loot é do matador sem sorteio.

### O que o cliente vê

`session-state` leva `party` (líder, membros, vivos, vocação, level, manaPercent), `partySpending`
(gasto de cada um e a prévia de rateio) e, no modo compartilhado, `partyBag`; `party-state` leva a
composição dos membros com HP, vocação (`vocationId`), level (`level`) e percentual de mana
(`manaPercent`), reenviado ao vivo sempre que qualquer um desses valores, a composição ou a
liderança mudam (via `sameParty` no host, #339). `party-bag`, `party-settlement` e
`party-spending` chegam a cada mudança (opcodes 24–26 e 29, só servidor→cliente). Durante a hunt
a coluna esquerda mostra os companheiros com HP, num painel fixo (`PartyMembers`, #259); em
`shared`, a bolsa aparece como a janela flutuante "Party loot" (`PartyLootWindow`, #316) sobre o
mundo, aberta por padrão durante a hunt e alternável pelo ▣ do cabeçalho da party; a engrenagem ⚙
do mesmo cabeçalho reabre a formação e as ações da party durante a hunt, no modal "Gerenciar
party" (#320); o analisador é por personagem (`analyzer.md`).

## Regras

- Party é uma sessão de hunt com N participantes; um personagem está em uma sessão só.
- Tamanho máximo: `maxMembers` (4). Início com ≥ 2, todos aprovados, todos na Cidade.
- Formação por HTTP no `api`, em Redis com TTL; matchmaking forma, não inicia.
- Um nó por party; um ticket por membro, mesmo `sessionId`; tudo ou nada na emissão.
- XP: `floor(floor(xp × tabela[únicas] / 100) / elegíveis)`, resto descartado; solo é 100 %.
- Vocação nula conta como uma; Bestiário aplica-se à cota e conta o abate para todo elegível.
- `split`: supply próprio; um destinatário sorteado por monstro, loot com os modificadores dele.
- `shared`: supply rateado `floor(c/n)` na hora, resto e descoberto do usuário; loot na bolsa
  (cap = Σ capacidades), excedente na caixa do líder; venda e divisão a cada saída e no fim.
- `itemSchema.value` é obrigatório; `0` é "não se vende" e vai para o líder.
- Sair e morrer são `leave` com extrato próprio; o último encerra; `party-member-lost` cascateia.
- Modo fixo na sessão; sem opcode cliente→servidor novo (invariante 4).

## Parâmetros de balanceamento

| Parâmetro | Valor atual | Caminho |
|---|---|---|
| Tamanho máximo da party | 4 | `packages/content/data/party/baseline.json`, `maxMembers` (schema aceita 2–8) |
| Pool de XP por vocações únicas (%) | `{1: 125, 2: 150, 3: 175, 4: 200}` | `packages/content/data/party/baseline.json`, `xpPoolPercentByUniqueVocations` — chaves `1..maxMembers`, não decrescente, ≥ 100 |
| Faixa de level do matchmaking | 0 (desligado) | `packages/content/data/party/baseline.json`, `matchmakingLevelRange` |
| Preço de venda de cada item (bolsa) | por item — `bow` 130, `machete` 6, `cheese` 0 | `packages/content/data/items/*.json`, campo `value` (`itemSchema.value`, `packages/content/src/schemas.ts`) |
| TTL da party em formação | 30 min | `packages/server/src/party-store.ts`, `DEFAULT_TTL_MS` |
| TTL do convite | 2 min | `packages/server/src/party-store.ts`, `DEFAULT_INVITE_TTL_MS` |
| TTL na fila de matchmaking | 10 min | `packages/server/src/party-store.ts`, `QUEUE_TTL_MS` |
| Raio de entrada do 2º+ membro | 3 tiles do ponto de entrada | `packages/sim/src/rulesets/hunt.ts`, `ENTRY_RADIUS` |
| Intervalo de polling da tela de party | 2 000 ms | `packages/client/src/shell/PartyPanel.tsx`, `POLL_MS` |

## Em aberto

- ~~[ABERTO] Fórmula numérica final do bônus de XP por vocações únicas (§15.3, §43.2)~~ →
  **Resolvido:** `min(100 + 25 × únicas, 200)` %, dividido por igual, em
  `packages/content/data/party/baseline.json` (ADR 0027, decisão 3).
- ~~[ABERTO] Momento contábil exato da equalização de gastos (§15.4)~~ → **Resolvido:** tempo
  real, a cada uso de supply, em `packages/sim/src/rulesets/hunt.ts` (`#sharedPurse`; ADR 0027,
  decisão 5) — só no modo `shared`.
- `[ABERTO — valor provisório: 0, desligado]` Critérios exatos de matchmaking de hunt por faixa
  de level (§43.2) — o mecanismo existe (#199); a faixa é `matchmakingLevelRange` em
  `packages/content/data/party/baseline.json`.

## Divergências do PRD

- **PRD dizia (§15.3):** o sistema aceita uma tabela por número de membros **e** número de
  vocações únicas.
  **Implementado:** tabela indexada só por vocações únicas; o número de membros entra na
  divisão, não no pool.
  **Motivo:** ADR 0027 — com pool dividido por igual, a segunda dimensão seria coluna repetida.
  Consequência aceita: party de vocações iguais rende menos por cabeça que solo (125 % ÷ 2).

- **PRD dizia (§15.4):** gastos de supply equalizados entre os membros, momento contábil em
  aberto.
  **Implementado:** rateio em tempo real a cada uso (`floor(c/n)` de cada presente, resto do
  usuário), e **só no modo `shared`**; no `split` cada um paga o seu.
  **Motivo:** ADR 0027 — settlement no fim pode deixar um membro negativo e exige tabela de
  transferências para auditar; ratear na hora custa o mesmo e o extrato de cada um já sai
  equalizado. O modo `split` é decisão de produto (`docs/party-hunt-plan.md`): quem não quer
  pagar a poção do outro tem onde ficar.

- **PRD dizia (§15.5):** mesma chance base para todos, sorteio de loot individual por personagem,
  cada um com os próprios modificadores (Prey, Bestiário).
  **Implementado:** em `split`, **um** destinatário sorteado por monstro, e o loot é rolado uma
  vez, com a tabela como ele a vê; em `shared`, loot na bolsa sem modificador individual.
  Bestiário não modifica loot (só XP); Prey ainda não existe, e o gancho (`#lootTableFor`) entra
  depois do sorteio do destinatário.
  **Motivo:** ADR 0027 — rolar N vezes por monstro multiplica o loot por N; "sem last hit e sem
  prioridade por dano" está preservado no sorteio uniforme.

- **PRD dizia (§22.1):** autovenda limitada a 5 tipos de item (free) ou 20 (premium).
  **Implementado:** a venda da bolsa no settlement vende **tudo** que tem `value > 0`, sem limite
  de tipos; a autovenda do §22.1 continua não implementada.
  **Motivo:** ADR 0027 — a bolsa não é autovenda do jogador, é a liquidação de um bem comum; o
  limite de tipos é regra do que o jogador configura, e aqui ninguém configura nada. O campo
  `value` é o mesmo que a autovenda vai usar.

## Referências

PRD §15, §22.1, §43.2; ADR 0027 (decisões 1–9), ADR 0023 (sessão com muitos personagens),
ADR 0024 (repouso); `docs/party-hunt-plan.md` (desenho e exemplos numéricos);
`packages/sim/src/party.ts`, `packages/sim/src/rulesets/hunt.ts`, `packages/sim/src/session.ts`
(`leave`, `Receipt`), `packages/content/data/party/baseline.json`,
`packages/server/src/api/party.ts`, `packages/server/src/party-store.ts`,
`packages/server/src/receipts.ts`, `packages/protocol/src/messages.ts` (24–26),
`packages/client/src/party/`, `packages/client/src/shell/{PartyPanel,PartyMembers,PartyBag}.tsx`;
`bot.md` (§13.9), `analyzer.md`, `economy.md`, `bestiary.md`.
