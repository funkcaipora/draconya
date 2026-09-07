# 0004 — Cidade como protect zone

**Status:** aceito
**Data:** 2026-09-07
**Contexto técnico:** `server` (processo `game`, sessão de Cidade), interest management / sharding

## Contexto

Um mundo aberto com combate é apontado como o item mais caro que existe num MMO: exige interest
management fino, resolução de conflito entre muitos atores, e não escala horizontalmente porque
todo mundo compartilha o mesmo estado. A cidade, no entanto, é o único espaço verdadeiramente
compartilhado do jogo — tudo o resto (caçada, quest, boss, evento) já nasce instanciado.

O custo de não tratar isso é concreto: sem interest management, 2.000 jogadores na cidade dando
2 passos por segundo, cada passo replicado para os 2.000, geram 8 milhões de mensagens por
segundo. Com AOI — mapa dividido em células do tamanho aproximado da câmera (~18×14 tiles) —
cada passo vai para ~30 pessoas em vez de 2.000.

## Decisão

Tornar a cidade principal o único espaço compartilhado e persistente do jogo, e torná-la
deliberadamente inerte: protect zone sem combate, sem dano e sem automação. Rodar ali só
movimento, chat e interações pedido-resposta (loja, depósito, mercado, guild). Complementar com
interest management por células e shards de ~200 jogadores por cópia, abrindo "Cidade 2",
"Cidade 3" conforme a população cresce.

## Alternativas

- Mundo aberto com combate ou PvP na cidade — descartada por reintroduzir o gargalo O(N²) de
  transmissão e a resolução de conflito entre muitos atores que a topologia instanciada existe
  para evitar; é listada como algo que não dá para fazer sem trocar a arquitetura inteira.
- Otimizar só com AOI fino, sem limite de população por cópia — considerada insuficiente
  sozinha; sharding em ~200 jogadores por cópia é descrito como mais simples e mais eficaz do que
  otimizar AOI, além de alinhado com a filosofia de instanciar tudo.
- Permitir encontro espontâneo como pilar de mecânica (disputa por spawn, emboscada em mapa
  aberto) — descartada como consequência direta: nada que dependa de jogadores se encontrarem
  espontaneamente pode ser pilar do jogo.

## Consequências

- O custo por jogador na cidade cai para "transmitir passos e mensagens" — cerca de 10× mais
  barato por jogador que uma instância de caçada, porque não há combate, IA nem motor de regras
  rodando ali.
- Fica definitivamente fora do escopo qualquer mecânica que dependa de encontro espontâneo em
  mapa aberto: sem caçada em mapa aberto, sem PvP de emboscada, sem disputa por ponto de spawn.
  Encontro passa a ser sempre mediado — party, fila de evento, mercado.
- Mesmo "inerte", a cidade ainda exige dois investimentos de engenharia: interest management por
  célula e sharding de população — não é grátis, só é ordens de grandeza mais barato que a
  alternativa.
- Jogadores em cópias diferentes da cidade não se veem por padrão; encontrar um amigo específico
  depende de trocar de cópia manualmente — fricção deliberada, não bug.

## Invariantes afetados

8 (a cidade também é uma sessão — todo personagem está sempre em exatamente uma sessão, cidade
inclusive).
