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


## Invariantes locais

- **Nunca contém arte** (invariante 6). Um item declara `appearanceId`, um monstro declara
  `outfitId` — nunca um caminho de arquivo de sprite. É o que mantém a troca do pacote de assets
  como remapeamento de ids em vez de reescrita de conteúdo. Ver ADR 0008.
- **A versão de conteúdo é fixada na sessão** (invariante 7). Uma hunt iniciada na versão N termina
  na versão N. Este pacote expõe a versão; quem cria sessão a congela.
- Balanceamento é dado, não código. Se mudar um número exige deploy de lógica, está no lugar errado.
- Conteúdo inválido derruba o boot. Nunca chega à simulação.

## Como testar

```
pnpm vitest run packages/content
```

O teste que importa: todo arquivo de conteúdo valida contra o próprio schema, e ids referenciados
entre arquivos resolvem.

## Armadilhas conhecidas

- É tentador colocar lógica aqui ("esse monstro se comporta assim"). Comportamento é `sim`;
  aqui só ficam os números e as tabelas que o comportamento lê.

Issue: FUN-8.
