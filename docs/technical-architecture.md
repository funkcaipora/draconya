# Draconya — Arquitetura técnica e plano do MVP

**Versão:** 1.0
**Entrada:** `Draconya_PRD_Consolidado_v0.9.md` + `architecture.md`
**Escopo:** responde aos 16 itens do §45 do PRD e quebra o MVP em épicos e tarefas.

> Onde este documento contraria `architecture.md`, ele prevalece — o PRD trouxe decisões
> que simplificam o motor mais do que a análise anterior supunha.

---

## Parte I — Arquitetura

### 1. O que o PRD mudou em relação à análise anterior

Quatro decisões de produto eliminam subsistemas inteiros. Vale registrar porque elas reduzem risco e custo:

| Decisão do PRD | Consequência técnica |
|---|---|
| §14.4 Rota fixa por hunt | **A hunt não precisa de pathfinding.** A rota é uma lista ordenada de tiles. A* só é necessário em Quest (exploração manual) e na cidade. |
| §20.1 Supply abstrato pago em gold | **Sem inventário de consumível na sessão.** Consumo vira débito no ledger. Some o gerenciamento de pilhas, munição e reposição durante a hunt. |
| §21.5 Sem itens físicos no chão | **Uma classe de entidade a menos** e as mensagens de aparecer/sumir item somem do protocolo. |
| §6.2 Conteúdo manual preserva o personagem desconectado | **Um único modelo de sessão serve para tudo.** Não existe "sessão que morre com o socket"; muda só se há input chegando. |

E uma que aumenta o custo: §7.1 permite **personagens ilimitados por conta com 2 ativos simultâneos**, os dois podendo estar em hunt AFK. O teto de simulação é `2 × accounts ativas`, não `jogadores conectados`.

---

### 2. Arquitetura lógica (§45.1)

**Monólito modular, três tipos de processo.** Microserviços aqui só adicionariam latência e operação; os módulos ficam separados por fronteira de código para poderem virar serviços depois.

| Processo | Estado | Réplicas | Responsabilidade |
|---|---|---|---|
| `api` | stateless | N | HTTP: auth, contas, personagens, tickets, market, pagamentos, admin |
| `game` | **stateful** | N | Hospeda sessões. WebSocket. É onde a simulação roda. |
| `jobs` | singleton com lock | 1 | Agendador: Guild War diária, expirações, matchmaking, reconciliação de pagamento |

**Armazenamento:** PostgreSQL (verdade durável) + Redis (diretório de sessões, leases, filas, snapshots quentes).

**Roteamento:** o cliente pede um ticket ao `api`, que consulta o diretório, escolhe/descobre o nó `game` e devolve `{ticket, wsUrl}`. O ticket é de vida curta e de uso único.

```
navegador ──HTTP──> api ──> [Postgres] [Redis]
    │                          │
    │                          └── diretório: char → sessão → nó
    └──WebSocket──> game (nó N) ── sessões ──> [Redis snapshots] [Postgres marcos]
                       ▲
                jobs ──┘  cria sessões agendadas, expira, reconcilia
```

---

### 3. Modelo de sessão (§45.2) — a decisão central

**Todo personagem está sempre em exatamente um estado, cidade inclusive — e um estado ativo é sempre exatamente uma sessão hospedada.**

Isso transforma o requisito de estado exclusivo do §6 de *regra policiada* em *propriedade estrutural*: não existe lugar onde um personagem possa estar em dois estados, porque o estado é sempre uma coisa só — a sessão que o hospeda enquanto ele age, e a coluna `characters.state` enquanto ele repousa. O repouso não precisa de nó: a Cidade não simula nada (§37), e a sessão dela é recolhida depois de um prazo sem visualizador (ADR 0024).

```
Sessão
  id, type, nóId, versãoDeConteúdo, criadaEm
  ruleset            # Cidade | Hunt | Treino | Quest | Boss | GuildWar
  mundo              # tilemap + entidades
  participants[]    # CharacterRuntime — dono exclusivo do state quente
  visualizadores[]   # 0..n conexões, opcionais
  aggregates          # analisador from sessão
  ledgerSeq          # sequência to idempotência econômica
```

**`CharacterRuntime`** é o dono exclusivo do estado quente enquanto a sessão vive: posição, HP/mana, XP, skills, inventário, buffs, regras do bot compiladas, delta de gold. Nenhum outro processo escreve nesses campos.

#### 3.1 Política de tick por tipo

A taxa de tick é uma função de `(type, tem visualizador?)`:

| Sessão | Anexada | Desanexada | Observação |
|---|---|---|---|
| Cidade | orientada a evento | — | Sem tick de simulação. PZ não tem combate |
| Hunt | 10 Hz | **1–2 Hz** | Redução válida porque tudo é função de `dtMs` |
| Treino | **forma fechada** | **forma fechada** | Ver 3.2 |
| Quest / Boss | 10 Hz | 10 Hz | §6.2: personagem fica vulnerável, precisa continuar simulando |
| Guild War | 10 Hz | 10 Hz | Idem, e são poucas instâncias |

**Restrição que sustenta tudo:** nenhuma fórmula é escrita "por tick". Cooldown, regeneração, dano ao longo do tempo e velocidade de ataque recebem `dtMs`. A resolução de combate é idêntica anexada ou não — o que cai é só a camada de apresentação.

#### 3.2 Treino é resolvido por fórmula, não simulado

O §11 descreve treino sem dano efetivo, sem consumo de gold e com progressão de skill por uso. Isso é **determinístico no tempo decorrido**. Não precisa de tick nem anexado nem desanexado: calcula-se o progresso a partir de `(início, agora, limite Free/Premium)` no momento em que alguém pergunta.

Ganho: treino vira a atividade mais barata do jogo — custo zero por personagem parado. Como muita gente vai "estacionar" personagem em treino, isso importa.

O cliente anexado recebe animação decorativa; os números vêm da mesma fórmula.

