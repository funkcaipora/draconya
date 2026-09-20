# Itens, equipamento e inventário

**Status:** parcial — catálogo, `item_instance` (FUN-76), inventário por peso, equipamento e
capacidade (FUN-82), loot de item por abate e Caixa de Loot da Sessão (FUN-88) e a **tela de
mochila e equipamento** (FUN-90) e o **kit de nascimento** dado na criação (#153) e dois anéis com efeito passivo — Energy Ring e Life Ring (SV-16) — implementados; resgate da caixa e autovenda ainda não existem
**PRD:** §21, §22, §23, §25, §43.6
**Épico:** E5 (inventário, autovenda, Caixa de Loot); E7 (imbuement, durabilidade de anéis/colares); E11 (proveniência de lendário)

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

`charges` e `durationMs` estão declarados no schema e **ninguém os consome** (§21.3). A forma
entra agora para o catálogo não mudar quando a mecânica existir.

## Inventário e equipamento (FUN-82)

**Capacidade é peso**, no paradigma do Tibia (§21.5): a mochila cabe o que o personagem aguenta,
e a capacidade cresce com o level pela mesma tabela que dá HP e mana. Contar espaços seria outro
jogo — e um em que a armadura pesada não custa nada.

O que está **equipado conta no peso**. Sem isso, a estratégia ótima é vestir tudo para carregar o
dobro, e a capacidade deixa de significar o que diz.

| | |
|---|---|
| stack máximo | 100, e pilha cheia começa outra |
| empilha | só o que o conteúdo marca `stackable` — queijo sim, espada não (munição não é item desde o ADR 0026; ver "Decidido" abaixo) |
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
item nem vocação. `fist` é o fallback desarmado e não existe como arma. A munição não é item: é
uma seleção por família (`select-ammo`), com a grátis por padrão e as pagas debitando gold por
tiro; ver `combat.md` ("Famílias de arma e proficiências"). Arma de duas mãos (`twoHanded`, o bow)
recusa escudo, e vice-versa.

Desde o CMB-04 o combate lê também a **defesa** (`defense`) da peça: escudo ou arma corpo a corpo
de uma mão bloqueia parte do golpe físico. A escolha da fonte é do inventário (`defenseSource`),
que já conhece os slots e a incompatibilidade bow+escudo; a fórmula e a posição do sorteio estão
em `combat.md` e no ADR 0031. Bow/twoHanded e wand/rod não têm defesa residual — declarar
`defense` neles é recusado no boot. Não existe item de escudo no catálogo real ainda; a defesa
entra pelas armas de uma mão (machete 9, steel axe 10, spike sword 10, provisório).

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

**Com uma arma de distância na mão, o slot do escudo é o seletor de munição** (ADR 0026 d.3):
a célula mostra a munição em uso — a escolhida, ou a grátis, que é o que o servidor atira sem
escolha — com o preço por tiro; o clique abre o `AmmoPicker`, a lista da família com sprite,
nome, attack, preço ou "grátis" e level exigido (desabilitado acima do level, só para não
oferecer o que o servidor vai recusar); um clique manda `select-ammo`, e a escolha aparece
quando `player-stats.ammo` volta.

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

## Anéis com efeito passivo (SV-16, #352)

Os dois primeiros itens `kind: 'ring'` do catálogo. O efeito é passivo: vale enquanto o item
está equipado no dedo (`slot: 'finger'`), sem carga e sem duração — `charges`/`durationMs`
continuam declarados no schema e mortos (§21.3); a durabilidade de anéis é E7, issue própria.

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

## Decidido (ADR 0026): munição, containers e runa

- **Munição é seleção, não item** (decisão 3, o Huntera): o bow mostra no slot do escudo a
  munição escolhida da família `arrow`; a `arrow` é grátis e cada tiro das outras debita o
  preço dela do gold, pelo caminho do supply (§20.1). Sem gold, o tiro sai com a grátis. A
  seleção viaja no extrato e volta pelo ticket. Issues #151, #152, #161.
- **Mochila e bolsa elásticas** (decisão 6): a mochila é o item no slot `back`, a bolsa é fixa
  do personagem; 20 e 10 lugares iniciais que crescem por linhas sem limite — o único teto é o
  peso. Loot cai na mochila; a bolsa é onde o jogador organiza; a Caixa de Loot fica só para o
  que não cabe no peso. Sem bolsa dentro de mochila. Issues #160, #161.
- **Runa é supply de ataque** (decisão 8): a Avalanche é a primeira, com `requires { level,
  magicLevel }` e preço por uso; a categoria `rune` do bot a lança. Issue #165.

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

### A action bar não entrou, e por quê

A FUN-90 pedia "slots com hotkey que disparam a ação como intenção". **Não existe magia manual**:
o protocolo não tem `cast`, o servidor não tem caminho para ela, e quem lança é o bot. Combate
manual é o motor da F4 (E10).

Uma barra sem o que disparar seria decoração, e inventar o opcode com o servidor mudo do outro
lado é contrato antes do uso — o erro que a DT-07 nomeia. Ela entra quando houver o que ela
dispare.
- **§21.5 fala em slots fixos; aqui o lugar é elástico** (#160, ADR 0026 decisão 6). Mochila de
  20 e bolsa de 10 são o tamanho INICIAL, e crescem por linha enquanto houver capacidade — decisão
  do usuário: "o lugar não é limite, o peso é". A Caixa de Loot fica só para o que não cabe no
  peso.
