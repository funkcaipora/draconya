# Party de hunt — plano de implementação (E9, F3)

**Status:** aprovado em 2026-09-15 — as decisões estão no ADR 0027; este documento é o desenho com os
exemplos, e as issues do milestone M13 apontam para cá.
**PRD:** §15 (party e matchmaking), §16 (analisador), §21.6 (caixa de loot), §22.1 (autovenda), §43.2
**Substitui:** os `[ABERTO]` do §15.3 (fórmula de XP) e do §15.4 (momento contábil) e diverge do §15.5
(sorteio de loot) — ver §7 deste documento.

---

## 1. As três regras, como foram ditas

1. **Cada jogador recebe um % da XP total do monstro.**
2. **Cada vocação diferente na party dá +25 % de XP, no máximo +100 %.** Quatro jogadores, um de cada
   vocação: o monstro rende 200 % da XP; dividido por quatro, cada um ganha 50 % da XP do monstro.
3. **Loot e custos têm dois modos**, escolhidos pela party:
   - **Dividido** — cada um paga o próprio supply; o loot é sorteado para um membro.
   - **Compartilhado** — o custo é rateado; o loot vai todo para uma **bolsa da party** (do líder), cuja
     capacidade é a soma das capacidades dos membros; no fim é vendido e dividido automaticamente.

O resto deste documento é o que essas três frases obrigam, em código real, e onde elas deixam
buraco que alguém precisa decidir (§8).

---

## 2. O que já existe e o que a party muda

| Hoje (solo) | Onde | O que a party exige |
|---|---|---|
| Uma hunt = uma `Session` com **um** participante; `shared` só na Cidade (ADR 0023) | `packages/sim/src/session.ts`, `rulesets/hunt.ts` | uma `Session` de hunt com **N** participantes, **com** extrato e snapshot (a Cidade não tem nenhum dos dois) |
| Agregados são **da sessão** (`session.aggregates`): XP, gold, kills, supplies | `session.ts:274` | agregados **por participante**; os da sessão viram a soma (para o analisador da party) |
| `Session.end()` devolve **um** `Receipt` | `session.ts:517` | um extrato **por membro**, cada um com `seq` próprio |
| Extrato no Redis em `receipt:${sessionId}` | `packages/server/src/receipts.ts:131` | `receipt:${sessionId}:${characterId}` — quatro extratos da mesma sessão não podem se sobrescrever |
| Ledger `UNIQUE (session_id, seq)` | `db/schema.ts:191` | mantido: cada extrato da sessão consome um `seq` (`ledgerSeq++` por extrato, na ordem de entrada) |
| XP e loot vão para `credit.lastHitBy` | `hunt.ts` `#onMonsterDied` | XP para o **pool** e dividida; loot pelo modo da party |
| `#useSupply` debita `goldDelta` de quem usou | `hunt.ts:1471` | modo compartilhado rateia em tempo real (§4.2) |
| `Session.leave` só existe em shard; morte **encerra** a sessão | `session.ts:379`, `resolveDeath` | na party, sair e morrer são `leave` com extrato próprio; a sessão continua para os outros |
| `party-member-lost` é regra de saída **inerte** | `content/src/schemas.ts:896`, `docs/product/bot.md` | passa a disparar |
| Item **não tem valor de venda** no conteúdo | `itemSchema` | `value` (preço de venda ao NPC) — é o mesmo campo que a autovenda (§22.1, E5) precisa |
| Caixa de loot por personagem (`lootBox`, 30 min) | `host.ts` `#saveLootBox` | o excedente da bolsa da party cai na caixa do líder |
| Cliente entra na hunt por `enter-hunt { huntId, difficulty }` | `HuntMenu.tsx`, opcode 9 | a party escolhe hunt, dificuldade **e modo**; os membros aprovam; o início cria uma sessão para todos |

**A peça estrutural é uma só:** agregados e extrato por participante. Sem ela nada do resto fecha —
e ela é refatoração do que existe, não feature. Vai primeiro (issue 2 do §9).