#### 3.3 Ciclo de vida e leases

O diretório vive em Redis:

- `char:{id}:session → {sessionId, nodeId, type}` com TTL, renovado pelo nó dono
- `account:{id}:active → set` com **máximo 2** (§7.1), aplicado com script atômico
- `node:{id}:heartbeat` com TTL

Se um nó morre, os leases expiram e o `jobs` recupera as sessões a partir do último snapshot.

---

### 4. Estado, persistência e retomada (§45.4)

#### 4.1 Duas classes de estado

| Classe | Onde | Quem escreve | Exemplos |
|---|---|---|---|
| **Quente** | memória do nó | só a sessão dona | posição, HP/mana, XP, skills, inventário, buffs, regras do bot |
| **Frio transacional** | Postgres, sempre em transação | `api` e módulo de economia | Coins, Premium, ofertas de Market, proveniência de lendário, ledger |

**Gold é híbrido, e é o ponto delicado.** Ele muda dentro da sessão (loot, supply) e também em operações globais (Market). A regra:

- Dentro de Hunt/Boss/Quest/Guild War, gold muda como **delta em memória**, materializado periodicamente no ledger.
- Toda operação de Market acontece **na Cidade**, e lá as escritas econômicas são **síncronas e transacionais**.
- Como um personagem não pode estar em dois estados (§6), nunca há duas fontes de escrita para o mesmo gold ao mesmo tempo. **O invariante de estado exclusivo é também o mecanismo de controle de concorrência.**

#### 4.2 Ledger append-only idempotente

Toda movimentação de valor — gold, Coins, item, XP relevante — vira linha em um ledger:

```
ledger(id, character_id, session_id, seq, type, delta, ref, created_at)
UNIQUE (session_id, seq)
```

A unicidade de `(session_id, seq)` é o que garante o §41: **retry nunca duplica**. E o ledger é a trilha de auditoria exigida no §40 sem precisar de um sistema separado.

#### 4.3 Snapshot e retomada (§38.4)

- Snapshot serializado da sessão para Redis a cada **15–30 s** e em marcos (level up, item raro, morte).
- Marcos importantes replicados para Postgres.
- **Em deploy: drenar.** O nó para de aceitar novas sessões, faz snapshot final, e **encerra cada sessão creditando o progresso** — que é explicitamente permitido pelo §38.4 e é muito mais simples que migração ao vivo.
- O formato do snapshot já nasce suficiente para **migrar** uma sessão para outro nó; a migração fica implementável depois sem mudar dados.
- Sessão encerrada por drenagem notifica o jogador com o motivo e o extrato.

---

### 5. Motor de bot server-side (§45.6)

O §13 já é uma especificação implementável. Traduzindo:

**Cinco categorias independentes**, cada uma com cooldown próprio de **1 s** (§13.5) e avaliação de cima para baixo, primeira regra válida executa (§13.4):

| Categoria | Slots |
|---|---|
| Cura | 3 |
| Potions | 4 (2 vida, 2 mana) |
| Magias de ataque | 10 |
| Runas e itens | 10 |
| Magias de suporte | 10 |

**Teto de 5 ações por segundo por personagem.** Esse cooldown por categoria *é* o freio de reação que `architecture.md` deixou em aberto — não é preciso inventar outro. Se o combate ficar longo demais em Guild War, o parâmetro a mexer é este.

**Compilação, não interpretação.** As regras são compiladas uma vez, ao entrar na sessão, para um vetor de predicados fechados. Nada de percorrer JSON a cada avaliação.

**Avaliação disparada por evento, não por tick:** quando o HP muda, só as regras que olham HP são reavaliadas; quando um cooldown de categoria expira, aquela categoria reavalia. Custo proporcional a eventos, não à população.

**Vocabulário fechado e versionado.** Condições: `hp%`, `mana%`, `alvos`, `hpAlvo%`, `distânciaAlvo`, `efeitoPresente`, `habilidadePronta`, com `< > <= >=`. Ações: `conjurar`, `usarPotion`, `usarRuna`, `equipar`, `desequipar`. Versionar o vocabulário permite adicionar condições sem invalidar configurações salvas.

**Bot avançado (§13.7, §13.8)** entra como duas máquinas de estado sobre o mesmo motor:
- *Lure dinâmico:* estado `percorrendo | limpando`, transições por contagem de monstros contra `min`/`max`.
- *Ring swap:* histerese explícita — limiar de entrada e de saída diferentes, exatamente como o PRD pede, para não oscilar.

---

### 6. Simulação de combate (§45 geral)

- **Jogador sempre acerta** (§12.2). Não há rolagem de acerto ofensivo — some metade da matemática de combate.
- **Dodge reduz o dano recebido em 50%**, rolado no defensor, vale contra tudo inclusive magia.
- **Monstro comum usa passo guloso** (§17.1): tenta o tile que aproxima; bloqueado, tenta adjacente; senão espera. `O(1)` por monstro por tick.
- **Hunt não usa pathfinding.** A rota é dados: uma lista ordenada de tiles com pontos de spawn associados (§14.4, §14.5).
- **Morte** (§26) encerra a hunt, devolve à PZ, aplica penalidade de XP e nunca remove item — o que elimina a necessidade de qualquer sistema de recuperação de itens.

---

### 7. Protocolo e reconexão (§45.5)

Mantém o desenho de `architecture.md`: WebSocket binário, frame `[chave uint32][flags][JSON([opcode, props])]`, flags para deflate e lote, pacote de protocolo compartilhado em TypeScript, validação de schema na entrada, deltas com ressincronização.

Acréscimos exigidos pelo PRD:

- **`session-attach` / `session-state`** — reanexar a uma sessão em andamento devolve o estado completo mais os agregados do analisador (§16.2), não um replay de eventos.
- **Eventos notáveis** — o snapshot guarda uma lista curta (subiu de level, item raro, quase morreu, morreu, saiu por qual regra) para a tela de retorno.
- **`feature-flags`** vindo do servidor, para o §39.

