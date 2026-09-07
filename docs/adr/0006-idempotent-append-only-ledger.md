# 0006 — Ledger append-only idempotente

**Status:** aceito
**Data:** 2026-09-07
**Contexto técnico:** módulo de economia, Postgres (`ledger`), `server` (`api` e `game`)

## Contexto

Gold é o ponto delicado do modelo de dados: muda dentro da sessão como delta em memória (loot,
supply) e também em operações globais como o Market, que precisam ser síncronas e transacionais.
O PRD exige que retry nunca duplique uma movimentação de valor e que exista trilha de auditoria
para transações — e pagamentos via PSP (PIX, cripto) somam o mesmo problema em outra forma, já
que um webhook pode ser reentregue.

A regra geral de persistência do projeto já apontava a direção: o que não pode ser perdido nem
duplicado — compra com moeda premium, negociação entre jogadores, mercado, transferência de gold
— precisa de escrita síncrona e log append-only. Um crash pode custar alguns minutos de XP; não
pode custar uma transação.

## Decisão

Registrar toda movimentação de valor — gold, Coins, item, XP relevante — como uma linha em um
ledger append-only: `ledger(id, character_id, session_id, seq, type, delta, ref, created_at)`, com
a constraint `UNIQUE(session_id, seq)`.

## Alternativas

- Atualizar saldo diretamente (`UPDATE` incremental) sem trilha — descartada por não sobreviver a
  retry (reentrega de mensagem duplicaria o crédito) e por não deixar auditoria.
- Deduplicação por tabela separada de requisições processadas — não adotada: a unicidade embutida
  na própria linha de ledger resolve dedup e auditoria com uma estrutura só.
- Creditar Coins fora de uma transação que também grava o evento de pagamento — descartada
  explicitamente; pagamentos usam a mesma ideia de unicidade, com `provider_event_id UNIQUE`.

## Consequências

- Retry de qualquer operação de valor fica seguro por construção: uma segunda tentativa com o
  mesmo `(session_id, seq)` falha na constraint em vez de duplicar.
- A auditoria de transações sai de graça do mesmo mecanismo, sem precisar de um sistema de log
  separado.
- Toda escrita de valor precisa carregar e incrementar corretamente um `seq` por sessão — é uma
  disciplina extra em cada ponto de código que mexe em gold, Coins, item ou XP relevante;
  esquecer o `seq` ou reaproveitar um valor quebra a garantia de forma silenciosa.
- Como o gold muda como delta em memória e só é materializado no ledger periodicamente, existe
  uma janela de defasagem por design entre o saldo quente e o ledger — a reconciliação e o
  snapshot de sessão precisam saber lidar com isso, especialmente na drenagem em deploy.
- O ledger cresce indefinidamente por ser append-only; arquivamento ou particionamento de longo
  prazo é um problema adiado, não resolvido por esta decisão.

## Invariantes afetados

10 (movimentação de valor passa pelo ledger com `(session_id, seq)` único; retry nunca duplica).