---

## 3. XP

### 3.1 Fórmula

```
únicas    = |{ vocação de cada membro ELEGÍVEL }|          (null conta como uma vocação — ver §8.3)
pool%     = min(100 + 25 × únicas, 200)                      (só com ≥ 2 membros elegíveis; solo = 100)
pool      = floor(xpDoMonstro × pool% / 100)
cota      = floor(pool / elegíveis)
XP(membro) = membro.bestiary.applyXpBonus(cota)              (bônus individual, como hoje — DT-04 mantido)
```

**Elegível** = está na sessão, vivo, stamina > 0. É a condição que hoje decide se o matador recebe
(`killer.alive && !isExhausted(killer)`), aplicada a cada membro em vez de a um.

O resto (`pool − cota × elegíveis`, no máximo `elegíveis − 1` pontos) é **descartado**. Dar ao último
golpe seria prioridade por last hit, que o §15.5 proíbe para loot e não faz sentido reintroduzir na XP.

### 3.2 Tabela (conteúdo, não código)

`packages/content/data/party/baseline.json` (a criar):

```json
{
  "id": "baseline",
  "maxMembers": 4,
  "xpPoolPercentByUniqueVocations": { "1": 125, "2": 150, "3": 175, "4": 200 },
  "matchmakingLevelRange": 0,
  "_open": "§15.3: a fórmula é 25 % por vocação única, teto 100 %; a tabela existe para o PRD (aceitar tabela por composição) e para balancear sem mexer no sim. matchmakingLevelRange é §43.2, ainda aberto — 0 desliga o filtro."
}
```

O `sim` lê a tabela; a fórmula do §3.1 é como ela foi preenchida. O PRD pedia "tabela por número de
membros e de vocações únicas" — o número de membros **não entra no pool**, só na divisão, então a
tabela é por vocações únicas apenas (divergência registrada, §7).

### 3.3 Exemplos

| Party | únicas | pool% | pool (monstro de 100 XP) | por membro |
|---|---|---|---|---|
| solo | — | 100 | 100 | 100 |
| knight + knight | 1 | 125 | 125 | 62 |
| knight + druid | 2 | 150 | 150 | 75 |
| knight + druid + sorcerer | 3 | 175 | 175 | 58 |
| knight + druid + sorcerer + paladin | 4 | 200 | 200 | 50 |
| 4 únicas, um morto | 3 (o morto não conta) | 175 | 175 | 58 para os três vivos |

A linha "knight + knight" é a que mais merece olhar (§8.1): dois iguais rendem **menos por cabeça**
do que cada um sozinho — 62 contra 100. É o que "vocações repetidas não geram bônus" implica quando o
pool é dividido, e é uma escolha de design, não de código.

### 3.4 Bestiário

O abate conta **para cada membro elegível** (não só para o matador): a party é o jeito previsto de
jogar e o Bestiário é progressão por monstro, não por golpe. Consequência: uma party de quatro fecha
marcos quatro vezes mais rápido que um solo com a mesma quantidade de ratos mortos — o que é o
esperado de "quatro pessoas matando". O bônus de XP de cada um continua individual (`applyXpBonus`
na cota, antes do `record`, a ordem de hoje).

### 3.5 Ordem, que é contrato

Por monstro morto, na ordem: **(1)** elegíveis e vocações únicas, **(2)** pool e cota, **(3)** para
cada membro elegível **na ordem de entrada na sessão**: `applyXpBonus` → `grantXp` → `record` no
Bestiário → `experience-gain` no fio. A ordem de entrada é a do vetor `session.participants`, que o
snapshot preserva. Nada aqui consome RNG.

---

## 4. Loot e custo — os dois modos

O modo é **da sessão**, escolhido pelo líder antes de propor a hunt e aprovado junto com ela; **não muda
no meio** (é o mesmo espírito do invariante 7: uma sessão auditável tem regras fixas). Vive em
`HuntSessionOptions.party.mode` e no snapshot.

