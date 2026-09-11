# 0025 — OTClient em WebAssembly como renderizador do mundo

**Status:** proposto
**Data:** 2026-09-10
**Contexto técnico:** `client` (viewport, casca, pipeline de assets), `protocol` (segunda tabela de
opcodes), `server` (processo `game`, visualizadores), `content` (aparência dos mapas), `tools`
(build da engine, cliente sintético 13.10); ADRs 0007 e 0016

## Contexto

O cliente do Draconya desenha o mundo com retângulos (FUN-23 em andamento) e o pacote de arte não
está na máquina (FUN-65). Ao mesmo tempo existe, no repositório `tibiazin-idle/tibia-idle`, um
cliente web validado: o OTClient Redemption compilado para WebAssembly, com assets 13.10
embutidos, uma casca de entrada e uma HUD própria em Lua/OTUI. Ele renderiza tudo que a FUN-23
ainda teria de construir — tiles com empilhamento, andares, luz, outfits, animações, efeitos,
nomes e barras — e mais o que ela nem lista.

O custo é que ele só fala Tibia 13.10, é C++/Lua compilado por Emscripten, pesa 126 MB na
primeira carga e exige threads (portanto isolamento de origem). O plano em
[`docs/otclient-web-client-plan.md`](../otclient-web-client-plan.md) inventaria o cliente,
lista as colisões com o que já está decidido e deixa quatro perguntas. Este ADR registra as
respostas e o recorte em que elas valem.

## Decisão

Adotar o OTClient Redemption em WebAssembly **como renderizador do mundo**, mantendo o shell
React como dono de tudo que é do Draconya — a forma C do plano:

1. **Duas conexões, dois visualizadores da mesma sessão.** O socket `/ws` e o protocolo próprio
   continuam intactos para hunt, bot, inventário, analisador e extrato. Um segundo socket, `/ot`,
   fala Tibia 13.10 com a engine e leva só o mundo: mapa, criaturas, passos, vida, stats, chat e
   efeitos. O `SessionHost` trata os dois como visualizadores da mesma sessão; a simulação não
   sabe que existem dois protocolos.
2. **Versão 13.10** de pacote de assets e de protocolo — a combinação que o tibia-idle validou
   ponta a ponta. A tabela de aparências e `THINGS_VERSION` migram de 13.32 para 13.10.
3. **HUD do Draconya em DOM**, não em Lua. O que fica dentro do canvas é o que o Tibia já
   desenha: nomes, barras, efeitos, recipientes, menu de contexto. Cada informação tem um dono só.
4. **Upstream fixado por commit, com patches no repositório**, não fork. O único patch de C++
   previsto faz o WebSocket seguir o esquema da página e aceitar um caminho.
5. **O viewport Pixi sai** quando a engine provar o critério da Fase 2. Não ficam dois
   renderizadores.

**Recorte.** Isto é um teste, executado na branch `claude/otclient-web-experiment`, rodando
localmente, sem deploy. As tarefas vivem no milestone "OTClient web · teste local" do GitHub. O
status deste ADR muda para `aceito` quando o critério de saída da Fase 2 do plano — entrar na
hunt, ver o monstro morrer e sair com extrato, **na tela da engine** — for observado, e para
`substituído` se o teste for descartado. Enquanto `proposto`, nada do que está em `main` depende
dele.

## Alternativas

- **Tudo dentro da engine, HUD em Lua/OTUI** (como o tibia-idle faz) — descartada: reescreve em
  Lua cinco telas já entregues e testadas em React, para sistemas que não existem no Tibia.
- **Só inspiração, manter o Pixi** — descartada: não usa o cliente; continua sendo construir um
  renderizador do zero.
- **13.32**, o pacote que a tabela de aparências cita hoje — descartada: nenhuma combinação
  engine + assets + servidor foi validada nessa versão, e o custo de trocar é uma tabela de
  duas linhas.
- **Fork do upstream** — adiada: patches sobre commit fixado bastam enquanto forem poucos; virar
  fork é decisão nova.
- **Websockify** entre navegador e `game` — descartada: o `game` já é um servidor WebSocket, e o
  fio do OTClient é WebSocket binário; o salto extra não compra nada.

## Consequências

- O `game` passa a falar um segundo protocolo. A tabela de opcodes 13.10 mora em
  `packages/protocol/src/tibia/opcodes.ts`, um arquivo, derivada para os dois sentidos — o
  invariante 5 continua valendo, com duas tabelas no mesmo lugar. O outro lado é o upstream, MIT.
- Lua e OTUI entram no repositório, confinados a `packages/client/engine/modules/`, pela exceção
  que o ADR 0016 prevê para ferramenta externa que exige a linguagem. O `source-policy` passa a
  recusar `.lua`/`.otui` fora dali. `entry.js` do tibia-idle não entra como está: vira
  TypeScript. Os scripts Python de `ops/` não entram: o que for necessário é reescrito em `tools`.
- Uma cadeia de build em C++ (Emscripten, vcpkg) passa a existir, fora do caminho do PR: o
  artefato é construído raramente e fixado por hash; módulos Lua são trocados por repack sem
  recompilar.
- A origem do cliente precisa de `Cross-Origin-Opener-Policy: same-origin` e
  `Cross-Origin-Embedder-Policy: require-corp`. Todo subrecurso de outra origem passa a exigir
  CORP. No teste local isso é o servidor de desenvolvimento do Vite; em produção seria o Nginx do
  ADR 0022.
- A engine não roda em boa parte dos celulares (1 GB de memória WASM, WebGL 2, threads). O shell
  sem mundo continua sendo um modo legítimo, e o jogo idle não depende dele (invariante 3).
- O `backend/` Node e o `server/` do tibia-idle são GPL v2. Deles lê-se o formato; código é
  escrito do zero a partir do parser do OTClient (MIT), com a seção citada no PR.
- Se aceito, este ADR substitui em parte o ADR 0007 (o viewport Pixi; a HUD em DOM e o store
  fora do React ficam) e emenda o ADR 0016 (a exceção acima). Os dois só são editados na
  aceitação.

## Invariantes afetados

Nenhum muda. O invariante 4 ganha um segundo decodificador de intenção (opcodes `Walk*`,
`AutoWalk`, `Talk`, `LeaveGame`), que descarta com log tudo que não é intenção reconhecida; o
invariante 5 ganha uma segunda tabela, no mesmo pacote e num arquivo só; o invariante 7 passa a
ser conferido também contra o pacote de assets que a engine carrega (`welcome` diz qual, a casca
recusa ligar a engine com outro).