O cliente prevê **apenas o próprio passo**, em conteúdo manual. Dano, loot e resultado de empurrão são sempre do servidor.

---

### 8. Conteúdo e configuração (§45.7, §39)

Pacote `content/` versionado no repositório, carregado e validado por schema no boot do nó:

```
content/
  monsters/     stats, level recomendado, loot table, XP
  hunts/        rota, spawns, 4 dificuldades, composição por dificuldade
  items/        atributos base fixos, requisitos, slots from imbuement
  spells/       custo, cooldown, damage, requisito from level e vocação
  vocations/     HP/mana por level, spells liberadas, árvore from passivas
  prey/         bônus e durações
  bestiário/     marcos e recompensas por monstro
  supply/       preços
  economia/     penalidade from morte, bônus premium, bônus from party
  flags/        feature flags
```

**A versão de conteúdo é fixada na sessão.** Uma hunt iniciada com a versão N termina com a versão N, mesmo que um deploy publique N+1 no meio. Sem isso, rebalancear enquanto milhares de sessões desanexadas rodam produz resultados inconsistentes e impossíveis de auditar.

**`content/` nunca contém arte.** A arte vive num pacote separado (`things/`), e a ligação entre os dois é uma tabela de ids: `data/appearances/baseline.json` mapeia id de conteúdo → id de aparência, e `buildContent` resolve o `appearanceId` de cada item e o `outfitId` de cada monstro no boot (FUN-94). O arquivo da entidade não guarda nenhum dos dois. Consequência prática: **trocar o pacote de assets é editar um arquivo, não reescrever conteúdo** — e o servidor não precisa carregar arte nenhuma, só ids.

---

### 9. Modelo de dados (§45.3) — tabelas centrais

```
account(id, email, password_hash, created_at, coins)
character(id, account_id, name, vocation, level, xp, skills_json,
          gold, capacity, premium_until, stamina_ms, stamina_updated_at,
          state, session_id)
item_instance(id, character_id | market_offer_id | loot_box_id,
              type, cargas, imbuements_json,
              origem_character_id, origem_tipo, origem_em)   -- proveniência §25.3
inventory_slot(character_id, slot, item_instance_id, quantidade)
bot_config(character_id, versao_vocabulario, regras_json)
bestiário(character_id, monstro_id, kills, marcos_json)
prey(character_id, slot, monstro_id, bonus, expira_em, ultimo_roll_gratis)
imbuement(item_instance_id, efeito, tier, ms_efetivos_restantes)
guild(id, name), guild_member(guild_id, character_id, cargo)
guild_war_team(id, guild_id, name), guild_war_match(...), guild_war_score(...)
market_offer(id, item_instance_id | coins_qtd, vendedor_character_id, preco, state)
ledger(id, character_id, session_id, seq, type, delta, ref, created_at)
payment(id, account_id, provider, provider_event_id UNIQUE, valor, coins, state)
session_snapshot(id, type, no_id, versao_conteudo, blob, atualizado_em)
```

Dois pontos que evitam migração destrutiva depois (§35.3):
- **`item_instance` tem identidade própria desde o dia um** — sem isso, lendário negociável na Fase 2 exige reescrever o inventário inteiro.
- **Proveniência é gravada no drop**, não reconstruída de log.

---

### 10. Economia, Market e pagamentos (§45.8, §45.9)

- **Market sem taxa** (§32.3) e global. Compra é uma transação Postgres que move `item_instance` e gold entre personagens e escreve duas linhas de ledger.
- **Coins por gold** (§33.3): Coins pertencem à conta, o gold ao personagem. A transação cruza os dois níveis e é a operação economicamente mais sensível do jogo — precisa de teste de concorrência dedicado.
- **PIX e cripto** (§34.1): PSP com webhook. Idempotência por `provider_event_id UNIQUE`. **Coins nunca são creditadas fora de uma transação que também grava o evento de pagamento.** Cripto exige mínimo de confirmações configurável antes do crédito.
- **Reconciliação diária** no `jobs`: pagamentos sem crédito e créditos sem pagamento viram alerta.

---

### 11. Segurança e anti-abuso (§45.11, §41)

- Combate, loot, XP e transações são resolvidos no servidor; o cliente só manda intenção.
- Limite de 2 personagens ativos por conta aplicado com script atômico no Redis, não com verificação otimista.
- **A automação é legítima** — "parece bot" nunca pode ser sinal de punição. O que resta detectar é **multiconta e RMT**, e as defesas são: teto de 2 sessões por conta, stamina de 24 h, e ledger auditável por conta.
- Ticket de sessão de uso único com expiração curta.
- Ações administrativas com trilha de auditoria.

---

### 12. Observabilidade (§45.10, §40)

Três camadas:
1. **Telemetria de produto** — a lista do §40 vai para uma tabela de eventos append-only, particionada por dia.
2. **Métricas de sistema** — sessões por nó, custo de tick por sessão, atraso do tick, mensagens/s, bytes/s, latência de reanexação. **Implementadas (FUN-47)**, em `/metrics` do nó de jogo:

   | métrica | forma | por quê |
   |---|---|---|
   | `draconya_sessions_active{type,attached}` | gauge | recontada por ciclo, e **zera o que sumiu** — contador incremental erra devagar |
   | `draconya_tick_duration_us{type}` | histograma | a que mais importa; **nunca média** — a cauda é o que satura o nó |
   | `draconya_tick_lag_ms{type}` | histograma | quanto o tick passou do **período que pediu**, não o intervalo |
   | `draconya_tick_lag_budget_exceeded_total{type}` | counter | a pergunta de alerta: "já aconteceu?" |
   | `draconya_messages_sent_total` / `draconya_bytes_sent_total` | counters | contados **depois do lote**, que é o que saiu no fio |
   | `draconya_reattach_duration_ms` | histograma | resolver diretório + carregar snapshot + hospedar |
   | `draconya_active_slots_per_account` | gauge | só subir é vazamento na FUN-15, e o sintoma é "não consigo logar" |

   Rótulos são só tipo de sessão (seis valores) e anexada (dois). **Nada por `characterId` ou
   `sessionId`** — milhares de valores matam qualquer backend, e a conta chega longe de quem a
   causou.

   Falta `orphan_sessions`: quem detecta órfã é o `jobs`, e o `jobs` não tem superfície de
   métrica. Uma gauge sempre zero seria pior que a ausência — um painel dizendo "nenhuma órfã"
   sem nunca ter olhado.
