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
