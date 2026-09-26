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

Qualquer `data/<tipo>/` (hoje `items/`, mais tarde `monsters/`) aceita, além do arquivo autoral
direto na pasta, duas subpastas que `load.ts` lê sozinho, sem precisar de mudança em
`content.ts`:

```
data/items/backpack.json          # autoral, uma entidade por arquivo (de sempre)
data/items/generated/weapons.json # gerado por `pnpm catalog:import items` — um ARRAY por fatia
data/items/overrides/*.json       # correção nossa: { id, reason, patch }
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
  "pack": "tibia-1332",            // de qual pacote vieram estes números
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
aceita `circle`, `wave` e `beam` (`buildContent` recusa o resto); `wave`/`beam` saem do monstro
na direção do alvo, recalculada no `sim` — o schema não guarda direção nenhuma. `monster.defenses`
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
data/packs/tibia-1332.json         # quais ids EXISTEM no pacote, por registro, em faixas
```

A tabela acima diz que o rato é o outfit 21; nada conferia que o outfit 21 **existe**. O
número passava pelo schema e pelo boot, e o defeito aparecia em produção como um quadrado
invisível — o cliente pede um quadro que não há e desenha o fallback, a três camadas da
causa. O pacote em si mora em `things/`, fora do Git, e o servidor nem o carrega; o que entra
aqui é a **sombra** dele: `[[100,167],[169,370],…]` por `object`, `outfit`, `effect` e
`missile`. `buildContent` cruza a tabela com essas faixas e recusa o id que não está em
nenhuma — `appearances.monsters.rat: outfit 9999 não existe no pacote tibia-1332`. Roda no
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
variável. Sem isso, um deploy apontando `/things/1400` com o conteúdo conferido contra o 1332
passaria em tudo e desenharia exatamente o quadrado que a conferência existe para impedir.

**Fica fora de `computeVersion`.** O inventário não é lido por sessão nenhuma; regenerá-lo
porque o pacote ganhou ids não muda o que ninguém vê, e contá-lo faria um `pnpm
assets:inventory` recusar todo snapshot de uma queda sem drenagem. O que muda a arte de uma
sessão é o `pack` da tabela, e esse já conta.

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
`validateBotConfigV2` cruza `spellId`/`supplyId` contra os catálogos. A carga de bênção é a única
exceção: segue item `kind: 'consumable'` **não-empilhável** em `items/blessing-charge.json`, sem
`restock` nem `group` obrigatórios, e quem a consome é a TP-03 (M22). O motor por grupo é a AB-07
(#422).

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
- **`routeSchema.spawnPoints` ganhou `monsterId`, `at` e `respawnDelayMs`, todos opcionais e
  todos por PONTO** (#519, o formato do spawn do Canary — um `<monster>` por posição, com
  `spawntime` próprio, nunca um sorteio por zona). Ausentes, o comportamento é o de sempre:
  `Spawner` sorteia da composição, a posição é o tile do `routeIndex`, o respawn usa o
  `respawnDelayMs` da DIFICULDADE. `routeIndex` continua obrigatório mesmo com `at` declarado —
  ele ancora ao laço (ordem, andar de referência); `at` é só a posição de nascimento.
- **`monsterSchema.blockable` é o `isBlockable` do TFS/Canary, e o default é `false`** (#519) —
  NÃO esperar o jogador sair da vista antes de respawnar, porque é isso que 1.640 dos 1.656
  monstros do bestiário do Canary fazem, Dragon e Dragon Lord inclusive. `spawnClearRadius`
  (#236) da hunt só vale para quem declara `blockable: true` — Rat e Rotworm o fazem, porque o
  comportamento deles vem do Huntera observado, não do Canary, e não podia mudar aqui.
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

Issue: FUN-8.
