# Progressão, vocações e level

**Status:** stats por level/vocação, curva de XP, level up e skills por uso implementados; famílias
de arma e proficiências (CMB-05) implementadas; promoção de vocação implementada (#566); passivas não
**PRD:** §4.1, §9, §43.1
**Épico:** E2 (stats por vocação/level, skills por uso); E7 (árvore de passivas, promoção de vocação)

## Comportamento

O jogo tem quatro vocações — Cavaleiro, Druida/Curandeiro, Feiticeiro e Arqueiro — cada uma um arquétipo clássico de papel (tank, suporte/cura, dano mágico, dano à distância). HP e Mana crescem automaticamente por level, sem distribuição manual de atributos: o jogador não aloca pontos em força ou inteligência, o crescimento é inteiramente determinado pela vocação escolhida.

Existe uma única promoção permanente de classe no MVP — **implementada pelo #566 como serviço
de Cidade, não por quest** (ver "Divergências do PRD" e "Promoção de vocação" abaixo). A maior
parte das magias é liberada automaticamente conforme o personagem sobe de level; as magias mais
fortes ficam condicionadas a essa promoção — ainda não ligado, porque o catálogo de magias que
exigiria promoção não existe (ver "Em aberto"). O sistema deve ser construído de forma que
promoções adicionais possam ser introduzidas futuramente sem exigir remodelagem completa do
personagem.

Skills sobem pelo uso, seguindo o paradigma do Tibia, e não automaticamente com o level do personagem.

Cada personagem recebe pontos de passiva ao longo da progressão, distribuídos numa árvore própria da vocação. A árvore permite caminhos como dano, suporte e sustain. Os pontos podem ser redistribuídos livremente em PZ, quantas vezes o jogador quiser — não há custo nem limite de respec.

O catálogo de magias do jogo usa como referência de escopo funcional as magias do Tibia — até o level 80 no M12 (ADR 0026, decisão 5: as magias instantâneas que o motor expressa, por Base Power), e até aproximadamente o level 120 depois, sem reproduzir catálogo proprietário, nomes, assets ou código — o conteúdo final precisa ser definido/licenciado de forma própria.

## Regras

- Ganho de HP/Mana por level é automático e fixo por vocação (ver tabela de parâmetros).
- A escolha de vocação ocorre no level 8 (ver `onboarding.md`).
- Existe exatamente uma promoção de classe no MVP, permanente e única — obtida na Cidade (#566),
  não por quest.
- Magias liberadas por level: a maioria; magias mais fortes: condicionadas à promoção (ainda não
  ligado — ver "Em aberto").
- Skills evoluem por uso, não por level.
- Pontos de passiva são distribuídos em árvore própria por vocação (dano / suporte / sustain).
- Respec de passivas é livre, ilimitado e restrito a PZ.

## A curva de XP é a do Tibia (#521, ADR 0037)

Desde a #521, a curva não é mais um número que o Draconya escolhe — é a fórmula real do Tibia
(`Player::getExpForLevel`, Canary/TFS, verificada em `opentibiabr/canary` `main` 2026-09-24):

```
totalXpForLevel(L) = (L³ − 6L² + 17L − 12) / 6 × 100
```

Sempre um inteiro: `L³ − L` é o produto de três inteiros consecutivos e por isso múltiplo de 6,
e o resto da expressão já é múltiplo de 6 sozinho — não precisa arredondar. `xpToCompleteLevel(L)`
é a diferença entre dois totais consecutivos, calculada em O(1) — nunca um laço somando do zero,
que a level 200+ tornaria caro. `xp` no personagem continua sendo o **total acumulado**, nunca
"XP dentro do level".

Conferida: level 1 = 0, level 8 = 4.200, level 200 = 129.389.800.

O `progressionSchema.xp` é um tipo com duas formas (`{ kind: 'tibia' }` ou
`{ kind: 'power', base, exponent }`): o CONTEÚDO real (`baseline.json`) sempre usa `'tibia'`; a
forma `'power'` (a fórmula antiga, `base × level^exponent`) sobrevive só para fixture de teste
que quer uma curva pequena e arbitrária, sem carregar os números do Tibia. Antes da #521 a curva
era balanceamento do Draconya e ficava só em conteúdo, sem código dedicado — agora ela é regra
do Tibia (ADR 0037 revoga esse limite do ADR 0019 para mecânica de jogo), e por isso vive como
fórmula fechada em `packages/sim/src/progression.ts` (`tibiaTotalXp`), não mais como dois
números em JSON.

Guardar o **acumulado**, e não o progresso dentro do level, é o que faz a penalidade de morte
cascatear sozinha: tira-se XP do total e o level é recalculado. Guardar o progresso dentro do
level exigiria um laço de "desce um level, devolve o resto" escrito à mão — exatamente onde o
caso de cascata de dois levels passa despercebido.

### Personagem que já existia (migração 0009, ADR 0014)

A curva nova muda o que `xp` SIGNIFICA — o mesmo número aponta para um level diferente. A
migração `packages/server/migrations/0009_521-tibia-xp-curve.sql` preserva o **level** e a
**fração de progresso dentro dele** de quem já tinha personagem, recalculando só o valor
absoluto de `xp`:

```
xp_novo = total_novo(L) + fração × completar_novo(L)
fração  = (xp_antigo − total_antigo(L)) / completar_antigo(L)
```

As duas curvas em SQL fechado (soma de quadrados para a antiga, a cúbica para a nova — ver o
comentário do arquivo), sem laço e sem função: um `UPDATE` só, por personagem. Testado em
`packages/server/src/db/xp-curve-migration.postgres.test.ts` — inclusive o caso que dá nome ao
teste, um personagem level 9 na metade do level que continua level 9 na metade depois da
migração, só que na curva nova.

**Subir de level enche vida e mana (#678, ADR 0037).** É o Canary `Player::addExperience`:
quando o level muda para cima, `health = healthMax; mana = manaMax`. Vários levels num abate
curam uma vez, nos máximos finais. A **perda** de level na penalidade de morte não cura nada: só
reduz os máximos (e o atual, se passar deles), como no Canary.

Até #678 o level up só somava o delta dos máximos ("dá os pontos, não cura"), com o argumento de
que o bot morando na fronteira de um level nunca morreria. Era uma divergência do Tibia sem ADR,
contra o ADR 0037 — e esse bot na fronteira é o Tibia.

**O level up é autoritativo sobre os stats.** Ele recalcula `maxHealth` e `maxMana` pela tabela,
o que significa que qualquer valor inventado na criação do personagem some no primeiro level up.
Por isso a criação de sessão passou a derivar HP e mana da mesma tabela — antes ela usava
números fixos, e o personagem *encolheria* ao subir de level.

## Bônus de XP somam entre si (#563)

Todo bônus percentual de XP é **aditivo**: a XP de cada membro de uma party é a cota dele vezes
`(100 + soma dos bônus) / 100`, com **uma** multiplicação em inteiro — nunca uma cadeia de
`floor` por bônus, que perde um ponto na borda de cada um. Hoje os termos são:

- **faixa de level** (`experienceBonusByLevel`): 200% até o level 300, 100% acima. É decisão de
  **produto** do Draconya, não do Tibia — o `lowLevelBonus` do Canary é 50% até o level 50.
- **Bestiário**: +1% por marco alcançado, somado sobre todos os monstros (DT-01). O abate que
  fecha o marco é pago pela regra de ANTES dele (DT-04).
- **VIP e evento**: o ponto de extensão existe no ruleset, com valor zero hoje — monetização
  está fora do escopo da #563.

A cota vem antes: a tabela de party (`xpPoolPercentByUniqueVocations`, ADR 0027) define a XP
compartilhada, e os bônus incidem sobre ela. A conta é em INTEIRO pela mesma razão do Bestiário
(`100 × 1,13` é `112.99999999999999`): o conteúdo exige percentuais inteiros, e
`applyExperienceBonus` (`packages/sim/src/progression.ts`) faz
`floor(exp × (100 + soma) / 100)`. O resultado não depende de haver alguém assistindo
(invariante 3) — a 1 Hz ou a 10 Hz, o mesmo abate rende a mesma XP.

## A progressão volta para o banco pelo `jobs`, como delta

O `game` não escreve nada durável. Ele encerra a sessão, monta o extrato e o deixa no Redis; o
`jobs` lê, escreve a linha de ledger e, **na mesma transação**, aplica a progressão na linha do
personagem.

A escolha é deliberada: o `jobs` já lê o extrato e já escreve o ledger, e manter a escrita
durável fora do processo stateful significa que uma falha ali não perde progresso — o extrato
fica no Redis e a próxima varredura tenta de novo.

**XP e gold entram como DELTA**, nunca como estado final. Escrever o estado final não é
idempotente, e dois extratos do mesmo personagem processados fora de ordem se sobrescreveriam.
Como delta, eles somam na ordem que vier.

**A progressão pendura na mesma chave de idempotência do ledger** (`session_id`, `seq`): a linha
do personagem só é tocada quando a linha de ledger foi de fato inserida. Um retry encontra o
conflito, não insere nada, e por isso não credita nada — que é o par grava-depois-apaga do
invariante 10 valendo para os dois de uma vez.

**O level é DERIVADO da XP nova**, nunca copiado do extrato. Copiar faria um extrato antigo,
processado fora de ordem, rebaixar um personagem que já subiu; derivar sempre bate com a XP que
está na linha.

**A stamina é a exceção, porque não é soma.** Ela vai como valor absoluto, com o instante em que
valia, e só sobrescreve quando é mais nova — sem essa guarda, um extrato atrasado devolveria
stamina já gasta.

O piso de zero na XP é do banco, não confiança em quem chama: a penalidade de morte chega no
extrato como número negativo, e XP negativa é um estado impossível que dá erro estranho em todo
lugar que a lê depois.

### Quem emite ticket liquida antes de ler

A varredura do `jobs` roda a cada dez segundos, e quem reconectava dentro dessa janela lia
`level` e `xp` da tabela **antes** do delta da sessão que tinha acabado. O personagem nascia com
o progresso de antes — e como o level up é autoritativo sobre os stats, ele também *encolhia*:
`statsForLevel` recalculava HP e mana a partir do level velho.

O banco convergia sozinho, porque o que se escreve é delta. Mas para quem estava jogando era
indistinguível de perda de dados, e sumia sozinho em dez segundos — o pior formato possível:
ninguém reproduz de propósito, e quem reporta parece enganado.

Agora `POST /api/tickets` liquida o que aquele personagem tem pendente antes de ler a linha
dele. É o **mesmo** caminho da varredura, não um paralelo: mesma linha de ledger, mesma chave
única, mesma transação. É isso que torna o encontro dos dois inofensivo — o `jobs` e a emissão
podem processar o mesmo extrato ao mesmo tempo, e o segundo a chegar bate na
`UNIQUE (session_id, seq)`, não aplica nada, e apaga um extrato já pago.

Somar o delta pendente por cima do que veio do banco seria mais barato e estaria **errado**:
entre ler a linha e ler o Redis cabe uma varredura inteira, e o mesmo delta entraria duas vezes
na conta que o jogador vê.

**Falhar ali recusa a entrada** (HTTP 503), em vez de deixar passar. Entrar com um personagem que
o servidor sabe estar desatualizado é o defeito que a rota acabou de deixar de ter, e a recusa é
retentável de graça: o extrato continua no Redis e a varredura o pega de qualquer jeito.

Para achar o extrato daquele personagem sem varrer o keyspace inteiro a cada login, o Redis
guarda um índice por personagem (`receipts:char:{characterId}`) ao lado do extrato. Um extrato
gravado por um nó `game` antigo, durante um deploy em rolagem, não tem entrada de índice e volta
a esperar a varredura — degradação, não perda.

`GET /api/characters` e `POST /api/characters/:id/select` liquidam pelo **mesmo caminho** antes
de ler a linha (FUN-66), então a tela de seleção e o jogo concordam. A diferença é o que se faz
ao falhar: o ticket recusa a entrada, porque a sessão nasce daquele número; a lista **serve o
valor atrasado** e loga, porque ela é como se chega a qualquer lugar e um 503 nela trancaria a
conta inteira por uma falha de ledger — o valor ali só é exibido, nada é criado a partir dele.
Na lista, liquida-se depois de listar (os ids só se conhecem listando) e relê-se só quando algo
foi escrito; sem pendência o custo é um `SMEMBERS` por personagem e nenhuma consulta a mais.

## Rates do servidor (#691, M44-G15)

Todo servidor do Tibia tem rates, e o Draconya também: o bloco `progression.rates` em
`packages/content/data/progression/baseline.json` (`ratesSchema`, `packages/content/src/schemas.ts`)
é o `rateExp`/`rateSkill`/`rateMagic`/`rateLoot`, os stages de `data/stages.lua` e os
`rateMonster*`/`rateBoss*` do `config.lua` do Canary. O rate mora no **conteúdo versionado**, e
não em variável de ambiente do servidor (invariante 7): entra no `computeVersion`, uma sessão
termina no rate da versão em que começou, e mudar o rate é deploy de conteúdo.

```jsonc
"rates": {
  "experience": 1, "skill": 1, "magic": 1,
  "loot": 1,                 // inteiro; 0 desliga o loot
  "useStages": false,        // o `rateUseStages` do Canary
  "experienceStages": [],    // [{ "minLevel": 1, "maxLevel": 8, "multiplier": 7 }, …]
  "skillStages": [], "magicLevelStages": [],
  "monster": { "health": 1, "attack": 1, "defense": 1 },
  "boss":    { "health": 1, "attack": 1, "defense": 1 }
}
```

**O default é neutro, e o conteúdo real não declara o bloco:** o Tibia com rate 1. Com tudo em 1,
cada aplicação curto-circuita e nenhum número muda — nem um arredondamento a mais.

| Rate | Onde se aplica | Como |
|---|---|---|
| `experience` / `experienceStages` | abate (`#grantPartyXp`) | `floor(xp × rate)`, **depois** do bônus do Bestiário, por membro e pelo level de cada um (o `baseRate` do Canary) |
| `skill` / `skillStages` | prática (`#gainSkills`) | pontos × rate, sem arredondar; o stage é o do nível **base** da skill |
| `magic` / `magicLevelStages` | prática da skill `magic` | igual, pelo ML base (o `getBaseMagicLevel()` do Canary ignora bônus de item) |
| `loot` | sorteio (`rollLoot`) | chance de cada linha × `max(1, loot)`, teto 1; `0` devolve loot vazio **sem consumir sorteio** |
| `monster` / `boss` `.health` | compilação do monstro (`compileMonster`) | `trunc(vida × mult)`, piso 1 |
| `monster` / `boss` `.defense` | compilação do monstro | `defense` e `armor` × mult truncados; `defenseMitigation` × mult em ponto flutuante |
| `monster` / `boss` `.attack` | golpe do monstro | `trunc(dano sorteado × mult)` — o sorteio é o mesmo, e a sequência do `Rng` não muda |

`monster.boss: true` (o `MonsterType::isBoss` do Canary) escolhe o bloco `boss`; ausente é
`false`. Só a flag: raridade e pontos do Bosstiary são o #629.

Com `useStages`, a primeira faixa que contém o level vence (`getRateFromTable`), e sem faixa
vale o rate simples. `buildContent` recusa faixa sem `maxLevel` que não seja a última, faixa com
`minLevel > maxLevel` e faixas sobrepostas — no Canary a segunda seria letra morta.

**Fronteira com o bônus de level baixo:** o `lowLevelBonusExp` do Canary **não** é um rate aqui.
O ADR 0043 (emenda de 2026-09-25) escolheu a forma por faixa do Huntera, que é o
`progression.experienceBonusByLevel` do #563 (na `main`; ainda não nesta linha). Quando os dois
se encontrarem, o rate de XP multiplica **depois** da soma de percentuais de bônus — a ordem do
Canary (`exp × (1 + bônus%) × stamina × baseRate`).

Fora daqui: `rateSpawn` e `rateKillingInTheNameOfPoints` (sem sistema correspondente), os
`SCHEDULE_*_RATE` de evento, VIP e boosted creature, e a exibição dos rates ao jogador.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| HP / mana / capacidade por level — Knight | +15 / +5 / +25 (o Tibia; ADR 0026, decisão 5) | `packages/content/data/vocations/knight.json` |
| HP / mana / capacidade por level — Paladin | +10 / +15 / +20 (o Tibia; ADR 0026) | `packages/content/data/vocations/paladin.json` |
| HP / mana / capacidade por level — Sorcerer | +5 / +30 / +10 (o Tibia; ADR 0026) | `packages/content/data/vocations/sorcerer.json` |
| HP / mana / capacidade por level — Druid | +5 / +30 / +10 (o Tibia; ADR 0026) | `packages/content/data/vocations/druid.json` |
| Arma inicial de cada vocação | steel axe / bow / wand of vortex / snakebite rod (ADR 0026, decisão 3; #154) | `packages/content/data/vocations/*.json`, `startingWeaponItemId` |
| Kit inicial de cada vocação (level 8) | Knight: steel axe + wooden shield; Paladin: bow (o escudo vai para a mochila, duas mãos); Sorcerer: wand of vortex + wooden shield; Druid: snakebite rod + wooden shield (#496) | `packages/content/data/vocations/*.json`, `startingKit` |
| Skill de distância — início, curva (base), dano por nível | 10 / 30 / +2% `[ABERTO — dano por nível provisório]` (base = `skillBase` da distância no Canary, #521, ADR 0037; o `factor` é por vocação, ver abaixo; sobe por tiro de bow, #152) | `packages/content/data/skills/distance.json` |
| HP inicial (level 1) | 150 (o Tibia; verificado batendo o HP 3065 do Knight level 200, #521) | `packages/content/data/progression/baseline.json` |
| Mana inicial (level 1) | 55 (o Tibia: `5 × (level + 10)`, verificado batendo a mana 1050/5850 do Knight/Sorcerer level 200, #521, ADR 0037 — substitui os 20 provisórios da FUN-114) | `packages/content/data/progression/baseline.json` |
| Capacidade inicial | 400 (o Tibia) | `packages/content/data/progression/baseline.json` |
| HP por level antes da vocação | 5 (o `gainhp` da vocação `None` do Canary `vocations.xml`, #521) | `packages/content/data/progression/baseline.json` |
| Mana por level antes da vocação | 5 (o `gainmana` da vocação `None` do Canary, #521) | `packages/content/data/progression/baseline.json` |
| Level em que a vocação é escolhida | 8 | `packages/content/data/progression/baseline.json` |
| Quantidade de promoções no MVP | 1 | caminho previsto: `packages/content/vocations` |
| Curva de ganho de pontos de passiva | `[ABERTO]` | caminho previsto: `packages/content/vocations` |
| Teto de pontos de passiva | `[ABERTO]` | caminho previsto: `packages/content/vocations` |
| Curva de XP | a cúbica do Tibia, `(L³ − 6L² + 17L − 12) / 6 × 100` (#521, ADR 0037 — ver seção acima) | `packages/content/data/progression/baseline.json`, `xp: { kind: 'tibia' }` |
| Bônus de XP por level | 200% até o level 300 (inclusive), 100% acima — aditivo com o Bestiário (#563, decisão de produto) | `packages/content/data/progression/baseline.json`, `experienceBonusByLevel` |
| Velocidade do personagem | 220 no level 1, +2 por level, sem incremento por vocação — o TFS clássico (`PLAYER_BASE_SPEED` + 2×(level−1), `forgottenserver` `src/player.h`/`vocations.xml`, #527, ADR 0037 decisão 4); é a MESMA escala do passo (`ceil50(chão × 1000 / speed)`) e da velocidade de monstro, e por isso não segue o Canary (110 de base, +1/level — outra escala de cliente). Antes do #527 era 278 (observação do Huntera), provisório e sem fonte única com o resto do motor. `startingSpeed` / `speedPerLevel` e `regen` viajam também em `catalogue.progression` (#361, SV-25) | `packages/content/data/progression/baseline.json`, `startingSpeed` / `speedPerLevel` |
| Regeneração de vida/mana — sem vocação (levels 1–7) | pulsos: 1 de vida a cada 12 000 ms / 2 de mana a cada 6 000 ms (a vocação `None` do Canary: `gainhpticks`/`gainhpamount`, `gainmanaticks`/`gainmanaamount` — #521, ADR 0037; em pulsos desde #678) | `packages/content/data/progression/baseline.json`, `regen.health` / `regen.mana` (`ticksMs`, `amount`) |
| Regeneração de vida/mana — Knight / Paladin / Sorcerer / Druid | vida/mana, `amount` a cada `ticksMs`: Knight 1/6 000 e 2/6 000 · Paladin 1/8 000 e 2/4 000 · Sorcerer e Druid 1/12 000 e 2/3 000 (o `vocations.xml` do Canary, #521, #678) | `packages/content/data/vocations/*.json`, `regen` |
| Regeneração exige comida? | `false` (o Huntera — ADR 0043 emenda de 2026-09-25: regenera sempre em hunt, sem comida) | `packages/content/data/progression/baseline.json`, `regeneration.requiresFood` |
| Multiplicador de skill/ML por vocação — Knight | fist/club/sword/axe 1,1 (uniforme) / distância 1,4 / escudo 1,1 / magia 3,0 (`<skill id multiplier>` e `manamultiplier` do Canary, #521/#567, ADR 0037) | `packages/content/data/vocations/knight.json`, `skillMultipliers` |
| Multiplicador de skill/ML por vocação — Paladin | fist/club/sword/axe 1,2 (uniforme) / distância 1,1 / escudo 1,1 / magia 1,4 | `packages/content/data/vocations/paladin.json`, `skillMultipliers` |
| Multiplicador de skill/ML por vocação — Sorcerer | fist 1,5 / club/sword/axe 2,0 / distância 2,0 / escudo 1,5 / magia 1,1 | `packages/content/data/vocations/sorcerer.json`, `skillMultipliers` |
| Multiplicador de skill/ML por vocação — Druid | fist 1,5 / club/sword/axe 1,8 / distância 1,8 / escudo 1,5 / magia 1,1 (só a Druid difere da Sorcerer aqui — a XML do Canary não trata as duas como idênticas) | `packages/content/data/vocations/druid.json`, `skillMultipliers` |
| Multiplicador de skill/ML sem vocação (levels 1–7) | fist 1,5 / club/sword/axe 2,0 / distância 2,0 / escudo 1,5 / magia 4,0 (a vocação `None`) | `packages/content/data/progression/baseline.json`, `skillMultipliers` |
| Penalidade de morte — fração fixa (< level 24) | 10 % da XP ACUMULADA (não mais de `xpToCompleteLevel`) — o Tibia, #521, ADR 0037 | `packages/content/data/progression/baseline.json`, `deathPenalty.flatFraction` |
| Penalidade de morte — limiar da fórmula cúbica | level 24 (o Tibia) | `packages/content/data/progression/baseline.json`, `deathPenalty.cubicFromLevel` |
| Penalidade de morte — redução de quem está abençoado (`premium`) | 56 % (sete bênçãos × 8 % do Tibia — mapeia o `premium` que o repo já tinha) | `packages/content/data/progression/baseline.json`, `deathPenalty.blessedReduction` |
| Penalidade de morte — redução de quem está promovido | 30 %, ADITIVA à de bênção e NUNCA tetada (`Player::getLostPercent`, #569; ligado ao estado real do personagem pelo #566) | `packages/content/data/progression/baseline.json`, `deathPenalty.promotionReduction` |
| Promoção — level mínimo e preço | level 20, 20.000 gold, iguais nas quatro vocações (`data-otservbr-global/npc/king_tibianus.lua:194-204`, o NPC-padrão de promoção do Canary — #566, ADR 0042 decisão 1) | `packages/content/data/vocations/*.json`, `promotion.minLevel`/`promotion.price` |
| Promoção — regen de Elite Knight | vida/mana, `amount` a cada `ticksMs`: 1/4 000 e 2/6 000 (`vocations.xml` id 8 do Canary, mais rápido que o Knight base 1/6 000) | `packages/content/data/vocations/knight.json`, `promotion.regen` |
| Promoção — regen de Royal Paladin | 1/6 000 e 2/3 000 (id 7, mais rápido que o Paladin base 1/8 000 e 2/4 000) | `packages/content/data/vocations/paladin.json`, `promotion.regen` |
| Promoção — regen de Master Sorcerer / Elder Druid | vida igual à base (1/12 000); mana 2/2 000, mais rápida que a base 2/3 000 (ids 5 e 6) | `packages/content/data/vocations/{sorcerer,druid}.json`, `promotion.regen` |
| Promoção — soul máximo e cadência | 200 / 15.000 ms, contra 100 / 120.000 ms da base (`soulmax`/`gainsoulticks` do Canary, ids 5-8) — **campo pronto, sem consumidor ainda**: depende do mecanismo de soul (#593) mesclar | `packages/content/data/vocations/*.json`, `promotion.soulMax`/`promotion.soulGainTicksMs` |
| Penalidade de morte — redução por bênção (#570) | 8 % por bênção, sete dão 56 % — mapeia o gradiente real de `CharacterRuntime.blessings` | `packages/content/data/progression/baseline.json`, `deathPenalty.blessingReduction` |
| Penalidade de morte — redução de quem está promovido | 30 %, ADITIVA à de bênção e NUNCA tetada (`Player::getLostPercent`, #569; `promoted` ainda não é estado do personagem — ver #566/ADR 0042) | `packages/content/data/progression/baseline.json`, `deathPenalty.promotionReduction` |
| Penalidade de morte — piso de level | **removido pelo #569** — o Tibia nunca teve piso (ver "Divergências do PRD"); o personagem pode cair até o level 1 | — |
| Penalidade de morte — skill tries e mana gasta | o MESMO percentual que tira XP tira também os tries de cada skill (podendo derrubar o nível dela) e a mana gasta — modelada como os pontos da skill `magic`, sem campo próprio (#569, `Player::death`) | — (mecanismo em `packages/sim/src/progression.ts`, `applySkillLosses`) |
| Loyalty (bônus da idade da conta sobre skill e ML) | 1 ponto por dia de conta; 10 degraus de 360 em 360 pontos, de 5 % a 50 % (o Canary, #628; ver "Loyalty") | `packages/content/data/loyalty/baseline.json` |
| Rates do servidor (XP, skill, magia, loot, stages, monstro, boss) | todos 1, stages desligados — o Tibia com rate 1 (#691; ver "Rates do servidor") | `packages/content/data/progression/baseline.json`, `rates` (ausente = neutro) |
| Referência de catálogo de magias | Tibia até o level 80 no M12 (ADR 0026), ~120 depois (referência funcional; números por Base Power do TibiaWiki) | `packages/content/data/spells/` |
| Fist/Club/Sword/Axe — início, curva (base), dano por nível | 10 / 50 / +2% `[ABERTO — dano por nível provisório]` (base = `skillBase` do Canary para os quatro tipos, #521/#567, ADR 0037; `factor` por vocação, ver acima — separadas da antiga skill única `melee` no #567) | `packages/content/data/skills/{fist,club,sword,axe}.json` |
| Magia (ML) — início, curva (base), dano por nível | 0 / 1600 / +3% `[ABERTO — dano por nível provisório]` (base = `getReqMana` do Canary — o custo do ML1 é sempre a base cheia, o expoente zera; `factor` = `manamultiplier`, por vocação, ver acima; #521, ADR 0037) | `packages/content/data/skills/magic.json` |
| Escudo — início, curva (base), defesa por nível | 10 / 100 / +2% `[ABERTO — defesa por nível provisória]` (base = `skillBase` do escudo no Canary, #521, ADR 0037; `factor` por vocação, ver acima) (CMB-04) | `packages/content/data/skills/shielding.json` |
| Cura — mana, cooldown, quanto cura | 20 / 1 000 ms / 60 `[ABERTO — valor provisório]` | `packages/content/data/spells/heal.json` |
| Golpe Arcano — mana, cooldown, dano, alcance | 15 / 2 000 ms / 40 / 3 tiles `[ABERTO — valor provisório]` | `packages/content/data/spells/strike.json` |

O catálogo tem **duas magias** (FUN-74), e é de propósito: uma de cura e uma de dano de alvo
único são o suficiente para o motor de magia existir por inteiro — custo, cooldown, alcance,
alvo, atribuição e morte. Magia em área e o resto do catálogo entram depois, contra um motor que
já está provado. Ver [`combat.md`](./combat.md) e [`bot.md`](./bot.md).

## Em aberto

- ~~[ABERTO] HP/Mana por level do Druida (§9.3)~~ → **Resolvido:** +5 / +30 / +10, o do Tibia (ADR 0026, decisão 5), em `packages/content/data/vocations/druid.json`.
- ~~Skills separadas por tipo de arma (sword/axe/club), como no Tibia~~ → **Resolvido pelo #567:**
  `fist`/`club`/`sword`/`axe` são quatro skills agora, cada uma com o `skillMultipliers` por
  vocação do `<skill id multiplier>` do Canary — a taxonomia de **família** já existia desde o
  CMB-05, e faltava só a skill acompanhar. O Knight (`vocation.spellSkill`) deixa de apontar uma
  skill fixa: `SPELL_SKILL_WEAPON` ("weapon") é a sentinela que o `sim` resolve pela FAMÍLIA da
  arma equipada, para Berserk/Groundshaker/Front Sweep/Fierce Berserk/Whirlwind Throw escalarem
  certo trocando de arma. ~~Migração do dado persistido e do painel do cliente ficam para a
  #568~~ → **Resolvido pelo #568:** a migração `0013` (`packages/server/migrations`) copia
  `skills.melee` para `club`/`sword`/`axe` de quem já tinha treinado corpo a corpo (mesma curva
  que `melee` tinha antes da separação), com `coalesce` protegendo progresso real já gravado
  depois do #567 e sem apagar `melee` (ADR 0014 — a chave fica órfã, sem uso, até uma remoção
  declarada); `fist` nasce no inicial, porque não há como saber, olhando só o total acumulado em
  `melee`, quanto veio de golpe desarmado. O painel Skills do cliente (`SkillsPanel.tsx`,
  `state/hud.ts`, `state/apply.ts`, `shell/skills-preference.ts`) troca a linha única "Corpo a
  Corpo" pelas quatro — Punho/Maça/Espada/Machado, cada uma com sua barra de progresso.
- Base de progressão (HP/mana/capacidade iniciais e crescimento dos níveis 1–7) não está no
  PRD: o §9.3 define só o incremento **por vocação**. Desde a #521 (ADR 0037) esses números SÃO
  o Tibia (`gainhp`/`gainmana`/`gaincap` da vocação `None`, verificados no Canary
  `vocations.xml`), não mais provisórios do Draconya — só `startingCapacity` (400) continua sem
  fonte oficial do PRD. ~~A velocidade também~~ → **Resolvido pela #527 (ADR 0037 decisão 4):**
  `startingSpeed`/`speedPerLevel` agora são o TFS clássico (220, +2/level), a mesma escala do
  passo e da velocidade de monstro — ver a linha "Velocidade do personagem" acima.
- ~~A curva de XP também não está no PRD~~ → **Resolvido pela #521 (ADR 0037):** a curva agora
  é a cúbica do Tibia (`Player::getExpForLevel`), não mais uma escolha de balanceamento do
  Draconya — ver "A curva de XP é a do Tibia" acima.
- Skill/ML por vocação (multiplicador de crescimento), regeneração por vocação e a penalidade
  de morte também eram provisórios do Draconya e **foram resolvidos pela #521 (ADR 0037)**: os
  três agora são os números do Tibia, verificados no Canary `vocations.xml` e em
  `player.cpp`/`vocation.cpp` — ver as seções acima e a tabela de parâmetros.
- **Bônus de XP de level baixo (M32-02, #563):** o [ADR 0043](../adr/0043-tibia-stamina-and-food-only-regeneration.md)
  tinha essa questão bloqueada entre o `lowLevelBonusExp = 50` fixo do TFS/Canary e "fora de
  escopo". A resposta do dono de 2026-09-25 ("copie do Huntera") resolveu a FORMA: um
  multiplicador `levelBonusPercent`, decrescente por level, medido em quatro pontos no Huntera
  (L1 +200 %, L2 +199 %, L3 +197 %, L7 +192 %) — ver a linha na tabela de parâmetros acima e a
  emenda do ADR 0043. A fórmula exata da curva e o level em que ela zera continuam `[ABERTO]`.
- **Regeneração só com comida (#726, ADR 0049 decisão 5):** a emenda do ADR 0043 de
  2026-09-25 tinha REVERTIDO a regeneração por comida (o Huntera regenera sempre em hunt, sem
  condição de comida observada). O ADR 0049 reabre essa porta como FLAG de conteúdo
  (`progression.regeneration.requiresFood`, default `false` — o Huntera continua valendo) em
  vez de decisão de arquitetura: o dono pode ligar a regra do Tibia (regenerar só com
  `fedMs > 0`, dado por comida) editando conteúdo, sem deploy de lógica nova. `fedMs` é rastreado
  desde já (comer sempre soma o contador), mesmo com a flag desligada.

## Decidido na implementação: a vocação não é retroativa

O PRD é silencioso sobre o que acontece com os sete primeiros levels quando a vocação é
escolhida no level 8. A implementação **não recalcula**: os incrementos até o level 8 saem da
tabela base, e só os levels acima seguem a vocação.

O motivo é o jogador. Recalcular mudaria o HP máximo de uma vez, na tela, no momento da
escolha — e um número que salta sem explicação parece bug, não progressão. Se o balanceamento
pedir o contrário depois, é mudança de conteúdo mais uma migração, não de lógica.

Quem passa do level 8 **sem** escolher vocação continua crescendo pela tabela base. O §7.4
permite adiar a escolha, e travar o crescimento seria punição silenciosa por algo que o jogo
não avisa.
- Nomes finais das vocações e das promoções (§9.1).
- Curva exata de ganho de pontos de passiva e teto final da árvore — foi discutida uma desaceleração progressiva em levels altos, mas nada foi fechado (§9.5).
- Catálogo final de magias e números de balanceamento associados (§43.1).

## Divergências do PRD

- **§9.3 — ganho por level por vocação.** O PRD fixava Cavaleiro +20 HP/+5 mana, Arqueiro
  +15/+10, Feiticeiro +5/+25 e deixava o Druida em aberto. Decisão do usuário em 2026-09-12
  (ADR 0026, decisão 5): copiar o Tibia — Knight 15/5/25, Paladin 10/15/20, Sorcerer e Druid
  5/30/10 (HP / mana / capacidade), sem vocação 5/5/10 —, "qualquer coisa eu edito depois". Os
  números moram em `packages/content/data/vocations/*.json` e entram pela issue #151.
- ~~§26.2 — piso de level da penalidade de morte (levelFloor, #521, ADR 0037).~~ →
  **Removido pelo #569:** o Draconya deixou de proteger o level 8 — **o Tibia real não tem esse
  piso** (confirmado na TibiaPlan, "Tibia Death Penalty", 2026-09-24: todo mundo perde XP,
  mesmo abaixo do level 8, e `Player::death` também derruba skill tries e mana gasta sem piso
  nenhum). O piso era decisão de PRODUTO do Draconya desde antes da #521, para não punir com
  perda de level quem acabou de escolher vocação; o #569 alinhou o comportamento ao Tibia real,
  e o personagem agora pode cair até o level 1.
- **§9.1/§43.1 — como a promoção é obtida.** O PRD (linha 12 acima) previa quest. O ADR 0042
  (decisão 1) decidiu diferente: **serviço de Cidade** — level 20, 20.000 gold debitados pelo
  ledger, sem diálogo de NPC nem item de quest —, porque o Draconya não tem motor de diálogo
  (invariante 8: a Cidade não simula nada além de navegação) e uma tela de serviço é o mesmo
  padrão já recomendado para bênçãos (M33) e para o Santuário de Imbuement (M40). O Huntera
  confirma que a promoção EXISTE (nomes de vocação promovida observados numa party, Parte IV do
  `docs/reference/huntera-observed.md`) mas nunca capturou o mecanismo de obtenção — level e
  preço vêm do Canary (`king_tibianus.lua:194-204`) como valor provisório até uma captura futura.

## Como a vocação é escolhida (ADR 0026, decisões 1 e 3)

Pelo jogador, no level 8 ou depois, **uma vez**, por uma intenção `choose-vocation` do cliente —
na Cidade ou numa hunt, sem NPC, altar ou lugar. Ao escolher, a arma da vocação vai para a mão
e a machete do kit de nascimento volta para a mochila; a vocação é escrita no banco uma vez, pelo
extrato, e volta pelo ticket. Quem passa do 8 sem escolher continua crescendo pela tabela base
(ver abaixo). Não há troca de vocação: passiva tem respec (§9.5), vocação não. Implementação na
issue #154.

## Promoção de vocação (#566, ADR 0042 decisão 1)

Estado do personagem, não uma vocação nova no catálogo: `CharacterRuntime.promoted: boolean`,
persistido em `characters.promoted` (`not null default false`). As regras que checam
`vocationId` continuam checando a base (Knight continua `knight`, nunca vira `elite-knight`); a
vocação ganha um bloco `promotion` opcional (`packages/content`) com o nome de exibição, o regen
promovido e o requisito de obtenção.

**Como se obtém.** Na Cidade, com vocação escolhida, level ≥ 20 e 20.000 gold disponível: o
cliente manda `promote-vocation` (opcode 29, sem payload); o servidor confere tudo e debita o
preço por `goldDelta`, liquidado pelo mesmo canal que já debita `sell-items` na praça
(invariante 10). Fora da Cidade a intenção é recusada — não é possível promover numa hunt.
`promoted` nunca desce: o ledger funde por `OR` (`characters.promoted OR receipt.promoted`), não
por `coalesce` — a diferença é que boolean não tem "ausente" que precise ser preenchido uma vez
só, só "nunca reverte".

**O que muda ao promover.** Regeneração de vida/mana passa a usar `promotion.regen` (ver
tabela); a penalidade de morte soma os 30% de `promotionReduction` (#569, ligado pelo #566). O
HUD troca o nome exibido pelo `promotion.name` — "Elite Knight" em vez de "Knight" — no
`TopBar` e no modal Personagem, que também mostra a tela de serviço (requisito, preço, botão)
enquanto o personagem não promoveu.

**O que ainda não está ligado.** `promotion.soulMax`/`promotion.soulGainTicksMs` existem no
conteúdo (os números do Canary, 200/15.000 ms) mas não têm consumidor: dependem do mecanismo de
soul (#593) mesclar primeiro. Liberação de magia por promoção (linha 12 acima) também não está
ligada — depende do catálogo de magias que a exigiria.

## Skills sobem pelo USO (FUN-75)

§9.4 **[DECIDIDO]**: skill não vem de level, vem de fazer — paradigma do Tibia. Quais skills
existem, quanto cada uso rende, quanto custa cada nível e quanto ela acrescenta ao golpe são
todos **conteúdo**, em `packages/content/data/skills/`.

| Skill | Alimentada por | Contribuição |
|---|---|---|
| Fist / Club / Sword / Axe | cada golpe que sai, na skill da FAMÍLIA da arma usada (#567: espada treina `sword`, não `axe`) | multiplica o poder do golpe |
| Distância | cada tiro de arma de distância (#152) | multiplica o poder do tiro |
| Magia | **mana gasta**, não lançamentos | multiplica o poder da magia |
| Escudo | cada ataque físico elegível recebido (CMB-04); no `combat-v3`, só o bloqueado com escudo (#686) | multiplica a defesa do escudo ou da arma de uma mão |

**Shielding sobe por bloqueio, não por ser atacado.** A prática é do evento elegível — o
defensor tem escudo ou arma de uma mão e o ataque é de um tipo aprovado —, e não depende de o
bloqueio ter acontecido nem de quanto HP foi perdido: um bloqueio total ainda treina, e um
ataque elemental não treina. O rato parado, sem atacar, também não move a skill (não é por
tick). A fórmula e a posição do sorteio estão em
[`combat.md`](./combat.md) e na emenda do ADR 0031.

### No `combat-v3`, o try depende do tipo de bloqueio (#686)

Com o perfil `combat-v3` (ADR 0040), as três práticas acima seguem a regra do Canary
(`combat/attack-practice.ts`). O alvo devolve o **tipo de bloqueio** do golpe
(`resolveBlockHit`, antes da mitigação percentual): `none` (tirou sangue), `defense` (a defesa
zerou), `armor` (a armadura zerou) ou `immunity`. O personagem guarda quatro campos em
`CharacterRuntime.attackPractice`, zerados a cada sessão e nunca salvos no banco (só no snapshot
quente, omitidos quando iniciais):

| Evento | Efeito |
|---|---|
| golpe `none` | treina; `bloodHitCount` e `shieldBlockCount` voltam a 30 |
| golpe `defense`/`armor` | treina só se `bloodHitCount > 0`, e gasta um — 30 bloqueados seguidos no máximo |
| golpe `immunity` | não treina; contadores intactos |

| Skill | Tries por golpe no `combat-v3` |
|---|---|
| Fist/Club/Sword/Axe (e punho) | 1 se o golpe treina e não foi imune, senão 0 — na skill DA FAMÍLIA usada (#567) |
| Distância | 2 no tiro limpo, 1 no bloqueado, 0 no imune ou sem sangue; o tiro **errado** usa o estado do tiro anterior |
| Escudo | 1 quando o golpe RECEBIDO foi bloqueado (`defense`/`armor`) com carga de `blockCount`, `shieldBlockCount > 0` e **escudo** na mão — arma de uma mão não treina; o contador cai mesmo sem escudo |

Magia, runa e wand também passam pelo tipo do alvo: um acerto limpo recarrega os contadores, mas
não rende try de arma (a wand continua praticando magia por mana). Com secundário, a última
chamada vence (o secundário). O primeiro golpe da sessão que for bloqueado, e o primeiro tiro
errado, rendem 0 — nada nasce carregado. `30` e `2/1/0` são constantes do `sim`
(`BLOOD_HIT_RECHARGE`, `distanceTries`), não conteúdo. `combat-v1`/`v2` seguem a regra de
cima, bit a bit. O tique de condição do próprio personagem ainda não recarrega os contadores
(no Canary ele passa pelo `blockHit`): fica para issue própria.

### O ritmo de cada skill é por VOCAÇÃO (#521, ADR 0037)

`pointsForLevel(definition, level, factor)` (`packages/sim/src/skills.ts`) sempre calculou
`base × factor^(level − startingLevel)`; o que mudou é de onde vem `factor`. Antes era só o
`curve.factor` do JSON da skill — igual para todo mundo. Agora `skillFactorFor(definition,
vocation, progression)` escolhe o multiplicador da VOCAÇÃO de quem está usando (o `<skill id
multiplier="…">` do Canary `vocations.xml`), caindo no `skillMultipliers` da tabela base (a
vocação `None`) para quem ainda não escolheu, e só no `curve.factor` do próprio conteúdo quando
nem vocação nem tabela base declaram um valor — o caminho do conteúdo de teste antigo.

É por isso que um Knight sobe corpo a corpo rápido (multiplicador 1,1, uniforme nos quatro tipos
desde o #567) e magia devagar (3,0), e um Sorcerer o oposto (fist 1,5 / club-sword-axe 2,0 / magia
1,1) — a MESMA curva de conteúdo (`base`, `startingLevel`), um fator diferente por quem está
jogando. A mesma tabela cobre magic level: no Canary, ML é só mais uma entrada de `vocations.xml`
(`manamultiplier`), então não tem mecanismo próprio — é `skillMultipliers.magic`, como qualquer
outra skill.

`character.skills.gain`/`progressOf` recebem o `factor` já resolvido: quem chama (o ruleset, ou
`playerStatsOf` no `host`) é quem sabe a vocação do personagem — `Skills` continua sem conhecer
`Vocation` nem `Progression`, só números.

### Famílias de arma e proficiência (CMB-05, #333)

A skill que uma arma alimenta e escala não está escrita no ruleset: cada **família de arma** é
dado em `packages/content/data/weapon-families/` e aponta para uma skill e para uma fórmula. As
famílias são `fist` (desarmado), `sword`, `axe`, `club`, `distance`, `wand` e `rod`; o item de
arma declara a sua, e `buildContent` recusa família incoerente com o `kind` ou que não exista.

- `sword`/`axe`/`club`/`fist` apontam cada um para a SUA própria skill (`sword`/`axe`/`club`/
  `fist`, #567) — antes disso as quatro compartilhavam `melee`; a espada não treinava mais
  machado por acidente porque `#practice` (`sim`) já cita a skill pela FAMÍLIA, e não por um
  gatilho compartilhado (`#gainSkill`, não `#gainSkills`, é quem credita o uso — a distinção
  importa porque `fist`/`club`/`sword`/`axe` continuam com o MESMO `gain.on: 'melee-hit'`).
- `distance` aponta para a skill `distance`; o `base` da fórmula é o `attack` da **munição**.
- `wand`/`rod` apontam para a skill `magic` e **não** têm fórmula: usam a faixa fixa e o
  `manaPerHit` da arma, e praticam por **mana gasta**. Elas não recebem multiplicador de weapon
  skill por engano (DT-02).
- `fist` é o fallback sem item: o `attack`, o alcance e o tipo vêm de `combat.player`, e a
  fórmula é a da família. Ela não existe como arma no catálogo.

A contribuição por nível de skill de uma família é o `damagePerLevel` da skill apontada — editar
a skill rebalanceia todas as famílias que a usam. A fórmula da família (os fatores
`levelFactor` e `spread`) é provisória e está marcada em `_open` no arquivo.

**Magia sobe por mana gasta, e isso é mecanismo, não número.** Por lançamento, a forma ótima de
subir magia seria lançar mil vezes a magia mais barata, e o jogo viraria macro de spam. É a razão
pela qual o Tibia faz assim, e ela vale copiar.

**O golpe conta como uso mesmo quando acerta de raspão.** Contar só acerto cheio faria a skill
subir mais devagar contra alvo blindado, que é o oposto do que "sobe pelo uso" quer dizer. Magia
recusada, ao contrário, **não** rende nada: não gastou mana, não praticou.

**O custo de um nível é inteiro.** `50 × 1,1` dá `55,000000000000007` em ponto flutuante, e o
resto que sobra ao fechar um nível carregaria esse lixo para o próximo — numa hunt de oito horas
são milhares de níveis de resíduo somado. Com custo inteiro e uso inteiro, a conta fecha exata.

Subir uma skill é **evento notável** (§16.2): numa hunt de oito horas é uma das poucas coisas que
o jogador quer ver ao voltar, ao lado do level up.

### Como a skill vai e volta do banco

| | quando | forma |
|---|---|---|
| entra na sessão | emissão do ticket | vem da coluna `skills`, junto com level, XP e gold |
| sai da sessão | extrato → ledger | valor **absoluto**, fundido pelo maior de cada skill |

A skill precisa **entrar**, não só sair: ela escala o dano durante a hunt, e um personagem que
entrasse sempre no nível inicial bateria errado a hunt inteira.

Sai absoluta porque a sessão já entrou com o valor de verdade — somar delta por cima do banco
daria o mesmo número com uma chance a mais de contar duas vezes. E a fusão pelo **maior** de cada
skill é a regra, não uma escolha conservadora: skill nunca desce, então um extrato antigo
processado fora de ordem não tem como rebaixar o que já subiu. É a preocupação que a stamina
resolve com guarda de instante, resolvida aqui sem instante nenhum.

Extrato **sem** skills não apaga as que já estavam lá — é o extrato de uma sessão de Cidade, ou de
um nó antigo durante deploy em rolagem.

### O que chega ao cliente (SV-04)

Três campos são expostos em `player-stats` e em `session-state.self`:
- `speed`: velocidade do personagem (`Math.round(character.speed * character.speedScale)`), calculada a partir de `startingSpeed` e `speedPerLevel`, escalada por efeitos de aceleração (haste).
- `skills`: mapa de `skillId` para `{ level, percentToNext }`, cobrindo as três skills do jogo (`melee`, `distance`, `magic`).
- `magicLevel`: atalho com `{ level, percentToNext }` para a skill `magic` (`skills.magic`), duplicado no topo para facilitar acesso direto nas barras de interface do HUD e manter paridade com as barras clássicas.

O percentual para o próximo nível (`percentToNext`) é um número inteiro de 0 a 99 (truncado via piso `Math.floor` e limitado a 99 enquanto o nível não fecha).

## Loyalty: o bônus da idade da conta sobre skill e ML (#628, ADR 0052 d.5)

**Status:** implementado — bônus no nível efetivo de toda skill de uso e do magic level, fixado
por sessão, mostrado no painel Skills. **Fora:** o título de Loyalty ("Scout of Tibia" …
"Enlightened of Tibia") — é apresentação, sem efeito de jogo, e o Draconya não tem onde
mostrá-lo.

O Tibia dá a quem tem conta velha um bônus percentual sobre os **tries** que a skill já
acumulou, convertido em níveis extras na curva REAL da vocação (`Player::getLoyaltySkill` e
`getLoyaltyMagicLevel`, `player.cpp:1100-1125` e `7429-7453`). `getSkillLevel`/`getMagicLevel`
usam esse nível no lugar do base — por isso o bônus vale no dano, na chance à distância, na
defesa do escudo, na cura, na fórmula de magia e no requisito de `magicLevel` de uma runa, e não
só no que a tela mostra.

### Quem calcula o quê

| Peça | Quem | Onde |
|---|---|---|
| Dias de conta | a `api`, na EMISSÃO do ticket, com o relógio dela: `floor((agora − account.created_at) / 86 400 000)` — `Account::getAccountAgeInDays` do Canary, que divide inteiro | `packages/server/src/loyalty.ts` (`accountAgeDays`), `GameRepository.getAccountCreatedAt` |
| Pontos e degrau | a `api`, com a tabela do conteúdo: `dias × pointsPerCreationDay`, o `percent` do MAIOR degrau que os pontos alcançam, × `bonusPercentageMultiplier`, **truncado** (`setLoyaltyBonus(uint16_t)`) | `packages/sim/src/loyalty.ts` (`loyaltyPointsOf`, `loyaltyBonusPercentOf`) |
| Bônus na sessão | o `game`, fixado no `CharacterRuntime` ao entrar (`InitialCharacter.loyaltyBonusPercent`) e **nunca relido** — atravessa toda transição Cidade↔hunt e toda retomada de snapshot | `CharacterState.loyaltyBonusPercent` |
| Tries → níveis extras | o `sim` | `LoyaltyLevels.levelOf`, `CharacterRuntime.loyaltyLevelOf`, `HuntRuleset#loyaltyLevelOf` |

O valor **não é persistido**: deriva de `account.created_at` a cada ticket, então não há coluna,
migração, extrato nem ledger. Uma conta que completa o dia 360 no meio de uma sessão só ganha o
degrau na PRÓXIMA entrada — o `initializeLoyaltySystem` do Canary também roda só no login. Numa
party, cada membro carrega o bônus da PRÓPRIA conta (`/start` e `/join`); o do líder não nivela
ninguém.

### A conta do Canary

`total = tries acumulados até o nível + tries do nível corrente` (soma do custo de todos os
níveis já fechados, `Σ pointsForLevel` de `startingLevel` a `level − 1`); `bonus = floor(total ×
percent / 100)`; e o `bonus` é gasto nível a nível — cada nível custa o `pointsForLevel` dele, o
primeiro já contando os tries que o personagem tinha — até acabar. É o **mesmo custo** que
`Skills.gain` cobra, e o mesmo piso vale para skill (10) e para o magic level (0) porque o piso é
o `startingLevel` do conteúdo. O bônus é sobre TRIES, não sobre o nível: 50 % numa espada de
Knight nível 100 (2 655 971 tries acumulados) vale **4 níveis** (104), não 50; e 10 % no mesmo
ponto (265 597 tries) fica 54 tries abaixo do custo de sair do 100 (265 651) e não vale nada.

O "nível máximo" do Canary também vale: quando o custo do próximo nível deixa de crescer
(`currReqTries >= nextReqTries` — a conversão para `uint64` estourou, ou o fator é 1), o nível
base é o teto e o bônus não passa dele. Os tries do `Skills` do Draconya podem ser fracionários
(rate ≠ 1); a conta usa o piso, como os tries inteiros do Tibia.

### O que lê o nível efetivo, e o que continua no base

| Lê o nível COM Loyalty | Continua no nível BASE |
|---|---|
| golpe corpo a corpo e à distância, chance de acerto à distância, defesa do escudo/arma, fórmula de magia e de cura, requisito de `magicLevel` de runa e o espelho dele no `slotStates` | ganhar tries, o estágio de rate de skill/ML (`getBaseMagicLevel`), a penalidade de morte, o extrato e o snapshot |

Um único ponto, `HuntRuleset#loyaltyLevelOf`, faz a leitura; sem bônus (o caso de toda conta com
menos de 360 dias) ele devolve o nível base sem achar a vocação nem calcular fator nenhum. O
custo acumulado por skill fica num cache derivado do personagem (`LoyaltyLevels`), que nunca vai
ao snapshot.

**Correção junto:** o espelho do `slotStates` para o requisito de `magicLevel` de uma runa lia só
o nível base, enquanto o disparo (`#runeScaling`) já somava o bônus de equipamento (#524) e o de
condição (#576) — a tela podia mostrar a runa trancada com o disparo liberado. Os três lugares
(`#runeScaling`, `#spellScaling` e o espelho) leem agora o mesmo `#magicLevelOf`.

### O que chega ao cliente

`player-stats` e `session-state.self` ganham `loyaltyBonusPercent` (inteiro; **ausente** quando
é zero) e cada `SkillProgress` ganha `loyaltyLevel` (o nível efetivo; **ausente** quando o bônus
não muda o nível). O painel Skills mostra o nível efetivo na linha (o que o Tibia desenha), o
base e o quanto o Loyalty soma na dica da linha ("Base 100 + 4 de Loyalty"), e "Loyalty +50%" no
cabeçalho. A barra de progresso continua a do nível BASE — é nele que os tries entram.

| Parâmetro | Valor | Onde mora em packages/content |
|---|---|---|
| Loyalty ligado | `true` (`loyaltyEnabled`) | `packages/content/data/loyalty/baseline.json`, `enabled` |
| Pontos por dia de conta | 1 (`loyaltyPointsPerCreationDay`); os dois de Premium (`loyaltyPointsPerPremiumDay*`) valem 0 no `config.lua.dist` e o Draconya não rastreia dias de Premium comprados — o resultado é o mesmo | `loyalty/baseline.json`, `pointsPerCreationDay` |
| Multiplicador do percentual | 1,0 (`loyaltyBonusPercentageMultiplier`) | `loyalty/baseline.json`, `bonusPercentageMultiplier` |
| Degraus | 360 → 5 %, 720 → 10 % … 3 600 → 50 %, de 360 em 360 pontos (`data/libs/functions/player.lua:762-790`) | `loyalty/baseline.json`, `tiers` |

## Alma (soul, #593)

**Status:** implementado — máximo, ganho por XP e custo de magia. **Conjuração ainda não** (a
magia que de fato gasta alma é a #594).

Saiu de `docs/product/future-systems.md`: o handoff só listava "Soul Points" como estatística de
personagem, mas o épico E7 já cobria a mecânica que faltava — o Canary cobra alma
(`spell:soul(n)`) de 50 magias de conjuração de runa, e sem alma nenhuma delas existe de verdade.

**O teto e a cadência de ganho são da VOCAÇÃO** (`soulMax`/`soulGainTicksMs`,
`packages/content/data/vocations/*.json`), do `soulmax`/`gainsoulticks` do Canary
`vocations.xml` — verificado em `opentibiabr/canary` `main` 2026-09-27. O Canary distingue
vocação base (100/120000 ms) de PROMOVIDA (200/15000 ms); Draconya não tem promoção ainda
(ver "Em aberto" acima), então cada vocação carrega só o número da base — o dia em que a
promoção existir, ela reescreve estes dois campos como já reescreve stats por level.

**Sem vocação não há alma.** O Canary sempre tem vocação (mesmo `VOCATION_NONE` declara os
dois números); aqui o personagem nasce sem uma e escolhe no level 8 (§7.4), e a alma só passa a
existir quando ele escolhe: `chooseVocation` enche a alma para o `soulMax` da vocação na hora —
a mesma decisão de "veste o kit completo", não "veste aos poucos". Até lá, `soul` é `0` e a
coluna do banco também nasce em `0`.

**O ganho é passivo, disparado por XP** (`Player::onGainExperience` do Canary,
`data/events/scripts/player.lua`): a cada abate que rende XP ≥ o level QUE O PERSONAGEM TINHA
antes do ganho, com a alma abaixo do teto, (re)aplica-se uma condição de quatro minutos
(`CONDITION_SOUL`, fixo — não é conteúdo, ao contrário do teto e da cadência) que credita um
ponto de alma a cada `soulGainTicksMs`. É a MESMA máquina de condição com tique periódico que
haste, cura ao longo do tempo e veneno já usam (#155/CMB-07) — só o efeito muda: soma alma em
vez de saúde. Relançar (matar outro monstro dentro da janela) reinicia o prazo de quatro
minutos, como no Canary.

**O custo é da MAGIA** (`spellSchema.soulCost`, opcional — ausente é `0`, o normal de hoje):
lançar sem alma suficiente é RECUSADO pela MESMA regra da mana — a ação não sai e a alma não é
gasta —, e a alma sai por último, junto da mana. Nenhuma magia real declara `soulCost > 0`
ainda: a conjuração de runa (que é quem de fato cobra) é a #594.

**Persistência.** `characters.soul` (migração `0017_593-soul.sql`) é a coluna do banco: valor
ABSOLUTO, ÚLTIMA-ESCRITA-VENCE, nunca fundido pelo maior como skill/Bestiário — alma PODE
DESCER (é gasta), e fundir por máximo reviveria um saldo já gasto. Viaja ticket → sessão →
extrato → ledger pela mesma régua da munição escolhida e do equipamento.

**HUD.** `soul`/`soulMax` chegam em `player-stats` e `session-state.self`, como `speed`/`skills`
acima; a linha "Soul Points" do painel Skills mostra `soul/soulMax` — `0/0` é "sem vocação
escolhida", a mesma degradação de `vocationId: null`.

| Parâmetro | Valor | Onde mora em packages/content |
|---|---|---|
| Teto de alma (base, as quatro vocações) | 100 | `packages/content/data/vocations/*.json`, `soulMax` |
| Cadência de ganho (base, as quatro vocações) | 1 ponto a cada 120 000 ms | `packages/content/data/vocations/*.json`, `soulGainTicksMs` |
| Duração da condição de ganho após XP | 4 minutos, fixo (mecanismo, não conteúdo) | `packages/sim/src/rulesets/hunt.ts`, `SOUL_CONDITION_DURATION_MS` |
| Custo de alma por magia | `0` em todo o catálogo real hoje | `packages/content/data/spells/*.json`, `soulCost` |

### Divergência do Canary

Vocação PROMOVIDA (200/15000 ms) não existe em Draconya — promoção de vocação é `[ABERTO]` (ver
acima), e o dia em que ela chegar reescreve `soulMax`/`soulGainTicksMs` como já reescreve o resto
dos stats por promoção.
