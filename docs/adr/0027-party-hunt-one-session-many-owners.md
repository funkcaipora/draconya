# 0027 — Party de hunt: uma sessão com N donos, XP por vocação única e dois modos de loot e custo

**Status:** aceito — decisão 5 emendada por #359 (custo e loot como dois eixos independentes) e pelo [ADR 0035](0035-party-v2-runtime-settings-shared-bag-and-live-join.md); decisões 8 e 9 emendadas pelo [ADR 0035](0035-party-v2-runtime-settings-shared-bag-and-live-join.md); decisão 8 emendada de novo pelo [ADR 0036](0036-party-standalone-surface-and-leader-start.md) (fim da aprovação pré-start); decisão 3 emendada em 2026-09-24/25 (#525) pela fidelidade CANARY do ADR 0037 decisão 4 (ainda em outra branch, `docs/adr-0037-tibia-fidelity`, não mesclada nesta)
**Data:** 2026-09-15
**Contexto técnico:** `packages/sim` (session, hunt ruleset, novo `party.ts`), `packages/content`
(`party/`, `item.value`), `packages/protocol` (party no ticket e no `session-state`),
`packages/server` (`api/party`, tickets, extratos por membro), `packages/client` (party na seleção
de hunt, bolsa). Sistemas: hunt, economia de sessão, analisador, bot (regra `party-member-lost`).

## Contexto

O PRD §15 decide a intenção — party de até 4, premiar vocações únicas, equalizar supply, loot sem
last hit — e deixa três coisas abertas que impedem qualquer implementação: a fórmula de XP (§15.3),
o momento contábil da equalização (§15.4) e o critério de matchmaking (§43.2). A FUN-71 (ADR 0023)
mostrou que uma sessão pode ter muitos personagens, mas a Cidade não tem extrato nem snapshot — e
uma hunt tem os dois. Hoje `session.aggregates`, `Session.end()` e a chave `receipt:${sessionId}`
assumem **um dono por sessão** (`packages/sim/src/session.ts:274`, `:517`;
`packages/server/src/receipts.ts:131`). A regra de saída `party-member-lost` existe desde a FUN-86 e
é inerte. O desenho completo, com exemplos numéricos e a lista de issues, está em
`docs/party-hunt-plan.md`; este ADR fixa o que ali é decisão.

## Decisão

1. **A party é uma sessão de hunt com N participantes, que não é shard.** Tem extrato, snapshot e
   repouso por sessão. Cada membro é dono do próprio `CharacterRuntime` dentro dela; a sessão é a
   única escritora dos N (invariante 9). `enter-hunt` (opcode 9) continua sendo o caminho solo.
2. **Agregados e extrato passam a ser por participante.** `Session` ganha `aggregatesOf(characterId)`
   e `session.aggregates` vira a soma; `end()` e `leave()` devolvem um `Receipt` por personagem, cada
   um com `seq = ++ledgerSeq`. No Redis a chave é `receipt:${sessionId}:${characterId}`. O `jobs` e o
   `UNIQUE (session_id, seq)` não mudam. Em solo nada muda de comportamento.
3. **XP por vocação única, dividida por igual.** `pool% = min(100 + 25 × únicas, 200)` com ≥ 2
   membros elegíveis (vivo, stamina > 0, na sessão); solo é 100. `cota = floor(pool / elegíveis)`;
   o resto é descartado. O bônus de Bestiário de cada um se aplica à cota, na ordem de hoje (DT-04
   da FUN-113). A tabela vive em `content/data/party/baseline.json`, indexada **só** por vocações
   únicas. Personagem sem vocação (level < 8) conta como uma vocação ("nenhuma"). Party de vocações
   iguais rende menos por cabeça que solo (125 % ÷ 2) — decidido e aceito: é o que "repetidas não
   somam" significa quando o pool é dividido.
4. **O abate conta no Bestiário de todo membro elegível**, não só do matador.
5. **Dois modos, fixados na sessão** (`party.mode`, no ticket e no snapshot; não muda no meio):
   - `split`: cada um paga o próprio supply; por monstro, **um** membro elegível é sorteado
     (uniforme) e o loot — gold e itens — é rolado com os modificadores dele e vai para ele. O
     sorteio do destinatário vem **antes** de `rollLoot` e **só existe com ≥ 2 participantes**: a
     sequência do RNG em solo fica idêntica à de hoje (FUN-63).
   - `shared`: cada uso de supply de preço `c` debita `floor(c / n)` de cada membro presente e o
     resto do usuário; membro sem saldo para a cota é coberto pelo usuário; se o usuário não cobre,
     `not-enough-gold` para ele. O loot cai numa `PartyBag` da sessão com capacidade igual à soma
     das capacidades dos presentes (cai quando alguém sai, sem descartar); o excedente vai para a
     caixa de loot do líder (§21.6). **Settlement** ao sair e ao encerrar: `total = gold + Σ
     value × quantity`, `cota = floor(total / presentes)` para cada presente, resto um gold por
     membro na ordem de entrada; item sem `value` vai para a mochila do líder. Sem modificador
     individual de loot neste modo.
