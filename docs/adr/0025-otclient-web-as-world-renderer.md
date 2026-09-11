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
2. **Versão 13.32** de pacote de assets e de protocolo — a que a tabela de aparências, o
   `THINGS_DIR` de quem desenvolve e o volume do staging já usam, com tag pública
   (`dudantas/tibia-client@13.32.14520`). Um pacote só para os dois renderizadores, sem
   remapear id nenhum. Ver a emenda abaixo: o plano recomendava 13.10.
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
- **13.10**, a combinação que o tibia-idle validou ponta a ponta — era a recomendação do plano;
  descartada em 2026-09-11, quando a tabela de aparências deixou de ter duas linhas (ver emenda).
  O que o tibia-idle validou continua valendo como referência de forma; a versão é um botão só
  (`engine.lock.json`, `TIBIA_PROTOCOL_VERSION`), e voltar a 13.10 custa um remap de tabela.
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

## Emenda — 2026-09-11: a `main` andou, e a versão é 13.32

Entre a escrita do plano (base `a3c34ce`) e a abertura das tarefas, a `main` recebeu ~20 commits
de outras sessões: sprites reais no viewport Pixi, com outfits, nomes e barras de vida (FUN-23,
FUN-103); efeitos, mísseis e dano flutuante como mensagens de protocolo (`creature-hit`,
`effect`, `missile` — FUN-106, FUN-109); paredes montadas por vizinhança (FUN-105); a HUD com a
skin do Tibia e o sprite de cada item no inventário (FUN-108); stats ao vivo; e a tabela de
aparências, que tinha duas linhas, passou a mapear personagem, magias, supplies, golpes, chão e
quatro peças de parede — tudo em ids do pacote **13.32**, que é o que está em `things/1332` de
quem desenvolve e no volume de staging.

Duas consequências para esta decisão:

1. **A versão passa a ser 13.32** (decisão 2 acima). A recomendação de 13.10 vinha de duas
   coisas: a validação do tibia-idle e uma tabela de duas linhas fácil de remapear. A segunda
   deixou de ser verdade, e a primeira é substituída pelo spike da Fase 0, que valida a versão
   escolhida contra a engine real — é para isso que ele existe. O pacote 13.32 tem tag pública no
   mesmo repositório que o 13.10 (`dudantas/tibia-client@13.32.14520`), então o build da engine
   continua reproduzível. As diferenças de layout entre 1310 e 1332 estão documentadas no parser
   do upstream (`features.lua`: ≥1314, ≥1320, ≥1332) e são a primeira coisa que o spike fixa.
2. **A comparação que decide este ADR mudou de régua.** O plano dizia que a engine entregava
   "tudo que a FUN-23 ainda teria de construir"; boa parte disso foi construída no Pixi enquanto o
   plano era escrito. O que a engine ainda oferece e o Pixi não tem — andares, luz, animações por
   `frameGroups` completas, projéteis e efeitos com todas as fases, empilhamento de itens,
   recipientes, menu de contexto — continua valendo, mas o critério de aceitação da Fase 2 passa a
   ser lido **contra o Pixi de hoje**, não contra retângulos. A decisão 5 (o Pixi sai) só se
   sustenta se, na tela, a engine for melhor do que ele é agora — e é o encerramento do teste
   (última tarefa do milestone) quem responde.

O pipeline de assets em TypeScript deixou de ser "validação e o resto dormente": o inventário
desenha o sprite de cada item e a casca lê a skin de UI do pacote. Ele fica, com consumidor, em
qualquer desfecho.