3. **Alertas** — atraso de tick acima do orçamento, sessão órfã, divergência de reconciliação, ledger inconsistente.

A métrica que mais importa cedo: **custo de tick por instância**, porque toda a projeção de custo depende dela e ela é a única estimativa que não dá para derivar de fora. Medida na FUN-46 e exposta na FUN-47.

---

### 13. Cliente (§45.14)

**[DECIDIDO] React + PixiJS v8 + Vite.** HUD em DOM, mundo em canvas, câmera de ~18×14 tiles.

O §5.2 pede densidade de client de MMORPG — muitas janelas, painéis laterais, tabelas, chat, hotkeys. Isso é trabalho de DOM, e é onde React paga. O canvas só desenha tiles, criaturas, projéteis e efeitos, e Pixi entrega isso com bundle bem menor que Phaser.

**Regra de arquitetura do cliente que não pode ser quebrada:** o estado de jogo vive num **store mutável fora do React**, alimentado pelos deltas do WebSocket. Componentes assinam fatias estreitas. O canvas nunca renderiza através do React.

Motivo: chegam dezenas de deltas por segundo. Um HUD denso re-renderizando por contexto a cada `creature-move` derruba a taxa de quadros e nenhuma memoização salva depois. Zustand com seletores, ou um emissor de eventos próprio, resolvem — o que importa é que a decisão seja tomada no dia um.

### 13.1 Pipeline de assets

**[DECIDIDO] Usar o pacote de assets do cliente Tibia.**

Registro objetivo: esse é o risco jurídico apontado nos documentos anteriores, e a decisão é do produto. A mitigação técnica é a indireção por id da seção 8 — ela mantém a troca do pacote como um trabalho de remapeamento, e é praticamente de graça.

O formato já está mapeado da engenharia reversa do Huntera:

```
/things/<versão>/
  catalog-content.json                  índice: appearances, sprites, staticdata
  appearances-<hash>.dat                protobuf: objetos, outfits, efeitos, missiles
  sprites-<hash>.bmp.lzma               folhas comprimidas
```

- **Folhas:** 32×32 (12 colunas), 32×64 (12), 64×32 (6), 64×64 (6).
- **Decodificação:** leitor de varint protobuf escrito à mão para o `.dat`, decoder LZMA para as folhas, `createImageBitmap` e cache LRU por orçamento de bytes.
- **Outfits** usam camada template com quatro canais de cor — cabeça, corpo, pernas, pés — sobre uma paleta HSV fixa. Necessário para a personalização de aparência do §7.4.

Três melhorias sobre o que o Huntera faz, que valem o custo:

1. **Decodificar em Web Worker.** O decoder LZMA em JS puro é pesado; no thread principal ele engasga a entrada no jogo.
2. **Cachear em IndexedDB / Cache Storage.** O Huntera rebaixa e redescomprime as folhas a cada sessão. Guardar o resultado decodificado corta a maior parte do tempo de carregamento a partir do segundo acesso.
3. **Versionar o caminho** (`/things/<versão>/`) desde o começo, para poder subir de versão sem invalidar cache nem quebrar ids.

---

### 14. Custo estimado (§45.16)

Cenário de referência revisado com os números do PRD: **20 mil contas ativas, até 40 mil personagens em sessão, 12 mil conexões simultâneas**.

| Item | Estimativa |
|---|---|
| Hunt anexada, por tick | 50–200 µs (5 jogadores + 10–48 monstros) |
| Hunt desanexada | mesmo custo por tick, a 1–2 Hz |
| Treino (qualquer) | ~0 — forma fechada |
| 2.400 hunts anexadas | 5–12 cores |
| 6.000 hunts desanexadas | 3–6 cores |
| Guild War (poucas instâncias, 30 jogadores) | < 1 core |
| **Total de simulação** | **10–20 cores** |
| Banda de saída | 8–18 MB/s (só anexados) |

Duas ou três máquinas de aplicação mais Postgres e Redis gerenciados. **O gargalo provável continua sendo banda e conexões, não CPU.**

#### Medido (FUN-46) — 2026-09-09, Apple M2, macOS arm64, Node 24.14

`pnpm bench:hunts`: 5.000 hunts desanexadas, 1 personagem cada, **38 monstros vivos por
instância**, 1 Hz, 10 minutos simulados. Duas execuções.

| Métrica | Estimativa | Medido |
|---|---|---|
| custo de tick por instância | 50–200 µs | **11,4 – 14,8 µs** |
| instâncias por core (1 Hz) | 200–500 | **~67.000 – 88.000** |
| memória por sessão | a medir | **27,9 KiB** |
| snapshot por sessão | a medir | **8,9 KiB** |
| pausa de GC | a medir | 3,1–3,8 s em ~35 s de laço, **pico de 75–105 ms** |

**A projeção não estourou: sobrou.** O custo medido é três a quatro vezes menor que a ponta
otimista da estimativa, e a conclusão da seção continua valendo com folga — o gargalo é banda e
conexão, não CPU. Nenhuma das saídas previstas (baixar mais o tick, apertar stamina, reescrever
o núcleo em Rust ou Go) precisa ser acionada.

Memória também não é o gargalo que se temia: 5.000 sessões cabem em ~140 MiB de heap, e os
5.000 snapshots correspondentes em ~44 MiB de Redis.

