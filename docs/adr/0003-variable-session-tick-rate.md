# 0003 — Tick variável por sessão

**Status:** aceito
**Data:** 2026-09-07
**Contexto técnico:** `sim/`, `server` (processo `game`)

## Contexto

O tick de mundo existe só para o que é contínuo — IA de monstro, regeneração, expiração de
efeito, dano ao longo do tempo — porque ações do jogador já são processadas na chegada, fora do
tick. Rodar esse tick a 10 Hz o tempo todo, para toda sessão, é caro: no cenário de referência de
15.000 jogadores conectados e 60.000 personagens caçando, manter 10 Hz em tudo custaria de 30 a
75 cores; com a redução de tick para sessões sem visualizador, o mesmo cenário cai para 10 a 25
cores.

Nem toda sessão pode reduzir da mesma forma, porque nem toda sessão tem a mesma tolerância a
imprecisão temporal. Quest, Boss e Guild War deixam o personagem vulnerável mesmo sem
visualizador presente, e precisam continuar sendo simulados com fidelidade total. Treino, por
outro lado, é uma progressão determinística no tempo decorrido e não precisa de tick nenhum.

Essa redução só é segura porque a resolução de combate é definida como função de `dtMs`, nunca de
contagem de tick — sem essa restrição, mudar a cadência mudaria o resultado, e jogadores
descobririam que a sorte muda conforme alguém está olhando ou não.

## Decisão

Definir a taxa de tick como função de `(type from sessão, tem visualizador anexado?)`: Cidade
orientada a evento, sem tick de simulação; Hunt a 10 Hz anexada e 1–2 Hz desanexada; Treino
resolvido por forma fechada, sem tick em nenhum dos dois casos; Quest, Boss e Guild War sempre a
10 Hz, anexados ou não. Impor como restrição de engenharia que toda fórmula de simulação
(cooldown, regeneração, dano ao longo do tempo, velocidade de ataque) receba `dtMs` e nunca
assuma uma cadência fixa.

## Alternativas

- Tick fixo de 10 Hz para toda sessão — descartada pelo custo: é o cenário de 30 a 75 cores em
  vez de 10 a 25 no dimensionamento de referência.
- Pausar a simulação sem visualizador e recalcular por estimativa ao reconectar — descartada por
  ser a mesma progressão offline por fórmula rejeitada na ADR 0001.
- Reduzir também o tick de Quest/Boss/Guild War quando desanexado — descartada porque nesses
  modos o personagem fica vulnerável e precisa de fidelidade total mesmo momentaneamente sem
  visualizador, ao contrário da caçada, onde ausência de plateia é o caso normal.

## Consequências

- Sustenta a economia de CPU que viabiliza o teto de simulação do jogo sem exigir mais máquinas.
- Impõe uma disciplina permanente sobre `sim/`: todo cálculo é auditável verificando se recebe e
  usa `dtMs`; um único cálculo esquecido "por tick" reintroduz divergência silenciosa entre
  anexado e desanexado.
- Separa com clareza o que a simulação decide do que é mostrado — só a camada de apresentação
  (emitir evento por golpe, interpolar projétil, animar) pode variar com a cadência.
- Reanexar depois de horas a 1–2 Hz exige reconstituir contexto por agregados e eventos notáveis,
  não por replay — a maior parte dos eventos intermediários nunca foi emitida para ninguém.

## Invariantes afetados

2 (nada por tick, tudo por `dtMs`), 3 (o resultado da simulação não depende de haver alguém
assistindo).
