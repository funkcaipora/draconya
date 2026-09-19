# O HUD como contrato — etapas e tarefas

O que deve ser feito para a interface ficar exatamente como
[a imagem](kit-reference/10-hud-hunt.png), em etapas e tarefas rasas: só objetivo e critério de
aceite. As decisões estão no [ADR 0032](adr/0032-the-rendered-hud-is-the-game-contract.md); o
desenho (camadas, dependências, riscos) está em [hud-contract-plan.md](hud-contract-plan.md). Cada
tarefa vira issue pelo `/spec`, que escreve a spec completa a partir daqui — este documento não é
spec.

**Como usar:** uma tarefa = uma issue, no milestone da etapa, com a label de épico indicada e a de
escopo do commit que a fecha; "depende de" vira "bloqueada por". A ordem dentro de cada etapa é a
ordem de execução. Régua visual de toda tarefa de cliente: `kit-reference/10-hud-hunt.png` e a
captura do modal citada — comparação lado a lado é revisão humana do orquestrador.

---

## Etapa 1 · O servidor sabe contar — M18, lado do servidor

Milestone [M18 · Barra de ações, estoque e automações](https://github.com/funkcaipora/draconya/milestone/8) ·
épico `E4 · Bot server-side` (AB-01/02: `E5 · Economia de sessão`). Cadeia empilhada, na ordem.

### AB-01 · Suprimentos abstratos
**Objetivo:** poção e runa voltam a ser suprimento abstrato do catálogo — `price`, `effect`,
`requires` e `group` — e o gold é debitado no uso; a carga de bênção segue como o único item
`consumable`, não-empilhável.
**Critério de aceite:**
- `packages/content/data/supplies/` tem `health-potion`, `mana-potion` e `avalanche-rune` com
  `price`, `effect`, `requires` e `group`; `content.supplies` é o catálogo.
- `items/health-potion.json`, `mana-potion.json` e `avalanche-rune.json` foram removidos; a
  `blessing-charge` continua item `kind: 'consumable'`, sem `restock` nem `group` obrigatórios.
- A baseline de bot de cada vocação só referencia suprimentos do catálogo; `pnpm check` verde.
- `docs/product/items.md` lista os suprimentos e onde cada parâmetro mora.

### AB-02 · Munição abstrata, colar e escudo
**Objetivo:** flecha e virote voltam ao catálogo abstrato `ammunition/`, com família, `attack`,
`price` e level gate; entram o primeiro colar que gasta por carga e o primeiro escudo real.
**Critério de aceite:**
- `packages/content/data/ammunition/` tem `arrow`, `burst-arrow`, `sniper-arrow` e `onyx-arrow`
  com família (`arrow`/`bolt`), `attack`, `price` (> 0) e `requires.level`; `content.ammunition` é
  o catálogo.
- Um colar com `slot: 'neck'`, `charges` e proteção elemental; um escudo com `defense` — ambos
  equipáveis pelo kit inicial de teste.
- `items/*-arrow.json` foram removidos; o projétil fica em `appearances.ammunition`; `pnpm check`
  verde.

### AB-03 · Vocabulário v2 do bot
**Objetivo:** a configuração do bot passa a ser quatro conjuntos de 24 slots (ação, condições em
E, tecla, chave automática), conjunto ativo, cinco automações de catálogo (entrada em
OU, saída em E) e postura — sem trava de level — com migração determinística da v1.
**Critério de aceite:**
- `BOT_VOCABULARY_VERSION = 2`; o schema tem `sets[4].slots[24]`, `activeSet`, `automations[]`
  (`renew-ring`, `renew-amulet`, `swap-ammo-by-targets`, `swap-weapon-shield-by-hp`, `swap-ring`),
  `stance`; as condições são `hp`, `mana`, `targets`, `target-hp` e `condition`.
- A ação do slot é `spell` (`spellId`) ou `supply` (`supplyId`); `validateBotConfigV2` cruza os
  dois contra os catálogos.
- Tecla é uma de `1–9`, `0`, `F1–F12`, única dentro do conjunto; o schema recusa duplicata.
- `advancedFromLevel` e `advancedOnly` não existem mais no conteúdo nem no catálogo.
- `migrateBotConfigV1` é pura e idempotente, testada com toda baseline v1 do repositório: regras
  entram no conjunto 1 na ordem cura → poções → ataque → runas → suporte, preservando `enabled`,
  condição e ordem; o token `supply` v1 vira `supplyId`; `ringSwap` vira a automação `swap-ring`;
  `exit`, `lure` e `targeting` passam
  intactos.
- Baseline v2 por vocação com as automações que fazem sentido ligadas (paladino: munição por
  alvos; cavaleiro: arma/escudo por vida).

### AB-04 · Gold no uso
**Objetivo:** usar um suprimento debita o `price` do gold no ato, via `useSupply`; não há pilha a
decrementar nem lote a comprar.
**Critério de aceite:**
- Teste de hunt com poção configurada: cada uso debita o `price` do saldo e soma
  `Aggregates.goldSpent`; retry do extrato não duplica (invariante 10).
- Sem gold, a ação é recusada (`not-enough-gold`) e a regra de saída "acabar o gold" encerra a hunt.
- Nenhum débito é decidido por tick (é evento da fila) e a sessão a 1 Hz desanexada produz o mesmo
  extrato.

### AB-05 · Munição por família
**Objetivo:** a escolha é por família (opcode 14 `select-ammo`), validada por `requires.level` no
servidor e publicada em `player-stats.ammo { arrow, bolt }`; cada tiro debita o `price` do gold.
**Critério de aceite:**
- Testes: o `select-ammo` de uma munição liberada muda `player-stats.ammo`; uma acima do level é
  recusada com motivo; sem saldo que cubra o preço, o tiro não sai (nem `shot`, nem dano).
- A ausência de uma família cai na básica da família (a primeira em ordem de id), que também é
  paga; não existe fallback grátis.
- Snapshot com `ammo` por família é preservado na retomada.

### AB-06 · Cargas e duração
**Objetivo:** anel equipado vence por tempo, colar por carga; o item é destruído ao esgotar e o
inventário avisa o cliente.
**Critério de aceite:**
- `durationMs` agenda o vencimento na fila de eventos ao equipar e cancela ao desequipar; a
  sessão desanexada a 1 Hz vence no mesmo instante lógico.
- `charges` decrementa a cada bloqueio elemental que o colar absorve; em zero, o item some do
  slot e a mensagem `inventory` reflete.
- Testes cobrem os dois caminhos e o caso "desequipou antes de vencer".

### AB-07 · Motor de slots v2
**Objetivo:** substituir o motor por categoria pelo motor por grupo de cooldown do conteúdo:
ordem do slot é a prioridade, condições em E, o inelegível é pulado no mesmo ciclo.
**Critério de aceite:**
- Testes RP-001…RP-004: o slot de topo sem mana não trava o grupo — o próximo elegível dispara
  no mesmo ciclo; grupos `healing`, `attack`, `support` e `potion` são independentes.
- A condição `condition` funciona ("castar haste só sem haste").
- Sem tetos por categoria; o motor v1 (`select()` por categoria) foi removido.
- A matriz de conformidade de combate do M19 continua idêntica — muda quem decide, não o dano.

### AB-08 · Automações v2
**Objetivo:** as cinco automações rodam no `sim` com entrada em OU e saída em E, usando atuadores
próprios de equipar, desequipar e trocar munição (o bot não passa pelos opcodes do jogador).
**Critério de aceite:**
- Um teste por modelo: anel renovado ao vencer; colar renovado ao esgotar; ≥ N alvos troca para a
  munição A e volta para B abaixo; HP < x % troca para uma mão + escudo e HP > y % volta para
  duas mãos; swap ring por HP OU alvos com retorno ao anel anterior.
- Automação desligada não age; sem o item na mochila, a automação informa o motivo e não trava o
  resto.
- O mecanismo `#applyRingSwap` v1 foi absorvido por `swap-ring` e não existe em separado.

### AB-09 · Protocolo e servidor v2
**Objetivo:** intenções `use-slot`, `select-target` e `select-ammo`, estado dos slots para o
cliente, catálogo
v2 e o portão de versão com migração ao carregar o personagem.
**Critério de aceite:**
- `use-slot { set, slot }` executa a ação se elegível, ignorando as condições do slot; fora de
  hunt ou inelegível responde `slot-result { ok: false, reason }`.
- `select-target { creatureId }` muda o alvo e `player-stats.targetId` reflete; alvo morto cai em
  `nearest`. `select-ammo { ammoId }` muda a munição da família e `player-stats.ammo` reflete.
- `slot-state` traz, por slot, pronto / cooldown restante / motivo de bloqueio.
- `catalogue` v2 leva suprimentos, munição, grupos, teclas válidas e modelos de automação, sem
  `advancedFromLevel`.
- Personagem com configuração v1 no Postgres entra com a v2 migrada e persistida pelo caminho do
  ADR 0028; campos novos são opcionais com default; testes do `server` cobrem os dois lados.

---

## Etapa 2 · A tela — M18, lado do cliente

Milestone M18 · épico `E14 · Cliente`. Parte do fim da etapa 1.

### AB-10 · ActionBar
**Objetivo:** a fileira de 124 px volta com a barra 2 × 12, CONJUNTO, ALVO, ⌖ Lure·Follow e a
legenda, montada na Cidade e na caçada; a tecla dispara `use-slot`; Shift+clique desliga o
automático do slot.
**Critério de aceite:**
- Geometria do kit (`minmax(0,1fr) 124px`); slots de 36 px com rótulo curto, tecla, cor do
  elemento e cooldown (de `slot-state`); slot sem dado é vazio — nada
  inventado; sem estado "LV 50+".
- Tecla envia `use-slot`; a recusa aparece no tooltip com o motivo do servidor.
- CONJUNTO troca `activeSet` e ALVO troca a política pela `bot-config`; "Salva automaticamente"
  reflete salvo/salvando; ⌖ abre o modal de lure/alvo e a legenda mostra mín/máx e a postura do
  bot.
- As pills de caçada sobem para `bottom:130` com a legenda de saída acima, centralizada; abaixo
  de 720 px a barra vira seção do modo página.
- Testes por `prerender`; comparação com `kit-reference/10-hud-hunt.png` aprovada.

### AB-11 · ActionConfigModal
**Objetivo:** configurar um slot — ação do catálogo (magia ou suprimento), condições em E, tecla,
chave automática — no modal do kit.
**Critério de aceite:**
- Igual à captura 34 (`NumField` = `Input` numérico pequeno); salvar envia `bot-config`.
- Tecla já usada no conjunto é recusada com mensagem; valor fora de faixa bloqueia o salvar.
- Testes por `prerender` cobrindo slot vazio, slot de magia e slot de suprimento.

### AB-12 · Automações — painel e modais
**Objetivo:** o painel AUTOMAÇÕES com as linhas do kit e "+ Adicionar", os modais de catálogo e
de configuração (entrada OU / saída E), e a aposentadoria do `BotPanel`, do `RuleEditor`, do
botão "Lure e alvo" e da seção "Configurações avançadas".
**Critério de aceite:**
- Iguais às capturas 35–38; toggle, ⚙ e × enviam `bot-config`; o resumo de cada linha é gerado
  dos parâmetros.
- Montado na Cidade e na caçada; `BotPanel.tsx` e `RuleEditor.tsx` não existem mais e nenhum texto
  "Bot avançado a partir do level 50" sobrou no cliente.
- Testes por `prerender`; comparação com a captura 10 aprovada.

### AB-13 · Coluna direita e alvo
**Objetivo:** `AmmoPicker` sobre o Escudo com bow/crossbow, Mochila com rótulo e contagem, clique
na Batalha
ou no mundo escolhe o alvo, moldura vermelha sobre a criatura alvo.
**Critério de aceite:**
- Com bow/crossbow equipado, o slot do Escudo mostra a munição escolhida e o clique abre o
  `AmmoPicker` com as opções da família liberadas pelo nível; sem pilha nem contagem.
- Item com rótulo curto mostra rótulo + contagem na Mochila (o `Slot` já suporta).
- Clique na linha da Batalha ou na criatura envia `select-target`; a moldura no canvas segue
  `targetId`.
- Testes por `prerender` e do overlay; comparação com a captura 10 aprovada.

### AB-14 · Documentação de produto do M18
**Objetivo:** `docs/product` descreve o bot v2, o suprimento abstrato, a munição e as cargas como
existem.
**Critério de aceite:**
- `bot.md` (slots, conjuntos, automações, `use-slot`, migração), `items.md`, `economy.md` (§20.1,
  gold no uso), `hunt.md` e os `AGENTS.md` afetados atualizados; `docs-check`
  verde; nenhuma menção a categorias v1 ou level 50 fora de contexto histórico.

---

## Etapa 3 · A coluna direita e as skills — M21

Milestone [M21 · Postura, moedas, loot e skills](https://github.com/funkcaipora/draconya/milestone/12) ·
épico `E2 · Combate e progressão base` (CO-02/03/04: `E5 · Economia de sessão`). CO-05 pode
começar a qualquer momento; o resto parte da AB-09.

### CO-01 · Postura
**Objetivo:** Defensiva / Balanceada / Atacante como fight mode real, com os fatores do TFS, no
perfil `combat-v2`, por intenção `set-stance`, e o controle do set ligado.
**Critério de aceite:**
- `stance` persistido com a configuração de combate; `set-stance` muda e `player-stats` reflete.
- Testes de dano causado e defesa por postura (ofensiva: dano cheio; balanceada: dano ÷ 1,2 e
  defesa × 1,2; defensiva: dano ÷ 2 e defesa × 2); default Balanceada.
- Perfil `combat-v2` com a matriz de conformidade própria; `combat-v1` preservado (ADR 0031).
- O `Stance` do set é clicável e mostra a postura do servidor; comparação com a captura 10.

### CO-02 · Moedas físicas na bolsa
**Objetivo:** gold, platinum e crystal coins como itens na bolsa; o loot deposita, a troca
100 → 1 é automática, e o saldo do topo continua sendo o ledger.
**Critério de aceite:**
- Loot de gold vira pilhas na bolsa; 100 gold viram 1 platinum e 100 platinum viram 1 crystal
  sem intervenção.
- Ao sair da hunt, o valor da bolsa entra no ledger como `hunt-credit` (uma linha, idempotente) e
  a bolsa esvazia; a morte não perde a bolsa; party `shared` continua depositando na bolsa da
  party.
- `player-stats.gold` continua sendo o saldo do ledger.

### CO-03 · Loot na mochila e Despachar loot
**Objetivo:** os drops entram na mochila limitados pela capacidade; `dispatch-loot` vende ao
valor do conteúdo pelo ledger; com a capacidade cheia o bot despacha sozinho; a Caixa de Loot em
Redis é aposentada.
**Critério de aceite:**
- Teste: drop entra na mochila; `dispatch-loot` vende cada item a `value`, credita o ledger e
  esvazia; em party respeita `shareLoot`.
- Capacidade cheia dispara o despacho automático sem intervenção.
- Código da Caixa de Loot (FUN-88) removido; snapshot antigo carrega sem erro.

### CO-04 · Bolsa e Despachar loot no cliente
**Objetivo:** BOLSA com GOLD / PLAT / GEM, a pill "Despachar loot »" e o modal do kit.
**Critério de aceite:**
- Bolsa igual à captura 10; a pill envia `dispatch-loot`; o modal (captura 25) lista item ×
  quantidade × valor vindos do servidor; o topo mostra o saldo.
- Testes por `prerender`.

### CO-05 · Skills por família de arma
**Objetivo:** `fist`, `club`, `sword`, `axe`, `distance`, `shielding` e `magic` como skills do
conteúdo e do `sim`; a skill `melee` única é dividida na migração.
**Critério de aceite:**
- `packages/content/data/skills/` tem as sete; a família da arma equipada treina a sua skill.
- Migração copia o progresso de `melee` para `sword`, `axe` e `club`, idempotente e testada.
- `player-stats.skills` leva todas; `docs/product/progression.md` atualizado.

### CO-06 · Soul Points
**Objetivo:** soul no personagem, com regeneração por evento e custo em magia; a conjuração de
munição do paladino é o primeiro consumidor.
**Critério de aceite:**
- `soul`/`maxSoul` (100; 200 com Premium); regenera 1 a cada 240 s (120 s com Premium) por evento
  da fila.
- Magia com custo `soul` é recusada sem soul suficiente; a conjuração de munição do paladino é o
  primeiro consumidor e debita soul.
- `player-stats` leva `soul` e `maxSoul`.

### CO-07 · Painel Skills completo
**Objetivo:** barra do Level, as 11 linhas default da imagem, Personalizar com as 15 skills reais
e "CAP" formatado.
**Critério de aceite:**
- `xpPercentToNext` trafega em `player-stats`; a linha Level tem barra.
- Default: Experiência total, Level, Hit Points, Mana, Soul Points, Capacidade, Speed, Stamina,
  Magic Level, Sword Fighting, Shielding; Personalizar (captura 39) lista as 15 existentes, sem
  Fishing.
- "Cap" com separador de milhar; comparação com a captura 10 aprovada.

### CO-08 · Documentação de produto do M21
**Objetivo:** `docs/product` descreve postura, moedas, loot na mochila, famílias de skill e soul.
**Critério de aceite:**
- `combat.md`, `economy.md`, `items.md`, `progression.md` e `death.md` atualizados; `docs-check`
  verde.

---

## Etapa 4 · O que a party ainda deve à imagem — M20 (existente)

Milestone [M20 · Party e VIP](https://github.com/funkcaipora/draconya/milestone/11) · épico
`E9 · Party e matchmaking`. Os dois interruptores do líder, Amigos e o teto de membros já são
issues do M20 — não repetir. Além disso, a PR #409 renumera o seu ADR para 0033.

### PT-01 · DPS e HPS por membro
**Objetivo:** dano causado e cura feita nos últimos 60 s, mais os totais da sessão, por membro,
no painel da party e no analisador; sigla de vocação de duas letras.
**Critério de aceite:**
- Acumuladores por evento com carimbo lógico, aparados na leitura — nada por tick; teste com a
  sessão desanexada dá os mesmos totais.
- `party-state.members[]` leva `dps`, `damageTotal`, `hps`, `healTotal`; a linha "DPS n · total /
  HPS n · total" aparece como na captura 10; siglas EK/RP/ED/MS.

### PT-02 · Parar no meio exige o sim de todos
**Objetivo:** encerrar a sessão da party para todos é uma proposta que cada membro aprova; sair
sozinho continua livre.
**Critério de aceite:**
- Proposta do líder, aprovação por membro em 60 s, encerramento com settlement ao completar;
  recusa ou prazo cancela; teste cobre os três desfechos.
- "Sair da caçada" de um membro continua sendo a saída individual em 5 s; a nota do painel passa
  a descrever um mecanismo real.

---

## Etapa 5 · O topo e o mundo — M22

Milestone [M22 · Topo e mundo — Loja, bênção, boost e status](https://github.com/funkcaipora/draconya/milestone/13) ·
épico `E7 · Progressão persistente` (TP-05/07: `E14 · Cliente`). Parte da AB-08 e do M21.

### TP-01 · Gemas da conta
**Objetivo:** `account.coins` passa a ser lida e escrita pelo `api` com lançamento próprio, chega
na `session-state` e aparece na pill do topo.
**Critério de aceite:**
- Tabela de movimentos da conta com idempotência; crédito administrativo por rota do `api`.
- `session-state` leva `coins`; a pill "N ◆" aparece como na captura 10; sem compra com dinheiro
  real neste plano.

### TP-02 · Loja
**Objetivo:** catálogo `content/store` (boost de EXP 24 h, carga de bênção, Premium 30 d), compra
pelo `api` debitando gemas e entregando (item na mochila ou atributo na conta), o modal do kit e
o botão LOJA.
**Critério de aceite:**
- `POST /api/store/buy` idempotente: debita gemas, entrega e registra; sem gemas, recusa.
- Modal igual às capturas 32–33 (a aba "Comprar gold" fica para a TP-06); botão LOJA no topo.

### TP-03 · Bênção
**Objetivo:** o slot BENÇÃO consome a carga e ativa `blessed`; a morte consome a bênção e reduz
a penalidade de XP; pill "Bênção ativa".
**Critério de aceite:**
- Teste: usar a carga ativa `blessed`; morrer consome e aplica `blessing.lossFactor` do conteúdo
  sobre os 60 %/54 %; sem bênção, a penalidade é a de hoje.
- `player-stats` leva `blessed`; a pill aparece só quando ativa.

### TP-04 · Boost de EXP
**Objetivo:** multiplicador temporário de XP com vencimento na fila, somado ao do bestiário, e a
pill "EXP +N % Xh".
**Critério de aceite:**
- `xpBonus { percent, expiresAtMs }` em `player-stats`; a XP creditada usa o multiplicador até o
  instante lógico do vencimento (teste desanexado).
- A pill mostra o percentual somado e o tempo do bônus que vence primeiro; some sem bônus.

### TP-05 · Pills de buff e status do canto
**Objetivo:** a pill de buff mostra o nome da magia ou item que a criou; o status vira
"● 42 ms · 60 fps".
**Critério de aceite:**
- `active-conditions` leva `sourceName`; as pills mostram esse nome com o tempo restante.
- O canto mostra só ms e fps; a cor do ponto é o estado da conexão e a palavra fica no tooltip.

### TP-06 · Comprar gold
**Objetivo:** o "+" da pill de gold abre a aba "Comprar gold" da Loja — livro de ordens gemas ↔
gold sem taxa, com o ledger dos dois lados.
**Critério de aceite:**
- Ordem de compra e de venda casam pelo preço; cada casamento gera lançamentos idempotentes de
  gold (ledger da sessão) e de gemas (movimentos da conta); sem taxa.
- Aba igual à captura 33; o "+" abre nela. Pode escorregar para depois do marco sem quebrar o
  resto.

### TP-07 · Configurações
**Objetivo:** endpoint de preferências da conta e o modal do kit com o que tem consumidor hoje;
ícone no topo.
**Critério de aceite:**
- Preferências persistidas na conta e aplicadas ao entrar (nomes, barras e texto de dano no
  viewport; som só se existir); o toggle PT/EN não entra.
- Modal igual à captura 31 no que existe; ícone de Configurações no topo.

### TP-08 · Documentação de produto do M22
**Objetivo:** `docs/product` descreve gemas, Loja, bênção, boost e preferências.
**Critério de aceite:**
- `monetization.md`, `death.md`, `settings.md` e `future-systems.md` atualizados; `docs-check`
  verde.

---

## Depois

Guild (E12) e Prey (E7) são os dois ícones que ainda faltam no topo — cada um nasce de um PRD do
dono e de um marco próprio, e o ícone aparece com o sistema. A regeneração base por vocação (e
comida) é assunto de um plano à parte.
