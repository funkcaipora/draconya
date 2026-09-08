# @draconya/client

## Propósito

O cliente web: React + PixiJS v8 + Vite. HUD em DOM, mundo em canvas, câmera de ~18×14 tiles.
Pipeline de assets (parser de aparências, decoder LZMA em Worker, cache persistente).

## Fronteiras

**Pode importar:** `protocol`, `content`.
**Não pode importar:** `sim`, `server`, `tools`.

O cliente não simula. Se ele precisar de uma regra de `sim` para decidir algo, ou a regra vira
mensagem do servidor, ou a decisão não é do cliente.

## De onde vêm os assets

O pacote de arte **não é versionado neste repositório** (`things/` está no `.gitignore`) e não
está em nenhum repositório público. Ele vem de uma instalação do cliente do Tibia, e fica local:

```
things/<version>/           # THINGS_DIR e THINGS_VERSION no .env
  catalog-content.json
  appearances-<hash>.dat
  sprites-<hash>.bmp.lzma
```

**Os repositórios de OTClient não contêm sprites.** Foi verificado: `opentibiabr/otclient`,
`OTCv8/otclientv8` e `opentibia/yatc` não trazem `Tibia.spr`, `Tibia.dat`, `catalog-content.json`
nem folhas `sprites-*.bmp.lzma`. São clientes que *leem* os assets; a arte própria deles é só de
interface (cursores, skins, fontes).

O que eles trazem e que **vale muito**:

| Fonte | O que aproveitar | Licença |
|---|---|---|
| `opentibiabr/otclient` | **`src/protobuf/appearances.proto`** — o schema proto2 real, com `frameGroups`, categorias e ações. Gere o leitor a partir dele em vez de escrever um leitor de varint na mão | MIT |
| `OTCv8/otclientv8` | Referência de ergonomia e organização de HUD (§5.2 do PRD) | MIT |
| `opentibia/yatc` | Implementação de referência mais antiga | **GPL-2.0** |

**Cuidado de licença:** MIT nos dois primeiros — copiar código é limpo, mantendo o aviso de
copyright. **O YATC é GPL-2.0**, que é copyleft: copiar código de lá obrigaria o Draconya inteiro
a ser GPL. Leia como referência se quiser; não copie linha.

## Invariantes locais

- **O estado de jogo vive num store mutável fora do React**, em `src/state/`, alimentado pelos
  deltas do WebSocket. São DUAS camadas, e a divisão é a garantia:
  - `state/world.ts` — criaturas, instância, mapa. **Não existe `subscribe` neste módulo.** Um
    `creature-move` não pode causar render de React porque não há caminho do movimento até o
    React. É estrutural, não combinado — disciplina dura até o quinto componente.
  - `state/hud.ts` — o que uma pessoa lê como texto ou barra. Assinatura por fatia, com
    throttle opcional para valor contínuo.

  `state/apply.ts` é a única costura entre socket e estado, e cada `case` dele decide mundo ou
  HUD. **O canvas nunca renderiza através do React**; ele lê `world` direto no laço de render
  (`world/viewport.ts`). Ver ADR 0007.
- **O mundo é desenhado com RETÂNGULOS por enquanto** (`world/`). O pacote de arte não está no
  repositório e o pipeline dele é a FUN-16..21. O que existe é tudo o que não depende de arte:
  câmera de 18×14, camadas, ordem de desenho por `y`, reaproveitamento de sprite e
  interpolação de passo. Trocar retângulo por sprite é trocar a textura e ligar os
  `frameGroups`, não reescrever o viewport.
- **A ordem de desenho só é recalculada quando alguém troca de tile.** Dentro de um passo as
  criaturas deslizam sem se ultrapassar, então reordenar a cada quadro é refazer o mesmo
  trabalho 60 vezes por segundo.
- **Reconectar é REANEXAR** (`net/connection.ts`). Não recarrega a página, não recria
  personagem e **não limpa o store**: pede ticket novo e volta para a mesma sessão, que nunca
  parou de rodar. A tela continua mostrando a última coisa verdadeira até o `session-state`
  chegar, em vez de piscar vazia. Se a reconexão parecer um login novo para o jogador, o
  ADR 0001 vazou para a UI.
- **A espera entre tentativas tem jitter.** Sem ele, a queda de um nó faz todos os clientes
  daquele nó voltarem no mesmo instante e o derrubarem de novo — agora com a carga
  concentrada num milissegundo.
- **O estado da conexão fica na tela.** Jogo idle silencioso é indistinguível de jogo travado:
  sem indicador, ninguém sabe se a hunt está rendendo ou se o socket caiu há dez minutos.
- **O cliente só manda intenção** (invariante 4).
- Predição é **só do próprio passo**, com reconciliação. Nunca preveja dano, loot, nem o passo
  dos outros.
- **Não recebe snapshot por tick.** Um passo chega uma vez, com origem, destino e duração; o
  cliente anima os ~400 ms.

## Como testar

```
pnpm vitest run packages/client
pnpm --filter @draconya/client build
```

O pacote **entrou no `pnpm typecheck`** junto com a FUN-22. Antes disso ele não era verificado
por ninguém: o `tsconfig.json` dele tem `composite: false` e `noEmit`, o que o impede de ser
project reference, e o `vite build` usa esbuild, que remove tipo sem checar. Dava para escrever
`const x: number = 'texto'` aqui e o `pnpm check` continuar verde.

O teste de desempenho que importa — com 40 criaturas se movendo, os commits do React ficam
próximos de zero — é medido no `apply.test.ts` uma camada abaixo: commit só acontece se alguém
for avisado, então o teste conta AVISOS, e o número esperado é zero, não "baixo".

## Armadilhas conhecidas

- O decoder LZMA em JS puro é pesado — roda em Web Worker, nunca no thread principal.
- Folhas decodificadas vão para IndexedDB. Sem isso, cada sessão rebaixa e redescomprime tudo.
- `requestAnimationFrame` para em aba de fundo. Ao voltar, aplique em bloco o que chegou; não
  tente animar dez minutos de eventos.
