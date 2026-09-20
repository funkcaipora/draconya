# Progressão, vocações e level

**Status:** stats por level/vocação, curva de XP, level up e skills por uso implementados; famílias
de arma e proficiências (CMB-05) implementadas; passivas e promoção não
**PRD:** §4.1, §9, §43.1
**Épico:** E2 (stats por vocação/level, skills por uso); E7 (árvore de passivas, promoção de vocação por quest)

## Comportamento

O jogo tem quatro vocações — Cavaleiro, Druida/Curandeiro, Feiticeiro e Arqueiro — cada uma um arquétipo clássico de papel (tank, suporte/cura, dano mágico, dano à distância). HP e Mana crescem automaticamente por level, sem distribuição manual de atributos: o jogador não aloca pontos em força ou inteligência, o crescimento é inteiramente determinado pela vocação escolhida.

Existe uma única promoção permanente de classe no MVP, obtida por quest. A maior parte das magias é liberada automaticamente conforme o personagem sobe de level; as magias mais fortes ficam condicionadas a essa promoção. O sistema deve ser construído de forma que promoções adicionais possam ser introduzidas futuramente sem exigir remodelagem completa do personagem.

Skills sobem pelo uso, seguindo o paradigma do Tibia, e não automaticamente com o level do personagem.

Cada personagem recebe pontos de passiva ao longo da progressão, distribuídos numa árvore própria da vocação. A árvore permite caminhos como dano, suporte e sustain. Os pontos podem ser redistribuídos livremente em PZ, quantas vezes o jogador quiser — não há custo nem limite de respec.

O catálogo de magias do jogo usa como referência de escopo funcional as magias do Tibia — até o level 80 no M12 (ADR 0026, decisão 5: as magias instantâneas que o motor expressa, por Base Power), e até aproximadamente o level 120 depois, sem reproduzir catálogo proprietário, nomes, assets ou código — o conteúdo final precisa ser definido/licenciado de forma própria.

## Regras

- Ganho de HP/Mana por level é automático e fixo por vocação (ver tabela de parâmetros).
- A escolha de vocação ocorre no level 8 (ver `onboarding.md`).
- Existe exatamente uma promoção de classe no MVP, obtida por quest permanente e única.
- Magias liberadas por level: a maioria; magias mais fortes: condicionadas à promoção.
- Skills evoluem por uso, não por level.
- Pontos de passiva são distribuídos em árvore própria por vocação (dano / suporte / sustain).
- Respec de passivas é livre, ilimitado e restrito a PZ.

## A curva de XP é fórmula, não tabela

`xpToCompleteLevel(L) = round(base × L^exponent)`, e `xp` no personagem é o **total acumulado**,
nunca "XP dentro do level".

Uma tabela de 500 linhas seria mais expressiva e é o caminho errado: a curva vai ser
rebalanceada muitas vezes, e rebalancear uma tabela é reescrever 500 linhas à mão — o que na
prática significa que ela nunca é rebalanceada. Dois números mudam a curva inteira.

Guardar o **acumulado**, e não o progresso dentro do level, é o que faz a penalidade de morte
cascatear sozinha: tira-se XP do total e o level é recalculado. Guardar o progresso dentro do
level exigiria um laço de "desce um level, devolve o resto" escrito à mão — exatamente onde o
caso de cascata de dois levels passa despercebido.

**Subir de level dá os pontos, não cura.** O máximo de HP e mana sobe, e o atual sobe junto na
mesma quantidade. Curar no level up faria "subir de level" virar poção grátis, e um bot bem
configurado morando na fronteira de um level nunca mais morreria.

