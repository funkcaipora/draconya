# @draconya/content

## Propósito

Dados de jogo versionados: monstros, hunts e rotas, itens, magias, vocações, prey, bestiário,
supply, parâmetros de economia e feature flags. Validados por schema no boot do nó.

## Fronteiras

**Pode importar:** `protocol`.
**Não pode importar:** `sim`, `server`, `client`, `tools`.

## Dois pontos de entrada

```
@draconya/content        schemas, tipos e montagem em memória — PURO
@draconya/content/load   leitura de disco com node:fs
```

`sim` importa só o primeiro, e o lint impede o segundo. O motivo é o invariante 1: se o
carregador saísse pelo mesmo ponto de entrada, `node:fs` entraria em `sim/` por
transitividade — **sem nenhum import de `node:*` aparecer no pacote**, que é o que torna
esse tipo de violação difícil de enxergar em revisão.

Regra prática: se a função lê arquivo, ela vai para `load.ts`. Se ela só valida ou monta
estrutura em memória, vai para `content.ts` e pode ser usada por qualquer um.

## O catálogo importado (ADR 0038, #572)

**`staging/monsters/` não é conteúdo carregado** (#578/#579): é onde `pnpm catalog:import monsters`
escreve — a transcrição PURA do Canary, item ainda por slug de nome, sem passar pelo catálogo de
itens (#573/#574) nem pela tabela de aparências. `pnpm catalog:promote-monsters` (#580) é o passo
SEGUINTE, e não depende de `CANARY_DIR`: lê o que já está commitado em `staging/` e separa cada
entidade (a forma do `monsterSchema` mais `bestiary` e `outfitId`) em três destinos —
`data/monsters/generated/<fatia>.json` (o monstro, sem os dois campos), `bestiary/baseline.json`
(`entries`) e `appearances/baseline.json` (`monsters`). De caminho, valida `loot.items` contra o
catálogo de itens REAL (`data/items` — o que `load.ts` de fato carrega hoje) e remove a linha cujo
item não existe, ou que pede pilha de item que não empilha — contada, nunca em silêncio, em
`docs/reference/catalog/monsters-promotion-report.md`. Rat, Rotworm, Dragon e Dragon Lord nunca
são promovidos POR ESTE SCRIPT (`HAND_AUTHORED_MONSTER_IDS`, `scripts/catalog/promote-monsters.ts`)
— o #581 os regenerou uma única vez, direto em `generated/<fatia>.json` (Rat em `mammals.json`,
Rotworm em `vermins.json`, Dragon e Dragon Lord em `dragons.json`). O #581 tinha dado aos dois um
override próprio (`data/monsters/overrides/rat.json`/`rotworm.json`) para o `blockable: true`
temporário que Rat Cellars e Rotworm Caves ainda exigiam com o modelo antigo de pull; o #586
(M36-05) converteu as duas hunts para os spawns reais do Canary e apagou os dois arquivos — Rat e
Rotworm caem no `blockable: false` do próprio Canary, como o resto do bestiário. `pnpm
catalog:promote-monsters` (`preserveHandAuthored`) NUNCA sobrescreve essas quatro entradas numa
reimportação futura — elas só mudam de novo por decisão deliberada, como o #581. `load.ts` não lê
`staging/`, e nada do jogo deve ler.

**`staging/items/` também não é conteúdo carregado** (#573/#574): `pnpm catalog:import items`
escreve lá — 1946 itens de caça. `items.ts` já resolve `slot: 'hand'` por default em TODA arma
sem `<script><attribute key="slot">` (a maioria do Canary não declara — os 22 itens `kind:
'weapon'` autorais concordam: `hand`, twoHanded ou não), e não copia `defense` de item que o
PRÓPRIO Canary classifica fora de `shield`/arma (`primarytype` "valuables"/"creature products"
com `weaponType shield`/`sword` residual — "rusted shield", "broken macuahuitl": curiosidade de
quest, não equipamento). Uma arma cujo `primarytype` MENTE (diz "axe weapons" mas `weaponType` é
`distance` sem `ammotype` — "broken Iks spear") também sai do corte, pela mesma regra M34-04 que
já vale para `primarytype: "distance weapons"`. `pnpm catalog:promote-items` (#748) é o passo
SEGUINTE, na mesma forma de `promote-monsters.ts`: lê `staging/items/generated/`, e escreve
`data/items/generated/<fatia>.json` MENOS duas exclusões, cada uma contada em
`docs/reference/catalog/items-promotion-report.md`, nunca em silêncio — id que colide com item
AUTORAL (os 73 de sempre; o autoral vence, ADR 0014), e `appearanceId` (o `id` do `<item>` do
Canary, que É o clientid do OTB) fora do inventário do pacote que `appearances/baseline.json.pack`
DECLARA (FUN-21; lido pelo nome do campo, nunca fixo em código — a troca de pacote, quando
acontecer, não pede mudança aqui). `appearanceId` é staging-only — o mesmo recurso que `outfitId`
usa em monstro — e vira linha em `appearances/baseline.json.items`, nunca campo do item
(`itemSchema` não o declara).

**`staging/spells/` e `staging/runes/` também não são conteúdo carregado** (M37-08, #595):
`pnpm catalog:import spells`/`pnpm catalog:import runes` lê `data/scripts/spells/**`/`data/scripts/
runes/**` do Canary (`scripts/catalog/spell-calls.ts` para a chamada de método, `scripts/catalog/
spell-formula.ts` para o reconhecedor estrutural de `onGetFormulaValues` — nunca executa Lua, ADR
0019) e escreve lá, por fatia de VOCAÇÃO (`generated/knight.json`, `generated/general.json` para
o que não tem restrição). As 82 magias e 20 supplies do #523 continuam autorais em `data/spells/
*.json`/`data/supplies/*.json` com os MESMOS ids — gerar direto em `data/spells/generated/`
colidiria (a mesma razão de `staging/monsters/`); não existe `pnpm catalog:promote-spells` ainda —
migrar o catálogo manual para `overrides/` + `generated/` é trabalho de #596/#597, que também
cobrem o resto das ~120 magias e as runas fora das duas formas de fórmula que este leitor
reconhece (`docs/reference/catalog/spells-report.md`/`runes-report.md` listam o que ficou de
fora, com o motivo).

**`learnPrice` da magia (#624, ADR 0058 d.3) é importado dos NPCs, sem `staging/`:** a magia continua
autoral em `data/spells/*.json`, e `pnpm catalog:spell-prices` (`scripts/catalog/spell-prices.ts`,
o irmão de `catalog:npc-prices`) lê as ~1 800 chamadas `StdModule.learnSpell` dos 51 NPCs de
`data-otservbr-global/npc/` com `luaparse` — nunca executa Lua, e um preço/nome/vocação que não é
literal vai para o relatório em vez de virar `0` — e regrava SÓ a linha `"learnPrice"` do arquivo
(insere antes de `"manaCost"`, preserva a formatação). Regras: o **MENOR** preço entre os NPCs que
ensinam a magia à vocação dela (ADR 0038 d.6); a ligação é o NOME sem diferenciar caixa (o
`hasLearnedInstantSpell` do Canary é `strcasecmp`), não o id do arquivo — `haste-druid` e
`haste-sorcerer` têm o mesmo nome, e é a vocação do NPC (normalizada para a base: Master Sorcerer →
Sorcerer; Monk fica de fora) que separa; `premium` não entra. **`learnPrice: 0` é magia grátis** (as
básicas), e AUSENTE é "ninguém a ensina" — nunca confunda os dois (`!== undefined`, jamais truthy).
Magia sem NPC (`challenge`, `conjure-power-bolt`, `conjure-sniper-arrow`, `great-death-beam`) NUNCA
é tocada pelo script: o preço dela é curado à mão com a fonte no `_open` (três provisórios, um
ausente de propósito — ver `docs/product/progression.md`, "Aprender magia"). `pnpm check` roda
`catalog:spell-prices --check`: um arquivo de magia divergente do Canary, ou o relatório
(`docs/reference/catalog/spell-prices-report.md`) desatualizado, reprova. `load.test.ts` fecha o
outro lado: toda magia do catálogo real tem preço, exceto a `NOT_TAUGHT` — uma magia nova sem
`learnPrice` seria uma magia que ninguém consegue lançar.

**`data/skinning/generated/` é a esfola de cadáver** (#626, ADR 0048 d.5/d.6): `pnpm catalog:import
skinning` lê o `skinning.lua` do Canary (`config[ferramenta][id do cadáver]`) e a cruza com o
`monster.corpse` e a cadeia de decaimento (`duration`/`decayTo`) de cada monstro do catálogo — uma
linha por MONSTRO, com a ferramenta, o material, a `chance` (`SKINNING_CHANCE_SCALE = 100000`) e
os `stages` esfoláveis do cadáver (`canaryItemId` é identidade para o Scavenge, nunca arte;
`afterTtlMs` é a vida do cadáver DEPOIS da tentativa — o `duration` do `after` do Lua mais a cadeia
`decayTo` dele no `items.xml`, 360 s em todas as 62 entradas, porque o `transform` do Canary reinicia
o decaimento). Depende
de `data/monsters/**` e `data/items/**` já promovidos: monstro, ferramenta ou material fora do
catálogo saem em `skipped` no relatório, e o boot recusa referência solta. A obsidian knife, a
blessed wooden stake e o `rabbits-foot` são itens AUTORAIS (o importador de itens não classifica
`primarytype="tools"`); o pé de coelho vale 50 gp (o preço de compra de `shops.lua`, que o `items.xml`
não dá) e NÃO leva `creatureProduct`, porque o flag vem do `primarytype="creature products"`.
Reimportar depois de promover mais monstros recupera o que ficou de fora.

Qualquer `data/<tipo>/` (`items/`, `monsters/`) aceita, além do arquivo autoral direto na pasta,
duas subpastas que `load.ts` lê sozinho, sem precisar de mudança em `content.ts`:

```
data/items/backpack.json             # autoral, uma entidade por arquivo (de sempre)
data/items/generated/weapons.json    # promovido por `pnpm catalog:promote-items` — um ARRAY por fatia
data/items/overrides/*.json          # correção nossa: { id, reason, patch }
data/monsters/generated/mammals.json # promovido/regenerado — um ARRAY (Rat mora aqui desde o #581)
data/monsters/overrides/*.json       # correção nossa: { id, reason, patch } — nenhuma hoje (#586 apagou as duas que existiam)
```

Um arquivo — autoral ou gerado — que contém um **array** vira várias entidades; um objeto solto
continua sendo uma entidade só, como sempre foi. **Id repetido entre autoral e gerado é erro no
boot** (a mesma checagem de duplicata que `parseAll` já fazia, sem código novo: as duas listas só
se juntam antes de chegar lá).

Um `overrides/*.json` **nunca** vira entidade nova — é `{ id, reason, patch }` aplicado por cima
da entidade de mesmo id (autoral OU gerada) toda vez que o conteúdo é CARREGADO, nunca uma vez só
na hora de importar. `reason` é obrigatório e sem default (o boot recusa sem ele): correção sem
motivo é indistinguível de erro de digitação na próxima revisão. Override para um id que não
existe em lugar nenhum é erro — correção órfã quase sempre significa que o id mudou. O patch é
**raso**: sobrescreve os campos que lista, não troca o objeto inteiro nem faz merge profundo em
campo aninhado.

Por que a correção não entra em `generated/` direto: `pnpm catalog:import` regenera essa pasta a
cada reimportação, sempre como transcrição PURA do Canary — um campo editado ali seria
sobrescrito em silêncio na próxima vez. `overrides/` é o único lugar em que uma correção
sobrevive a uma reimportação. Ver `scripts/catalog/` para quem escreve `generated/`.

Toda entidade em `generated/` carrega um bloco `source: { engine, commit, path }` (ADR 0038
decisão 2, `CatalogSource` em `scripts/catalog/generated-writer.ts`). Como cada schema de
entidade é `z.strictObject`, isso só chega até `sim`/`server` sem derrubar o boot porque o
schema declara `source: catalogSourceSchema.optional()` explicitamente — a MESMA forma que
`tilemapSchema` já usa para o `source` do mapa importado (ADR 0025 decisão 3). Todo schema novo
que passar a hospedar entidade gerada precisa do mesmo campo; esquecê-lo só aparece quando a
primeira entidade de verdade for importada, e o erro (`Unrecognized key: "source"`) não aponta
para cá.

**O boss é o monstro com bloco `bosstiary`** (#629): `monsterSchema.bosstiary = { rarity, raceId }`
(`bane`/`archfoe`/`nemesis` e o `bossRaceId` do Canary, a chave do contador de abates) e `boss:
true` — o `isBoss` do Canary É "tem bloco bosstiary" (`!bosstiaryClass.empty()`). O importador
(`scripts/catalog/monsters.ts`, `readBosstiary`) escreve os dois juntos, e a promoção os leva a
`data/monsters/generated/` como estão (é campo do schema, ao contrário de `bestiary`/`outfitId`);
`buildContent` recusa `bosstiary` sem `boss` e duas raridades para o mesmo `raceId` (variantes do
mesmo boss compartilham o contador). A tabela de níveis por raridade — abates e pontos de cada um
dos três níveis, a `IOBosstiary::levelInfos` — é `data/bosstiary/baseline.json`, transcrita à mão
de UM arquivo do Canary (bloco `source`, sem `_open`: o boot avisa todo `_open` como valor não
decidido, e este é decidido). Boss não tem `bestiary` no Canary, e não entra em
`bestiary/baseline.json`.

## Mapa e rota

O mapa é **grade de caracteres**, uma string por linha: `#` bloqueia, o resto é livre. Escolha
deliberada sobre um formato binário compacto — mapa é conteúdo, e conteúdo se edita e se revisa.
Numa grade ASCII o diff do PR mostra a parede que mudou; num blob base64 mostra que "o mapa
mudou". A conversão para `Uint8Array` acontece uma vez, no carregamento.

O bitmap em memória é **array plano indexado por `y * width + x`**, não array de objetos: é
consultado a cada passo de cada monstro de cada instância, e é a estrutura mais quente do motor.

**O mapa tem andares** (FUN-119, ADR 0025). `grid` é o açúcar de um andar só; `floors:
{ "7": { grid, speed? }, "6": … }` é a forma completa, com `z` dizendo qual é o andar padrão. A
camada `speed` é a velocidade de chão por tile, um caractere resolvido por `speedPalette` —
ausente, todo tile anda a `DEFAULT_GROUND_SPEED` (150, o que o TFS usa). `floorChanges` liga um
tile a outro andar (escadas), e `source` diz de que OTBM um mapa importado veio. O `sim` só lê
bloqueio, velocidade e escadas; a pilha de aparências de um mapa importado mora em `things/`,
nunca aqui.

**`city.json` diz o mapa E o passo**: `stepDurationMs` é o passo fixo da Cidade (150 ms, cópia do
Huntera); a hunt anda pela fórmula do Tibia com `progression.startingSpeed`/`speedPerLevel` e
`monster.speed`.

**Mapa importado: o que é gerado e o que é autorado** (FUN-118, FUN-120, ADR 0025). Um mapa com
`source` veio do OTBM real por `pnpm map:import`: `floors` (grade e velocidade), `speedPalette`
e `source` são GERADOS, e `pnpm map:import --check` — que o `pnpm check` roda — reprova a grade
editada à mão, porque ela é a geometria do arquivo de origem e não uma opinião. O que se autora
no JSON é `entryPoint` e `floorChanges`; reimportar preserva os dois. Mapa importado NÃO tem
linha em `appearances.maps`: a arte dele é a pilha por tile em `things/<versão>/maps/<id>.json`,
que o cliente busca pelo `mapId` da sessão. A regra das escadas de Thais: o degrau (aparência
1947, ou a variante 1958, em `(x, y, z)`) leva a `(x, y−1, z−1)`, e o tile em cima dele,
`(x, y, z−1)`, leva a `(x, y+1, z)` — observado no Huntera e válido para as 46 escadas do
recorte; `load.test.ts` prende que cada escada tem a volta. `city/city.json` aponta `thais`; a praça 10×10 de antes vive
só como fixture em `packages/server/src/testing/content.ts`.

**A rota fecha um laço** (§14.4), e isso é validado no carregamento. Rota aberta faz o
personagem chegar ao fim e parar — o sintoma chega dias depois como "a hunt travou", sem ligação
nenhuma com o arquivo de rota.

**Cenário usável: o importador CLASSIFICA, o mecanismo é a #728** (#727, ADR 0050 d.1).
`tilemapSchema.interactables[]` diz o que cada tile É — porta (comum, de chave, de level, de
quest), capim, stone pile, rope spot, ladder, alavanca, baú, placa, teleporte — a partir de
`aid`/`uid`/`text` do OTBM (portas e capim, pela tabela; baú e placa, pelo atributo) e das
tabelas do Canary transcritas como DADO em `data/scenery/canary-tables.json` (`doors.lua`,
`register_actions.lua`, `global.lua`, `items.xml` — só números e pares de id, nunca o script,
ADR 0019). **O tile de um interativo nunca é `#` na grade**, mesmo fechado/trancado: quem sabe
se dá para pisar ali agora é o interativo — hoje só a classificação existe; o estado que muda por
sessão (`TileOverrides`) é a #728, que ainda não existe, e o `sim` não lê `interactables` até
lá. `docs/product/scenery.md` traz os números medidos nos quatro mapas.

Confira antes de subir o servidor:

```
pnpm content:check
```

## Invariantes locais

- **Nunca contém arte** (invariante 6), e o id de aparência **não mora na entidade** (FUN-94):
  ele vive em `data/appearances/baseline.json`, uma linha por id de conteúdo, e `buildContent`
  resolve `appearanceId`/`outfitId` a partir dela no boot. Nunca um caminho de arquivo de sprite,
  em lugar nenhum. Ver ADR 0008 e a seção "A tabela de aparências", abaixo.
- **A versão de conteúdo é fixada na sessão** (invariante 7). Uma hunt iniciada na versão N termina
  na versão N. Este pacote expõe a versão; quem cria sessão a congela.
- Balanceamento é dado, não código. Se mudar um número exige deploy de lógica, está no lugar errado.
- Conteúdo inválido derruba o boot. Nunca chega à simulação.

## Progressão (FUN-34)

`vocations/*.json` traz o incremento por level de cada vocação; `progression/baseline.json`
traz onde o personagem começa e como cresce **antes** de escolher vocação — o personagem nasce
sem ela e escolhe no level 8 (§7.4).

**Nada disso vive em código.** Mudar quanto um Cavaleiro ganha de HP por level é editar JSON e
reiniciar. Se um número desses aparecer em `packages/sim`, a tabela deixou de ser a fonte da
verdade e o balanceamento virou tarefa de quem mexe em código.

A base é **obrigatória**: sem ela não há stats de level 1, e um default em código seria
exatamente o que a regra acima proíbe. O carregador recusa conteúdo sem ela.

`progression.startingKit` (#153, ADR 0026 decisão 2) é com o que todo personagem nasce
**vestido**: item e slot. `buildContent` confere que o item existe, que o slot é o dele, que ele
não tem `requires` (o personagem nasce level 1 sem vocação) e que há um por slot — reprova no
boot, não na criação do personagem. Vazio é válido: é o conteúdo de teste.

Valor ainda não decidido no PRD entra com `_open` **no próprio arquivo**, nunca como número
que parece decidido — palpite disfarçado de decisão é o que faz ninguém lembrar de voltar. O
boot repete todos eles em `openValues`, e o `docs-check` conta os `[ABERTO]` correspondentes
em `docs/product/`.

## A tabela de aparências (FUN-94)

```
data/appearances/baseline.json     # id de conteúdo → id de aparência
```

```jsonc
{
  "id": "baseline",
  "pack": "tibia-1533",            // de qual pacote vieram estes números
  "monsters": { "rat": 21 },       // → outfitId
  "items": { "spike-sword": 3271 } // → appearanceId
}
```

**Trocar de pacote de assets é editar ESTE arquivo**, e mais nenhum. É o que o ADR 0008 já
prometia; antes da FUN-94 os ids viviam inline em cada entidade, e a promessa valia na letra
— nenhum caminho de arte em `content/` — mas não no efeito.

Separada **por tipo**, e não um mapa achatado: id é único dentro de um tipo, não entre eles. No
dia em que existir o item `rat` e o monstro `rat`, um mapa achatado sobrescreveria o outro em
silêncio, no arquivo que existe justamente para ninguém conferir arte à mão.

`buildContent` reclama dos **dois lados**: entidade sem linha na tabela, e linha na tabela
apontando entidade que não existe. A segunda é o defeito que a tabela INTRODUZ — com o id inline,
apagar a entidade levava o id junto; com a tabela, a linha fica para trás.

**Fixture não escreve tabela à mão.** `placeholderAppearances(raw)` deriva uma com ids
sequenciais, e o nome diz o que ela é: um teste de combate não fala de arte, e os números dela
não apontam aparência que exista em pacote nenhum.

**`spells`, `supplies` e `hits` são conferidos de UM lado só** (FUN-109). São os efeitos que o
combate desenha — `effect` é a animação no tile, `missile` o projétil do conjurador ao alvo —, e
a linha órfã continua sendo recusada pela mesma razão de sempre. Mas magia sem entrada é magia
MUDA, e muda é válida: exigir o outro lado obrigaria cada magia nova a nascer com arte antes de
nascer com número, que é a ordem errada. Por isso o placeholder emite as três seções vazias, e
por isso `load.test.ts` — e não `buildContent` — é quem prende que todo spell do repositório
tem efeito hoje.

**`appearances.abilities` é a única seção sem conferência dos dois lados** (CMB-06). As chaves
dela são SEMÂNTICAS e compartilhadas (`spit`, `fire-impact`) — a ability de monstro aponta
`presentation.missileKey`/`impactKey`, nunca um id de arte (invariante 6). Chave sem linha é
MUDA, e linha sem uso é vocabulário à espera: as duas são válidas, e por isso não há id de
conteúdo para cruzar. O monstro declara `abilities[]`; ausente normaliza no boot para UMA
básica montada de `attack`/`attackIntervalMs`/`attackRange`/`damageType`, e o id `basic` é
reservado ao boot. **Os ids que cada chave resolve continuam sendo arte**, então
`packProblems` os confere contra o inventário do pacote (CMB-09, #242): um projétil fora da
faixa é o quadrado invisível da FUN-21, agora a cada lançamento.

**A IA do TFS é conteúdo opcional, nunca contagem por tick** (#518, referência §15-19).
`monsterAbilitySchema.chance` é OPCIONAL e sem default preenchido de propósito — não
`z.number().default(1)` — porque a diferença entre "ausente" e "declarado como 1" é observável
no `sim` (ausente não rola sorteio, declarado rola sempre). `monsterAbilityTargetSchema.area`
aceita `circle`, `wave`, `rows` e `beam` (`buildContent` recusa o resto; o catálogo usa `rows`,
#679); `wave`/`rows`/`beam` saem do monstro na direção do alvo, recalculada no `sim` — o schema não guarda direção nenhuma. `monster.defenses`
(cura própria) é normalizado no boot como `abilities` (`normalizeMonsterDefenses`, ausente vira
lista VAZIA — nunca `undefined` — para o `sim` iterar sem `?? []`), mas sem básica a sintetizar:
nenhum monstro cura sozinho por padrão. `monster.targetChange`/`runOnHealth`/`staticAttack` são
opcionais e passam direto (sem compilação) — presença é o que importa, não normalização de
forma. Nenhum destes campos tem default preenchido: ausência é o comportamento de sempre, e é
isso que preserva rato e rotworm.

**A conferência visual dos efeitos e projéteis é auditada e re-rodável** (CMB-09, #242). O
método, a versão do pacote e o bloqueio da biblioteca parcial estão em
`docs/combat-presentation-audit.md`; `src/appearances.test.ts` prende que toda referência cai no
inventário versionado e, quando `things/<versão>/library/manifest.json` existe, que a aparência
existe no índice dela. **Nesta máquina a biblioteca é parcial** (47 de 4171 folhas), e nenhum
sprite de efeito/projétil tem PNG — por isso nenhum id foi corrigido sem evidência; os `_open`
das magias registram o bloqueio em vez da frase genérica "sem conferência visual".

**`maps.<id>.wall` é UM id ou as quatro peças** (FUN-105): `{ vertical, horizontal, corner,
pole }`, como o Tibia monta muro — o tile bloqueado não tem uma arte só, e a peça é escolhida
pela vizinhança. A regra que escolhe é do CLIENTE (`world/walls.ts`); aqui moram os quatro ids,
e o schema não normaliza: o arquivo diz o que o humano escreveu, e `wallSetOf(wall)` é quem
transforma um número nas quatro iguais para quem desenha. `wallSetSchema` é `strictObject`,
como item e monstro — uma quinta peça seria descartada em silêncio, no arquivo que existe para
ninguém conferir arte à mão.

## O inventário do pacote (FUN-21)

```
data/packs/tibia-1533.json         # quais ids EXISTEM no pacote, por registro, em faixas
```

A tabela acima diz que o rato é o outfit 21; nada conferia que o outfit 21 **existe**. O
número passava pelo schema e pelo boot, e o defeito aparecia em produção como um quadrado
invisível — o cliente pede um quadro que não há e desenha o fallback, a três camadas da
causa. O pacote em si mora em `things/`, fora do Git, e o servidor nem o carrega; o que entra
aqui é a **sombra** dele: `[[100,167],[169,370],…]` por `object`, `outfit`, `effect` e
`missile`. `buildContent` cruza a tabela com essas faixas e recusa o id que não está em
nenhuma — `appearances.monsters.rat: outfit 9999 não existe no pacote tibia-1533`. Roda no
boot, no `pnpm content:check` e em `load.test.ts`, que é o que faz o CI reprovar sem ter pacote
nenhum.

**Gerado, nunca escrito à mão:** `pnpm assets:inventory` lê o `appearances-<hash>.dat` de
`things/<versão>/` e escreve o arquivo; `pnpm assets:inventory --check` (dentro do `pnpm
check`) regenera em memória e compara — pacote ausente é aviso e pulo, inventário
desatualizado é erro. É a única hora em que o arquivo encontra o `.dat` de verdade, e por
isso trocar de pacote é editar a tabela **e** rodar o gerador.

**A conferência só roda quando há inventário.** Sem nenhum, `buildContent` a pula — é o que
deixa a fixture de combate com o placeholder (`pack: "placeholder"`, ids 1, 2, 3…) sem falar de
arte. Com inventário e nenhum do pacote que a tabela cita, é erro: `pack` deixou de ser só
documentação. `load.test.ts` prende que o conteúdo real tem o inventário do pacote citado,
senão apagar `packs/` desligaria a conferência em silêncio.

**O pacote SERVIDO tem que ser o conferido.** A sombra é de um pacote; o cliente carrega o de
`VITE_THINGS_URL`, que é configuração de deploy. `buildContent` expõe `content.pack`, e o
`game` recusa subir quando `THINGS_VERSION` não bate com `pack.version`
(`packages/server/src/served-pack.ts`) — o compose deriva `VITE_THINGS_URL` da mesma
variável. Sem isso, um deploy apontando `/things/1400` com o conteúdo conferido contra o 1533
passaria em tudo e desenharia exatamente o quadrado que a conferência existe para impedir.

**Fica fora de `computeVersion`.** O inventário não é lido por sessão nenhuma; regenerá-lo
porque o pacote ganhou ids não muda o que ninguém vê, e contá-lo faria um `pnpm
assets:inventory` recusar todo snapshot de uma queda sem drenagem. O que muda a arte de uma
sessão é o `pack` da tabela, e esse já conta.

**`appearances.scenery` é GERADO, e mora numa tabela SEPARADA** (#727, ADR 0050 d.1):
`data/appearances/generated/scenery.json`, escrito por `pnpm map:import` — nunca à mão, como
`baseline.json`. `load.ts` lê a subpasta `appearances/generated/` junto com `appearances/`, e
`buildContent` mescla a seção `scenery` de toda tabela que não seja `baseline` por cima da de
`baseline` (mesma chave, o último arquivo em ordem alfabética vence — a mesma regra do resto do
conteúdo). A forma é `appearanceKey → { estado → id }` — `door-1629: { closed, open }`,
`grass-3696: { uncut, cut }`, `lever: { down, up }` (uma alavanca só, compartilhada por todo
mapa: 2772/2773 do Canary são o par físico, não um por instância) —, e só entram as chaves que
ALGUM interativo de ALGUM mapa importado realmente usa: a tabela do Canary tem centenas de
portas que o jogo inteiro usa, a maioria fora dos quatro recortes do Draconya e fora do
inventário do pacote (`packs/tibia-1332.json` é a sombra de Thais/Rat Cellars/Rotworm
Caves/Dragon Lair, não do jogo inteiro) — gerar a tabela toda faria `packProblems` recusar id
que nenhum mapa usa, e o boot cairia por causa de porta que não está em lugar nenhum do jogo
importado. `packProblems` confere cada estado de cada chave contra o pacote, como `corpses`.

## Loot (FUN-63)

A tabela do monstro separa **moeda** de **item**: `loot.gold` é `{ chance, min, max }` e
`loot.items` é uma lista com `itemId`. Gold é campo no personagem (`character.gold`), não item —
por isso tem lugar próprio, em vez de um `itemId: "gold-coin"` que o código teria que reconhecer
pelo nome. `items` só aceita lista vazia enquanto não houver catálogo de itens; `buildContent`
recusa o resto, porque creditar um item fantasma no primeiro abate é pior que não subir.

## Magia e consumível (FUN-74, FUN-77, AB-01)

`spells/*.json` e os consumíveis de `items/*.json` são catálogos como os outros: **a engine é
dona do mecanismo, o conteúdo é dono dos números.** Custo de mana, cooldown, alcance, quanto cura
e quanto custa em gold — nada disso mora em `sim`.

O `effect` é uma união discriminada por `kind`, fechada como o vocabulário do bot e pela mesma
razão: o `sim` só executa o que conhece, e uma magia com efeito desconhecido é recusada no boot
em vez de virar um slot morto que ninguém explica.

**Suprimento é abstrato** (AB-01, ADR 0032 d.6). Poção e runa vivem em `supplies/*.json` com
`price`, `effect`, `requires` e `group`; o uso debita gold direto (`useSupply`), sem pilha e sem
reposição. O vocabulário v2 do bot (AB-03) usa o token `supply` com `supplyId`, e
`validateBotConfigV2` cruza `spellId`/`supplyId` contra os catálogos. O motor por grupo é a AB-07
(#422).

A carga de bênção (`items/blessing-charge.json`, item `consumable` não-empilhável do M22) foi
**removida pelo #570**: bênção deixou de ser item de mochila e virou serviço de Cidade (ADR
0052) — intenção C2S tratada pela sessão de Cidade, gold pelo ledger, nunca um `use-item`. O
catálogo novo é `data/blessings/*.json` (`blessingSchema`): sete bênçãos PvE (o `Blessings.All`
do Canary tem 8 ids; o 1º, Twist of Fate, é PvP e fica fora), cada uma com `order` — o índice do
BIT que `CharacterRuntime.blessings` guarda (`packages/sim/src/blessings.ts`) — e `enhanced`
(as duas mais caras, Heart/Blood of the Mountain). O preço por level é `progression.
blessingPricing` (`getBlessingCost` do Canary, `blessing.lua:148-166`): faixa fixa até o level
30, faixa linear até o 119, faixa linear com base maior dali em diante — `enhanced` multiplica
mais em cada faixa —, e GRÁTIS abaixo do level 21 (o Adventurer's Blessing, `config.lua.dist:
496`). A redução na morte é `deathPenalty.blessingReduction` (8%) MULTIPLICADA pela contagem de
bits — nunca mais a soma pronta de um binário `premium`.

## Skills (FUN-75)

`skills/*.json` diz quais skills existem, o que alimenta cada uma, quanto custa cada nível e
quanto ela acrescenta ao golpe. §9.4 decide que skill sobe por USO; os números não vêm do PRD e
entram com `_open`.

Uma coisa aqui é **mecanismo, não número**: `spell-cast` rende por **mana gasta**, não por
lançamento. Por lançamento, a forma ótima de subir magia seria lançar mil vezes a magia mais
barata. É por isso que o Tibia faz assim, e é por isso que a união de `gain` é discriminada em
vez de ser um campo `points` só.

## Itens (FUN-76)

`items/*.json` é a DEFINIÇÃO; a instância é linha no Postgres (`item_instance`), e a divisão é o
ponto. Aqui ficam id, tipo, slot, peso, atributos, requisitos e se empilha — a aparência não,
desde a FUN-94.

**Atributos base são fixos** (§21.2). Não há rolagem por instância: duas espadas do mesmo id são
idênticas, e item melhor é item **diferente**. Isso apaga toda a matemática de variação por
instância — junto com a pergunta "por que a minha é pior".

`loot.items` do monstro é conferido contra este catálogo. Antes ele era recusado por princípio
porque catálogo não existia; agora o que decide é a referência existir.

`charges` e `durationMs` são mecanismos vivos desde a AB-06 (#421, ADR 0032 d.8): o `sim` gasta a
carga do colar no golpe elemental que ele protege e agenda o vencimento do item de duração na fila
de eventos, destruindo o item ao esgotar.

**`defense` é da peça e só nas combinações aprovadas** (CMB-04, emenda do ADR 0031): escudo, ou
arma corpo a corpo de uma mão. Bow/twoHanded e wand/rod não têm defesa residual, e `buildContent`
recusa `defense > 0` fora daí. O perfil declara `combat.defense` (`blockChance`, `blockTypes`,
`skillId`); ausente é o estágio identidade, que preserva o v1. A `skillId` precisa existir no
catálogo de skills E subir por `shield-block` — as duas coisas são conferidas no boot, porque uma
referência torta deixaria o escudo sem treinar ou uma skill que nunca sobe.

**`extraDefense`/`spellbook`/`quiver` só existem para a conta do JOGADOR** (#549, M30-02;
`sim/combat/player-defense.ts`) — diferente de `defense` acima, nenhum dos três entra no
`combat-v3` de monstro nem no bloqueio do CMB-04. `extraDefense` (só `kind: 'weapon'`) é o
`extradef` do Canary, somado ao `defense` do ESCUDO (ou da própria arma, se for de duas mãos) —
a Mystic Blade do kit level 200 é o único item que o declara hoje. `spellbook`/`quiver` (só
`kind: 'shield'`, mutuamente exclusivos) marcam o "escudo" que usa `secondaryShield` da vocação
em vez de `primaryShield` na mitigação — o Spellbook of Mind Control (Sorcerer/Druid) declara o
primeiro; nenhum item hoje declara o segundo (a Royal Crossbow do Paladin é de duas mãos e usa
`Weapon.ammoFamily` para o mesmo efeito, não um item de escudo).

**`vocation.mitigation`/`progression.mitigation`** (#549, M30-02) são o `<mitigation multiplier
primaryShield secondaryShield>` de `vocations.xml` — SEM relação com `mitigationSchema`
(resistência/imunidade por tipo, CMB-03) nem com `Monster.defenseMitigation` (ADR 0040), apesar
do nome repetido (o próprio Canary também reusa "mitigação" para os três). O de `progression` tem
DEFAULT (os números da vocação `None`) — diferente de `regen`, que fica sem um de propósito —
porque aqui o número É o do Canary, verificado, e o default só existe para não reabrir a dúzia de
fixtures de teste que constroem `Progression` sem falar de combate; o conteúdo REAL declara os
três de qualquer forma.

**O kit de nascimento e as armas de vocação** (#151, ADR 0026) são os primeiros itens com
que o jogo se compromete, e cada id de aparência foi **conferido de olho** — o índice da
biblioteca (`things/<versão>/library/appearances/object.jsonl`) não tem nome, e um id errado
desenha outra coisa sem erro nenhum; a regra é abrir o PNG do primeiro `spriteId` do objeto
antes de gravar a linha. Os números do Tibia (TibiaWiki) e os ids do pacote 13.32:

| item | id | atributos |
|---|---|---|
| machete | 3308 | attack 12, 16,5 oz — a arma de todo mundo até o level 8 |
| leather helmet / armor / legs / boots | 3355 / 3361 / 3559 / 3552 | armor 1 / 4 / 1 / 1; 22 / 60 / 18 / 9 oz |
| backpack | 2854 | `kind: container`, `slot: back`, 18 oz |
| steel axe (Knight) | 7773 | attack 21, 41 oz |
| bow (Paladin) | 3350 | `twoHanded`, 31 oz — sem attack: o dano é da munição |
| wand of vortex (Sorcerer) / snakebite rod (Druid) | 3074 / 3066 | 19 oz — alcance, mana e dano entram no motor pela #152 |
| wooden shield | 3412 | `kind: shield`, `slot: shield`, defense 14, 40 oz — peça do kit de vocação desde #496 |

`kind: 'container'` e `slot: 'back'` andam juntos, e `twoHanded` só em arma — `buildContent`
recusa o resto. **Como a arma bate é da arma** (#152, CMB-05): `weapon: { kind, family, range,
ammoFamily?, manaPerHit?, damage? }` — `melee` (o `attack` do item), `distance` (o `attack` da
munição da `ammoFamily`, que precisa ter munição no catálogo) ou `wand` (`manaPerHit` e `damage`
por faixa, `attack` 0). A `family` (`sword`, `axe`, `club`, `distance`, `wand`, `rod`) aponta para
a skill e a fórmula em `data/weapon-families/`; ausente, o boot normaliza pelo `kind`
(melee→`sword`, distance→`distance`, wand→`wand`), e o conteúdo real declara. `fist` é o fallback
desarmado e **não** existe como arma — declará-la num item reprova o boot. Família inexistente ou
de `kind` diferente também reprova. Arma sem `weapon` é `{ kind: 'melee', family: 'sword',
range: 1 }`, normalizado no boot; campo de um tipo em arma de outro, ou `weapon` fora de arma, é
recusado. O projétil da wand e do rod mora em `appearances.weapons[itemId].missile`, de um lado só
como `spells`. A arma de vocação exige a vocação (`requires.vocationId`), e é isso que a segura
até o level 8: o personagem nasce sem vocação.

**O kit da vocação (#496) é o grant completo do level 8**, em `startingKit` de cada
`vocations/*.json` — arma + `wooden-shield`, com o escudo do Paladin na mochila, porque o bow é
de duas mãos e o `equip` veste a arma ANTES do escudo (a ordem do kit é contrato). O boot confere
cada peça: existe, está no slot declarado (quando o é), exige no máximo a PRÓPRIA vocação, e não
há duas no mesmo slot — a segunda nasceria na mochila com o slot declarado mentindo. Arma de
duas mãos com escudo NÃO é recusada aqui (diferente do kit de nascimento, que é gravado direto
no banco): esse kit passa por `equip`, e o estado impedido é alcançável. `startingWeaponItemId`
sobrevive como fallback legado do conteúdo de teste — se ele e o kit coexistem, o boot exige que
a arma declarada seja uma das peças, porque o host prefere o kit e o campo ficaria só a mentira
de exibição; é daí que o `catalogue` deriva a arma que o diálogo do level 8 mostra.

**`creatureProduct: true` é do importador — e o override o leva ao item autoral** (#603, o charm
Gut): o `scripts/catalog/items.ts` o escreve em todo item da fatia `creature-products`
(`primarytype="creature products"`), e `sim/loot.ts` o lê para somar o Gut à chance de drop. Item
autoral (`data/items/*.json`) vence o gerado no mesmo slug, então o flag nunca chegaria a ele: o
`reconcileAuthored` emite o override `data/items/overrides/<id>.json` (`patch.creatureProduct:
true`, com o motivo) sozinho, a cada `pnpm catalog:import items`. São cinco hoje — `worm`,
`green-dragon-leather`, `green-dragon-scale`, `red-dragon-leather`, `red-dragon-scale`, justo os
drops do Dragon, do Dragon Lord, do Rotworm e da Cave Rat. Item autoral novo que o Canary declare
creature product não precisa de edição à mão: reimporte. O teste de `charms-combat.test.ts` cruza o
staging inteiro com o conteúdo carregado, então o esquecimento quebra o `pnpm check`.

## Munição (#151, AB-02, ADR 0032 decisão 7)

**Munição é abstrata** (ADR 0032 d.7; a decisão 3 do ADR 0026 volta a valer): flecha e virote
vivem em `ammunition/*.json` com `family` (`arrow`/`bolt`), `attack`, `price` (> 0 — sem fallback
grátis) e `requires.level`. O `attack` e o `damageType` (default `physical`) do tiro são da
munição, e cada tiro debita o `price` do gold. `buildContent` recusa arma de distância cuja
`ammoFamily` não tem munição no catálogo.

A aparência: o projétil fica em `appearances.ammunition[id]` (`missile`), e o ícone do
`AmmoPicker` vem da mesma tabela. Não duplicar o ícone — duas verdades para o mesmo número
(DT-03). Os projéteis do pacote 13.32: arrow 3, burst arrow 4, sniper arrow 22, onyx arrow 23.

A seleção é por família pelo opcode 14 `select-ammo`, validada por `requires.level` no servidor e
publicada em `player-stats.ammo { arrow, bolt }`; a ausência de uma família cai na básica da
família (a primeira em ordem de id), que também é paga. O primeiro colar (`glacier-amulet`,
`kind: 'amulet'`, `slot: 'neck'`, `charges` + `mitigation` elemental) e o primeiro escudo real
(`wooden-shield`, `kind: 'shield'`, `slot: 'shield'`, `defense`) entram como itens; o consumo da
carga é a AB-06 (#421).

## Como testar

```
pnpm vitest run packages/content
```

O teste que importa: todo arquivo de conteúdo valida contra o próprio schema, e ids referenciados
entre arquivos resolvem.

## Armadilhas conhecidas

- É tentador colocar lógica aqui ("esse monstro se comporta assim"). Comportamento é `sim`;
  aqui só ficam os números e as tabelas que o comportamento lê.
- **Uma porta TRANCADA (id `locked` de `KeyDoorTable`) é `.` na grade, não `#`** (#727, ADR
  0050 d.1) — o mesmo vale para toda porta/capim/pile/rope spot/ladder/alavanca classificados.
  Quem espera "porta fechada bloqueia o bot" precisa olhar `interactables[].initialState` e
  `requires`, não `isBlocked`: até a #728 (`TileOverrides`) pousar, NADA impede o bot de andar
  por cima de uma porta trancada — é a troca deliberada do ADR (a alternativa, manter `#` para
  sempre, prendia o bot atrás de toda porta de Thais sem jeito nenhum de destrancar).
- **`lure` e `ringSwap` são configuração de PERSONAGEM, não conteúdo** (FUN-87). Os schemas
  moram aqui porque o vocabulário do bot mora aqui; os valores vêm do `bot_config` de quem
  configurou. Nenhum arquivo de `data/` os define, e nenhum deveria.
- **`itemSchema`, `monsterSchema`, `wallSetSchema` e `packSchema` são `strictObject`, e os
  outros não.** Zod DESCARTA chave desconhecida em silêncio, e depois da FUN-94 é exatamente o
  que aconteceria com um `appearanceId` escrito no item por hábito: o arquivo pareceria certo, o número não iria a
  lugar nenhum, e o item apareceria com a arte de outro sem nada acusar. `load.test.ts` varre
  `data/` pela mesma coisa, porque a mensagem do schema não diz PARA ONDE o campo foi.
- **O `.refine` de `botRingSwapSchema` é regra de jogo, não de forma.** `removeAbove` maior que
  `equipBelow` é o que garante a faixa morta da histerese — limiares iguais parseiam como número
  válido e trocam o anel a cada golpe. Recusar aqui é mais barato que descobrir pelo extrato.
- **Rota pode atravessar `floorChanges`, e a posição EFETIVA de um passo pode divergir do tile
  autorado** (#519, hunt multiandar — a Darashia Dragon Lair). `validateRoute` (`map.ts`) não
  confere mais adjacência tile a tile: confere adjacência à posição EFETIVA, que vira o destino
  da escada assim que o passo pisa nela — exatamente como `move()` do `sim` resolve de verdade.
  Um tile que É origem de escada nunca é o problema por si só; o que é sempre um erro é um ponto
  de PASSAGEM (`--via` do `trace-route.ts`) sobre um degrau, porque ninguém "para" numa escada.
- **`routeSchema.spawnPoints[i].monsterId`/`at`/`respawnDelayMs` são OBRIGATÓRIOS desde o #583**
  (nasceram opcionais no #519, o formato do spawn do Canary — um `<monster>` por posição, com
  `spawntime` próprio, nunca um sorteio por zona; `at` continua opcional, só posição de
  nascimento). Um de `monsterId`/`monsters` é exigido por `.refine` — não existe mais
  composição de dificuldade para cair como fallback quando o ponto não declara nada (fim do
  pull por dificuldade, ADR 0039). `routeIndex` continua obrigatório mesmo com `at` declarado —
  ele ancora ao laço (ordem, andar de referência).
- **`routeSchema.spawnPoints` ganhou `monsters` (#582)**: vários candidatos com peso na MESMA
  posição — o caso do Canary em que dois `<monster>` do mesmo `<spawn>` caem exatamente no
  mesmo ponto (`spawn_monster.cpp:90-96`). Mutuamente exclusivo com `monsterId` (`.refine`); o
  `Spawner` sorteia entre os candidatos DO PONTO, um sorteio só por resolução de spawn.
  Nenhum ponto do recorte real (Darashia Dragon Lair, 47 pontos) usa este campo — `weight` não
  ocorre em nenhuma das 187081 linhas de `otservbr-monster.xml` —, mas o mecanismo existe no
  Canary e `scripts/catalog/spawns.ts` precisa reconhecê-lo sem quebrar quando aparecer.
- **`monsterSchema.blockable` é o `isBlockable` do TFS/Canary, e o default é `false`** (#519) —
  NÃO esperar o jogador sair da vista antes de respawnar, porque é isso que 1.640 dos 1.656
  monstros do bestiário do Canary fazem, Dragon e Dragon Lord inclusive. O campo da HUNT que
  fazia isso antes (`spawnClearRadius`, #236) foi REMOVIDO no #583; hoje `blockable: true` no
  MONSTRO — Rat e Rotworm o declaram, comportamento do Huntera observado, preservado por decisão
  explícita, não do Canary — só vale para RESPAWN pós-morte, nunca para a população inicial da
  hunt (que sempre nasce na hora, como o `startup()` do Canary).
- **A condição `speed` (CMB-11, #556) é `delta` OU `formula`, nunca os dois nem nenhum, e a
  `key` é FIXA** (`conditionEffectSchema`/`conditionSpecSchema`). `delta` (inteiro, milésimos) é
  o formato do `speedChange` de ATAQUE/DEFESA de monstro, copiado sem conversão do Lua; `formula`
  (`{ mina, minb, maxa, maxb }`) é o formato de RUNA/MAGIA, o `setFormula` do Canary/TFS
  transcrito. `type` (`'haste' | 'paralyze'`) é o nome do Tibia — não é derivado do sinal
  calculado, porque só o `sim` sabe o resultado depois de sortear. `SPEED_CONDITION_KEY`
  (`'speed'`) é OBRIGATÓRIA em `conditionSpecSchema.key` sempre que `effect.kind === 'speed'` —
  `buildContent` recusa qualquer outra —, e é essa chave única compartilhada que faz haste e
  paralyze de fontes diferentes se substituírem no `sim`, sem lógica de exclusão mútua a mais.
- **`monsterDefenseSchema.heal` virou OPCIONAL, e `condition` é a alternativa** (CMB-11, #556) —
  `buildContent` exige pelo menos um dos dois; uma `condition` de defesa só aceita `type:
  'haste'` (o self-haste do Doom Deer), nunca `paralyze` — uma defesa que se paralisa sozinha
  não é o mecanismo que o bestiário observado usa.
- **`item.combatModifiers` é pontos-base (×10000); `monster.critChance` é PERCENTUAL** (M30-04,
  #551) — unidades DIFERENTES de propósito, cada uma a escala do campo correspondente no Canary
  (`items.xml` já usa ×10000; o Lua do monstro usa `critChance = 10` direto). Quem soma os dois
  em pontos-base é o `sim` (`Inventory.combatModifiers`/`monsterCriticalModifiers`,
  `combat/modifiers.ts`), não este pacote — `content` só valida a forma. `lifeleechchance`/
  `manaleechchance` do Canary (`items.xml`) NÃO têm campo aqui: `Game::calculateLeechAmount` só
  lê a skill AMOUNT, e o próprio Canary as pula na descrição do item — são vestigiais, sem
  consumidor na resolução de dano (a pergunta do `_open` do #548 "conferir se a chance ainda é
  lida" está respondida: não é). Nenhum item ou monstro do catálogo real declara os campos novos
  ainda — os quatro monstros do bestiário (rat, rotworm, dragon, dragon lord) ficam no default
  `critChance: 0`, a identidade; só 6 bosses do Canary declaram, fora do recorte hoje.
- **`item.absorb`/`increase`/`reflect`/`cleavePercent` são PERCENTUAL INTEIRO** (M30-05, #552),
  a escala do `items.xml` do Canary — diferente de `mitigation.resistances` (fração) e de
  `combatModifiers` (pontos-base). O `combat-v3` aplica a absorção item a item com arredondamento,
  e a conta inteira é a do Canary. `mitigation.resistances` de ITEM e `absorb.<tipo>.percent` são
  o MESMO `absorbpercent*`: o schema recusa os dois no mesmo tipo. O reflexo compila no boot
  (`compileReflect`, tabela completa por tipo, ausente quando nada reflete) — é a forma que o
  reflexo de monstro (#683) reusa.
- **O monstro tem schema de mitigação PRÓPRIO** (#683): `monsterMitigationSchema` aceita
  resistência em `[-2, 1)` (o `minElementalResistance` do Canary); o `mitigationSchema` do item
  continua `[-1, 1)`. Os dois são `mitigationSchemaWith(piso)` — alargar o compartilhado mudaria o
  item sem pedido. `monster.elementHealing` (teto 500) e `monster.reflect` (teto 200) são
  PERCENTUAL INTEIRO, como o reflexo de item, e compilam no boot (`compileElementHealing`,
  `compileReflect` com `flat` zero); ausentes no monstro compilado quando nada cura/reflete.
- **`monster.conditionImmunities` é o `monster.immunities[].condition` do Canary** (#559, ADR 0041
  d.2) — distinto de `mitigation.immunities` (`combat = true`, DANO). Onze nomes:
  `paralyze`, `drunk`, `invisible` e as oito DOTs (`DAMAGE_OVER_TIME_CONDITION_IMMUNITY`, a
  `Combat::DamageToConditionType`: `physical` sangra, `earth` envenena, `fire` queima…) — o
  vocabulário do ADR, NÃO os nomes do Lua (`bleed`, `fire`, `earth`…), que o importador traduz.
  **`invisible` significa "enxerga o invisível"** (`Monster::canSeeInvisibility`), nunca "não pode
  ficar invisível": é a exceção que não bloqueia a condição. `outfit` (119 monstros) fica fora até
  o M44-03. Ausente é `[]`, sem imunidade nenhuma.

Issue: FUN-8.
