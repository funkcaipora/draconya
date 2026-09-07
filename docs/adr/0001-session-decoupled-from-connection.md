# 0001 — Sessão desacoplada da conexão

**Status:** aceito
**Data:** 2026-09-07
**Contexto técnico:** `server` (processo `game`), `sim/`, `protocol/` (`session-attach` / `session-state`)

## Contexto

O pitch central do jogo é a caçada idle: o jogador monta equipamento, configura regras de
comportamento e o servidor simula a caçada de verdade, com ou sem alguém olhando. Isso só é
verdade se a sessão não depender de conexão nenhuma — caso contrário, fechar o navegador teria
que pausar ou destruir o progresso, e o jogo cairia para o modelo comum de progressão offline
calculada por fórmula ao reconectar.

Sem um modelo único de sessão, cada fluxo vira caso especial: reconectar depois de uma queda,
assistir a caçada de um amigo, e um modo observador de administrador exigiriam três mecanismos
diferentes. Além disso, mesmo nos modos manuais (quest, boss, PvP), o personagem precisa
continuar existindo no mundo — parado e vulnerável — quando o jogador desconecta, em vez de
simplesmente sumir. Ou seja: em nenhum lugar do jogo "sessão morre com o socket" é o
comportamento certo.

## Decisão

Modelar toda atividade — caçada inclusive — como uma sessão que vive no servidor e é dona do
próprio estado, independente de qualquer conexão. O socket do jogador é apenas um
**visualizador** que se anexa (`session-attach`) e se desanexa; anexar ou desanexar nunca cria
nem destrói a sessão, só muda se há input chegando e apresentação sendo entregue a alguém.

## Alternativas

- Sessão vinculada ao socket, pausando ou morrendo quando o WebSocket cai — contradiz o pitch do
  jogo e transforma reconexão num fluxo especial.
- Progressão offline calculada por estimativa ao reconectar — descartada explicitamente: a
  caçada não é progresso estimado, é a mesma simulação rodando de verdade, com ou sem plateia.
- Dois modelos de sessão distintos, um efêmero para caçada e um persistente para conteúdo
  manual — descartado porque um único modelo, com visualizador opcional ou obrigatório conforme
  o tipo de ruleset, cobre os dois casos com o mesmo mecanismo.

## Consequências

- Reconexão deixa de ser um fluxo próprio e vira "anexar um visualizador"; assistir à sessão de
  outra pessoa e o modo observador de admin saem de graça do mesmo mecanismo.
- O eixo de custo muda de "conexões simultâneas" para "personagens em sessão simultaneamente" —
  potencialmente muito maior, já que ninguém precisa estar presente para caçar (o cenário usado
  na análise de custo é 15 mil pessoas online com 60 mil personagens caçando ao mesmo tempo).
  Isso é registrado como o maior risco de custo do projeto, e quem o controla é mecânica de jogo
  (stamina, suprimento, sessões por conta, teto de duração), não engenharia.
- Regras de saída automáticas deixam de ser conveniência e passam a ser rede de segurança
  obrigatória, com piso não desativável — o personagem pode estar em risco às 3 da manhã sem
  ninguém olhando.
- Passa a ser necessário log de sessão, agregados e notificação externa (push, Telegram,
  Discord), já que não existe tela aberta para avisar nada em tempo real.
- Fica em aberto o que fazer com sessões em voo quando o processo precisa reiniciar (deploy ou
  queda de nó) — resolvido separadamente na ADR 0010.
- Multiconta rodando sem navegador aberto fica trivial de manter; a defesa passa a depender de
  limites de conta, não da presença de alguém para notar o abuso.

## Invariantes afetados

3 (o resultado da simulação não depende de haver alguém assistindo), 8 (todo personagem está
sempre em exatamente uma sessão). Depende também do invariante 2 (nada por tick, tudo por
`dtMs`) para ser economicamente viável — ver ADR 0003.
