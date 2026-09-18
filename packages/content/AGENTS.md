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
reservado ao boot.

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

## Magia e supply (FUN-74, FUN-77)

`spells/*.json` e `supplies/*.json` são catálogos como os outros: **a engine é dona do
mecanismo, o conteúdo é dono dos números.** Custo de mana, cooldown, alcance, quanto cura e
quanto custa em gold — nada disso mora em `sim`.

O `effect` é uma união discriminada por `kind`, fechada como o vocabulário do bot e pela mesma
razão: o `sim` só executa o que conhece, e uma magia com efeito desconhecido é recusada no boot
em vez de virar um slot morto que ninguém explica.

**Supply não é item** (§20.1). Ele tem `price` e não tem peso, slot nem instância — usar debita
gold direto. É por isso que ele tem pasta própria em vez de esperar o catálogo de itens, que é
M8. `validateBotConfig` cruza `spellId` e `supplyId` contra estes dois catálogos; `itemId` é
sempre recusado, pela mesma razão que `loot.items` só aceita lista vazia.

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

`charges` e `durationMs` estão no schema e ninguém os consome ainda (§21.3) — a forma entra agora
para o catálogo não mudar quando a mecânica existir.

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

## Munição (#151, ADR 0026)

`ammunition/*.json` é um catálogo à parte, e **munição não é item**: não tem peso, pilha nem
instância. É uma seleção por família (`arrow` para bow, `bolt` para crossbow), o modelo do
Huntera (`ammo-selection { arrow, bolt }`, `docs/reference/huntera-observed.md` §20): a de
`price: 0` é a grátis e o padrão da família, e cada tiro das outras debita `price` do gold do
personagem, pelo caminho do supply (§20.1). `buildContent` exige uma grátis por família — é
ela que o bow dispara quando o gold acaba, e sem ela o bot pararia de atirar (invariante 11).
A aparência vive em `appearances.ammunition[id] = { icon, missile }`, conferida dos dois
lados como a do item: `icon` é o objeto que o seletor mostra, `missile` o projétil do tiro —
os dois obrigatórios (arrow 3, sniper arrow 22, onyx arrow 23 no 13.32, conferidos de olho). Hoje: arrow (3447, attack 25, grátis), sniper arrow (7364, 28,
level 20) e onyx arrow (7365, 38, level 40); os preços por tiro são `_open` até serem
conferidos no TibiaWiki. Quem atira é o `sim` (#152).

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

Issue: FUN-8.