**O número que merece atenção é a pausa de GC.** Um pico de 100 ms a 10 Hz significa um tick
perdido para todas as sessões anexadas do nó ao mesmo tempo. Não é problema para hunt desanexada
— ela recupera pelo `dtMs` do tick seguinte, por construção —, mas é exatamente o tipo de coisa
que aparece como "travadinha" para quem está olhando, e é métrica de operação (FUN-47), não de
simulação.

**O custo por instância piora com a escala, e é medido:** 400 hunts saem a 9,3 µs, 5.000 saem a
11–15. A diferença é localidade — 22 MiB de conjunto de trabalho cabem no cache, 142 MiB não. É
mais uma razão para medir no cenário cheio em vez de extrapolar de um pequeno.

#### Remedido depois da FUN-68 — 2026-09-09, Apple M2, Node 24.12

O relógio lógico e a fila de eventos ([ADR 0020](adr/0020-logical-session-scheduler.md))
trocaram o laço de tick, e o custo mudou — **em direções opostas conforme o modo**. Por segundo
*simulado*, que é a unidade que compara:

| | tick em lote | fila de eventos |
|---|---|---|
| 10 Hz, anexada | 71 µs/s | **15 µs/s** — 4,7× mais barato |
| 1 Hz, desanexada | 8,9 µs/s | 12,4 µs/s — 1,4× mais caro |

No cenário frio cheio (`pnpm bench:hunts`, 5.000 hunts a 1 Hz), **três execuções** — uma delas
com `dist` apagado, para garantir que mede o código de agora e não um build velho:

| Métrica | Estimativa | Medido (3 execuções) |
|---|---|---|
| custo de tick por instância | 50–200 µs | **18,2 – 20,6 µs** |
| instâncias por core (1 Hz) | 200–500 | **48.600 – 54.900** |
| memória por sessão | a medir | **27,0 KiB** (idêntico nas três) |
| snapshot por sessão | a medir | **12,0 KiB** (idêntico nas três) |

> **Estes dois números são anteriores à FUN-63.** A atribuição de dano (`Contribution`, um `Map`
> por criatura viva) subiu a memória para **36,9 KiB** e o snapshot para **14,2 KiB** — medido na
> `main` em 2026-09-10, no mesmo M2. O custo de tick foi de 18–21 µs para 21,0 µs, dentro da
> variância entre execuções. Ninguém remediu ao mergear a FUN-63, e a tabela ficou dizendo o
> número de antes: é o mesmo tipo de deriva que o índice de `docs/product/` tinha.
| pausa de GC | a medir | 2,9–3,7 s em ~50 s de laço, **pico de 100–195 ms** |

Um número anterior desta seção dizia 34,7 KiB de memória por sessão e não reproduz: três
execuções seguidas dão 27,0 KiB. A medida é `(heap depois do primeiro tick − heap antes) / 5.000`
com GC forçado dos dois lados, e é estável. A hipótese mais provável é que o 34,7 seja anterior às
quatro otimizações de alocação que a própria [ADR 0020](adr/0020-logical-session-scheduler.md)
descreve — o número de CPU foi atualizado depois delas e o de memória não.

**Remedido depois da FUN-63 (morte e recompensa como pipeline):** o mesmo cenário sobe para
**~21 µs** por tick por instância (três amostras A/B alternadas: 19,4/15,8/18,7 antes contra
21,8/19,9/21,2 depois; ~43.000 instâncias por core a 1 Hz). O custo é a atribuição de dano
registrada a cada golpe — `Contribution` em `Map`, mutada no lugar; um `Record` com chave
dinâmica media ~0,6 µs a mais — e é o preço de saber quem matou, que party, boss e bestiário
vão cobrar depois. Sem registrar golpe nenhum o número volta a ~19,7 µs, o que situa o resto
do pipeline (sorteio de loot, crédito na morte) dentro do ruído.

**A conclusão desta seção não muda: sobra.** O medido continua duas a dez vezes melhor que a
ponta otimista da estimativa (50–200 µs, 200–500 instâncias por core), e o gargalo segue sendo
banda e conexão.

O que vale entender é por que o número da hunt desanexada subiu, já que a issue previa o
contrário. A 1 Hz o laço antigo avaliava cada monstro **uma vez por segundo**, independentemente
da cadência real dele — menos trabalho do que a correção exige, e era exatamente essa
sub-avaliação que produzia 1,51× mais dano sofrido na hunt desanexada. Os 9,3 µs mediam uma
simulação errada. O custo agora é proporcional ao tempo simulado e quase indiferente à taxa, que
é o comportamento que se queria.

O snapshot subiu porque a fila é serializada: de 8,9 para 12,0 KiB por sessão, ou ~15 MiB de
Redis a mais com 5.000 sessões. A memória de heap por sessão **não** subiu — 27,9 antes, 27,0
agora, o que está dentro do ruído da medida.

#### Medido com o servidor de verdade (FUN-45) — 2026-09-09, Apple M2, mesma máquina

`pnpm load`, contra `api` + `game` + `jobs` num processo, Postgres e Redis em contêiner. Duas
rodadas, cada uma num nó vazio.

| | 1.000 desanexadas | 500 anexadas |
|---|---|---|
| sessões abertas / falhas | 1.000 / 0 | 500 / 0 |
| entrada (p50 / p99) | 3,4 s / 5,1 s | 3,2 s / 4,5 s |
| bytes/s por sessão | — (sem socket) | **42,8** |
| latência ping→pong (p50 / p95 / p99) | — | **0,7 / 4,3 / 10,3 ms** |
| memória por sessão | (coletor rodou entre as leituras) | **9,3 KiB** |
| custo de tick médio, do `/metrics` | **14,6 µs** | 8,5 µs |

O custo de tick medido pelo servidor **bate com o do banco de ensaio** (11–15 µs na FUN-46),
agora que o cenário é grande o bastante para o JIT chegar ao regime. É a confirmação que faltava:
o número não era artefato do laço isolado.

