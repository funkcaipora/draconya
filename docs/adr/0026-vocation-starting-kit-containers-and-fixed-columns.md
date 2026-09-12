# 0026 — Vocação no level 8, kit inicial, munição e runa como consumíveis, containers do Huntera e as colunas fixas

**Status:** aceito
**Data:** 2026-09-12
**Contexto técnico:** `content` (itens, munição, vocações, magias, supplies), `sim` (arma,
munição, containers, buffs, grupos de cooldown), `protocol` (`choose-vocation`, `select-ammo`,
`move-item`, `inventory`), `server` (kit na criação, vocação e munição no extrato), `client` (as
duas colunas fixas)

## Contexto

O M12 pede quatro coisas que o código de hoje decide de outro jeito, ou não decide: as quatro
vocações com uma arma inicial cada e as magias até o level 80; o set inicial de couro e a
machete; o bot fixo na coluna da esquerda como no OTClientV8 com vBot; o set e a mochila fixos
como no cliente do Tibia, copiando a bolsa e a mochila do Huntera.

O que existe: as quatro vocações em `content/data/vocations/` com ganho por level, a regra
`vocationLevel: 8` em `progression/baseline.json`, `statsForLevel` por vocação a partir do 8,
`requires.vocationId` em item e magia, a recusa `wrong-vocation` no `sim` e no host — e **nenhum
escritor** de `character.vocationId` em lugar nenhum: a coluna `characters.vocation` existe e
nunca é escrita. O inventário é uma lista plana por peso (`inventory.ts`, "Peso, não slots"),
com nove slots de corpo e sem slot de mochila. O ataque do jogador é um só: `attack` da arma na
mão, alcance fixo em `combat.player.attackRange` (1, "o único que existe hoje"), skill `melee`
sempre, e nada lê munição nem mana. O catálogo de magias tem três magias genéricas com poder
fixo. O bot abre numa sobreposição de tela inteira, e o inventário numa janela à direita que a
barra do topo fecha.

O que já estava decidido, e que este ADR não pode contrariar em silêncio: o PRD §21.1 diz que
equipamento só vem de drop de monstro; o §20.1 `[DECIDIDO]` diz que poção e runa não são itens
físicos — usar debita gold; o §5.3 põe set e mochila à direita e o bot à esquerda; o §7.4 põe a
escolha de vocação no level 8; e o ADR 0019 §25 adiou containers aninhados "até equipamento
existir" — existe desde a FUN-82, e ninguém reabriu a decisão.

O que o Huntera faz, lido do socket em 2026-09-11 (`docs/reference/huntera-observed.md`, Parte
III): `player-inventory` com dez chaves de equipamento (`helmet, amulet, backpack, armor,
weapon, shield, ring, legs, boots, ammo`), a mochila com 20 lugares (`slotCount`), uma bolsa
fixa com 10 (`satchelCount`), itens `{ uid, itemId, count, cumulative, … }`, o loot da hunt
caindo na mochila por índice (`inventory-delta { container: "backpack", index, item }`), o
gold fora dos containers, e a munição como uma **seleção por família** (`ammo-selection { arrow,
bolt }`), não uma pilha. Um personagem level 7 com `vocation: null` segurava uma wand of vortex
com `weaponAttack: 0` — arma de vocação não bate sem vocação.

O que o Tibia faz (TibiaWiki, lido em 2026-09-12): vocação escolhida ao sair da ilha inicial no
level 8, com a arma da vocação; bow de duas mãos com alcance 6 e o dano da flecha; wand e rod
com alcance 3, dano por faixa fixa e mana por golpe (wand of vortex 2, snakebite rod 1); ganho
por level Knight 15/5/25, Paladin 10/15/20, Sorcerer e Druid 5/30/10, sem vocação 5/5/10; cada
magia instantânea com grupo de cooldown (attack, healing, support) e um **Base Power** por
magia — a fórmula de conversão para dano não é publicada; runas com cargas compradas no NPC.

## Decisão

1. **A vocação é escolhida pelo jogador, no level 8 ou depois, uma vez.** Intenção
   `choose-vocation` do cliente, aceita em qualquer sessão hospedada — Cidade ou hunt — quando
   `level >= progression.vocationLevel` e a vocação é `null`; sem NPC, altar ou lugar. Sem
   troca depois. `characters.vocation` é escrita uma vez, pelo extrato no `jobs` (`… WHERE
   vocation IS NULL`), nunca pelo `game`; a vocação viaja no ticket como o bot e as skills.
