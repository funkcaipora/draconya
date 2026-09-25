# 0039 — Caçada idêntica ao Tibia em toda hunt: spawns do Canary por ponto e fim do pull por dificuldade

**Status:** aceito; corroborado pelo Huntera em 2026-09-25 para o catálogo-alvo do M36-06 — o
modelo de spawn por ponto NÃO muda (ver emenda) — aplica ao catálogo inteiro de hunts a decisão 6
do
[ADR 0037](0037-tfs-canary-fidelity-except-action-bar-and-automation.md) (*"as mecânicas de caça
têm que ser idênticas"*, usuário em 2026-09-24), já usada pela Darashia Dragon Lair (emenda
2026-09-25 do [ADR 0025](0025-real-map-from-otbm.md))
**Data:** 2026-09-25
**Contexto técnico:** `packages/content` (`hunts/`, `routes/`, schema de spawn e dificuldade),
`packages/sim` (`rulesets/hunt.ts`, spawner), `scripts/` (importador de spawn), `packages/server`
(migração de dado persistido), `packages/client` (compatibilidade do campo `difficulty`)
**Issues:** M36 — #582 a #587

## Contexto

O ADR 0025 introduziu o mapa real por recorte de OTBM, mas manteve o modelo de dificuldade do
Huntera para povoar cada hunt: três tamanhos de pull (Cauteloso/Ousado/Agressivo,
`monsterCount` 2/5/8) com composição sorteada e `spawnClearRadius` segurando o respawn perto de
qualquer participante. A Darashia Dragon Lair (emenda de 2026-09-25 ao ADR 0025, #519) já
abandonou esse modelo para nascer diretamente dos 47 pontos de spawn do
`data-otservbr-global/world/otservbr-monster.xml` do Canary — cada ponto com monstro, posição e
`spawntime` próprios, sem sorteio — porque o ADR 0037 decisão 6 pede a mecânica de caça idêntica
ao Tibia em **toda** hunt, e o pull por tamanho nunca existiu no jogo real: ele é uma
característica observada do Huntera (FUN-123), não do Canary.

O que falta é estender essa conversão às hunts que ainda usam o modelo antigo — Rat Cellars e
Rotworm Caves — e ao catálogo de hunts futuras, com um mecanismo único de importação em vez de
cada hunt reinventando o próprio conjunto de decisões.

## Decisão

1. **Toda hunt nasce de um recorte OTBM mais os pontos de spawn do Canary que caem nele.** O
   importador de spawn (M36-01, `scripts/catalog/`, mesma convenção do ADR 0038) lê
   `otservbr-monster.xml`, filtra pela bounding box do recorte já importado pelo `map:import`
   (ADR 0025) e escreve um `SpawnPoint` por entrada real do arquivo: monstro, posição absoluta e
   `spawntime`. `routeSchema.spawnPoints` já ganhou os três campos opcionais que isso precisa
   (`monsterId`, `at`, `respawnDelayMs`) na emenda #519 do ADR 0025; esta decisão os torna a
   regra, não a exceção da Dragon Lair.
2. **O respawn segue o `SpawnMonster` do Canary.** Monstro com `isBlockable` (`blockable` no
   nosso schema, default `false` como no Canary — 1.640 dos 1.656 monstros do bestiário não
   bloqueiam) espera nenhum jogador à vista antes de nascer (`findPlayer`,
   `src/creatures/monsters/spawns/spawn_monster.cpp:184` e `:288`). Monstro não bloqueável nasce
   de qualquer forma, com um efeito de teleporte 3× `NONBLOCKABLE_SPAWN_MONSTER_INTERVAL`
   (`spawn_monster.cpp:288-345`) antes de aparecer, mesmo com jogador em cima do ponto.
3. **`difficulties.monsterCount`/`composition` e o `spawnClearRadius` saem de toda hunt.** O
   modelo de pull por tamanho, herdado do Huntera (FUN-123), deixa de existir — inclusive em Rat
   Cellars e Rotworm Caves, as duas primeiras hunts do catálogo (M36-05). O que continua sendo do
   Draconya é a automação que caça sobre essa mecânica: rota fixa sem pathfinding (ADR 0009),
   follow e targeting do bot (ADR 0037 decisão 2).
4. **O campo `difficulty` do protocolo e do dado persistido vira opcional e é ignorado**, nunca
   descartado (ADR 0014): um personagem com hunt em andamento sob o modelo antigo migra na
   leitura, sem quebrar retomada.
5. **A vida útil do cadáver vem da cadeia de decaimento real do `items.xml`, por monstro.** O
   Canary não some o cadáver de uma vez: cada item de cadáver tem `decayTo` para o próximo
   estágio, que decai de novo, até um `decayTo="0"` final. O `corpseTtlMs` da hunt passa a ser a
   **soma** da cadeia inteira — a Darashia Dragon Lair já fixou isso (5973 → 4025 → 4026 → 4027,
   10+300+300+60 = 670.000 ms), corrigindo um erro da primeira versão daquela emenda, que tinha
   usado só o primeiro estágio. O motor continua com um TTL só por hunt (sem decaimento em
   múltiplos estágios nem TTL por monstro individual) — a simplificação registrada é essa, não o
   valor do TTL.
6. **A rota continua sendo do Draconya** (ADR 0037 decisão 2, ADR 0009): passo guloso, sem
   pathfinding, sobre os pontos de spawn importados — o importador só decide **onde** o monstro
   nasce e **quando**, nunca como o personagem se move até lá.

## Alternativas

- **Manter o pull por tamanho e só trocar a fonte dos monstros por Canary.** Descartada: o ADR
  0037 decisão 6 já rejeitou isso explicitamente para a Dragon Lair, e manter as outras hunts sob
  um modelo diferente tornaria a fidelidade parcial — exatamente o problema que o ADR 0037
  mediu no dano de arma e na Mass Healing antes de ser corrigido.
- **Um TTL de cadáver por estágio, simulando o `decayTo` completo.** Descartada por agora: o
  motor de hunt não tem um relógio de item por tile fora do que já existe para campo (ADR 0031
  emenda CMB-07); a soma fixa preserva o número real sem esse mecanismo novo. Fica como trabalho
  futuro se um monstro precisar de um cadáver que muda de aparência no meio da vida.
- **Derivar `spawnClearRadius` do próprio `findPlayer` do Canary, em vez de removê-lo.** Descartada:
  os dois mecanismos não são o mesmo — `spawnClearRadius` bloqueia por **distância de qualquer
  participante vivo**, `findPlayer` bloqueia por **visibilidade** e só quando o monstro é
  `blockable`; confundir os dois produziria um comportamento que não é nem um nem outro.

## Consequências

- M36 (#582–#587) implementa esta decisão: importador de spawn (M36-01), fim do pull nas hunts
  existentes (M36-02), compatibilidade do protocolo (M36-03), TTL de cadáver pela cadeia
  (M36-04), Rat Cellars e Rotworm Caves com spawn real (M36-05) e o primeiro lote de hunts novas
  por faixa de level (M36-06).
- `docs/product/hunt.md` passa a descrever spawn por ponto como a regra, com a nota de que o
  modelo de pull do Huntera é histórico.
- Duas questões do plano ficam registradas para quando as issues concretas as encontrarem, sem
  bloquear esta decisão: quantas hunts o M36-06 importa por faixa de level e quem aprova cada
  lote (`docs/tibia-parity-plan.md` lista a questão junto do milestone); e se a janela de
  visibilidade do `findPlayer` (decisão 2) deve usar o alcance de espectadores do Canary
  (`Spectators::find`, ±11 tiles) ou a viewport do cliente do Draconya — as duas produzem
  resultado observável diferente perto da borda da tela, e a escolha é do M29/M36 quando a issue
  chegar lá.
- O que piora: o importador de spawn precisa da bounding box do recorte já feita (dependência de
  ordem com `map:import`), e uma hunt sem nenhum ponto de spawn do Canary dentro do recorte
  (recorte mal escolhido) falha na importação em vez de cair num pull genérico — o que é
  deliberado: sem spawn real, a hunt não é "idêntica ao Tibia".

## Invariantes afetados

Nenhum muda. O invariante 1 (`sim` puro) continua valendo: o spawner lê `SpawnPoint` como dado de
conteúdo, sem I/O. O invariante 7 é o motivo de o campo `difficulty` migrar em vez de ser
descartado.

## Emenda — 2026-09-25: decisões do dono ("copie do Huntera") — catálogo aberto, modelo de spawn intocado

O dono respondeu, em 2026-09-25, as doze questões abertas do `docs/tibia-parity-plan.md` §5 com
"copie do Huntera": onde o Huntera (o Tibia-idle observado em `docs/reference/huntera-observed.md`)
foi observado fazendo algo, a decisão de produto segue o Huntera; onde não foi observado, a regra
provisória permanece e a captura fica registrada (`docs/tibia-parity-plan.md` §6).

Esta emenda responde à questão 2 do plano ("quantas e quais hunts, qual a meta total do M36-06?").
O catálogo do Huntera **não é fixo**: cresceu de 55 hunts (Parte I §7, 2026-09-10) para 58 (Parte
II §15, 2026-09-11) para 73 (Parte V §31, 2026-09-22) em doze dias. Rat Cellars é sempre a
primeira; na leva de 73, a ordem até a posição 8 é Rat Cellars → Spider Nest → Troll Hills →
Swamp Troll Cave → Orc Camp → Folda Icefields → Bone Crypt → Rotworm Caves → Dwarf Mines →
Minotaur Maze → (lista elidida na captura, linhas 693-699).

**Decisão da emenda:** o catálogo-alvo do M36-06 é o do Huntera — aberto e crescente, importado
por lote a cada milestone, não um número fixo para bater de uma vez. Rat Cellars primeiro e
Rotworm Caves na 8ª posição já batem com o que o Draconya tem hoje (`rat-cellars.json`,
`rotworm-caves.json`) e continuam sem mudança.

**Isto NÃO reabre a decisão 3 acima.** O modelo de pull por tamanho que o Huntera usa
(Cauteloso/Ousado/Agressivo, `monsterCount` 2/5/8) continua removido — o Contexto deste ADR já
identifica esse modelo como "uma característica observada do Huntera (FUN-123), não do Canary", e
a resposta do dono decide qual catálogo de hunts importar, não como cada uma nasce: toda hunt
continua nascendo do recorte OTBM mais os pontos de spawn reais do Canary (decisão 1), sem
`monsterCount`/`composition`/`spawnClearRadius` (decisão 3), inclusive as futuras importadas do
catálogo do Huntera.

**Achado à parte, sem bloquear esta decisão:** a captura de 2026-09-22 (Parte VI §38, linhas
806-817) faz um match de terreno (472 votos) para a Rotworm Caves numa caverna em Darashia z8
(x33098–33185) diferente da usada pela emenda #511 deste ADR — o recorte atual (#511) é uma
caverna maior e mais aberta, achada contra a caixa candidata da Parte V §34 (z9,
x32097-32158), superada por este match de terreno mais preciso. Fica registrado para quando a
issue M36-05 (recorte real de Rotworm Caves) chegar; recortar de novo não é decisão deste ADR.

Confiança: baixa a média — alta para as contagens e as posições capturadas (Rat Cellars primeira,
Rotworm Caves 8ª, os dois números reconfirmados só para essas duas hunts especificamente); baixa
para "a lista completa e ordenada de 73 nomes" — só cerca de 14 de 73 nomes foram de fato citados
nas capturas, e nenhum arquivo de captura bruto sobrevive em disco.

**Captura pendente:** repetir o método de captura por WebSocket na tela de personagem e salvar o
corpo decodificado COMPLETO da mensagem de catálogo de hunts, para o número de hunts que existir
então.

(Evidência: `docs/reference/huntera-observed.md` Parte I §7 linhas 121-126; Parte II §15 linhas
311-317; Parte V §31 linhas 693-699; Parte VI §38 linhas 806-817.)
