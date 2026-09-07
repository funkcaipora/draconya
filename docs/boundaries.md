# Fronteiras entre pacotes

Este documento explica **por que** cada pacote do monorepo pode importar o que pode e não pode
importar o que não pode. É o que ler quando `eslint.config.js` recusar um import e a mensagem de
erro não bastar.

**Esta tabela é normativa, junto com `eslint.config.js`.** Os dois têm que dizer a mesma coisa
sempre. Se uma fronteira muda — um pacote passa a poder importar outro, ou uma restrição de I/O
fica mais estrita — o commit que muda isso atualiza os dois arquivos juntos. Uma tabela que
descreve uma regra que o lint não aplica é uma mentira documentada; um lint que aplica uma regra
que a tabela não descreve é uma armadilha para quem só leu a tabela. Nenhum dos dois estados é
aceitável.

## A tabela

| Pacote | Pode importar | Não pode importar |
|---|---|---|
| `protocol` | nada interno | qualquer outro pacote |
| `content` | `protocol` | `sim`, `server`, `client`, `tools` |
| `sim` | `protocol`, `content` | `server`, `client`, `tools`, e qualquer I/O (`node:*`, `fs`, `net`, `http`, `pg`, `redis`, `uWebSockets.js`, `express`, entre outros) |
| `server` | `protocol`, `content`, `sim` | `client` |
| `client` | `protocol`, `content` | `sim`, `server`, `tools` |
| `tools` | todos os outros cinco | — |

## Por que cada fronteira existe

### `protocol` — a raiz

`protocol` não importa nenhum outro pacote do monorepo. Ele é a única coisa que `client` e
`server` têm em comum, e `client`/`server` nunca podem se importar (ver abaixo) — então
`protocol` só consegue ser essa ponte neutra se não carregar, ele mesmo, nada de ninguém.
Opcodes e tipos de mensagem vivem só aqui, num arquivo, como fonte única das duas tabelas
(cliente e servidor). Se `protocol` importasse de `sim`, por exemplo, todo consumidor de
`protocol` passaria a arrastar `sim` também — e a neutralidade acaba.

### `content` — dado, não lógica

`content` descreve dados de jogo — monstros, hunts, itens, magias, vocações, prey, bestiário,
supply, economia, flags (`docs/technical-architecture.md` §8) — e só depende de `protocol` para
tipos compartilhados. Ele nunca contém arte, só `appearanceId`/`outfitId`.

`content` é lido por processos bem diferentes entre si: o servidor de jogo, o cliente, e
eventualmente uma ferramenta de balanceamento rodando sozinha. Se `content` importasse de `sim`,
`server`, `client` ou `tools`, deixaria de ser possível ler um arquivo de conteúdo isoladamente —
qualquer um desses processos teria que carregar o resto do monólito só para validar um JSON de
monstro.

### `sim` — a fronteira mais importante

`sim` é o núcleo de simulação: combate, movimento, bot. Duas restrições distintas, com razões
diferentes:

**Camada.** `sim` não importa `server`, `client` nem `tools`. A mesma lógica de tick precisa
produzir resultado idêntico rodando em teste unitário, em carga sintética (milhares de sessões
sem ninguém olhando) ou em produção — sem nenhuma pista, no código, de quem está hospedando a
simulação ou de como o resultado chega até alguém.

**Pureza — I/O, rede, banco, framework, relógio global.** Esta é a regra que `docs/architecture.md`
chama de decisão central de stack: "escreva a simulação como núcleo puro, isolado de I/O e de
framework, para poder trocar de linguagem depois sem tocar no protocolo nem no cliente." Três
consequências práticas, na ordem em que elas importam no dia a dia:

1. **Testabilidade.** Testar combate, bot e tick não exige subir servidor, Postgres ou Redis —
   é chamar função pura com um `dtMs` e conferir o estado que volta.
2. **Custo.** A mesma hunt roda a 10 Hz anexada e a 1–2 Hz desanexada com resultado idêntico
   (invariante 2 do `CLAUDE.md` raiz) porque nada depende de relógio de parede, só do `dtMs`
   recebido. É o que faz a projeção de custo de milhares de hunts desanexadas
   (`docs/technical-architecture.md` §14) ser viável.
3. **Opcionalidade de linguagem.** Se o custo de CPU virar gargalo, este núcleo — e só ele —
   pode ser reescrito em Rust ou Go sem tocar no protocolo nem no cliente
   (`docs/architecture.md`, seção de stack do servidor). Isso só continua verdade enquanto `sim`
   não tiver absorvido nenhuma dependência de I/O específica do Node.

Por isso a lista de módulos proibidos em `sim` não é só `node:*` — inclui os nomes sem prefixo
mais comuns (`fs`, `net`, `http`, `https`...) e os pacotes de terceiros que a arquitetura já
nomeou para banco, cache e framework HTTP/WebSocket (`pg`, `redis`, `express`, `uWebSockets.js`,
e variações próximas). A lista em `eslint.config.js` não é fechada — cresce quando aparecer um
novo cliente de banco, fila ou framework que `sim` tente importar.