### 4.1 Modo `split` (dividido)

**Custo:** cada membro paga o que usa. É o código de hoje, sem mudança.

**Loot:** por monstro morto, **um membro elegível é sorteado** (uniforme) e o loot é rolado **com os
modificadores dele** (Prey e Bestiário, quando existirem — hoje não há modificador de loot; o gancho
fica no lugar certo). O item vai para a mochila dele; o que não cabe, para a caixa de loot **dele**.

Ordem dos sorteios (FUN-63: a sequência do RNG é contrato e os testes prendem loot exato):

```
solo (1 participante): rollLoot(gold) → rollLoot(itens)           — IDÊNTICO a hoje, nenhum sorteio novo
party (≥ 2):           pickRecipient() → rollLoot(gold) → rollLoot(itens)
```

O sorteio do destinatário vem **antes** do loot porque os modificadores são do destinatário. Em solo
ele **não acontece** — se acontecesse, toda sequência de loot de toda hunt existente mudaria.

**Gold do monstro:** segue o mesmo sorteado. É "loot", não "XP" — e o §15.5 trata loot como um todo.

### 4.2 Modo `shared` (compartilhado)

**Custo — rateado em tempo real, dentro da sessão.** Cada uso de supply de preço `c` por qualquer
membro debita `floor(c / n)` de **cada** membro presente, e o resto (`c mod n`) vai para o próprio
usuário. Se um membro não tem saldo para a cota dele, **o usuário cobre a diferença**; se nem o usuário
consegue, é `not-enough-gold` para o usuário, como hoje.

Por que em tempo real e não settlement no fim (o §15.4 deixava aberto):

- os quatro `CharacterRuntime` estão **na mesma sessão** — a sessão é dona do estado quente de todos
  (invariante 9), então debitar de quatro é tão barato quanto de um;
- ninguém termina a hunt com saldo negativo — o settlement no fim poderia empurrar um membro abaixo de
  zero, e "saldo nunca negativo" é garantia de ordem, não de correção depois;
- `goldSpent` de cada extrato já sai **equalizado**, e o ledger fica auditável linha a linha sem uma
  segunda tabela de transferências.

O `out-of-gold` de saída continua **por membro**: quem zerou sai, os outros passam a ratear por `n − 1`.

**Loot — a bolsa da party.** Todo item cai numa `PartyBag` da sessão (estado do ruleset, no snapshot):
`{ items: CarriedItem[], capacity: Σ capacidade dos membros presentes }`. Gold do monstro vai direto
para a bolsa também (como `gold` acumulado, sem virar item). O peso é conferido contra `capacity`
como na mochila; o que não cabe vai para a **caixa de loot do líder** (§21.6), com o mesmo prazo de
30 min. Quando um membro sai, `capacity` diminui — a bolsa pode ficar acima do teto; não se descarta
nada, só para de aceitar até vender.

Sem sorteio de destinatário aqui: a ordem do RNG é `rollLoot(gold) → rollLoot(itens)`, igual a solo.
Os modificadores individuais de loot **não se aplicam** no modo compartilhado (não há "de quem" é o
item) — divergência do §15.5 registrada em §7.

**Settlement — venda e divisão.** Acontece em **dois** momentos, e é o mesmo código:

1. quando um membro **sai** (saída, morte, regra de saída, logout com encerramento);
2. quando a sessão **encerra**.

O que ele faz: `total = bag.gold + Σ value(item) × quantity` (valor de venda ao NPC, `itemSchema.value`
— a criar), `cota = floor(total / presentes)`, cada presente (o que está saindo inclusive) recebe
`cota` em `goldDelta`, e o resto (`total mod presentes`) vai **um gold para cada um dos primeiros
membros na ordem de entrada** até acabar. A bolsa zera. Fica registrado em `notableEvents` como
`party-settlement <total>/<presentes>` — é a linha que o analisador e a auditoria leem.