6. **`itemSchema.value`** (preço de venda ao NPC, inteiro ≥ 0) passa a ser obrigatório em todo item
   do repositório. É o mesmo campo que a autovenda (§22.1, E5) vai usar.
7. **Sair e morrer são `leave`, com extrato próprio e settlement.** A sessão continua para os
   outros; `party-member-lost` dispara no `onLeave`; a liderança passa ao mais antigo presente; o
   último a sair encerra. Morte mantém a penalidade de hoje.
8. **Formação é do `api`, em Redis, transitória** (`party:{id}`, TTL): criar, convidar, entrar,
   sair, propor `{ huntId, difficulty, mode }`, aprovar, iniciar. `start` exige todos aprovados,
   todos na Cidade, escolhe um nó e emite um ticket por membro com o mesmo `sessionId`; o primeiro
   ticket a chegar cria a sessão com os N. Matchmaking por faixa de level (§15.2) fica para depois,
   com `matchmakingLevelRange` já na tabela.
9. **Protocolo:** `party-state`, `party-bag`, `party-settlement` (S2C, no `session-state` e a cada
   mudança); nenhum opcode C2S novo — formação é HTTP, `leave-hunt` (10) serve para sair.

## Alternativas

- **Tabela de XP por (membros, vocações únicas)**, como o PRD pedia — o número de membros não entra
  no pool nesta regra, só na divisão; uma segunda dimensão seria coluna repetida.
- **Sorteio de loot individual por personagem** (§15.5 literal) — rolar quatro vezes por monstro
  multiplica o loot por quatro; a regra nova é "um destinatário sorteado".
- **Equalização de supply por settlement no fim** — pode deixar um membro negativo e exige uma
  tabela de transferências para auditar; os quatro estão na mesma sessão, ratear na hora custa o
  mesmo e o extrato de cada um já sai equalizado.
- **Recusar o supply quando um membro não tem saldo para a cota** — um membro sem gold travaria
  as poções de todos; o usuário cobrir é o que uma party faria.
- **Vender a bolsa só no fim da hunt** — quem sai depois de duas horas perderia a parte dele;
  vender a cada saída dá a cada um o que caiu enquanto estava.
- **Party como shard** (`shared: true`) — shard não tem extrato nem snapshot (ADR 0023), e uma
  hunt precisa dos dois.
- **Formação pela sessão da Cidade (WebSocket)** — a Cidade é inerte e o `api` já é quem emite
  ticket e conhece o limite de ativos por conta; uma party não é estado quente.
- **Bestiário só para o matador** — party é o jeito previsto de jogar e o Bestiário é progressão
  por monstro; contar só para quem deu o último golpe reintroduz last hit.

## Consequências

