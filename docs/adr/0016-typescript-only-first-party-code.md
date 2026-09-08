# 0016 — TypeScript como linguagem única do código first-party

**Status:** aceito
**Data:** 2026-09-07
**Contexto técnico:** tooling da raiz — `eslint.config.ts`, `scripts/`, `tsconfig.tooling.json`

## Contexto

O Draconya já era TypeScript onde alguém olha. Os seis pacotes em `packages/` são `.ts`/`.tsx`,
a raiz declara `"type": "module"`, e Vitest e Drizzle já usavam configuração em TypeScript.

Sobravam dois arquivos:

```
eslint.config.js
scripts/docs-check.mjs
```

O problema não era o tamanho deles. Era que **enquanto os dois padrões coexistem, o próximo
script entra em JavaScript por conveniência** — e um script em JavaScript não participa do
typecheck, então erro de digitação num caminho ou num nome de campo só aparece no dia em que
alguém roda o comando. O `docs-check` é exatamente o tipo de script onde isso dói: ele valida a
documentação do repositório inteiro, e um `problems.brokenLnk` em vez de `brokenLink` teria
passado calado, criando um array novo e reportando zero problemas.

Havia um sintoma disso já visível: `vitest.config.ts` e `drizzle.config.ts` **eram TypeScript e
mesmo assim não eram verificados**, porque o `tsconfig.json` raiz é só agregador de project
references dos pacotes. Escrever em `.ts` não bastava; era preciso alguém checar.

O `eslint.config.js` guardava a evidência do custo de deixar isso correr: ele carregava dois
blocos de comentário contraditórios sobre o próprio formato de módulo, um afirmando que o
repositório não tinha `package.json` e que o arquivo precisava ser CommonJS, e outro logo abaixo
corrigindo. Nenhum dos dois era verificável por ferramenta nenhuma.

## Decisão

**Todo código first-party do Draconya é TypeScript.** Se é código mantido pelo projeto e poderia
ser JavaScript, é TypeScript — código de aplicação, ferramenta interna, script de
desenvolvimento, script de validação e configuração executável.

Novos arquivos não usam `.js`, `.jsx`, `.mjs` nem `.cjs`. As extensões são `.ts` e `.tsx`;
`.mts`/`.cts` só quando houver necessidade explícita de distinguir o sistema de módulos, o que
não é o caso hoje, com ESM em toda parte.

Três consequências práticas, e a terceira é a que faz a decisão valer:

1. **Os dois arquivos migraram.** `scripts/docs-check.ts` roda por `tsx` (já era dependência),
   e `eslint.config.ts` carrega via `jiti`. O comando de lint continua `eslint .`, sem wrapper.
2. **Scripts e configuração entram no typecheck**, por `tsconfig.tooling.json` — o que também
   trouxe `vitest.config.ts` e `drizzle.config.ts` para dentro pela primeira vez.
3. **`scripts/source-policy.ts` reprova o `pnpm check`** quando um `.js` first-party aparece.

Sem o item 3, esta ADR seria um pedido de bom comportamento. Regra de arquitetura que depende de
alguém lembrar dela é seguida até o primeiro dia de pressa — o mesmo raciocínio que colocou as
fronteiras de import em regra de lint (`docs/boundaries.md`) em vez de em prosa.

O `source-policy` varre `git ls-files`, não o disco. Andar pelo filesystem obrigaria a manter uma
lista de exclusão de `node_modules/`, `dist/`, `build/` e `coverage/` que fica desatualizada — e
bastaria rodar `pnpm build` antes do check para `dist/` disparar falso positivo em cima de código
gerado. O que o Git rastreia é exatamente a definição de "mantido pelo projeto".

## O que esta decisão NÃO significa

**Não é "o repositório só tem arquivos TypeScript".** Formato de infraestrutura, documentação e
configuração continua na linguagem natural dele:

```
README.md            docs/*.md            package.json         tsconfig*.json
docker-compose.yml   Dockerfile           .github/workflows/*.yml
scripts/backup-postgres.sh                .githooks/commit-msg
```

Shell script chamado pelo cron e pelo Git fica em shell: reescrever em TypeScript adicionaria um
runtime a um caminho que hoje não tem nenhum, e o backup precisa rodar mesmo quando o Node do
projeto está quebrado.

**Também não é "JavaScript some do runtime".** TypeScript é compilado ou interpretado para
JavaScript, e `dist/` e `node_modules/` estão cheios dele. Arquivo gerado e dependência externa
não são código mantido pelo projeto, e estão fora da política.

## Alternativas consideradas

**Deixar como estava.** Dois arquivos não incomodam ninguém — mas a regra ausente é o que permite
o terceiro. O custo da migração era pequeno justamente agora; ele cresce com o tempo.

**Migrar os arquivos sem o `source-policy`.** Resolveria o estado e não a política: sem checagem,
o repositório volta ao ponto de partida no primeiro script novo, e a ADR viraria documentação
desatualizada — que é pior que documentação nenhuma.

**Renomear `eslint.config.js` para `.cjs` e parar por aí.** Trata o sintoma errado: o incômodo
nunca foi o formato de módulo, foi a existência de dois padrões para código first-party.

**Marcar os arquivos no `.gitattributes` para o GitHub Linguist parar de contar JavaScript.**
Recusada: mudaria a estatística sem mudar nada do que importa. O ganho real da decisão é
typecheck e padrão único, e a classificação de linguagem é consequência, não objetivo.

## Consequências

Uma dependência de desenvolvimento nova (`jiti`) e uma configuração TypeScript a mais
(`tsconfig.tooling.json`), além de mais um passo no `pnpm check`.

Em troca: script interno passa a falhar no typecheck em vez de em produção, configuração
executável segue o mesmo padrão do resto, e a decisão é imposta por ferramenta.

**Exceção** só existe quando uma ferramenta externa exigir JavaScript: limitação real e
reproduzível, registrada em ADR, com o caminho exato listado em `ALLOWED` no `source-policy`.
Conveniência não conta, e uma exceção não abre precedente para a próxima. Hoje a lista está
vazia.

## Invariantes afetados

Nenhum dos onze invariantes muda. Esta é uma decisão sobre a linguagem do código mantido pelo
projeto, não sobre a arquitetura do jogo. Ela reforça a mesma escolha do
[ADR 0014](0014-english-code-conventions.md) e das fronteiras de import: **o que é regra do
projeto deve ser verificável por ferramenta**, e não apenas escrito.