Item **sem `value`** (ou `value: 0`) não vira gold: vai para a mochila do líder no settlement, e o
que não couber, para a caixa dele. É o único caminho em que item de bolsa vira `acquired` de alguém.

Vender no settlement e não no fim da sessão inteira resolve o caso que mais dói: o membro que sai
depois de duas horas leva a parte dele do que caiu **enquanto ele estava** — e quem entra numa bolsa
já cheia não leva o que caiu antes dele, porque a bolsa foi zerada na última saída... só que
**ninguém entra** numa hunt em curso (a party fecha antes de iniciar, §5), então isso nunca acontece.

---

## 5. Formação, início e vida da party

### 5.1 Onde a party vive antes da hunt

Party é **transitória**: existe entre "criar" e "iniciar a hunt" ou "desfazer". Não é linha de
Postgres — é Redis, no `api` (stateless), com TTL:

```
party:{partyId}        hash  { leaderId, mode, huntId?, difficulty?, createdAt }
party:{partyId}:members set  characterIds
party:{partyId}:approved set  characterIds que aprovaram a proposta atual
party:by-char:{characterId}  → partyId          (um personagem está em NO MÁXIMO uma party)
```

Endpoints (`api`, HTTP — o personagem está na Cidade, e a Cidade é inerte; nada disto passa pela
sessão):

| Rota | Quem | Efeito |
|---|---|---|
| `POST /api/party` | qualquer um na Cidade | cria; quem criou é líder |
| `POST /api/party/:id/invite { characterId }` | líder | convite pendente (TTL curto) |
| `POST /api/party/:id/join` | convidado | entra se `members < maxMembers` |
| `POST /api/party/:id/leave` | membro | sai; líder que sai passa a liderança ao mais antigo |
| `POST /api/party/:id/propose { huntId, difficulty, mode }` | líder | zera `approved`, registra proposta |
| `POST /api/party/:id/approve` | membro | marca; o líder aprova implicitamente ao propor |
| `POST /api/party/:id/start` | líder | exige `approved == members`; cria a sessão (5.2) |

Matchmaking (§15.2 "reúne compatíveis") é uma fila por faixa de level em Redis — fica **depois**
(issue 10 do §9): a party por convite já fecha o §44.4 sem ela.

### 5.2 Início — uma sessão, quatro tickets

`start` faz o que hoje `enter-hunt` faz para um, para todos de uma vez, na mesma transação lógica:

1. lê os quatro personagens do banco (linha, inventário, skills, bestiário — o mesmo que o ticket já
   carrega hoje, `api/tickets.ts` `inventoryOf`), verificando que **todos estão na Cidade**
   (`characters.state = 'city'`) e que a conta respeita o limite de ativos (§7.1);
2. escolhe **um** nó (`directory`), reserva o lease dos quatro personagens para o mesmo `sessionId`;
3. emite **um ticket por membro**, todos com o mesmo `sessionId`, `party: { leaderId, mode, members }`;
4. apaga a party do Redis — daqui em diante a sessão é a party.

No `game`, o primeiro ticket a chegar cria a sessão com **os quatro** `CharacterRuntime` (os dados de
todos vêm no ticket de qualquer um — o ticket é assinado pelo `api`), e cada socket seguinte só se
**anexa** como visualizador do próprio personagem, exatamente como a Cidade faz com muitos. O
personagem cujo dono nunca abriu o socket **está na hunt do mesmo jeito** — é idle-first (invariante 3):
o bot dele caça sem ninguém olhando.

`enter-hunt` (opcode 9) continua sendo o caminho solo. Não ganha campos de party.

### 5.3 Sair, morrer, encerrar