Relógios globais também são proibidos pelo lint: `no-restricted-globals` recusa `Date` e
`performance` em `sim`, incluindo acessos por `globalThis`. O pacote expõe o contrato `Clock`
e um relógio de teste controlado; o adaptador de tempo real `systemClock` vive em
`packages/server/src/clock.ts`. A simulação recebe os instantes como parâmetros e calcula
`dtMs` a partir deles.

### `server` — roda em Node, não no navegador

`server` pode importar `protocol`, `content` e `sim` — é ele quem monta a simulação pura com I/O
de verdade (Postgres, Redis, WebSocket). A única fronteira dura é `client`: um processo Node
nunca importa código que pressupõe DOM, React ou o bundler do navegador.

Note que `tools` **não** está na lista de proibidos de `server`. Isso é deliberado, não uma
lacuna: `server` pode usar utilitário operacional de `tools` quando fizer sentido — por exemplo,
o processo `jobs` reaproveitando uma ferramenta de importação de conteúdo. `client`, por outro
lado, não tem essa liberdade (ver abaixo), porque tudo que `client` importa vai para o bundle que
roda no navegador de outra pessoa; o que `server` importa fica em Node, do lado de dentro.

### `client` — só manda intenção

`client` pode importar `protocol` e `content`, nunca `sim`, `server` ou `tools`. Isto é a
consequência direta do invariante 4 do `CLAUDE.md` raiz: **o cliente só manda intenção, nunca
dano, posição resolvida, loot, XP ou resultado de transação.** Mandar `sim` ou `server` para o
bundle do navegador exporia — e tornaria alterável, no DevTools de qualquer jogador — exatamente
a lógica que decide esses resultados. `tools` fica de fora pelo mesmo motivo que fica de fora do
bundle de qualquer produto: é código de operação e de importação de conteúdo, não algo pensado
para ser baixado por um jogador.

### `tools` — o topo, não uma dependência

`tools` reúne scripts de importação (tilemap, rota, assets do cliente Tibia) e o cliente
sintético de carga (`docs/technical-architecture.md` §17, épico E0). Por isso ele pode importar os
outros cinco pacotes sem restrição — é o topo da árvore, não uma peça que outro pacote monta.

A contrapartida é que **nada deveria importar de `tools`**: é por isso que ele aparece na lista de
proibidos de `content`, `sim` e `client`. Se algum desses três precisar de algo que hoje só existe
em `tools`, o código certo a mover é o utilitário — para `content`, `sim` ou um novo módulo
compartilhado —, nunca liberar o import.

## Como isso vira lint

`eslint.config.js` implementa esta tabela com `no-restricted-imports` — regra nativa do ESLint,
sem dependência extra — um bloco por pacote, restrito via `files` a `packages/<pacote>/**`.

Um detalhe que vale saber antes de tentar contornar um erro de lint escrevendo um caminho
relativo em vez de importar pelo nome do pacote: o motor de `patterns` do `no-restricted-imports`
casa cada padrão como uma regra estilo `.gitignore`. Isso significa que o nome nu de um pacote
proibido — sem nenhum curinga — já cobre as quatro formas de import que importam: o specifier
exato (`"sim"`), um subcaminho (`"sim/qualquer-coisa"`), um pacote com escopo
(`"@algum-scope/sim"`) e um import relativo cru que atravesse pacotes
(`"../../sim/src/index"`). Não existe atalho relativo que escape da regra — só existe import
legítimo, pelo nome do pacote, de quem a tabela acima permite.

A mesma amplitude tem um efeito colateral aceito de propósito: um arquivo local que, por
coincidência, tenha o nome exato de um pacote proibido também dispara o lint — por exemplo, um
`import x from './client'` dentro de `server/` para um helper interno chamado `client.ts` (um
"cliente HTTP" qualquer, sem relação com o pacote `client/`). Se isso acontecer, o arquivo local
está com um nome ambíguo; renomeie-o (`http-client.ts`, por exemplo) em vez de tentar afrouxar a
regra. O custo desse falso positivo ocasional é baixo — é um `git mv`. O custo de afrouxar a regra
para evitá-lo seria abrir espaço para o caso que ela existe pra pegar.

## Se este documento e `eslint.config.js` divergirem

Um dos dois está desatualizado. Corrija os dois no mesmo commit — nunca só o que for mais fácil
de mudar no momento.

## Pontos de entrada de `content/`

`content/` expõe dois: `.` é puro (schemas, tipos, montagem em memória) e `/load` lê disco
com `node:fs`. **`sim/` pode importar o primeiro e não o segundo.**

Vale explicitar porque é a única fronteira desta tabela que não é entre pacotes, e sim
*dentro* de um: sem ela, `sim` importa `content`, `content` importa `node:fs`, e a pureza do
invariante 1 se perde por transitividade — sem que nenhum import proibido apareça em `sim/`.
