# 0007 — Cliente React + PixiJS com store externo

**Status:** aceito
**Data:** 2026-09-07
**Contexto técnico:** `client`

## Contexto

O PRD pede densidade de client de MMORPG: muitas janelas, painéis laterais, tabelas, chat,
hotkeys — trabalho de DOM, onde um framework de componentes paga seu custo. O canvas, por outro
lado, só precisa desenhar tiles, criaturas, projéteis e efeitos numa câmera de ~18×14 tiles,
muito menos do que um motor de jogo genérico cobre.

O protocolo manda eventos discretos, não um snapshot por tick, mas ainda assim chegam dezenas de
deltas por segundo (`creature-move`, dano, efeitos) que precisam atualizar a tela sem
re-renderizar tudo. O risco concreto: um HUD denso re-renderizando por contexto a cada delta de
movimento derruba a taxa de quadros, e nenhuma memoização resolve isso depois de o problema já
estar espalhado pela base de código.

## Decisão

Construir o cliente em React + PixiJS v8 + Vite. HUD em DOM, mundo em canvas. Manter o estado de
jogo num store mutável fora do React, alimentado diretamente pelos deltas do WebSocket;
componentes assinam fatias estreitas desse store; o canvas nunca renderiza através do React.

## Alternativas

- Phaser 4 em vez de PixiJS — descartada por trazer ~1,4 MB de bundle com recursos (cena, câmera,
  sprites, entrada, áudio) que um jogo de tiles simples não usa; Pixi é mais leve, ao custo de o
  time escrever a própria camada de câmera, cena e entrada.
- Canvas 2D próprio, sem biblioteca — não adotada; teria bundle ainda menor, mas deixaria
  batching e desempenho em celular inteiramente por conta do time sem necessidade real.
- Estado de jogo em Context/estado padrão do React — descartada porque um HUD denso
  re-renderizando a cada delta de movimento derruba a taxa de quadros, e a correção precisa vir
  antes do problema aparecer, não depois.
- Renderizar o mundo também com componentes React (ex.: wrapper React sobre Pixi) — descartada
  pela mesma regra: o canvas não pode renderizar através do ciclo de vida do React.

## Consequências

- HUD e mundo evoluem como camadas de fato independentes: iterar numa janela de inventário não
  arrisca a taxa de quadros do canvas, e vice-versa.
- Ler o estado de jogo via `useContext` ou props fica proibido por convenção de arquitetura desde
  o primeiro componente — é disciplina que precisa ser mantida desde o início, porque corrigir
  depois que várias telas já dependem de props exigiria reescrevê-las.
- O time herda a responsabilidade de escrever câmera, cena e input que um motor como Phaser
  entregaria pronto — é o preço explícito de escolher Pixi.
- Sincronizar o store externo com o fluxo de eventos do WebSocket é infraestrutura de cliente que
  precisa existir desde o início, não um detalhe a resolver depois que o HUD já estiver construído
  sobre outra premissa.

## Invariantes afetados

Nenhum dos onze diretamente — é uma decisão de engenharia de cliente. Na prática, sustenta o
invariante 4 (o cliente só manda intenção): o mundo é sempre um reflexo de deltas vindos do
servidor, nunca de estado inferido localmente.
