---
name: conformidade
description: Use antes de fechar uma issue, ou sempre que o diff tocar sim/, protocol/, content/ ou qualquer coisa que mexa em gold/coins/itens — audita o diff (git diff contra a base, ou arquivos indicados) contra os onze invariantes de arquitetura do Draconya e reporta violações com arquivo, linha, invariante e motivo. Acione com "roda a conformidade", "verifica os invariantes", "isso viola a arquitetura", "revisa esse diff antes de eu commitar", "confere se tem import de I/O em sim".
---

# Revisar diff contra os invariantes

Esta é a skill de maior valor do conjunto, porque audita exatamente as violações que passam batido
numa revisão humana distraída e só aparecem meses depois. Import de I/O em `sim/` não quebra
nenhum teste no dia em que é escrito — só quebra quando alguém tenta rodar a simulação desanexada,
ou trocar a engine de banco.

Esta skill **não é** `/code-review`. Não aponte nome de variável ruim, duplicação, falta de teste
ou estilo. Só os onze invariantes abaixo.

## Passo 1 — obter o diff

Se o usuário indicou arquivos específicos, revise só eles — leia o conteúdo inteiro do arquivo, não
só o trecho alterado, quando o arquivo for pequeno o suficiente. Caso contrário, rode:

```bash
git diff main...HEAD          # commits da branch atual que ainda não estão em main
git diff HEAD                 # mudanças no working tree, não commitadas
git diff --staged             # mudanças já staged
```

Rode os três se não tiver certeza do estado do working tree. Se nenhum dos três mostrar mudança
nenhuma, pare e diga isso — não há o que revisar.

## Passo 2 — os onze invariantes e o sinal de busca de cada um

> **Fonte canônica dos invariantes:** a lista abaixo é uma cópia de trabalho. A versão que vale é
> a do `CLAUDE.md` raiz, que é carregada em toda sessão do projeto. Se as duas divergirem, o
> `CLAUDE.md` vence e esta cópia é o bug — releia-a de lá antes de usar, e corrija aqui.


Para cada arquivo do diff, identifique o pacote (`packages/sim`, `packages/protocol`,
`packages/content`, `packages/server`, `packages/client`, `packages/tools`) e cheque os
invariantes aplicáveis a esse pacote:

| # | Invariante | Onde se aplica | Sinal de busca |
|---|---|---|---|
| 1 | `sim/` é puro — sem I/O, sem framework, sem rede, sem banco, sem relógio global | `packages/sim/**` (fora de arquivos de teste) | imports de `node:*`, `fs`, `net`, `http`, `pg`, `postgres`, `redis`, `ioredis`, `express`, `ws`, `uWebSockets.js`; chamadas a `fetch(`, `Date.now()` usado como fonte de tempo, `setInterval(`, `setTimeout(` |
| 2 | Nada é escrito por tick — todo cálculo recebe `dtMs` | qualquer função de tick/update dentro de `sim/` | decremento/incremento de campo de cooldown, timer ou duração sem `dtMs` no escopo (`cooldown--`, `cooldown -= 1`, `ticksRemaining--`); função de tick sem parâmetro `dtMs` que mesmo assim muda estado dependente do tempo |
| 3 | O resultado da simulação não depende de haver alguém assistindo | `sim/`, laço de sessão em `server/` | `if (attached`, `if (hasViewer`, `if (isConnected` envolvendo o *cálculo* de dano/loot/XP — é legítimo esse tipo de condição mudar taxa de tick ou o que é enviado pela rede, nunca o resultado |
| 4 | O cliente só manda intenção — nunca dano, posição resolvida, loot, XP ou resultado de transação | `packages/protocol/**`, mensagens direção cliente→servidor | campos como `damage`, `dano`, `loot`, `xp`, `xpGanho`, `result`, `resultado`, `posicaoResolvida` em tipo de mensagem cuja direção é cliente→servidor |
| 5 | Opcodes vivem só em `protocol/`, como fonte única das duas tabelas | repositório inteiro | declaração de enum/constante de opcode (`Opcode`, `OPCODE_`, literal numérico comentado como opcode) fora de `packages/protocol/` |
| 6 | `content/` nunca contém arte — só `appearanceId` e `outfitId` | `packages/content/**` | extensões `.png .jpg .bmp .svg .webp`; chaves como `spritePath`, `sprite`, `texture`, `imagePath`; qualquer referência de aparência que não seja `appearanceId`/`outfitId` |
| 7 | A versão de conteúdo é fixada na sessão e não muda no meio dela | `server/` (código de sessão) | leitura de conteúdo "atual"/"mais recente" (`content.getLatest()`, `loadCurrentContent()`) dentro do laço de uma sessão já criada, em vez de usar a `versaoDeConteudo` capturada na criação da sessão |
| 8 | Todo personagem está sempre em exatamente uma sessão, cidade inclusive | `server/` | estado de personagem (posição, HP, etc.) mantido ou mutado fora de `CharacterRuntime`/do modelo de sessão; código que trata "cidade" como um caso especial fora do modelo de sessão |
| 9 | Estado quente só é escrito pela sessão dona — nenhum outro processo toca | `server/` | escrita em campos de `CharacterRuntime` (posição, HP, mana, XP, skills, inventário, buffs, delta de gold) a partir de código que não é o laço de tick/handler da própria sessão — outro processo, um job, outro nó |
| 10 | Movimentação de valor passa pelo ledger com `(session_id, seq)` único — retry nunca duplica | `server/`, economia | update de `gold`/`coins`/`item_instance` sem insert correspondente em `ledger`; insert em `ledger` sem campo `seq`, ou com `seq` não derivado da sessão |
| 11 | A automação é legítima — "parece bot" nunca é sinal de punição | `server/`, anti-abuso | heurística de banimento/flag baseada em "regularidade de input", "sem variação humana", "muito preciso para ser humano" — distinto (e legítimo) de detecção de multiconta ou RMT |