| Evento | O que acontece |
|---|---|
| membro pede `leave-hunt` | `session.leave(id)` → settlement (se `shared`) → extrato **dele** (`manual-exit`) → vai para a Cidade. A sessão continua |
| membro morre | penalidade de XP, HP/mana cheios, como hoje — mas é `leave` com `death`, não `end`. Os outros continuam |
| regra `party-member-lost` de alguém | dispara no `onLeave` do ruleset, para cada outro membro que a tem: sai por `exit-rule` |
| `out-of-gold` / `hp-below` | por membro, como hoje — vira `leave` |
| último membro sai | a sessão **encerra** (`end`), com o extrato dele. Uma party de um é um solo com bolsa |
| líder sai | liderança passa ao mais antigo presente (`participants[0]`); a bolsa continua sendo da sessão, e o excedente passa a cair na caixa do novo líder |
| nó cai | snapshot restaura os N participantes (`participants[]` já é vetor); `party` e `bag` no estado do ruleset, opcionais — **sem bump** de `SNAPSHOT_FORMAT_VERSION` |
| deploy com drenagem | `end('drain')` para a sessão inteira: settlement, N extratos, todos voltam à Cidade |

**Extrato por membro**: `Session.end`/`leave` produzem `Receipt` por personagem, com os agregados
**dele** e `seq = ++session.ledgerSeq`. O `jobs` não muda: cada extrato é uma linha de ledger com o
`UNIQUE (session_id, seq)` de sempre. O que muda é a chave no Redis (`receipt:${sessionId}:${characterId}`)
e o índice `receipts:char:*`, que já é por personagem.

---

## 6. Por pacote

### `packages/content`
- `data/party/baseline.json` + `partySchema` (tabela do §3.2).
- `itemSchema.value` (inteiro ≥ 0, **obrigatório** — todo item do repositório ganha um número; quem
  não tiver preço conhecido fica com `0` e um `_open`). É o insumo da venda automática — e da
  autovenda do E5, que vem depois com o mesmo campo.
- `botExitRuleSchema` `party-member-lost` deixa de ser documentado como inerte.

### `packages/sim`
- `Session`: `aggregatesOf(characterId)` (mapa por participante; `session.aggregates` vira a soma
  materializada, para o analisador e o bench não mudarem); `leave()` para qualquer ruleset;
  `end()` e `leave()` devolvem `Receipt` **por personagem**; `ledgerSeq` por extrato.
- `rulesets/hunt.ts`: opção `party?: { leaderId, mode, xpTable }`; `#onMonsterDied` chama
  `#distributeXp` e `#deliverLoot` pelo modo; `#useSupply` rateia em `shared`; `PartyBag` no estado;
  `onLeave` faz settlement e dispara `party-member-lost`; morte → `leave`.
- Novo módulo puro `party.ts`: `uniqueVocations(members)`, `xpPool(xp, unique, table)`, `splitEqually(
  total, n)` com o resto na ordem dada, `settleBag(bag, members, catalog)`. Tudo testável sem sessão.
- `combat-events.ts`: `party-settlement`, `party-bag-changed` (para o hospedeiro apresentar).

### `packages/protocol`
- S2C: `party-state` (membros, líder, modo, quem está presente/vivo), `party-bag` (itens, gold,
  capacidade usada/total), `party-settlement` (total, cota, para quem). Vão no `session-state` e
  sempre que mudam (mesmo desenho de `bestiary`).
- C2S: nenhum opcode novo para formar party (é HTTP). `leave-hunt` (10) já existe e serve.
- Ticket: `party?: { leaderId, mode, members: [...] }` — fixado na sessão.

### `packages/server`
- `api/party.ts` (rotas do §5.1), `party-store.ts` (Redis), `tickets.ts` (ticket com `party` e o
  snapshot dos N).
- `game/sessions.ts`: `huntFor` aceita N personagens; `host.ts`: sessão com N donos que **não** é
  shard (tem extrato, snapshot, repouso por sessão e não por personagem); `#saveReceipt` por membro;
  `receipts.ts` chave nova; excedente da bolsa → `#saveLootBox(leaderId)`.
- `jobs/ledger.ts`: sem mudança de contrato — só recebe mais extratos.

### `packages/client`
- Painel de party **na seleção de hunt** (esquerda, junto do `HuntMenu` — é onde o Huntera põe,
  `docs/reference/huntera-observed.md`): criar/convidar/aprovar/modo, e o botão de iniciar que só
  acende com todos aprovados.
