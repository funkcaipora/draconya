# 0010 — Drenagem em deploy encerra creditando

**Status:** aceito
**Data:** 2026-09-07
**Contexto técnico:** `server` (processo `game`), `session_snapshot` (Postgres/Redis), pipeline de deploy

## Contexto

Como consequência da sessão desacoplada da conexão (ADR 0001), milhares de sessões podem estar em
andamento sem ninguém conectado no momento de um deploy ou de uma queda de nó. Reiniciar o
servidor sem tratamento nenhum destrói progresso de gente que não está presente para reagir — e
como já existe snapshot periódico da sessão (a cada 15–30 s e em marcos como level up, item raro
ou morte) como mecanismo de recuperação após queda, faltava decidir o que fazer especificamente
no caso controlado de um deploy.

O PRD permite explicitamente encerrar a sessão creditando o progresso nesse momento (§38.4), e
essa saída é descrita como muito mais simples que migração ao vivo de sessão entre nós.

## Decisão

Em deploy, o nó para de aceitar novas sessões, faz um snapshot final de cada sessão em andamento
e encerra cada uma delas creditando o progresso acumulado — em vez de migrar a sessão viva para
outro nó. O jogador é notificado do encerramento com o motivo e o extrato. O formato de snapshot
é desenhado para já ser suficiente para uma migração ao vivo futura, mesmo sem essa capacidade
estar implementada agora.

## Alternativas

- Migração ao vivo de sessão para outro nó durante o deploy — descartada para o MVP por ser
  significativamente mais complexa que encerrar creditando, sem ganho proporcional nesta fase.
- Descartar sessões em andamento sem creditar nada — descartada: para sessão desanexada isso
  destrói progresso de alguém ausente, minando a confiança no modo idle inteiro.
- Aceitar perda de progresso sem avisar — descartada; a diretriz é persistir e retomar, ou aceitar
  perder conscientemente avisando antes, nunca perder em silêncio.
- Desenhar o snapshot só para o caso de encerramento, sem pensar em migração futura — descartada;
  o formato nasce suficiente para migração para não exigir uma segunda reformulação depois.

## Consequências

- Deploy fica operacionalmente simples: parar de aceitar sessões novas, snapshotar, encerrar
  creditando — sem coordenar transferência de estado quente entre processos `game` diferentes.
- Cada deploy interrompe efetivamente todas as sessões em andamento no nó — não há continuidade
  perfeita. Uma hunt longa termina mais cedo do que o jogador esperava, com o progresso preservado
  mas a sessão encerrada; é simplicidade trocada por continuidade, deliberadamente.
- O crédito de progresso na drenagem depende de passar pelo mesmo caminho de ledger idempotente
  usado por qualquer outra movimentação de valor, para não duplicar nem perder o que já foi ganho
  num reprocessamento.
- Migração ao vivo continua não implementada — fica como trabalho futuro possibilitado pelo
  formato de snapshot, não entregue; se a frequência de deploy crescer a ponto de a interrupção
  incomodar jogadores, é essa a alavanca a puxar depois.
- O sistema de notificação — já necessário pela sessão desanexada — precisa cobrir também este
  caso operacional (drenagem), além dos casos de jogo (morte, fim de stamina).

## Invariantes afetados

9 (estado quente só é escrito pela sessão dona — preservado até o encerramento), 10 (o crédito
final de progresso é uma movimentação de valor e passa pelo ledger).