2. **O kit de nascimento é dado, não dropado.** Machete, leather helmet, leather armor, leather
   legs, leather boots e a mochila nascem como `item_instance` com `origin: 'starting-kit'`, na
   mesma transação de `POST /api/characters`. É a exceção declarada ao §21.1; a arma de vocação
   (`origin: 'vocation-choice'`) é a outra. Tudo o mais continua vindo de monstro.
3. **Uma arma inicial por vocação:** Knight → steel axe; Paladin → bow; Sorcerer → wand of
   vortex; Druid → snakebite rod. A arma vai para a mão e a machete volta para a mochila.
   **Munição como no Huntera:** não é item nem pilha — é uma seleção por família (`arrow`,
   `bolt`), mostrada no slot do escudo quando um bow está na mão; a `arrow` é grátis e cada tiro
   das outras (sniper arrow, onyx arrow) debita o preço dela do gold do personagem, pelo caminho
   do supply (§20.1). Sem gold para a munição escolhida, o tiro sai com a grátis. A seleção
   persiste pelo extrato, como a vocação.
4. **Uma skill corpo a corpo só, mais `distance`.** Sem sword/axe/club separadas por enquanto
   (`[ABERTO]` em `docs/product/progression.md`). O bow treina `distance`, e o dano do tiro é o
   `attack` da munição pela skill; wand e rod gastam mana por golpe e treinam `magic` pela mana
   gasta, como magia. Elemento de munição, wand e rod é ignorado até haver resistência por
   elemento no monstro.
5. **O catálogo de magias é o do Tibia até o level 80, filtrado pelo que o motor expressa.**
   Entram: ataque em alvo, área (onda e cleave à frente, feixe, explosão ao redor do lançador,
   cadeia aproximada por alvo mais vizinhos), cura, cura ao longo do tempo, haste, buffs de
   postura e magic shield, com os grupos de cooldown do Tibia — cada magia diz quanto tranca o
   grupo, e pode ter um grupo secundário — somados ao cooldown de categoria do bot. Ficam de
   fora, por nome em cada issue de vocação: runas e conjurações, invocação e ilusão, party,
   utilidade, cura de condição e dano ao longo do tempo (não há condições), magias de escudo (não
   há defesa de escudo). Os números são os do TibiaWiki, como fatos: **Base Power** por magia, e
   a conversão para dano por level e magic level é nossa, uma para todas, documentada e
   `[ABERTO]`. **Ganho por level é o do Tibia** (decisão do usuário): Knight 15/5/25, Paladin
   10/15/20, Sorcerer e Druid 5/30/10, sem vocação 5/5/10 — o PRD §9.3 ganha a divergência.
6. **Mochila e bolsa elásticas, sem aninhamento.** A mochila é o item no slot `back`; a bolsa
   (`satchel`) é fixa do personagem, não é item. As duas nascem com 20 e 10 lugares e **crescem
   por linhas, sem limite, enquanto houver capacidade**: o único teto é o peso. Loot cai na
   mochila; a bolsa é onde o jogador organiza (`move-item`); a Caixa de Loot fica só para o que
   não cabe no peso. Sem bolsa dentro de mochila — é a resposta limitada ao §25 do ADR 0019. O
   gold continua fora, porque é saldo.
7. **As duas colunas são fixas, como no OTClient: set, mochila e bolsa à direita; bot e hunts à
   esquerda.** Analisador e Bestiário à direita, abaixo dos containers; chat embaixo à esquerda.
   É o PRD §5.3 e o padrão do OTClientV8 (inventário no painel direito, bot no esquerdo,
   containers empilhados abaixo do inventário). Painel fixo é minimizável pela barra do topo,
   nunca removível. Referência visual: OTClientV8 (MIT) com vBot — painel lateral, linhas
   compactas, um interruptor por regra, a edição fina por cima.
8. **Runa é supply de ataque, e a Avalanche é a primeira.** Como poção (§20.1): não é item nem
   instância, usar debita gold — o preço por uso é o preço da runa no Tibia dividido pelas
   cargas. Ganha `effect.damage` com área e `requires { level, magicLevel }`; a categoria `rune`
   do bot, que existe desde a FUN-84, passa a ter o que lançar.

## Alternativas

- **Escolher a vocação no cadastro.** Contraria o §7.4 e o tutorial do level 1 ao 8; e o
  personagem que ainda não jogou não tem com que escolher.
- **A tríade de armas do Knight (jagged sword, daramian mace, steel axe), como no Tibia.** Sem
  skills por arma as três são a mesma arma; escolher entre elas seria uma tela para nada.