- `PartyBag` na coluna direita (só em `shared`): lista, gold, `usado/total` de capacidade.
- `Analyzer`: linha por membro + total da party; `party-settlement` como evento notável.
- Vitais dos companheiros na tela (nome, HP %) — mínimo para "morreu alguém".

---

## 7. Divergências do PRD (viram ADR 0027)

| § | PRD | Aqui | Por quê |
|---|---|---|---|
| 15.3 | tabela por (membros, vocações únicas) | tabela **só por vocações únicas**; membros só dividem | é o que a regra "25 % por vocação, teto 100 %, dividido por todos" diz; membros no pool seria segunda regra |
| 15.4 | momento contábil aberto | rateio **em tempo real**, dentro da sessão | ninguém termina negativo; um extrato por membro já sai auditável |
| 15.5 | sorteio **individual por personagem**, cada um com seus modificadores | `split`: **um** destinatário sorteado, loot rolado com os modificadores dele; `shared`: sem destinatário e sem modificador individual | "loot aleatório" é a regra nova; rolar quatro vezes por monstro multiplicaria o loot por quatro |
| 15.5 | "cada personagem decide previamente se sai" | mantido — `party-member-lost` | — |
| 22.1 | autovenda com limite Free 5 / Premium 20 tipos | a venda da bolsa **não tem limite de tipos** | é venda da party no settlement, não a lista de autovenda do personagem; o limite fica para a autovenda |

---

## 8. Decisões fechadas (2026-09-15, ADR 0027)

1. **Party de vocações repetidas rende menos por cabeça que solo** (62 contra 100). Aceito: é o que
   "repetidas não somam" significa com pool dividido.
2. **Solo = 100 %**; `"1": 125` na tabela só vale para party de iguais.
3. **Sem vocação (level < 8) conta como uma vocação única** ("nenhuma").
4. **Bestiário conta para todos os elegíveis.**
5. Resto do rateio de supply → usuário; resto da divisão da bolsa → um gold a cada um, na ordem de
   entrada.
6. Modo é da sessão; não muda no meio.
7. Membro sem gold para a cota do supply é coberto pelo usuário; se o usuário não cobre, recusa
   para ele.
8. Item sem `value` vai para a mochila do líder no settlement (excedente para a caixa dele).
9. Capacidade da bolsa é a soma dos presentes e cai quando alguém sai, sem descartar.
10. Companheiros na tela: HP % no painel; no mundo eles já são `creature-*`.

---

## 9. Issues do milestone [M13 · Party de hunt](https://github.com/funkcaipora/draconya/milestone/3) (ordem de execução)

