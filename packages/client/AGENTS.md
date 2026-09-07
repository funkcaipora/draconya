# @draconya/client

## Propósito

O cliente web: React + PixiJS v8 + Vite. HUD em DOM, mundo em canvas, câmera de ~18×14 tiles.
Pipeline de assets (parser de aparências, decoder LZMA em Worker, cache persistente).

## Fronteiras

**Pode importar:** `protocol`, `content`.
**Não pode importar:** `sim`, `server`, `tools`.

O cliente não simula. Se ele precisar de uma regra de `sim` para decidir algo, ou a regra vira
mensagem do servidor, ou a decisão não é do cliente.

## Invariantes locais

- **O estado de jogo vive num store mutável fora do React**, alimentado pelos deltas do WebSocket.
  Componentes assinam fatias estreitas. **O canvas nunca renderiza através do React.** Chegam
  dezenas de deltas por segundo; um HUD denso re-renderizando por contexto a cada `creature-move`
  derruba a taxa de quadros, e nenhuma memoização salva depois. Ver ADR 0007.
- **O cliente só manda intenção** (invariante 4).
- Predição é **só do próprio passo**, com reconciliação. Nunca preveja dano, loot, nem o passo
  dos outros.
- **Não recebe snapshot por tick.** Um passo chega uma vez, com origem, destino e duração; o
  cliente anima os ~400 ms.

## Como testar

```
pnpm --filter @draconya/client build
```

Testes de componente entram quando houver componente. O teste de desempenho que importa:
com 40 criaturas se movendo, o número de commits do React por segundo fica próximo de zero.

## Armadilhas conhecidas

- O decoder LZMA em JS puro é pesado — roda em Web Worker, nunca no thread principal.
- Folhas decodificadas vão para IndexedDB. Sem isso, cada sessão rebaixa e redescomprime tudo.
- `requestAnimationFrame` para em aba de fundo. Ao voltar, aplique em bloco o que chegou; não
  tente animar dez minutos de eventos.