- **Flechas físicas empilhadas no slot `ammo`, como no Tibia.** Inventário, peso e loot de
  munição para nada, e o bot pararia de atirar com a aljava vazia — o oposto de idle-first. O
  Huntera já resolveu isso com a seleção, e é a referência.
- **Spear como arma do Paladin.** Dispensaria munição, mas não é o que o Tibia dá no level 8
  nem o que o usuário pediu.
- **Skills sword/axe/club separadas.** É o Tibia, e fica `[ABERTO]`: dobraria o conteúdo de
  skill sem mudar nada no que o jogador vê hoje, que é uma arma só por vocação.
- **Fórmulas algébricas por magia.** O TibiaWiki de 2026 não as publica mais; copiar as do
  TFS/Canary é copiar código GPL (ADR 0019). Base Power com conversão nossa é o que dá para
  sustentar como fato.
- **Manter o ganho por level do PRD §9.3.** Decisão do usuário: copiar o Tibia, "qualquer coisa
  eu edito depois".
- **Containers com tamanho fixo (20 e 10) e transbordo para a Caixa de Loot.** Foi a primeira
  versão do plano; o usuário decidiu que o lugar não é limite, o peso é.
- **Bolsa dentro de mochila (aninhamento do Tibia).** Continua adiada: o Huntera não aninha, e
  o que o jogador precisa é organizar, não empilhar containers.
- **Set e mochila à esquerda, com o bot.** Foi a primeira versão do plano, divergia do §5.3; o
  usuário corrigiu para o layout do OTClient.
- **Runa física com cargas na mochila.** É a mesma discussão da munição, com o mesmo resultado;
  e contraria o §20.1, que já está decidido.

## Consequências

- `packages/content` ganha munição (`data/ammunition/`, seleção com preço por tiro), o campo
  `weapon` no item (`kind`, `range`, `ammoFamily`, `manaPerHit`, `damage`), `twoHanded`, o slot
  `back`, `kind: 'container'` com `initialSlots`, `startingKit` e `satchelInitialSlots` na
  progressão, `startingWeaponItemId` e `spellSkill` na vocação, grupos e Base Power na magia,
  `effect.damage` e `requires` no supply. Os ganhos por level passam a ser os do Tibia.
- `packages/sim` ganha `chooseVocation`, `selectAmmo`, o golpe por tipo de arma, o gold por tiro
  pelo caminho do supply, containers elásticos com `move`, buffs e cura ao longo do tempo como
  eventos da fila, grupos de cooldown com instante absoluto, formas de área a partir da direção
  do personagem — que passa a existir no `sim`. Tudo opcional no snapshot: sem bump de
  `SNAPSHOT_FORMAT_VERSION`.
- `packages/protocol` ganha três intenções (`choose-vocation` 14, `select-ammo` 15, `move-item`
  16), `vocationId` e `ammo` em `player-stats`, `vocations` e `ammunition` no catálogo, e o
  `inventory` com dois vetores posicionais.
- `packages/server`: o kit é a segunda inicialização de linha na criação do personagem (o bot
  padrão é a primeira); vocação, munição e posição dos itens viajam no extrato e voltam pelo
  ticket; `item_instance` ganha `container` e `slot_index`; `characters` ganha `ammo`. O `game`
  continua com uma escrita só (ADR 0021).
- `packages/client`: duas colunas fixas e minimizáveis, o inventário em quatro peças (set,
  seletor de munição, mochila, bolsa), o bot com interruptor por regra e editor por cima.
- O que piora: mais estado por personagem (vocação, munição, posição de item) atravessa o
  extrato, e cada campo novo é um lugar a mais para o `#creditUnrestorable` esquecer — a #154
  fecha esse buraco para os que existem. A conversão do Base Power é um número nosso, e é
  balanceamento até alguém medir contra monstros de level 80, que não existem.
- Divergências registradas: §21.1 (kit dado) em `docs/product/items.md`; §9.3 (ganho por
  level) em `docs/product/progression.md`. O §5.3 não diverge.

## Invariantes afetados

Nenhum. O invariante 6 continua: `content/` ganha ids de aparência, nunca arte. O 4 continua:
`choose-vocation`, `select-ammo` e `move-item` são intenções, e o servidor decide. O 9 e o 10
continuam: o kit é inicialização de linha durável antes de haver sessão (como o bot padrão da
FUN-114), e a arma de vocação, a munição e a posição dos itens chegam ao banco pelo extrato e
pelo `jobs`, na transação do ledger. O 11 continua: o bot atira com a munição grátis quando o
gold acaba, e continua a hunt.