- `packages/sim`: agregados por participante; `leave` em qualquer ruleset; `Receipt[]`; `party.ts`
  puro (vocações únicas, pool, divisão com resto, settlement); `PartyBag` no estado do ruleset,
  opcional — sem bump de `SNAPSHOT_FORMAT_VERSION`; o caminho quente ganha um laço de até 4 por
  morte e por supply, e o bench frio (#179) precisa de uma variante com party.
- `packages/content`: `party/baseline.json`, `partySchema`, `value` em todo item (número
  provisório com `_open` onde não houver preço conhecido).
- `packages/server`: chave de extrato por membro; `#saveReceipt` por membro; caixa de loot do
  líder; `api/party.ts` e `party-store.ts`; ticket com `party`; sessão criada com N.
- `packages/client`: painel de party na seleção de hunt, bolsa na direita, analisador por membro,
  HP dos companheiros.
- Divergências do PRD a registrar em `docs/product/party.md`: §15.3 (tabela só por vocações
  únicas), §15.4 (tempo real), §15.5 (um destinatário sorteado; sem modificador individual em
  `shared`), §22.1 (a venda da bolsa não tem limite de tipos). Fecha os `[ABERTO]` do §15.3 e
  §15.4; §43.2 continua aberto.
- O que piora: quatro personagens dependem de um nó só — a queda dele derruba quatro hunts, e a
  restauração por snapshot precisa reabrir os quatro leases; item sem `value` é um caminho a mais
  em que a bolsa vira `acquired` de alguém; o resto descartado da XP é perda real, pequena e
  determinística.

## Invariantes afetados

Nenhum. O 8 continua na leitura do ADR 0023: um personagem está em uma sessão, e a sessão pode ter
muitos. O 9 continua: os N `CharacterRuntime` são escritos só pela sessão da party, num processo. O
10 continua: um extrato por membro, cada um uma linha de ledger com `(session_id, seq)` único. O 3
continua: a party caça com zero sockets abertos e o membro que nunca abriu o navegador recebe a
mesma cota. O 4 continua: o cliente cria, convida, aprova, inicia e sai — nunca XP, loot, cota ou
valor de venda.

## Emenda — 2026-09-17 (#359): custo e loot como dois eixos independentes

A decisão 5 original fixava `party.mode` como um único campo (`split`/`shared`) que decidia ao
mesmo tempo se o custo do supply é rateado e se o loot vai para a bolsa dividida. O kit
renderizado (ADR 0030) desenha os dois como switches independentes ("Rateio de custos" e
"Dividir loot", `Hud.jsx:161`) e o próprio dado de exemplo do handoff usa uma combinação
(`shareCosts: true, splitLoot: false`) que o campo único não representa.

`PartyOptions` (sim) e `PartyState` (protocolo) ganham `shareCosts`/`splitLoot`, opcionais,
com fallback para `mode` quando ausentes (`shareCostsOf`/`splitLootOf` em `packages/sim/src/party.ts`)
— toda sessão criada pelo caminho de formação existente continua produzindo exatamente o `split`
ou o `shared` de sempre, byte a byte. `mode` **não é removido**: é o campo que toda formação
(`party-store.ts`, `tickets.ts`, `api/party.ts`) e todo cliente hoje leem, e substituí-lo
quebraria os dois. As quatro combinações resultantes:

- `shareCosts: false, splitLoot: false` — o `split` de sempre.
- `shareCosts: true, splitLoot: true` — o `shared` de sempre.
- `shareCosts: true, splitLoot: false` (nova) — custo rateado em tempo real, loot para um
  elegível sorteado (sem bolsa).
- `shareCosts: false, splitLoot: true` (nova) — cada um paga o próprio supply, loot para a
  bolsa da party, vendido e dividido no settlement.

**Quem edita os dois eixos, e quando, fica DEFERIDO**: a formação (`POST /api/party/:id/propose`)
continua aceitando só `mode`, e não há hoje nenhuma tela nem rota que produza uma combinação
mista fora de teste. Os switches do kit acendem no painel da hunt (M17) como LEITURA do que a
sessão já decidiu, não como controle editável, até uma issue de produto separada decidir "quem
edita e quando" — a proposta default, registrada aqui, é que a edição continue acontecendo na
proposta do líder (como o `mode` faz hoje), não durante a hunt.

## Emenda — 2026-09-24/25 (#525): XP compartilhada com a fórmula e a elegibilidade do Canary

A decisão 3 original (`pool% = min(100 + 25 × únicas, 200)`, "nenhuma" vocação contando como uma
a mais, cota `floor(pool / elegíveis)`) foi um palpite razoável para a FUN-71, escrito antes do
ADR 0037 fixar que mecânica de jogo copiada do Tibia usa o NÚMERO real das engines de origem, não
uma aproximação nossa — e decisão 4 daquele ADR é explícita: **o Canary manda em fórmula**. Uma
revisão adversarial da primeira versão desta emenda (2026-09-24) encontrou oito problemas, todos
do mesmo tipo: ela tinha sido escrita contra o TFS, e o TFS e o Canary DIVERGEM aqui em três
eixos. A versão abaixo reproduz o Canary — o que a decisão 4 pede — e registra onde o TFS diverge,
sem misturar os dois.

### A fórmula real do Canary (`Party:onShareExperience`, `data/events/scripts/party.lua`)

```
n  = Party::getUniqueVocationsCount()                    (capado em 4, "nenhuma" CONTA)
sz = getMemberCount() + 1                                 (o ROSTER inteiro: líder + membros)
m  = 0,1 × n² − 0,2 × n + 1,3                              (fração; em percentual: 10n² − 20n + 130)
m  = sz ≥ 4 ? m − 0,1 : m                                  (percentual: m − 10)
cota = ceil(xp × m / sz)                                   (o DIVISOR é sz, não n nem "elegíveis")
```

Três pontos em que a versão de 2026-09-24 desta emenda errou, e a correção:

1. **"Nenhuma" vocação (level < 8) CONTA como vocação distinta — não exclui, ao contrário do que
   a versão anterior desta emenda registrou citando só o TFS.** `Party::getUniqueVocationsCount`
   (`src/creatures/players/grouping/party.cpp`) insere `vocation->getBaseId()` de todo jogador do
   roster, com só uma guarda de ponteiro nulo (`if (!vocation) continue`) — sem excluir
   `VOCATION_NONE`. A vocação "None" (`data/XML/vocations.xml`, `id="0" baseid="0"`) é um
   `Vocation*` REAL, não um ponteiro nulo. **O TFS diverge**: `Party:onShareExperience` exclui
   `VOCATION_NONE` de `vocationsIds` explicitamente — mas é o Canary que manda em fórmula (ADR
   0037 d.4), e é o Canary que este código reproduz. `uniqueVocations`
   (`packages/sim/src/party.ts`) capa em 4 (o próprio loop do Canary para de contar ao chegar em
   4 distintas) e não exclui `null`.
2. **O desconto de −0,1 (−10 pontos percentuais) é gatilhado pelo TAMANHO da party, não pela
   contagem de vocações únicas.** O comentário do Canary ("subtract 0.1 if all vocations are
   present, because on all vocations the multiplier is 2.1 and it should be 2.0") descreve a
   INTENÇÃO — 4 vocações reais —, mas o CÓDIGO testa `partySize < 4`, o tamanho TOTAL da party.
   Uma party de 4 knights (`n = 1`) TAMBÉM desconta (120 % → 110 %), porque tem 4 membros; uma de
   2 knights + 2 druids (`n = 2`) desconta igual (130 % → 120 %). Este código reproduz o CÓDIGO,
   não o comentário — é o que "fidelidade" significa quando os dois divergem, e é o achado #1 da
   revisão: a versão de 24/09 indexava só por vocações únicas, sem termo de tamanho, e divergia
   do Canary real em qualquer party de 4+ com vocação repetida.
3. **O DIVISOR da cota final é o TAMANHO TOTAL da party (`getMemberCount() + 1`), não a
   contagem de elegíveis.** O TFS faz o mesmo (`#self:getMembers() + 1`) — os dois concordam
   nisto. A versão de 24/09 dividia por `eligible.length`; corrigido para `allMembers.length`, o
   roster inteiro da sessão (ver "Duas populações", abaixo).

A tabela `xpPoolPercentByUniqueVocations` SAIU do conteúdo (`packages/content/data/party/
baseline.json`, schema em `packages/content/src/schemas.ts`): o desconto por TAMANHO não cabe
numa tabela indexada só por vocações únicas sem uma segunda dimensão, e o número não é
balanceamento — é mecanismo copiado, a mesma categoria de `movementDuration`/`resolveDamage`.
`sharedExperiencePercent` (`packages/sim/src/party.ts`) é a fórmula em código; uma chave
`xpPoolPercentByUniqueVocations` num `RawContent` antigo é ignorada (schema não estrito), sem
precisar de migração.

**As duas engines só concordam por coincidência, nunca por regra**: `n = 4` sempre implica
`sz ≥ 4` nas duas, então o TFS (sem desconto) dá 200 % e o Canary (com desconto) dá 210 % − 10 % =
200 % — coincidem NESTE caso só porque o desconto do Canary cancela exatamente a diferença da
fórmula quadrática dele para a linear do TFS. Em QUALQUER outra composição (vocação repetida,
"nenhuma" presente, tamanho ≠ vocações únicas) os números divergem, às vezes na mesma direção,
às vezes não — não existe uma regra curta que diga quando batem.

### Elegibilidade (`Party::canUseSharedExperience`, TFS e Canary concordam aqui)

Nova nesta emenda, e ausente na decisão original: o TFS e o Canary desligam a divisão igual do
abate inteiro — não só para quem falhou — quando qualquer membro do ROSTER (não só quem vai
receber cota) não atende, ao mesmo tempo:

- **nível**: dentro de `ceil(maiorLevel / 1,5)` ("2/3 do maior level da party", constante no TFS,
  `partyShareRangeMultiplier` configurável no Canary com default `1,5`);
- **alcance**: 30 tiles e 1 andar do LÍDER (`EXPERIENCE_SHARE_RANGE`/`FLOORS` do TFS,
  `Position::areInRange<30, 30, 1>` do Canary);
- **atividade**: atacou, ou curou OUTRO PARTICIPANTE (nunca a si mesmo — ver abaixo), nos
  últimos 2 minutos, seguindo o CANARY (`Party::isPlayerActive`) por precedência do ADR 0037
  decisão 4, porque o TFS usa `pzLocked` (config de Proteção contra PK, não de party, default 1
  minuto).

Quando a regra desliga, cada elegível recebe XP pelo DANO que causou no abate
(`Creature::getGainedExperience`, `floor(dano/total × xp)`) — o mesmo caminho que o Tibia usa
fora de party, SEM o teto da cota compartilhada: quem causa 100 % do dano leva o XP INTEIRO do
monstro, não a cota dividida. A implementação vive em `canShareExperience`/`xpByDamage`
(`packages/sim/src/party.ts`) e `#xpShares` (`packages/sim/src/rulesets/hunt.ts`); os parâmetros
(30 tiles, 1 andar, divisor 1,5, janela de atividade) entram em
`content/data/party/baseline.json` (`sharedExperience`), não hardcoded — este bloco, ao
contrário do multiplicador, É balanceável sem redesenho (é um número por eixo, não uma fórmula
com dimensão nova), então continua conteúdo versionado.

**Curar A SI MESMO não conta como atividade** (achado #4 da revisão). `Player::isPartner`
(`player.cpp`, TFS e Canary) exclui `player == this` antes de `updatePlayerTicks` por cura — só
curar um PARCEIRO, ou atacar um monstro, prova engajamento com a party. `#emitHealed`
(`packages/sim/src/rulesets/hunt.ts`) só chama `#markCombatActive` quando o recipiente da cura é
DIFERENTE do healer; o HPS (`creditHealing`) continua contando o self-heal, porque é outra
pergunta ("quanto curei", não "estou com a party"). O código do Canary para este caminho
específico (`onTargetCreatureGainHealth`) tem uma variável não resolvida antes do uso que o torna
inerte na versão observada — a INTENÇÃO de excluir a si mesmo é idêntica nas duas engines
(mesmo `isPartner`), e é essa intenção, confirmada pelo TFS funcional, que este código reproduz.

### Duas populações: `allMembers` (roster) e `eligible` (quem recebe)

O TFS/Canary avaliam elegibilidade E calculam `n`/`sz` sobre o ROSTER inteiro da party
(`getPlayers()`: líder + membros, presente ou não elegível para receber XP). O Draconya usa
`session.participants` como esse roster — que já É "quem está na hunt" nesta arquitetura: morrer
em party é sair (`#depart`, #193), então não existe aqui o caso Tibia de um membro morto ainda
contando para o roster. Dentro desse roster, uma extensão SÓ do Draconya (sem equivalente nas
engines de origem) é a stamina: um membro sem stamina continua no roster — ainda conta para `n`,
para `sz` (o divisor) e para `highestLevel`/alcance/atividade em `canShareExperience` — mas não
está em `eligible` e não recebe cota nenhuma, do mesmo jeito que sempre decidiu se o matador
recebia em solo. As duas populações têm nomes DIFERENTES no código (`allMembers` vs. `eligible`)
de propósito, para a distinção não se perder na próxima leitura.

### Consequência aceita, e não um defeito

Um membro que nunca ataca nem cura outro participante durante uma hunt inteira (sem bot
configurado, por exemplo) desliga a divisão igual para a party inteira o tempo todo — inclusive o
abate que acontece no instante 0 da sessão, antes de qualquer um ter tido a chance de agir. É o
comportamento OBSERVADO (ou, no caso do self-heal do Canary, INTENCIONADO e confirmado pelo TFS)
nas engines de origem: dividir igual com quem ficou parado seria dar XP de graça, e nem o TFS nem
o Canary fazem isso. `docs/product/party.md` registra os exemplos numéricos.

O rateio de loot/custo (decisão 5, a bolsa compartilhada) **não muda** — a #505 está em andamento
nele, separadamente. Nenhum invariante é afetado: o 8 e o 9 continuam pela mesma leitura do texto
original; o novo estado (`lastCombatActionAtMs` em `Runner`) é escrito só pela sessão dona, como
todo o resto do `CharacterRuntime`/`Runner`.