## Passo 3 — atenção especial

Estas sete são as mais baratas de cometer e as mais caras de corrigir depois. Cada uma tem exemplo
de violação e de código correto.

**Import de I/O dentro de `sim/` (invariante 1)**

```ts
// packages/sim/src/hunt-loop.ts
// VIOLAÇÃO — sim/ não pode saber que Postgres ou o filesystem existem
import { Pool } from "pg";
import fs from "node:fs";

// OK — tipos puros e dados já carregados são permitidos
import type { MonsterDef } from "@draconya/content";
import type { AttackIntent } from "@draconya/protocol";
```

**Contador decrementado por tick, em vez de cálculo a partir de `dtMs` (invariante 2)**

```ts
// VIOLAÇÃO — o resultado depende da taxa de tick; 1 Hz desanexado dá resultado
// diferente de 10 Hz anexado, o que quebra a garantia de resultado idêntico
function onTick() {
  this.cooldownTicks -= 1;
  if (this.cooldownTicks <= 0) this.ready = true;
}

// OK — função do tempo decorrido, idêntica em qualquer taxa de tick
function onTick(dtMs: number) {
  this.cooldownMs -= dtMs;
  if (this.cooldownMs <= 0) this.ready = true;
}
```

**Opcode declarado fora de `packages/protocol` (invariante 5)**

```ts
// packages/server/src/combat-handler.ts
// VIOLAÇÃO — segunda fonte de verdade para opcode, as duas tabelas divergem com o tempo
export const OPCODE_ATTACK_RESULT = 0x42;

// OK — toda constante de opcode vem de uma única fonte
import { Opcode } from "@draconya/protocol";
```

**Caminho de sprite ou nome de arquivo de arte dentro de `packages/content` (invariante 6)**

```ts
// packages/content/src/monstros/rat.ts
// VIOLAÇÃO — content/ não sabe o que é um arquivo de arte; isso acopla o
// balanceamento ao pacote de assets e trava a troca de tileset
export const rat = { spritePath: "/sprites/rat_32x32.png", outfitId: 35 };

// OK — só a indireção por id; a arte vive no pacote de assets (things/)
export const rat = { outfitId: 35 };
```

**Escrita de valor (gold, coins, item) sem passar pelo ledger ou sem `seq` (invariante 10)**

```ts
// VIOLAÇÃO — muda saldo direto, sem linha de ledger e sem seq; um retry de rede
// nesta chamada duplica o crédito
await db.character.update({ where: { id }, data: { gold: { increment: lootValue } } });

// OK — passa pelo ledger, idempotente por (session_id, seq)
await ledger.append({ characterId: id, sessionId, seq: nextSeq, tipo: "loot", delta: lootValue });
```

**Escrita em estado quente de personagem fora da sessão dona (invariante 9)**

```ts
// VIOLAÇÃO — um processo/job externo escrevendo direto no runtime de uma sessão
// que não é a dele; corrida com o próprio laço de tick da sessão dona
jobsProcess.on("tick", () => {
  someOtherSession.characterRuntime.hp -= 10;
});

// OK — só a própria sessão, dentro do seu laço, escreve seu CharacterRuntime
class Session {
  private onTick(dtMs: number) {
    this.characterRuntime.hp -= this.computeDamage(dtMs);
  }
}
```

**Mensagem cliente→servidor que carrega resultado em vez de intenção (invariante 4)**

```ts
// VIOLAÇÃO — o cliente decide e manda o resultado; o servidor vira carimbador
type AttackMessage = { opcode: Opcode.Attack; targetId: string; damageDealt: number };

// OK — o cliente manda intenção; o servidor resolve o resultado
type AttackMessage = { opcode: Opcode.Attack; targetId: string };
```

## Passo 4 — reduzir falso positivo

- Ignore imports em arquivos de teste (`*.test.ts`, `*.spec.ts`) para fins do invariante 1, a não
  ser que o próprio código de produção testado também viole a regra.
- `Date.now()`/`setTimeout` usados só dentro de `tools/` ou em teste não violam nada — o
  invariante 1 é sobre `sim/`, não sobre o monorepo inteiro.
- Presença de visualizador (invariante 3) pode legitimamente mudar *taxa de tick* e *o que é
  enviado pela rede* — só não pode mudar o resultado da simulação em si.

## Saída

Formato fixo:

```markdown
## Violações encontradas
1. `packages/sim/src/hunt-loop.ts:14` — invariante 1 (sim/ é puro): importa `pg`, acesso a banco
   dentro de sim/.
2. `packages/protocol/src/messages.ts:30` — invariante 4 (cliente só manda intenção): mensagem
   `AttackMessage` carrega `damageDealt`, calculado no cliente.

## Sem violações
(quando não houver nenhuma) "Diff conforme — nenhuma violação dos onze invariantes encontrada."
```

Nunca invente achados para parecer útil. Se o diff está limpo, a resposta certa é uma linha dizendo
isso — não uma lista de observações estilísticas disfarçadas de violação de invariante.
