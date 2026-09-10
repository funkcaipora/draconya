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
  catalog-content.json      # índice → catalog.ts
  appearances-<hash>.dat    # protobuf → appearances.ts
  sprites-<hash>.bmp.lzma   # folhas → FUN-17
```

**Os testes do pipeline não dependem disso.** `src/assets/*.test.ts` monta o `.dat` com um
encoder de protobuf próprio (`assets/testing.ts`) e roda em qualquer lugar, CI incluído.
`appearances.pack.test.ts` é o outro lado: ele procura um `appearances*.dat` sob `THINGS_DIR`
e **pula** quando não acha, dizendo por quê numa linha.

A divisão é o ponto. Fixture prova COMPORTAMENTO — defaults do proto2, pulo por wire type,
registros separados — mas não prova que o schema que escrevemos é o schema que existe: ela foi
escrita pela mesma cabeça que escreveu o leitor, e um número de campo errado nos dois lugares
passa nos dois. Só arquivo real pega isso. Um teste que reprova onde o dado não existe seria
desligado no primeiro PR vermelho, e aí não protegeria nada em lugar nenhum.

Para rodar contra um pacote fora do repositório:

```
THINGS_DIR=/caminho/para/things pnpm vitest run packages/client/src/assets
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

## O pipeline de assets (FUN-16)

```
assets/protobuf.ts     mecanismo: varint, tag, slice, skip por wire type. Não sabe o que é aparência.
assets/appearances.ts  o schema: números de campo do appearances.proto real, e o leitor dirigido
assets/catalog.ts      o índice: qual folha tem qual id, e onde dentro dela
assets/testing.ts      encoder de protobuf, só para fixture
```

**Por que um leitor dirigido em vez de `protobufjs`.** A issue sugeria gerar o leitor a partir
do `.proto`, e a preocupação dela era não ADIVINHAR número de campo — `appearances.ts` cita o
schema real de `opentibiabr/otclient` (MIT) campo a campo, então não adivinhamos. O que um
decoder genérico custaria é o resto: ele materializa TODO campo de TODA mensagem, e
`Appearance.flags` — a maior parte dos 4,8 MB, da qual não usamos nada — viraria objeto para
cada uma das 42 mil aparências. O leitor dirigido pula a submensagem lendo um varint.
(`pbjs --target static-module` ainda emitiria `.js`, que o `source-policy` recusa.)

**O que é lido, e o que é pulado.** Lidos: `id`, `frame_group`, e de `sprite_info` os
`pattern_*`, `layers`, `sprite_id`, `bounding_square` e as durações das fases. Pulados:
`flags`, `name`, `description`, `bounding_box_per_direction`, `is_opaque` — e todo campo que
uma versão futura trouxer, **pelo wire type**. É isso, e não a lista de campos conhecidos, que
mantém o leitor válido quando o pacote sobe de versão.

Medido contra o `appearances.dat` do Canary (4,8 MB): **42.107 objects, 1.443 outfits, 242
effects, 62 missiles, em 136 ms.** O `outfit 21` sai com dois grupos — parado com 4 direções e
1 quadro, andando com 4 direções e 8 fases —, que é a forma que uma criatura do Tibia tem.

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

- **`packages/client/tsconfig.json` EXCLUI `*.test.ts`**, e isso é de propósito: o cliente é
  pacote de navegador e não tem tipos do Node. Dá-los a ele faria `node:fs` typecheckar dentro
  do código de produção — que é justamente o que não pode acontecer. Os testes continuam
  checados, pelo `tsconfig.tests.json`, que tem os tipos certos.
- **O id de sprite é GLOBAL entre as folhas**, não índice dentro de uma. `sheetFor` resolve pela
  faixa do `catalog-content.json`, e a faixa é INCLUSIVA nas duas pontas — um `<` no lugar de
  `<=` perde exatamente um sprite por folha, que é o defeito que ninguém acha olhando a tela.
- **`area` do `catalog-content.json` é lido e ignorado.** O que ele significa não foi verificado
  contra um pacote real (FUN-65), e derivar geometria de um campo não conferido seria pior que
  derivá-la de `spritetype`, que a §13.1 documenta. É o primeiro campo a conferir quando um
  pacote de verdade aparecer.
- O decoder LZMA em JS puro é pesado — roda em Web Worker, nunca no thread principal.
- Folhas decodificadas vão para IndexedDB. Sem isso, cada sessão rebaixa e redescomprime tudo.
- `requestAnimationFrame` para em aba de fundo. Ao voltar, aplique em bloco o que chegou; não
  tente animar dez minutos de eventos.
- **O analisador é DOM e tem FATIA PRÓPRIA** (`state/hud.ts`, FUN-83). Ler o estado inteiro faria
  a janela re-renderizar a cada golpe, que é exatamente o que o ADR 0007 existe para evitar.
- **Entre dois `session-state`, só o TEMPO anda.** O "por hora" é uma divisão cujo denominador é
  um relógio local; o numerador é sempre o último número que o servidor mandou. Extrapolar XP ou
  gold mostraria progresso que talvez não tenha acontecido — e o valor andaria PARA TRÁS na
  atualização seguinte. A taxa caindo devagar entre duas atualizações é o lado certo para errar.
- **`Aggregates` e `NotableEvent` do HUD são derivados do protocolo, não redeclarados.** Uma
  cópia à mão diverge no primeiro campo novo, e diverge em silêncio: `decodeS2C` devolve `null`
  sem erro quando a mensagem não bate, e a tela fica vazia sem ninguém ligar uma coisa à outra.
- **Campo opcional dos agregados vira "—", nunca zero.** Eles são opcionais porque um nó `game`
  anterior à FUN-78 manda sem eles (deploy em rolagem). Zero é uma afirmação que o servidor não
  fez.
- **A entrada (`account/`) é HTTP puro, e vem ANTES do socket** (FUN-97). Escolher personagem
  acontece quando ainda não existe sessão de jogo; o socket só abre depois, com o ticket que a
  escolha rende. `credentials: 'include'` em toda chamada — a sessão é cookie httpOnly (ADR 0012),
  e sem ele tudo responde 401 com o sintoma parecendo "não estou logado".
- **`account` é uma store separada do `hud`**, pela mesma razão que o `hud` é separado do `world`:
  ritmos diferentes. A lista de personagens muda três vezes por sessão; o HP muda sessenta vezes
  por segundo.
- **401 em `/api/auth/me` é a RESPOSTA "ninguém", não uma falha.** Tratá-lo como erro mostraria
  uma mensagem vermelha para quem só ainda não entrou — o estado de toda primeira visita.
- **Recusa da API vira frase, e a frase vive em `account/api.ts`.** Traduzir na tela faria a
  mesma recusa dizer coisas diferentes em cada lugar; e um código que ninguém traduziu ainda
  aparece cru, porque "algo deu errado" faz o jogador repetir o mesmo erro.
- **`?character=<id>` fica.** `phase-one-exit.test.ts` e `pnpm load` entram sem tela, e tirá-lo
  obrigaria os dois a simular login para testar sessão.
- **`net/current.ts` é como um botão manda intenção** (FUN-79). A conexão nasce e morre num
  efeito, e quem clica está em qualquer lugar da árvore: passar `send` por props atravessaria
  seis componentes que não têm nada a ver com socket, e contexto do React traria o socket para
  dentro do ciclo de render — que é o que o ADR 0007 mantém fora.
- **Mandar sem conexão é SILENCIOSO.** O clique pode cair no instante entre uma queda e a volta,
  e derrubar a tela por isso transformaria um piscar de rede em erro de jogo. Reconectar reanexa
  à mesma sessão (ADR 0001): o que se perde é o clique, não o estado.
- **O catálogo de hunts SUBSTITUI a lista, nunca acumula.** Reconectar reenvia a mesma lista, e
  concatenar daria hunts duplicadas a cada queda de rede.
- **A UI do bot não tem lista de opções em código** (FUN-89). Categorias, slots, magias e
  supplies vêm do catálogo (`state/hud.ts`, `catalogue`). Divergir do servidor faz o jogador
  configurar o que o bot recusa — e descobrir pelo extrato que não fecha.
- **Salvar é intenção, e a recusa NÃO descarta o rascunho.** Apagar o que o jogador escreveu é a
  pior resposta a "corrija isto". `bot-config-result` é tipado justamente para a tela não ter de
  casar com o texto de um `system-message`.
- **A ordem dos slots É a prioridade** (§13.4). A lista viaja como está; reordenar na hora de
  mandar mudaria o comportamento sem o jogador ter pedido.
- **O cliente NÃO soma peso** (FUN-90). Capacidade e peso vêm do servidor: quem sabe o que cabe
  é quem recusa, e a mesma conta em dois lugares diverge no primeiro item fracionário — com a
  versão do cliente sendo a errada.
- **A geografia da tela é fixa** (§5.3, §5.5). Inventário e analisador à direita, hunts e bot à
  esquerda, chat embaixo, nos mesmos lugares em hunt e em conteúdo manual. Reorganizar por
  atividade faz o jogador procurar a poção no meio da luta.
- **`inventory` e `catalogue` SUBSTITUEM, nunca acumulam.** O servidor manda o estado inteiro;
  montar a partir de pedaços daria uma mochila que diverge da dele sem nada acusar.