**O level up é autoritativo sobre os stats.** Ele recalcula `maxHealth` e `maxMana` pela tabela,
o que significa que qualquer valor inventado na criação do personagem some no primeiro level up.
Por isso a criação de sessão passou a derivar HP e mana da mesma tabela — antes ela usava
números fixos, e o personagem *encolheria* ao subir de level.

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

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| HP / mana / capacidade por level — Knight | +15 / +5 / +25 (o Tibia; ADR 0026, decisão 5) | `packages/content/data/vocations/knight.json` |
| HP / mana / capacidade por level — Paladin | +10 / +15 / +20 (o Tibia; ADR 0026) | `packages/content/data/vocations/paladin.json` |
| HP / mana / capacidade por level — Sorcerer | +5 / +30 / +10 (o Tibia; ADR 0026) | `packages/content/data/vocations/sorcerer.json` |
| HP / mana / capacidade por level — Druid | +5 / +30 / +10 (o Tibia; ADR 0026) | `packages/content/data/vocations/druid.json` |
| Arma inicial de cada vocação | steel axe / bow / wand of vortex / snakebite rod (ADR 0026, decisão 3; #154) | `packages/content/data/vocations/*.json`, `startingWeaponItemId` |
| Kit inicial de cada vocação (level 8) | Knight: steel axe + wooden shield; Paladin: bow (o escudo vai para a mochila, duas mãos); Sorcerer: wand of vortex + wooden shield; Druid: snakebite rod + wooden shield (#496) | `packages/content/data/vocations/*.json`, `startingKit` |
| Skill de distância — início, curva, dano por nível | 10 / 50×1,1 / +2% `[ABERTO — valores provisórios]` (ADR 0026, decisão 4; sobe por tiro de bow, #152) | `packages/content/data/skills/distance.json` |
| HP inicial (level 1) | 150 `[ABERTO — valor provisório: 150]` | `packages/content/data/progression/baseline.json` |
| Mana inicial (level 1) | 20 `[ABERTO — valor provisório: 20, uma cura ou um Golpe Arcano no level 1 (FUN-114)]` | `packages/content/data/progression/baseline.json` |
| Capacidade inicial | 400 `[ABERTO — valor provisório: 400]` | `packages/content/data/progression/baseline.json` |
| HP por level antes da vocação | 5 `[ABERTO — valor provisório: 5]` | `packages/content/data/progression/baseline.json` |
| Mana por level antes da vocação | 5 `[ABERTO — valor provisório: 5]` | `packages/content/data/progression/baseline.json` |
| Level em que a vocação é escolhida | 8 | `packages/content/data/progression/baseline.json` |
| Quantidade de promoções no MVP | 1 | caminho previsto: `packages/content/vocations` |
| Curva de ganho de pontos de passiva | `[ABERTO]` | caminho previsto: `packages/content/vocations` |
| Teto de pontos de passiva | `[ABERTO]` | caminho previsto: `packages/content/vocations` |
| Base da curva de XP | 20 `[ABERTO — valor provisório: 20]` | `packages/content/data/progression/baseline.json`, `xp.base` |
| Expoente da curva de XP | 2 `[ABERTO — valor provisório: 2]` | `packages/content/data/progression/baseline.json`, `xp.exponent` |
| Velocidade do personagem | 278 no level 1, +2 por level, sem incremento por vocação `[ABERTO — valor provisório, do Huntera]`. `startingSpeed` / `speedPerLevel` e `regen` viajam também em `catalogue.progression` (#361, SV-25) | `packages/content/data/progression/baseline.json`, `startingSpeed` / `speedPerLevel` |
| Referência de catálogo de magias | Tibia até o level 80 no M12 (ADR 0026), ~120 depois (referência funcional; números por Base Power do TibiaWiki) | `packages/content/data/spells/` |
| Corpo a Corpo — início, curva, dano por nível | 10 / 50×1,1 / +2% `[ABERTO — valores provisórios]` | `packages/content/data/skills/melee.json` |
| Magia — início, curva, dano por nível | 0 / 400×1,1 / +3% `[ABERTO — valores provisórios]` | `packages/content/data/skills/magic.json` |
| Escudo — início, curva, defesa por nível | 10 / 50×1,1 / +2% `[ABERTO — valores provisórios]` (CMB-04) | `packages/content/data/skills/shielding.json` |
| Cura — mana, cooldown, quanto cura | 20 / 1 000 ms / 60 `[ABERTO — valor provisório]` | `packages/content/data/spells/heal.json` |
| Golpe Arcano — mana, cooldown, dano, alcance | 15 / 2 000 ms / 40 / 3 tiles `[ABERTO — valor provisório]` | `packages/content/data/spells/strike.json` |

O catálogo tem **duas magias** (FUN-74), e é de propósito: uma de cura e uma de dano de alvo
único são o suficiente para o motor de magia existir por inteiro — custo, cooldown, alcance,
alvo, atribuição e morte. Magia em área e o resto do catálogo entram depois, contra um motor que
já está provado. Ver [`combat.md`](./combat.md) e [`bot.md`](./bot.md).

## Em aberto

- ~~[ABERTO] HP/Mana por level do Druida (§9.3)~~ → **Resolvido:** +5 / +30 / +10, o do Tibia (ADR 0026, decisão 5), em `packages/content/data/vocations/druid.json`.
- Skills separadas por tipo de arma (sword/axe/club), como no Tibia: a taxonomia de **família**
  existe desde o CMB-05, mas as três corpo a corpo ainda compartilham a skill `melee` — separá-las
  é rebalanceamento, não motor (ADR 0026, decisão 4).
- Base de progressão (HP/mana/capacidade iniciais e crescimento dos níveis 1–7) não está no
  PRD: o §9.3 define só o incremento **por vocação**. Os valores em
  `progression/baseline.json` são provisórios e estão marcados como tal no próprio arquivo.
- A curva de XP também não está no PRD. `base: 20, exponent: 2` põe o level 8 — onde a vocação
  é escolhida — a cerca de duas horas de Rat Cellars, cedo o bastante para a escolha não virar
  espera.

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

## Como a vocação é escolhida (ADR 0026, decisões 1 e 3)

Pelo jogador, no level 8 ou depois, **uma vez**, por uma intenção `choose-vocation` do cliente —
na Cidade ou numa hunt, sem NPC, altar ou lugar. Ao escolher, a arma da vocação vai para a mão
e a machete do kit de nascimento volta para a mochila; a vocação é escrita no banco uma vez, pelo
extrato, e volta pelo ticket. Quem passa do 8 sem escolher continua crescendo pela tabela base
(ver abaixo). Não há troca de vocação: passiva tem respec (§9.5), vocação não. Implementação na
issue #154.

## Skills sobem pelo USO (FUN-75)

§9.4 **[DECIDIDO]**: skill não vem de level, vem de fazer — paradigma do Tibia. Quais skills
existem, quanto cada uso rende, quanto custa cada nível e quanto ela acrescenta ao golpe são
todos **conteúdo**, em `packages/content/data/skills/`.

| Skill | Alimentada por | Contribuição |
|---|---|---|
| Corpo a Corpo | cada golpe que sai | multiplica o poder do golpe |
| Distância | cada tiro de arma de distância (#152) | multiplica o poder do tiro |
| Magia | **mana gasta**, não lançamentos | multiplica o poder da magia |
| Escudo | cada ataque físico elegível recebido (CMB-04) | multiplica a defesa do escudo ou da arma de uma mão |

**Shielding sobe por bloqueio, não por ser atacado.** A prática é do evento elegível — o
defensor tem escudo ou arma de uma mão e o ataque é de um tipo aprovado —, e não depende de o
bloqueio ter acontecido nem de quanto HP foi perdido: um bloqueio total ainda treina, e um
ataque elemental não treina. O rato parado, sem atacar, também não move a skill (não é por
tick). A fórmula e a posição do sorteio estão em
[`combat.md`](./combat.md) e na emenda do ADR 0031.

### Famílias de arma e proficiência (CMB-05, #333)

A skill que uma arma alimenta e escala não está escrita no ruleset: cada **família de arma** é
dado em `packages/content/data/weapon-families/` e aponta para uma skill e para uma fórmula. As
famílias são `fist` (desarmado), `sword`, `axe`, `club`, `distance`, `wand` e `rod`; o item de
arma declara a sua, e `buildContent` recusa família incoerente com o `kind` ou que não exista.

- `sword`/`axe`/`club`/`fist` apontam para a skill `melee` — **as três ainda compartilham uma
  skill só** (a separação por tipo de arma é trabalho de balanceamento, não de motor).
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
