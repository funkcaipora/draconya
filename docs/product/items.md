# Itens, equipamento e inventário

**Status:** parcial — catálogo, `item_instance` (FUN-76), inventário por peso, equipamento e
capacidade (FUN-82), loot de item por abate e Caixa de Loot da Sessão (FUN-88) e a **tela de
mochila e equipamento** (FUN-90) e o **kit de nascimento** dado na criação (#153), dois anéis com efeito passivo — Energy Ring e Life Ring (SV-16) —, os **suprimentos e a munição abstratos** (AB-01/AB-02/AB-05, ADR 0032 d.6/d.7), a **carga de bênção como único consumível** e as **cargas e a duração vivas no `sim`** (AB-06) implementados; o **kit level 200 por vocação e as nove poções do Tibia** (#524, M28): requisito de vocação com mais de uma vocação, bônus passivo de skill/velocidade por equipamento, poção de faixa aleatória e a poção de espírito (cura + mana num uso só); o **loot do Dragon/Dragon Lord e `supplyId` no loot** (#520, M28): 31 itens novos e o loot de monstro aceitando supply, que credita `CharacterRuntime.supplyStock` — ainda sem consumidor; resgate da caixa e autovenda ainda não existem
**PRD:** §21, §22, §23, §25, §43.6
**Épico:** E5 (inventário, autovenda, Caixa de Loot); E7 (imbuement, durabilidade de anéis/colares); E11 (proveniência de lendário); E2 (kit level 200, M28)

## Comportamento

Equipamentos completos só são obtidos por drop de monstro ou por recompensa/drop de boss — não existe craft de equipamento completo no MVP. Cada item tem atributos base fixos, sem rolagem aleatória: um item melhor é um item diferente, não uma versão evoluída infinitamente do mesmo item. Os requisitos de uso seguem o paradigma do Tibia — level e vocação —, sem exigir atributos adicionais como força ou inteligência. Os atributos base ficam enxutos de propósito; efeitos mais avançados entram via imbuement e sistemas paralelos.

A maioria dos equipamentos não tem durabilidade. As exceções são anéis, consumíveis por tempo, e colares, consumíveis por carga (um colar defensivo com N cargas consome uma carga cada vez que a condição de uso ocorre). Ao esgotar, o item é destruído permanentemente. Se houver mais unidades do mesmo item na mochila/stack, o sistema repõe automaticamente o item consumido; quando a pilha acabar, não há mais reposição.

O inventário segue o paradigma de capacidade do Tibia, com stack máximo de 100 por item, e não existem itens físicos largados no chão do mundo. Quando um item é obtido e o personagem não tem espaço ou capacidade para ele, o item vai para a Caixa de Loot da Sessão — consultável e resgatável assim que houver espaço, disponível por 30 minutos após o encerramento da sessão, expirando depois disso.

O jogador pode configurar tipos de item para autovenda: ao dropar, o item é vendido automaticamente e o gold é creditado direto, sem passar pela mochila. O limite é 5 tipos configuráveis para contas Free e 20 para Premium. Itens que caem sem estar configurados para autovenda tentam entrar no inventário normalmente e, faltando espaço, seguem para a Caixa de Loot da Sessão.

A autovenda **individual** (fora de party) do §22.1 segue **não implementada**. O M20 implementou a versão **de party** — coleta e venda automática configuradas pelo **líder**, com o limite (5/20) vindo do Premium do **personagem líder** —, que mora em `party.md`; não confundir as duas. O campo `value` é o mesmo que a autovenda individual vai usar.

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
- Autovenda: até 5 tipos configuráveis (Free) ou 20 (Premium); fluxo drop → venda automática → gold, sem passar pela mochila. **Individual (fora de party) ainda não implementada**; a versão **de party** (líder) entrou no M20 e vive em `party.md`.
- Imbuement: slots fixos por tipo de item; duração de 24h de tempo efetivo de hunt; relógio parado fora de hunt; exige materiais + taxa em gold.
- Lendários: nunca soulbound, sempre negociáveis, sem limite semanal de negociação; proveniência (personagem original, data, horário, origem) registrada permanentemente desde o drop.

## O que já existe (FUN-76)

Duas metades, e a divisão entre elas é o ponto: **a definição é conteúdo, a instância é banco.**

`packages/content/data/items/*.json` traz a definição — id, tipo, slot, peso, atributos,
requisitos, se empilha. **A aparência não mora aqui** (FUN-94): ela vive em
`data/appearances/baseline.json`, uma linha por id, e `buildContent` resolve o `appearanceId` de
cada item a partir dela no boot. É a tabela que o ADR 0008 já previa — *"trocar o pacote de
assets é remapear ids numa tabela, não reescrever `content/`"* —, e com o id inline isso valia na
letra e não no efeito: trocar de pacote era editar todo arquivo de item.

Dois testes seguram a fronteira: o que varre os arquivos de dados atrás de caminho de imagem
(invariante 6), e o que varre atrás de `appearanceId`/`outfitId` escrito no arquivo da entidade.
O schema do item é `strictObject` pela mesma razão — Zod descarta chave desconhecida em silêncio,
e um `appearanceId` escrito ali por hábito não iria a lugar nenhum sem nada acusar.

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

`charges` e `durationMs` deixaram de ser campos mortos na AB-06 (#421): o `sim` consome a carga
do colar a cada golpe elemental que ele protege e agenda o vencimento do item de duração na fila
de eventos (ver "Duração e carga do equipamento", abaixo).

### Suprimentos abstratos no catálogo (AB-01, ADR 0032 decisão 6)

Poção e runa **não são itens físicos**: voltaram a ser o catálogo abstrato `data/supplies/`, com
`price`, `effect`, `requires` e `group` (grupo de cooldown do motor v2). Usar debita o `price` do
gold no ato por `useSupply` — **sem pilha, sem reposição por lote e sem caminho `purchase` no
ledger**. A carga de bênção é a exceção: segue item `kind: 'consumable'` **não-empilhável** em
`data/items/blessing-charge.json`, sem `restock` nem `group` obrigatórios, e quem a consome é a
TP-03 (M22). Ver `economy.md` e `bot.md`.

| Suprimento | Efeito | `group` | `price` | Arquivo |
|---|---|---|---|---|
| `health-potion` | `heal` 80 | `potion` | 45 | `data/supplies/health-potion.json` |
| `mana-potion` | `mana` 100 | `potion` | 50 | `data/supplies/mana-potion.json` |
| `avalanche-rune` | `damage` gelo, BP 45, raio 3, alcance 8, `requires { level: 30, magicLevel: 4 }` | `attack` | 14 | `data/supplies/avalanche-rune.json` |

As nove poções do Tibia (#524, kit level 200): faixa **fixa** sorteada por uso (`effect.amountRange`,
sem escalar por level/ML — a mesma cura no level 50 e no 200), `requires.level`/`vocationId` fiéis ao
Canary `data/scripts/actions/items/potions.lua` (Monk omitido — não existe no Draconya), preço uniforme
de NPC do Tibia (TibiaWiki via tibiascape.com).

| Suprimento | Efeito | `requires` | `price` | Arquivo |
|---|---|---|---|---|
| `strong-health-potion` | `heal` 250–350 | level 50, Knight/Paladin | 115 | `data/supplies/strong-health-potion.json` |
| `great-health-potion` | `heal` 425–575 | level 80, Knight | 225 | `data/supplies/great-health-potion.json` |
| `ultimate-health-potion` | `heal` 650–850 | level 130, Knight | 350 | `data/supplies/ultimate-health-potion.json` |
| `supreme-health-potion` | `heal` 875–1125 | level 200, Knight | 480 | `data/supplies/supreme-health-potion.json` |
| `strong-mana-potion` | `mana` 115–185 | level 50 | 150 | `data/supplies/strong-mana-potion.json` |
| `great-mana-potion` | `mana` 150–250 | level 80, Sorcerer/Druid/Paladin | 250 | `data/supplies/great-mana-potion.json` |
| `ultimate-mana-potion` | `mana` 425–575 | level 130, Sorcerer/Druid | 350 | `data/supplies/ultimate-mana-potion.json` |
| `great-spirit-potion` | `heal` 250–350 **+** `alsoMana` 100–200 | level 80, Paladin | 225 | `data/supplies/great-spirit-potion.json` |
| `ultimate-spirit-potion` | `heal` 420–580 **+** `alsoMana` 250–350 | level 130, Paladin | 450 | `data/supplies/ultimate-spirit-potion.json` |

`effect.alsoMana` (#524) é o mecanismo novo da poção de espírito: repõe vida **e** mana no MESMO uso,
um único `useSupply`. Fica dentro do `kind: 'heal'` — e não vira um quinto `kind` — para não duplicar
todo `switch`/`if` sobre `effect.kind` que já trata "isto cura" (auto-target do bot, `#emitHealed`).
`CastSuccess.healed`/`manaRestored` já existiam separados; a poção de espírito é o primeiro caminho que
preenche os dois ao mesmo tempo.

| Item | Efeito | Arquivo |
|---|---|---|
| `blessing-charge` | `blessing` (a TP-03, M22, é quem o executa) | `data/items/blessing-charge.json` |

A aparência de EFEITO continua em `data/appearances/baseline.json` (seção `supplies`), conferida
de um lado só (FUN-109).

### Munição abstrata, colar e escudo (AB-02, AB-05, ADR 0032 decisão 7)

Flecha e virote voltaram a ser o catálogo abstrato `data/ammunition/`, com `family`
(`arrow`/`bolt`), `attack`, `price` (> 0 — sem fallback grátis) e `requires.level`. **Cada tiro
debita o `price` do gold** e o `attack`/`damageType` do tiro são do catálogo; a escolha é por
família, pelo opcode 14 `select-ammo`, validada por `requires.level` no servidor e publicada em
`player-stats.ammo`. O ícone do projétil é o `appearanceId` do catálogo de munição, e
`appearances.ammunition[id]` guarda o **projétil** (`missile`).

| Munição | `family` | `attack` | `price` | `requires` | Arquivo |
|---|---|---|---|---|---|
| `arrow` | `arrow` | 25 | 1 | — | `data/ammunition/arrow.json` |
| `burst-arrow` | `arrow` | 27 | 3 | — | `data/ammunition/burst-arrow.json` |
| `sniper-arrow` | `arrow` | 28 | 5 | `level: 20` | `data/ammunition/sniper-arrow.json` |
| `onyx-arrow` | `arrow` | 38 | 7 | `level: 40` | `data/ammunition/onyx-arrow.json` |
| `power-bolt` | `bolt` | 40 | 10 | `level: 55` | `data/ammunition/power-bolt.json` |

`power-bolt` (#524, kit level 200) é a primeira munição `family: 'bolt'` do catálogo — a da Royal
Crossbow do Paladin. Traz também `maxHitChance` (91, do Canary) — só DADO: a chance de acerto por
skill/distância é da issue #522 (`chance de acerto à distância`), que lê `weapon.hitChance` (o bônus
da arma, +3 na Royal Crossbow) e `ammunition.maxHitChance` juntos. Até a #522 entrar, o tiro segue
sempre acertando, como hoje.

O primeiro **colar** (`glacier-amulet`, `kind: 'amulet'`, `slot: 'neck'`, `charges: 20`,
resistência a gelo 0,2) e o primeiro **escudo real** (`wooden-shield`, `kind: 'shield'`,
`slot: 'shield'`, `defense: 14`) entram no catálogo; o consumo da carga do colar foi ligado na
AB-06 (#421). A munição **não é item**: com um bow/crossbow equipado, o slot do **Escudo** passa a
mostrar a munição escolhida da família e o clique abre o `AmmoPicker`; o slot `ammo` do corpo
segue genérico, e não há pilha nem contagem. **A escolha persiste entre sessões**: viaja no
extrato, o `jobs` grava em `characters.ammo` e ela volta pelo ticket ao entrar — o mesmo caminho
da vocação.

## Inventário e equipamento (FUN-82)

**Capacidade é peso**, no paradigma do Tibia (§21.5): a mochila cabe o que o personagem aguenta,
e a capacidade cresce com o level pela mesma tabela que dá HP e mana. Contar espaços seria outro
jogo — e um em que a armadura pesada não custa nada.

O que está **equipado conta no peso**. Sem isso, a estratégia ótima é vestir tudo para carregar o
dobro, e a capacidade deixa de significar o que diz.

| | |
|---|---|
| stack máximo | 100, e pilha cheia começa outra |
| empilha | só o que o conteúdo marca `stackable` — queijo sim, espada não; munição e suprimento não são item |
| item que não cabe | **recusado**, e vai para a Caixa de Loot da Sessão (issue própria) |

Item não empilhável vira sempre linha nova: duas espadas são duas **identidades**, e é a
identidade que carrega a proveniência (FUN-76). Juntá-las num contador apagaria de onde cada uma
veio.

### Mochila e bolsa posicionais (#160, ADR 0026 decisão 6)

Desde #160 o item tem **lugar**, no modelo do Huntera: a **mochila** é o item vestido em `back`
(`initialSlots: 20` em `items/backpack.json`) e a **bolsa** (`satchel`) é fixa do personagem, não
é item (`progression.satchelInitialSlots: 10`). As duas são vetores posicionais — `null` é lugar
vazio — e **crescem por linhas de `progression.containerRow` (5), sem limite, enquanto houver
capacidade**: o lugar nunca recusa loot (o bot não pode parar de caçar por mochila cheia —
invariante 11); só o peso recusa, e aí a Caixa de Loot segura. Remover apara as linhas vazias do
fim até o tamanho inicial. O loot cai na mochila (empilha antes de ocupar lugar; sem mochila nas
costas, cai na bolsa); a bolsa é onde o jogador organiza.

`move-item` (opcode 16) é a intenção de mover entre dois lugares — `{ container, index }` ou
`{ slot }`: troca, empilha até o teto (o resto fica na origem), veste (`to` é slot; o desequipado
volta ao lugar de onde o novo saiu) ou desveste para um lugar. É uma **transação** (referência
§25): tudo é validado antes de qualquer escrita, e a recusa (`no-such-place`, `empty-place`,
`backpack-not-empty` — a mochila só sai vazia) não muta nada. `Inventory` não conhece conteúdo:
os tamanhos chegam por `ContainerRules` na entrada da sessão (`onEnter`, e `onResume` para um
snapshot anterior ao formato, que é lido como lista plana sem bump de versão).

### Equipar

Intenção pelo socket (`equip`/`unequip`), validada no servidor por **slot, level e vocação**
(§21.2). Vocação é o mesmo campo que a magia usa: o personagem nasce sem uma e escolhe no level
8, então item de vocação é inacessível até lá por construção.

O que sai do corpo **volta para a mochila**, então a troca não muda o peso total — e é por isso
que equipar não confere capacidade.

Sucesso **não vira mensagem**: confirmar cada clique com uma linha de chat entulharia a tela. O
que o jogador vê é o item no lugar. Recusa vira mensagem, e diz qual foi.

### O que o combate lê

`combat.player.attackPower` deixou de ser "o ataque do personagem" e passou a ser o do personagem
**sem arma** — o fallback, e ele é conteúdo. A arma equipada substitui; a armadura vestida
**soma** à do conteúdo, porque `combat.player.armor` é a resistência do corpo e a peça
acrescenta. Substituir faria vestir a primeira armadura deixar o personagem mais frágil se ela
valesse menos que o número base.

Desde a #152 o combate lê também **como** a arma bate — `weapon: { kind, range, ammoFamily,
manaPerHit, damage }` —, e o alcance passou a ser da arma: bow 6 com a munição escolhida, wand
e rod 3 gastando mana, corpo a corpo 1. Desde o CMB-05 (#333) a arma declara também a
**família** (`weapon.family`: `sword`, `axe`, `club`, `distance`, `wand`, `rod`), que aponta para
a skill e a fórmula em `packages/content/data/weapon-families/` — o ruleset não conhece nome de
item nem vocação. `fist` é o fallback desarmado e não existe como arma. **A munição é abstrata**
(AB-02/AB-05, ADR 0032 d.7): o bow atira a munição escolhida da família (ou a básica dela), e cada
tiro debita o `price` do gold — sem pilha, sem munição grátis e sem `pullNextAmmo`. A escolha é
por família (`select-ammo`), o slot do Escudo a mostra e o `AmmoPicker` a troca. Ver "Munição
abstrata, colar e escudo" abaixo. Arma de duas mãos (`twoHanded`, o bow) recusa escudo, e
vice-versa.

Desde o CMB-04 o combate lê também a **defesa** (`defense`) da peça: escudo ou arma corpo a corpo
de uma mão bloqueia parte do golpe físico. A escolha da fonte é do inventário (`defenseSource`),
que já conhece os slots e a incompatibilidade bow+escudo; a fórmula e a posição do sorteio estão
em `combat.md` e no ADR 0031. Bow/twoHanded e wand/rod não têm defesa residual — declarar
`defense` neles é recusado no boot. Desde a AB-02 existe o primeiro **escudo real** no catálogo
(`wooden-shield`, `defense: 14`), ao lado das armas de uma mão (machete 9, steel axe 10, spike
sword 10, provisório).

### Como o item vai e volta do banco

| | quando | forma |
|---|---|---|
| entra na sessão | emissão do ticket | as instâncias do personagem viram mochila e equipamento |
| sai da sessão | extrato → ledger | o layout `slot → instanceId`, **absoluto**; e a posição `instanceId → { container, index }` (#160), gravada em `item_instance.container`/`slot_index` — último-escrito-vence, escopada por dono; a linha sem posição volta ao primeiro lugar livre |

**A sessão nunca escreve `item_instance`.** Ela registra onde as coisas ficaram; o `jobs` aplica
na mesma transação da linha de ledger (invariante 10), e retry não duplica porque a chave
`(session_id, seq)` recusa.

A liquidação **desequipa primeiro**: o índice único do banco recusa duas peças no mesmo slot, e
trocar A por B esbarraria nele se B entrasse antes de A sair. Extrato **sem** equipamento não
mexe em nada — é o de uma sessão de Cidade, ou de um nó antigo durante deploy em rolagem, e
limpar por omissão desequiparia o personagem sem ninguém ter pedido.

Item **não muda de dono** dentro da sessão: não há troca nem venda na hunt. O que muda é onde ele
está, e é só isso que atravessa.

### A tela (#161, ADR 0026 decisão 7)

A coluna da DIREITA do OTClient: o **painel do set** (`EquipmentPanel`) com os dez slots no
desenho de corpo do Tibia — mochila no canto superior direito —, a capacidade `usado / total oz`
e o gold (o gold sob o set é escolha nossa, copiada do Huntera; o cliente do Tibia o mostra na
bolsa de moedas); abaixo, a **janela da mochila** e a **da bolsa** (`ContainerWindow`), cada uma
uma grade de 5 por linha — uma linha da tela é uma linha do container —, com o lugar vazio
desenhado com o quadrado de pedra do pacote e a pilha com a quantidade; e abaixo delas o
analisador e o Bestiário. As três são **fixas**: sempre montadas, um botão da barra do topo
minimiza as três juntas (só o cabeçalho fica), nunca removidas.

**O slot de munição do set é o `AmmoPicker`** (AB-02/AB-05, ADR 0032 d.7): com um bow/crossbow
(distance de duas mãos) equipado, o slot do **Escudo** mostra a munição escolhida da família e o
clique abre o seletor com as opções liberadas pelo nível. O slot `ammo` do corpo continua genérico;
a munição não é item, e não há pilha nem contagem.

**Arrastar e clicar.** Arrastar (HTML5, nativo) de lugar para lugar manda `move-item`, de lugar
para slot manda `equip`, de slot para lugar manda `move-item` com `from: { slot }`; o
`dataTransfer` carrega só o LUGAR de origem, nunca o item. O clique continua vestindo e
desvestindo — é o caminho do celular, que não arrasta. A decisão de qual intenção sai é
`shell/drag-intent.ts`, pura e testada; nada na tela valida level, vocação ou peso (invariante
4). No celular a coluna vira blocos na ordem set → mochila → bolsa → bot → hunts → analisador →
bestiário.

## Loot de item e a Caixa de Loot da Sessão (FUN-88)

O item cai pelo mesmo sorteio de sempre — gold antes, itens na ordem da tabela, com o `Rng` da
sessão. **A ordem dos sorteios é contrato** (FUN-63), e acrescentar destino não muda sorteio.

Onde ele vai (§22.2):

1. **mochila**, se couber pela capacidade;
2. **Caixa de Loot da Sessão**, se não couber.

Com **stamina zero não cai nada** (§10.2) — nem gold, nem XP, nem item. O abate continua
contando: o jogador matou, e o extrato mentiria se dissesse que não.

Mochila cheia vira **uma** linha no extrato (`backpack-full`), não uma por item. Uma por item
encheria a lista curta da tela de retorno até ela deixar de ser lista, e o que o jogador precisa
saber é que ela encheu.

### O id da instância é determinístico, e é isso que dá idempotência

`sessionId:n`. Reprocessar um extrato insere a **mesma chave primária**, e `ON CONFLICT DO
NOTHING` faz disso operação nula — a idempotência do invariante 10 obtida por identidade
previsível, sem conferência. O contador entra no snapshot: recomeçá-lo geraria o mesmo id de
novo, e o item novo seria descartado por parecer repetido.

O catálogo é conferido **antes** de gastar um id. `buildContent` recusa loot de item inexistente
no boot, então isso só acontece com o conteúdo mudando sob uma sessão em voo — e aí o certo é não
entregar nada e não queimar identidade por um item que não vai existir.

### A caixa vive no Redis, e é por isso que ela expira de verdade

`lootbox:{sessionId}`, TTL de 30 minutos, contando do **encerramento da sessão** (§21.6) — quem
sabe que ela encerrou é quem a encerrou, então a caixa é escrita pelo `game`, não pela varredura.

Redis e não Postgres por uma razão que decide sozinha: **expirar precisa significar que o item
nunca existiu.** Uma linha em `item_instance` que ninguém consegue mais ver é pior que nenhuma —
ela aparece em consulta de proveniência, em soma de patrimônio, e em toda auditoria que alguém
escrever depois. Com TTL, o que expira some.

Por isso o item da caixa **ainda não é** uma instância no banco: ele vira linha quando for
resgatado. Criar a linha antes tornaria a expiração um `DELETE` que some com item de jogador.

Caixa vazia não cria chave: uma caixa vazia é indistinguível de não haver caixa, e criar uma por
sessão encerrada encheria o Redis com cinco mil chaves dizendo "não sobrou item".

**Quem expira é o TTL, não o `jobs`.** O ciclo apenas conta as pendentes
(`draconya_loot_boxes_pending`) — uma pilha que só cresce é jogador ganhando item que não
consegue resgatar, e isso não aparece em lugar nenhum sem alguém publicar o número.

### Loot de SUPPLY: `supplyId` credita o ESTOQUE, não passa pela mochila (#520)

Poção é suprimento **abstrato** (AB-01, ADR 0032 d.6) — sem pilha física, sem instância. Antes
da #520, `lootTableSchema` só conhecia `itemId`: um monstro não tinha como dropar poção nenhuma,
e o Dragon/Dragon Lord do Tibia soltam Strong Health Potion. A linha da tabela agora declara
**`itemId` OU `supplyId`**, nunca os dois — o `.refine` do schema recusa a ambiguidade —, e
`rollLoot` separa o resultado em `items`/`supplies` DEPOIS de sortear, na mesma ordem de sempre
(gold, depois cada linha na ordem do arquivo): a separação é de DESTINO, não de sorteio, e por
isso o contrato de semente do FUN-63 continua valendo sem exceção.

**O destino é `CharacterRuntime.supplyStock` (`supplyId → quantidade`), um Map novo no
personagem, opcional no snapshot como `ammo`/`bestiary` — sem bump de `SNAPSHOT_FORMAT_VERSION`.**
Solo e party `split` creditam o recipiente do loot sozinho (o mesmo `recipient` do gold);
party `shared` divide por igual entre os presentes no abate (`splitEqually`, o mesmo do
auto-sell), resto um a um nos primeiros — supply não pesa e não passa pela bolsa/`#settle` como
item, porque não tem peso nem valor de venda: o estoque **é** o destino final.

**`supplyStock` ainda não tem consumidor.** `useSupply` continua debitando gold, sem olhar o
estoque — a mesma decisão do `staticAttack` do monstro (#518): aceito e persistido, registrado
aqui como divergência em vez de meio implementado. Quando alguém ligar "gastar do estoque antes
do gold" em `casting.ts`, o dado já está no personagem; até lá, uma Strong Health Potion caída
do Dragon fica contada, mas o jogador não vê nem gasta — nenhuma tela mostra `supplyStock` hoje.

**Munição (Burst Arrow, Power Bolt) NÃO está no loot do Dragon/Dragon Lord**, apesar de cair
deles no Tibia real. Munição é abstrata do MESMO jeito que supply (ADR 0026 d.7: sem item
físico, cada tiro debita gold direto pela família escolhida) — mas `supplyId` só cobre
`supplies/`, e estender o mesmo mecanismo para `ammunition/` ficou fora do escopo da #520.
Nenhuma issue aberta cobre isso ainda.

## Anéis com efeito passivo (SV-16, #352)

Os dois primeiros itens `kind: 'ring'` do catálogo. O efeito é passivo: vale enquanto o item
está equipado no dedo (`slot: 'finger'`), sem carga e sem duração. Anéis que gastam por TEMPO
usam `durationMs`, consumido pelo `sim` desde a AB-06 (#421) — ver "Duração e carga do
equipamento".

**Energy Ring** — o dano sofrido debita da MANA antes da vida, e só o excedente vai para a vida.
É a MESMA leitura que a condição `mana-shield` do utamo vita (Magic Shield) já faz — as duas
convergem no mesmo lugar (`CharacterRuntime.receiveDamage`) e NÃO se somam: com o anel vestido E
a condição ativa ao mesmo tempo, o personagem continua absorvendo o dano uma vez só.

**Life Ring** — +300% da regeneração passiva BASE de vida e mana. "Base" é o ponto fixo por
vencimento de `progression.regen` (§10.2), sem nenhum outro bônus — hoje não existe nenhum outro
modificador de regeneração no jogo, então a conta é direta: 1 ponto vira 4.

O mecanismo de troca automática por HP/mana (o "ring swap" do bot, §13.8) já existia antes destes
dois itens e não muda: ele só troca o que está no dedo, e não sabe o que o anel faz — é o efeito
descrito aqui, lido do catálogo no momento do dano/regeneração, que dá sentido a essa troca.

## Duração e carga do equipamento (AB-06, #421)

`durationMs` e `charges` são mecanismos diferentes, e a AB-06 ligou os dois no `sim` (ADR 0032
decisão 8).

**Duração é TEMPO EQUIPADO, e o vencimento é um evento.** Ao equipar um item com `durationMs`, o
`sim` agenda `EQUIP_EXPIRE` para `agora + durationMs` na fila; ao desequipar, mover do slot ou
destruir, cancela. O item que vence sai do corpo e **não volta para a mochila** — é destruído.
Duração reinicia cheia ao reequipar: não há `remainingMs` guardado (DT-04), então tirar e vestir
de novo devolve o prazo inteiro. Como o prazo é um evento no relógio LÓGICO, a hunt desanexada a
1 Hz vence no MESMO instante que a anexada a 10 Hz (invariante 2, ADR 0020).

**Carga é por GOLPE PROTEGIDO.** O colar (`neck`) e, desde o #524, o anel (`finger`) gastam uma
carga CADA um a cada golpe de monstro cujo tipo eles protegem — imunidade explícita ou
resistência positiva; resistência negativa é vulnerabilidade e não gasta. As duas peças gastam
INDEPENDENTE (um golpe de fogo com Dragon Necklace e Might Ring vestidos gasta uma carga de cada).
A carga é da INSTÂNCIA (`CarriedItem.charges`), ausente é "cheio", e o total vem de `Item.charges`;
em zero o item sai do corpo e não vai para a mochila. O golpe é gasto mesmo quando esquivado
(DT-03): a mitigação incide no cálculo antes do corte do Dodge.

**A destruição avisa a apresentação.** O `sim` emite `equipment-changed`, e o `server` o mapeia
para a mensagem `inventory` já existente (opcode 16, sem campo novo — invariante 5): o slot
destruído aparece vazio. `CarriedItem.charges` é opcional, então snapshot antigo não precisa de
bump; o `EQUIP_EXPIRE` viaja na fila. **Carga e tempo restante não sobrevivem ao logout** — a
linha de `item_instance` não tem coluna, e persistir é trabalho à parte (fora do escopo da AB-06).

## O kit level 200 por vocação e o bônus de equipamento (#524, M28)

O catálogo tinha só equipamento de Rookgaard. O kit level 200 (Knight, Paladin, Sorcerer, Druid —
`docs/adr/0037-tfs-canary-fidelity-except-action-bar-and-automation.md`) trouxe os atributos que
faltavam no schema, todos com os números do Canary `data/items/items.xml` (`opentibiabr/canary`
main) e o preço de NPC do TibiaWiki (ADR 0037 d.4: Canary/TFS para mecanismo e número, TibiaWiki
para preço de NPC — os NPCs do `data-otservbr-global` são a economia própria daquele servidor, não
o fato do Tibia).

**Requisito de mais de uma vocação.** `requires.vocationId` (item e suprimento) aceita uma
vocação (`"paladin"`) OU uma lista (`["knight", "paladin"]`) — `vocationRequirementSchema`,
`matchesVocationRequirement` em `@draconya/content`. A Magic Plate Armor e a Knight/Crown Legs
são Knight+Paladin; a Hat of the Mad, a Focus Cape e o Spellbook of Mind Control são
Sorcerer+Druid. Diferente da magia (um arquivo por vocação, `haste-knight.json` etc., #155): lá o
formato pode mudar por vocação (mana, alcance); aqui o item físico é IDÊNTICO nas duas, e
duplicar o arquivo só para variar `vocationId` divergiria peso/preço no primeiro balanceamento.

**Bônus passivo de equipamento.** `item.bonuses` (§21.2): `skill` (uma skill, um valor — o magic
level do Tibia É a skill `magic` no Draconya, FUN-92) e `speed` (somado direto a
`character.speed`, as boots of haste). Lido por `Inventory.skillBonus`/`speedBonus` — a MESMA
forma de `armor()`/`mitigation()`, uma soma pelos poucos slots equipados, sem tabela por
catálogo. `skillBonus` entra em `#weaponPower` (a Paladin Armor, +2 distância, bate mais forte
com o crossbow), `#runeScaling` e `#spellScaling` (o Hat of the Mad/Focus Cape/Spellbook of Mind
Control, +1/+1/+2 magic level, escalam runa e magia de cura/dano mais forte). `speedBonus` entra
em TRÊS pontos: a entrada na hunt (`onEnter`), o snapshot antigo sem velocidade (`#onPlayerStep`)
e o equipar/desequipar em voo (`#equipmentObserver` → `#recomputeSpeed`) — calçar a bota muda a
velocidade no MESMO evento, sem esperar o próximo passo.

**Anel com carga**, além do colar (ver "Duração e carga do equipamento", acima): o Might Ring é
`kind: 'ring'` com `mitigation`+`charges`, sem `ringEffect` — mecanismo diferente do Energy/Life
Ring (efeito permanente enquanto vestido, sem carga). `#consumeAmuletCharge` foi alargado para
conferir os dois slots (`neck` e `finger`) independente.

**hitChance, só dado.** `weapon.hitChance` (a Royal Crossbow, +3) e `ammunition.maxHitChance` (o
power bolt, 91) entraram no schema e no catálogo, mas SEM mecanismo de acerto — a chance de
acerto à distância por skill/distância é a issue #522, que vai ler os dois campos. Até lá, tiro
sempre acerta (o comportamento de hoje).

**A troca registrada:** a Magic Longsword da issue é `slotType="two-handed"` no Canary E no TFS
(conferido nos dois `items.xml`, 2026-09-24) — ocuparia o slot do escudo, e o kit do Knight pede
Mastermind Shield junto. Substituída pela Mystic Blade (Canary `items.xml` id 7384): espada de
UMA mão, attack 44, defense 25, level 60, sem vocação — usável com escudo, como a issue autoriza
("item com requisito incompatível... trocar pelo equivalente do Tibia").

**Sem divergência de peso na Royal Crossbow.** Uma revisão anterior desta PR usava o peso do
TibiaWiki (60 oz) por parecer pesada demais para uma besta de duas mãos frente ao resto do kit —
uma divergência não autorizada pela ADR 0037 d.4, que reserva TibiaWiki só ao que nenhuma das duas
engines carrega (preço de NPC, por exemplo), nunca a atributo de item. Corrigido para os 120 oz
(12000) do Canary `items.xml` id 8023, confirmados também no TFS `items.xml` id 8851 — os dois
concordam em peso, `hitChance`, alcance e `attack`.

| Kit | Knight | Paladin | Sorcerer | Druid |
|---|---|---|---|---|
| cabeça | Crusader Helmet | Royal Helmet | Hat of the Mad | Hat of the Mad |
| peito | Magic Plate Armor | Paladin Armor | Focus Cape | Focus Cape |
| pernas | Knight Legs | Crown Legs | Zaoan Legs | Zaoan Legs |
| pés | Boots of Haste | Boots of Haste | Boots of Haste | Boots of Haste |
| mão | Mystic Blade | Royal Crossbow + power bolt | Wand of Starstorm | Hailstorm Rod |
| escudo | Mastermind Shield | — (besta de duas mãos) | Spellbook of Mind Control | Spellbook of Mind Control |
| amuleto | Dragon Necklace | Dragon Necklace | Dragon Necklace | Dragon Necklace |
| anel | Might Ring | Might Ring | Might Ring | Might Ring |

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Stack máximo por item | 100 | caminho previsto: `packages/content/items` |
| Defesa (blocking físico) da arma de uma mão | machete 9, steel axe 10, spike sword 10 `[ABERTO — spike sword provisório: 10]` (CMB-04) | `packages/content/data/items/*.json`, `defense` |
| Expiração da Caixa de Loot da Sessão | 30 minutos após o fim da sessão | caminho previsto: `packages/content/items` |
| Autovenda — tipos configuráveis (Free) | 5 | caminho previsto: `packages/content/economia` (premium) |
| Autovenda — tipos configuráveis (Premium) | 20 | caminho previsto: `packages/content/economia` (premium) |
| Duração de imbuement | 24h de tempo efetivo de hunt | caminho previsto: `packages/content/imbuement` |
| Catálogo de efeitos/materiais/valores/compatibilidade de imbuement | `[ABERTO]` | caminho previsto: `packages/content/imbuement` |
| Peso do Energy Ring / Life Ring | 2 oz cada `[ABERTO — provisório: sem referência de peso de anel no PRD nem no huntera-observed]` | `packages/content/data/items/{energy-ring,life-ring}.json` |
| Preço de venda do Energy Ring / Life Ring | 100 gold cada `[ABERTO — provisório, mesma razão]` | `packages/content/data/items/{energy-ring,life-ring}.json` |
| Bônus de regeneração do Life Ring | +300% da base (fixo, SV-16) | `packages/content/data/items/life-ring.json`, campo `ringEffect.percent` |
| Suprimentos — `price` / `group` | poção de vida 45 / `potion` `[ABERTO — preço provisório]`; poção de mana 50 / `potion` `[ABERTO — idem]`; avalanche rune 14 / `attack` `[ABERTO — idem]` | `packages/content/data/supplies/*.json` |
| Carga de bênção — peso / `value` | 1 oz / 0 `[ABERTO — peso e valor provisórios]` | `packages/content/data/items/blessing-charge.json` |
| Munição — `attack` / `price` / `requires.level` | arrow 25 / 1 / — `[ABERTO — preço provisório]`; burst arrow 27 / 3 / — `[ABERTO — idem]`; sniper arrow 28 / 5 / 20 `[ABERTO — idem]`; onyx arrow 38 / 7 / 40 `[ABERTO — idem]` | `packages/content/data/ammunition/*.json` |
| Colar — `charges` / resistência / peso / `value` | glacier amulet 20 cargas / gelo 0,2 / 5,5 oz / 0 `[ABERTO — cargas, resistência, peso e valor provisórios]` | `packages/content/data/items/glacier-amulet.json` |
| Escudo — `defense` / peso / `value` | wooden shield 14 / 40 oz / 0 `[ABERTO — defense, peso e valor provisórios]` | `packages/content/data/items/wooden-shield.json` |
| Kit level 200 — atributos e preço de NPC | os 19 itens da tabela do kit, acima (armor/attack/defense/weight/`value`/`bonuses`/`requires`) — números do Canary `items.xml` e do TibiaWiki, NÃO provisórios (#524) | `packages/content/data/items/*.json` (as 16 peças novas), `packages/content/data/ammunition/power-bolt.json` |
| Poções do Tibia — `amountRange` / `requires` / `price` | as nove poções da tabela, acima — números do Canary `potions.lua` e do TibiaWiki, NÃO provisórios (#524) | `packages/content/data/supplies/{strong,great,ultimate,supreme}-*.json` |
| Loot do Dragon (#520) — 20 linhas | atributos e `value` do Canary `items.xml`; preço de NPC do Tibia real via TibiaWiki quando o Canary só tinha oferta custom (ADR 0037 d.4) — 19 itens novos + `supplyId: strong-health-potion` | `packages/content/data/items/{dragon-ham,steel-shield,crossbow,dragons-tail,longsword,steel-helmet,broadsword,plate-legs,wand-of-inferno,green-dragon-scale,green-dragon-leather,double-axe,dragon-hammer,serpent-sword,small-diamond,dragon-shield,life-crystal,dragonbone-staff}.json` |
| Loot do Dragon Lord (#520) — 19 linhas | idem; reaproveita Energy Ring e Royal Helmet (já existiam), 12 itens novos + `supplyId: strong-health-potion` | `packages/content/data/items/{green-mushroom,royal-spear,gemmed-book,small-sapphire,golden-mug,red-dragon-scale,red-dragon-leather,strange-helmet,fire-sword,tower-shield,dragon-scale-mail,dragon-slayer,dragon-lord-trophy}.json` |

## Em aberto

- Catálogo de imbuement — efeitos, materiais, valores e compatibilidade exata por slot/equipamento (§23.4, §43.6). Bloqueia o épico E7 (`docs/technical-architecture.md` §20).

## Divergências do PRD

- **§21.1 — equipamento só por drop.** O kit de nascimento (machete, leather helmet/armor/
  legs/boots, mochila) e a arma de vocação no level 8 são **dados** ao personagem — `origin:
  'starting-kit'` e `'vocation-choice'` em `item_instance` —, não dropados (ADR 0026, decisões
  2 e 3). São as duas únicas exceções; tudo o mais continua vindo de monstro. O kit já é dado
  (#153): `progression.startingKit` em `packages/content/data/progression/baseline.json` lista
  as seis peças e o slot em que cada uma nasce vestida, e `createCharacter` grava as linhas de
  `item_instance` na **mesma transação** que o personagem (id `<characterId>:kit:<n>`), sem
  passar pelo ledger — o kit não tem preço. Personagem criado antes do #153 continua sem kit.
- **Royal Spear (#520) não é arma de arremesso.** No Tibia real é `weaponType distance` sem
  munição — o próprio item é o projétil, consumido ao acertar (`breakChance`). `WEAPON_KINDS`
  (`melee` / `distance`-com-munição-abstrata / `wand`) não tem essa forma, e modelar arma de
  arremesso ficou fora do escopo da #520: o item entra `kind: 'other'`, sem `weapon`, só
  vendável/curiosidade — igual ao Tibia real, onde nenhum NPC compra de volta.
- **Serpent Sword e Fire Sword (#520) perdem o componente elemental embutido.** O Tibia real dá
  `elementearth 8` à Serpent Sword e `elementfire 11` à Fire Sword — dano elemental somado ao
  físico no MESMO golpe. `weapon.damageType` é um tipo só por arma (CMB-03); `attack` fica com o
  total, e o componente elemental não aparece. As duas armas continuam batendo o número certo em
  físico; só o "queima também" some.
- **Defesa residual de arma de duas mãos (#520) não é copiada.** O Tibia real dá `defense` a
  Broadsword, Double Axe e Dragon Slayer mesmo sendo de duas mãos; `buildContent` recusa
  `defense > 0` fora de escudo/arma corpo a corpo de UMA mão (CMB-04, emenda do ADR 0031) — regra
  de antes da #520, não uma exceção criada para ela. O número simplesmente não entra no item.
- **Dragonbone Staff (#520) é club, não wand/rod.** O nome sugere conjuração, mas o Tibia real a
  modela como arma de club corpo a corpo (`weaponType club`), sem `mana`/`fromDamage`/`toDamage`
  no script de equip — e é assim que o catálogo a declara.
- **Gemmed Book (#520) reaproveita o item genérico "book" do Canary**, sem atributo próprio que
  distinga a versão "gemmed" (a diferença no Tibia real é só de nome/arte).

## Decidido (ADR 0026): munição, containers e runa

- **Munição é seleção, não item** (decisão 3, o Huntera): flecha e virote são selecionadas por
  família (opcode 14 `select-ammo`), com `price` por tiro e `requires.level`; o slot do Escudo
  mostra a escolhida e o `AmmoPicker` a troca. Não há pilha, nem fallback grátis. Issues #151,
  #152, #161, #417, #420.
- **Mochila e bolsa elásticas** (decisão 6): a mochila é o item no slot `back`, a bolsa é fixa
  do personagem; 20 e 10 lugares iniciais que crescem por linhas sem limite — o único teto é o
  peso. Loot cai na mochila; a bolsa é onde o jogador organiza; a Caixa de Loot fica só para o
  que não cabe no peso. Sem bolsa dentro de mochila. Issues #160, #161.
- **Runa é suprimento de ataque** (decisão 8): a Avalanche é a primeira, com
  `requires { level, magicLevel }` e `price` no uso; o bot a lança por um slot de ação `supply`.
  Desde a restauração do suprimento abstrato ela vive em `data/supplies/avalanche-rune.json`, e o
  gold é debitado no uso. Issue #165.

## A tela (FUN-90)

Mochila, dez lugares de equipamento (o décimo, `back`, é o das costas — a mochila do kit, desde a #151) e a capacidade, numa janela à direita. **A geografia é fixa**
(§5.3, §5.5): inventário e analisador à direita, hunts e bot à esquerda, chat embaixo — nos
mesmos lugares em hunt e em conteúdo manual. A tela não se reorganiza ao trocar de atividade; em
PvP manual, procurar onde a poção foi parar é o que custa a luta. Desde a FUN-115 o mundo ocupa a
tela inteira e as janelas flutuam por cima, abertas e fechadas pela barra do topo — a geografia
do Huntera.

**Nada é calculado no cliente.** Peso, capacidade e o que cabe vêm do servidor: quem sabe o que
cabe é quem recusa, e a mesma conta em dois lugares diverge no primeiro item com peso
fracionário — com a versão do cliente sendo a errada.

**O sucesso não vira mensagem.** "Equipado com sucesso" é ruído; o item mudando de lugar na tela
é a confirmação. A recusa, essa sim, vira texto — e a mochila NÃO é reenviada junto, porque
reenviar o mesmo estado diria que algo mudou.

A mensagem `inventory` leva só o que muda — id da instância, quantidade e onde ela está. Nome,
peso e aparência são atributo base, fixo por id (§21.2), e vêm no catálogo: repeti-los por
instância mandaria o mesmo texto dezenas de vezes a cada loot.

Ela sai ao **anexar**, depois de **equipar ou tirar**, e quando **cai loot** durante a hunt — este
último detectado por `aggregates.itemsLooted` mudar, que é um inteiro a comparar por ciclo em vez
de serializar a mochila dez vezes por segundo.

**O slot desenha o sprite do item** (FUN-108). Cada item tem `appearanceId` resolvido da
tabela, e o inventário o desenha com o MESMO quadro que o mundo usa: `ItemSprite`
(`packages/client/src/shell/ItemSprite.tsx`) é um canvas de 32 px por item, pintado uma vez
com `pack.object(appearanceId)` — DOM, sem Pixi, porque HUD é DOM (ADR 0007). A inicial do
nome num quadrado só aparece sem pacote de arte, enquanto o quadro está em voo, ou quando o
pacote não tem a aparência; ela é a degradação, não o desenho.

Para isso o **equipado leva `itemId` no protocolo** desde esta task. O `sim` MOVE o item para
o corpo ao equipar — ele sai da mochila —, e `inventory.equipped` era só `slot → instanceId`:
o cliente procurava o item vestido na mochila, não achava, e o slot saía com a inicial de
"item" e o tooltip "Tirar item". Agora cada entrada de `equipped` tem a mesma forma de uma
entrada da mochila (`instanceId`, `itemId`, `quantity`), o cliente resolve a definição por
`itemId` e o tooltip volta a ter o nome. O opcode não muda: é a mesma mensagem, com mais
dentro. O extrato que vai ao ledger continua `slot → instanceId`, porque o banco só precisa
saber onde cada linha está.

### A action bar entrou no M18 (AB-10, ADR 0032 d.1–d.3)

A FUN-90 pedia "slots com hotkey que disparam a ação como intenção", e a barra 2 × 12 entrou no
M18 como a configuração do bot **e** a superfície de disparo manual: a tecla manda `use-slot`, e
o servidor decide elegibilidade, gold, mana e cooldown (invariante 4). O disparo manual
substitui o que a FUN-90 chamava de "magia manual" — o opcode `cast` não existe, e quem lança
continua sendo o servidor. Ver `bot.md` §"A tela".
- **§21.5 fala em slots fixos; aqui o lugar é elástico** (#160, ADR 0026 decisão 6). Mochila de
  20 e bolsa de 10 são o tamanho INICIAL, e crescem por linha enquanto houver capacidade — decisão
  do usuário: "o lugar não é limite, o peso é". A Caixa de Loot fica só para o que não cabe no
  peso.