**Os 42,8 bytes/s por sessão NÃO são comparáveis aos 0,5–1,5 KB/s da projeção.** Hoje a hunt não
transmite mundo: não há `creature-move`, não há aparecer e sumir de criatura, não há delta de
posição. O que trafega é `pong` e pouco mais. Quando a sincronização de mundo existir, este número
sobe muito — e é para isso que ele está registrado agora, como piso conhecido.

**A entrada de 3 segundos é do `api`, não do nó de jogo.** Mil sessões significam mil criações de
conta, personagem e ticket, atravessando um pool de dez conexões no Postgres. Não é latência de
jogo; é a rampa do cliente de carga, e some com um cenário que reaproveita contas.

**Este número NÃO substitui uma medição na máquina de destino.** O tick é single-thread, então
quem decide é desempenho por core, e um core M-series não é um OCPU Ampere nem um core de EPYC
(ADR 0013). Medir aqui serve como linha de base e para detectar regressão de ordem de grandeza;
a conta de servidor de verdade precisa da rodada no host que vai rodar o jogo.

O maior risco de custo não é técnico: é o teto de `2 × accounts`. Stamina de 24 h com regeneração 1:1 significa que um personagem pode caçar metade do tempo — isso é o freio econômico real e precisa ser monitorado como métrica de infraestrutura, não só de game design.

---

### 15. Plano de testes de carga (§45.13)

Um cliente sintético que abre sessões sem renderizar. Três cenários, nesta ordem:

1. **Frio:** 5.000 hunts desanexadas, medir custo de tick e memória por sessão. É o teste que valida ou invalida toda a projeção de custo, e deve rodar na **Fase 1**, não no fim.
2. **Quente:** 2.000 hunts anexadas, medir bytes/s por jogador e atraso do tick.
3. **Pico:** uma Guild War 15×15 com 30 clientes reais reproduzindo movimento e empurrão, medindo latência ponta a ponta.

---

## Parte II — Plano do MVP

### 16. Núcleo indispensável × camadas que podem escorregar

O §4 define um MVP grande. Separando por risco estrutural:

**Núcleo — prova as propriedades difíceis de migrar depois:**
runtime de sessão, tick variável, snapshot e retomada, bot server-side, combate, hunt com rota fixa, supply em gold, ledger, morte, stamina, analisador, cliente base.

**Camadas — importantes para o produto, mas são configuração e contadores sobre o núcleo:**
Prey, Bestiário, imbuement, árvore de passivas, autovenda, caixa de loot, premium.

**Modos — reutilizam um mesmo motor manual:**
Quest, Boss e Guild War compartilham movimento manual, empurrão e instância fechada. Construir o motor uma vez e derivar os três.

**Fora do caminho crítico:** Market, Coins e pagamentos são bem compreendidos e independentes; podem ser feitos em paralelo por outra frente ou empurrados para o fim sem bloquear nada.

---

### 17. Épicos e tarefas

Tamanhos: **P** ≤ 1 dia · **M** 2–4 dias · **G** ≥ 1 semana.

#### E0 — Fundação
- [ ] **M** Monorepo pnpm: `protocol`, `content`, `sim`, `server`, `client`, `tools`
- [ ] **M** Pacote `protocol`: mapa de opcodes por direção, tipos, validação de schema
- [ ] **M** Codec de frame: chave + xorshift, flag deflate, flag lote, testes de ida e volta
- [ ] **M** Carregador de `content` com validação por schema no boot e versão de conteúdo
- [ ] **P** Formato de tilemap e de rota; ferramenta de importação
- [ ] **M** Parser de `catalog-content.json` e de `appearances.dat` (varint protobuf)
- [ ] **M** Decoder LZMA das folhas de sprite, rodando em Web Worker
- [ ] **M** Fatiador de folhas (32×32/32×64/64×32/64×64) + `createImageBitmap` + cache LRU
- [ ] **M** Cache persistente de folhas decodificadas em IndexedDB / Cache Storage
- [ ] **P** Colorização de outfit: template de 4 canais sobre paleta HSV
- [x] **P** Tabela de indireção `content` → `appearanceId`, para manter a troca de pacote barata — `data/appearances/baseline.json` (FUN-94). Validar cada id contra o pacote CARREGADO continua pendente, e depende do pacote (FUN-21, FUN-65)
- [ ] **M** Auth: registro, login, verificação de e-mail, sessão HTTP
- [ ] **M** CRUD de personagem, nome, criação inicial (§7.4)
- [ ] **M** Emissão de ticket de uso único e resolução de nó
- [ ] **G** Processo `game`: WebSocket com uWebSockets, anexar/desanexar visualizador
- [ ] **M** Diretório de sessões em Redis: lease de personagem, heartbeat de nó
- [ ] **M** Script atômico do limite de 2 personagens ativos por conta (§7.1)

#### E1 — Runtime de sessão
- [ ] **G** `Sessão` base + `CharacterRuntime` + laço de tick com `dtMs`
- [ ] **M** Política de tick por tipo e por presença de visualizador (10 Hz / 1–2 Hz / evento)
- [ ] **M** Serialização de snapshot; escrita periódica e em marcos
- [ ] **M** Retomada a partir de snapshot após queda de nó
- [ ] **M** Drenagem em deploy: encerrar creditando, com notificação e extrato
- [ ] **M** Máquina de estados do personagem (§6) com transições validadas
- [ ] **P** Sessão de Cidade orientada a evento
- [ ] **M** Interest management na cidade + shards de ~200 jogadores
- [ ] **M** `session-attach` / `session-state` com agregados

#### E2 — Combate e progressão base
- [ ] **M** Stats por vocação e por level (§9.3), tabela em `content`
- [ ] **M** Resolução de dano com Dodge de 50% (§12.2)
- [ ] **M** Cooldowns por tempo decorrido; nada "por tick"
- [ ] **G** Motor de magias: custo, alcance, área, efeito, requisito de level/vocação
- [ ] **M** Skills por uso (§9.4) com curva configurável
- [ ] **M** XP, level up, e penalidade de morte com piso no level 8 (§26.2)
- [ ] **M** Morte em PvE: encerra hunt, devolve à PZ, restaura HP/mana
- [ ] **P** Stamina como função do tempo decorrido (§10), sem tick