| # | Escopo | Task | Bloqueada por |
|---|---|---|---|
| 1 · [#186](https://github.com/funkcaipora/draconya/issues/186) | docs | ADR 0027 — party: uma sessão com N donos, XP por vocação única, dois modos de loot/custo; decisões do §8 fechadas | — |
| 2 · [#187](https://github.com/funkcaipora/draconya/issues/187) | sim | **Agregados e extrato por participante**; `leave` em qualquer ruleset; `ledgerSeq` por extrato; `session.aggregates` como soma. Sem mudança de comportamento em solo (todos os testes atuais passam intactos) | 1 |
| 3 · [#188](https://github.com/funkcaipora/draconya/issues/188) | content | `party/baseline.json` + schema; `itemSchema.value` em todo item do repositório | 1 |
| 4 · [#189](https://github.com/funkcaipora/draconya/issues/189) | sim | `party.ts` puro: vocações únicas, pool, divisão com resto, settlement da bolsa — só funções e testes de tabela | 3 |
| 5 · [#190](https://github.com/funkcaipora/draconya/issues/190) | sim | XP em party no `#onMonsterDied`: elegíveis, cota, Bestiário para todos, `experience-gain` por membro; 1 Hz == 10 Hz | 2, 4 |
| 6 · [#191](https://github.com/funkcaipora/draconya/issues/191) | sim | modo `split`: sorteio do destinatário antes do loot, modificadores dele; solo sem sorteio novo (sequência de loot idêntica — teste que prende) | 5 |
| 7 · [#192](https://github.com/funkcaipora/draconya/issues/192) | sim | modo `shared`: rateio de supply em tempo real com cobertura pelo usuário; `PartyBag` com capacidade somada; settlement em `leave`/`end`; excedente e item sem valor para o líder | 5 |
| 8 · [#193](https://github.com/funkcaipora/draconya/issues/193) | sim | saída e morte de membro: `leave` com extrato, `party-member-lost` ativo, liderança passa, último sai encerra | 7 |
| 9 · [#194](https://github.com/funkcaipora/draconya/issues/194) | server | extratos por membro no Redis (`receipt:${sessionId}:${characterId}`), `#saveReceipt` por membro, caixa de loot do líder, snapshot/restauração com N; `jobs` intacto (teste Postgres de 4 extratos da mesma sessão) | 2, 8 |
| 10 · [#195](https://github.com/funkcaipora/draconya/issues/195) | server | party no `api`: store Redis, rotas de convite/aprovação/modo/início, um nó e um ticket por membro, sessão criada com N; limite de ativos por conta | 9 |
| 11 · [#196](https://github.com/funkcaipora/draconya/issues/196) | protocol | `party-state`, `party-bag`, `party-settlement`; `party` no ticket e no `session-state` | 9 |
| 12 · [#197](https://github.com/funkcaipora/draconya/issues/197) | client | painel de party na seleção de hunt, bolsa na direita, analisador por membro, HP dos companheiros | 10, 11 |
| 13 · [#198](https://github.com/funkcaipora/draconya/issues/198) | server/tools | **critério de saída §44.4**: cliente sintético com 4 personagens de 4 vocações numa party `shared` — cada um recebe 50 % da XP de cada rato, a bolsa vende e divide, o ledger tem 4 linhas da mesma sessão | 12 |
| 14 · [#199](https://github.com/funkcaipora/draconya/issues/199) | server | matchmaking por faixa de level (§15.2, §43.2) — fila em Redis; **opcional** no milestone, `matchmakingLevelRange` já existe para ele | 10 |

**Pronto quando:** quatro personagens, um de cada vocação, entram numa party em modo compartilhado
a partir da Cidade; cada rato rende 50 % da XP a cada um; o que cai vai para a bolsa do líder, é
vendido e dividido quando alguém sai e quando a hunt acaba; o ledger tem uma linha por membro da
mesma sessão; fechar o navegador de qualquer um não muda nada disso.

---

## 10. Invariantes em jogo

| # | Como este plano os respeita |
|---|---|
| 1 | `party.ts` e o ruleset continuam puros; formação de party é `api` (Redis), fora do `sim` |
| 2 | XP, rateio e settlement acontecem em **eventos** (morte de monstro, uso de supply, saída) — nada por tick |
| 3 | a party caça com zero sockets abertos; o membro que nunca abriu o navegador recebe a cota igual |
| 4 | o cliente manda criar/convidar/aprovar/iniciar/sair; nunca XP, loot, cota ou valor de venda |
| 7 | modo, tabela de XP e `value` dos itens ficam fixos na versão de conteúdo da sessão |
| 8 | um personagem está em **uma** sessão; a party é uma sessão com quatro — a leitura do ADR 0023 |
| 9 | os quatro `CharacterRuntime` são escritos **só** pela sessão da party, que roda num processo só; rateio e settlement são escritas dela |
| 10 | um extrato por membro, cada um uma linha de ledger com `(session_id, seq)` único; retry idempotente como hoje |
| 11 | bot de cada membro continua o produto; `party-member-lost` é regra do bot, não punição |

**Custo:** o caminho quente ganha um laço de até 4 por morte de monstro e por uso de supply. O bench
frio (#179) mede solo; vale uma variante `PARTY=4` para o número não ser adivinhado.
