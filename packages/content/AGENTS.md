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

- **Nunca contém arte** (invariante 6). Um item declara `appearanceId`, um monstro declara
  `outfitId` — nunca um caminho de arquivo de sprite. É o que mantém a troca do pacote de assets
  como remapeamento de ids em vez de reescrita de conteúdo. Ver ADR 0008.
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