#### E3 — Monstros e hunt
- [ ] **M** Entidade monstro: stats, passo guloso, agressão, alcance
- [ ] **M** Spawns por ponto e composição por dificuldade (§14.5, §14.6)
- [ ] **M** Execução de rota fixa: percorrer, parar, retomar
- [ ] **G** Ruleset de Hunt: entrada, 4 dificuldades, encerramento (§14.8)
- [ ] **P** Troca de dificuldade encerrando e recriando instância (§14.7)
- [ ] **M** Bloqueio de XP, loot e Bestiário com stamina zero (§10.2)

#### E4 — Bot server-side
- [ ] **M** Vocabulário fechado e versionado de condições e ações
- [ ] **G** Compilador de regras para vetor de predicados
- [ ] **M** Cinco categorias com cooldown de 1 s e primeira-válida-executa (§13.4, §13.5)
- [ ] **M** Avaliação disparada por mudança de estado e por expiração de cooldown
- [ ] **M** Targeting: mais próximo, menor/maior HP, priorizar, ignorar, seguir, parado, distância (§13.6)
- [ ] **M** Regras de saída: membro saiu/morreu, gold acabou (§13.9)
- [ ] **M** Lure dinâmico com min/max (§13.7) — bot avançado
- [ ] **M** Ring swap com histerese de entrada e saída (§13.8) — bot avançado
- [ ] **P** Gate de bot básico até o level 49 (§13.2) — *subconjunto exato é [ABERTO] no PRD*

#### E5 — Economia de sessão
- [ ] **M** Supply abstrato: consumo debita gold direto (§20.1)
- [ ] **M** Ledger append-only com `UNIQUE(session_id, seq)`
- [ ] **M** Loot individual por personagem, sem last hit nem dano (§15.5)
- [ ] **M** Autovenda com limite Free 5 / Premium 20 (§22.1)
- [ ] **M** Inventário, capacidade e stack de 100 (§21.5)
- [ ] **M** Caixa de Loot da Sessão com expiração de 30 min (§21.6)
- [ ] **P** Comportamento de gold insuficiente com e sem regra de saída (§20.3)

#### E6 — Analisador
- [ ] **M** Agregados em tempo real: XP, gold, gasto, saldo, por hora, mortes, loot, supplies (§16.1)
- [ ] **P** Maior hit do ataque básico e por skill
- [ ] **M** Lista de eventos notáveis no snapshot, para a tela de retorno (§16.2)

#### E7 — Progressão persistente
- [ ] **M** Bestiário: contagem por monstro, 5 marcos, recompensas PvE (§18)
- [ ] **M** Prey: slots, roll diário, reroll de 10k, pool por level recomendado, 4 bônus (§19)
- [ ] **M** Árvore de passivas por vocação com respec livre em PZ (§9.5)
- [ ] **M** Imbuement com duração em tempo efetivo de hunt (§23.2)
- [ ] **P** Durabilidade de anéis por tempo e colares por carga, com reposição (§21.3, §21.4)
- [ ] **M** Promoção de vocação por quest (§9.2)

#### E8 — Treino
- [ ] **M** Ruleset de Treino resolvido por fórmula fechada
- [ ] **P** Trainer Monks sem dano efetivo, supplies gratuitos (§11.2)
- [ ] **P** Limites offline Free 6 h / Premium 12 h (§11.3)
- [ ] **P** Recuperação de stamina 1:1 durante treino

#### E9 — Party e matchmaking
- [ ] **M** Party de até 4, convite, liderança, saída
- [ ] **M** Fila de matchmaking em Redis com faixa de level
- [ ] **M** Fluxo: formar → líder escolhe hunt → membros aprovam → iniciar (§15.2)
- [ ] **M** Bônus de XP por vocação única, tabela configurável (§15.3)
- [ ] **M** Equalização de gastos de supply com settlement auditável (§15.4)
- [ ] **P** Saída/morte de membro respeitando regra individual

#### E10 — Motor manual (base de Quest, Boss e Guild War)
- [ ] **G** Movimento por tile validado no servidor + predição do próprio passo no cliente
- [ ] **M** Empurrão de 1 tile com cooldown e validação de destino
- [ ] **M** Alvo manual, hotkeys e ação por clique
- [ ] **M** Comportamento ao desconectar: personagem permanece, parado e vulnerável (§6.2)
- [ ] **M** Reanexação exata à posição e estado atuais

#### E11 — Quest e Boss
- [ ] **M** Ruleset de Quest: mapa maior, objetivo, repetível ou única (§28)
- [ ] **M** A* para clique-para-andar em mapa de quest
- [ ] **M** Ruleset de Boss: até 10, fechar sala ao iniciar, modo Iniciante com retorno após morte (§27)
- [ ] **M** Recompensa individual por dano elegível; sorteio de lendário
- [ ] **P** Registro de proveniência no drop de lendário (§25.3)
- [ ] **P** Limite de 1 tentativa por dia, configurável

#### E12 — Guildas e Guild War
- [ ] **M** Guilda com cargos Líder / Vice / Membro e permissões (§29)
- [ ] **M** Montagem de times de 15, múltiplos times por guilda
- [ ] **M** Matchmaking por level médio do time (§30.2)
- [ ] **M** Mapa, bases e posições predeterminadas do trono
- [ ] **G** Trono: ocupação de tile único, contador contínuo de 60 s, zerar ao sair/morrer/ser empurrado
- [ ] **M** Fila de eventos ordenada por timestamp — o ponto vale se os 60 s completam antes do evento de morte/push ser processado (§30.4)
- [ ] **M** Troca de posição do trono em 5, 10 e 15 pontos; vitória em 20
- [ ] **M** Respawn em 5 s na base, sem perda de XP durante a partida (§30.5)
- [ ] **M** Resultado: penalidade ao time derrotado, bônus de 24 h ao vencedor (§30.6)
- [ ] **P** Agendamento diário no `jobs` (§30.7)
- [ ] **P** Bestiário não aplica bônus em Guild War (§18.5)

#### E13 — Market, Coins e Premium
- [ ] **M** Market global sem taxa: listar, comprar, cancelar (§33)
- [ ] **M** Compra como transação Postgres movendo item e gold, com duas linhas de ledger
- [ ] **M** Coins por gold, cruzando conta e personagem (§33.3)
- [ ] **M** PIX via PSP com webhook e `provider_event_id UNIQUE`
- [ ] **M** Cripto com mínimo de confirmações configurável
- [ ] **M** Premium por personagem em 7/30/90 dias e aplicação dos benefícios (§34)
- [ ] **M** Reconciliação diária e alertas
- [ ] **P** Teste de concorrência dedicado para compra simultânea da mesma oferta

#### E14 — Cliente (React + Pixi v8 + Vite)
- [ ] **M** Store de estado de jogo fora do React, com assinatura por fatia
- [ ] **G** Shell: geografia do §5.3, painéis laterais, janelas, chat minimizável
- [ ] **G** Viewport Pixi: tiles, criaturas, projéteis, efeitos, câmera
- [ ] **M** Indicadores circulares de HP/mana (§5.4)
- [ ] **M** Action bar com presets por vocação e estágio (§8.2)
- [ ] **G** UI do bot: 5 categorias, slots, condições, targeting
- [ ] **M** Seleção de hunt com level recomendado e dificuldades
- [ ] **M** Janela do analisador, minimizável
- [ ] **M** Inventário, equipamento, skills, mochila
- [ ] **M** Market, Prey, Bestiário, passivas, guilda
- [ ] **M** Modo manual: hotkeys, alvo, empurrão, sem reorganizar a tela (§5.5)
- [ ] **M** Responsivo para celular sem exigir jogabilidade completa (§5.1)
- [ ] **G** Tutorial guiado do level 1 ao 8 com escolha de vocação (§8)

#### E15 — Operação
- [ ] **M** Tabela de eventos de telemetria do §40, particionada por dia
- [ ] **M** Métricas: sessões por nó, custo de tick, atraso, bytes/s, latência de reanexação
- [ ] **M** Alertas de atraso de tick, sessão órfã, divergência de reconciliação
- [ ] **M** Painel de admin: inspecionar personagem, sessão, ledger, conceder/estornar
- [ ] **G** Cliente sintético de carga e os três cenários da seção 15
- [ ] **M** Pipeline de deploy com drenagem

---

### 18. Fases e sequência

| Fase | Épicos | Duração | Critério de saída |
|---|---|---|---|
| **F1 — Espinha dorsal** | E0, E1, E2 parcial, E3 parcial | 4–5 sem | Entrar numa hunt, matar monstro com ataque básico, ganhar XP, **fechar o navegador, voltar e a hunt continuou**. Rodar o teste de carga frio. |
| **F2 — O loop** | E2, E3, E4, E5, E6 | 5–6 sem | §44.3 inteiro: hunt solo AFK com bot, supply, loot, analisador, stamina zero, morte |
| **F3 — Progressão e social** | E7, E8, E9 | 4–5 sem | §44.2, §44.4, §44.6 |
| **F4 — Conteúdo manual** | E10, E11 | 4–5 sem | §44.7 |
| **F5 — Guild War** | E12 | 3–4 sem | §44.8 |
| **F6 — Economia global** | E13 | 3 sem | §44.5, §44.9 |
| **F7 — Onboarding e operação** | E14 tutorial, E15 | 3 sem | §44.1 e painéis de operação |

**E14 (cliente) não é uma fase — é uma trilha paralela** que acompanha cada fase com a UI correspondente.

**Total: 26–31 semanas** para uma pessoa em tempo integral. Com uma segunda pessoa dedicada ao cliente, cai para algo entre 18 e 22.

#### Por que esta ordem

A F1 existe para provar, em quatro semanas, a única propriedade do projeto que é cara de descobrir tarde: **a sessão sobrevive ao navegador e ao restart**. Se o custo de tick medido no teste de carga frio estourar a projeção, é ali que a arquitetura muda — não depois de cinco meses de conteúdo em cima.

Guild War vem tarde de propósito. Ela reutiliza o motor manual da F4, e um modo 15×15 não tem como ser testado de verdade sem gente — o que só existe depois que o loop de progressão prende alguém.

---

### 19. Decisões

1. ~~React ou Angular~~ → **React + Pixi v8 + Vite.** Decidido.
2. ~~Tileset provisório licenciado~~ → **Assets do cliente Tibia.** Decidido; mitigação de reversibilidade na seção 8 e 13.1.
3. **[ABERTO] Corte de escopo.** O MVP do §4 são ~7 meses. F1 + F2 já é um jogo jogável — a pergunta é se você quer soltar para testadores nesse ponto ou só depois da Guild War.

### 20. Itens [ABERTO] do PRD que bloqueiam implementação

Estes não impedem começar, mas viram bloqueio quando o épico correspondente chegar:

| PRD | Aberto | Bloqueia |
|---|---|---|
| §43.3 | Subconjunto do bot básico pré-50 | E4, tarefa final |
| §43.2 | Fórmula do bônus de vocação única | E9 |
| §43.4 | Prey: 4 h de tempo real ou de hunt | E7 |
| §43.6 | Catálogo de imbuement | E7 |
| §43.8 | Horário, tolerância e roster da Guild War | E12 |
| §43.1 | HP/mana do Druida | E2 |

Todos são tabelas de configuração — a implementação pode nascer com valores provisórios marcados, desde que o `content` seja data-driven.
