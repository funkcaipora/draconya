# O HUD como contrato — plano de execução (pós-M17)

**Status:** aprovado em 2026-09-18 — a decisão de arquitetura é o
[ADR 0032](adr/0032-the-rendered-hud-is-the-game-contract.md); este documento é o inventário do
que falta e o desenho dos marcos. Substitui o §4/M18, o §3 (P1–P5) e o §3b ("decisões permanentes
contra o kit") de [kit-fidelity-plan.md](kit-fidelity-plan.md), que passa a ser o registro
histórico do M16, do M17 e do M15 revisado.
**Diretriz do dono (2026-09-18):** "Faça um plano para deixarmos a interface exatamente como na
imagem (principalmente a barra de ações inferior e os menus laterais). Isso muda as ADRs do bot
etc.; desconsidere tudo que foi decidido e vamos decidir com base na imagem."
**A imagem:** [kit-reference/10-hud-hunt.png](kit-reference/10-hud-hunt.png) — o HUD de caçada do
kit renderizado (composição `GameScreen` de `App.jsx`). As capturas 34–38 (barra e automações),
25 (Despachar loot), 32–33 (Loja) e 31 (Configurações) são a régua dos modais que este plano toca.
**Especificação funcional da barra:** [prd-ui-behavior.md](prd-ui-behavior.md) (RG-*, UC-*,
RP-*) — continua valendo onde não contradiz o ADR 0032 (o ADR vence).
**Evidência:** [reviews/hud-parity-audit-2026-09-18.md](reviews/hud-parity-audit-2026-09-18.md) —
a captura do HUD atual (commit `700ec7e`) e os três levantamentos (cliente por região, modelo de
jogo por sistema, decisões vigentes) que fundamentam cada linha abaixo.

---

## 1. O que já foi entregue e o que está em aberto

### 1.1 Marcos

| Marco | Nº | Estado em 2026-09-18 | O que trouxe para a imagem |
|---|---|---|---|
| M14 · Design system — fundação | 4 | fechado (19/19) | Tokens, primitivos, entrada, casca de duas colunas |
| M16 · Fidelidade ao kit — pura | 6 | fechado (14/14, PR #364) | CSS e geometria do kit em tudo que já existia |
| M17 · Recomposição do HUD | 7 | fechado (15/15, PRs #365–#380) | Janela flutuante, Analisador e Party loot flutuantes, modais Personagem/Cyclopedia/Party/Hunts/Detalhes, ordem dos ícones, overlays do mundo, arcos de vida/mana, painel Skills com Personalizar |
| M15 · O servidor conta mais (revisado) | 5 | fechado (26/26, PR #366) | Skills com %, speed, stamina, players online, alvo atual, condições ativas, gasto por membro, expulsar, anéis + Ring swap, dois eixos de custo/loot, saída em 5 s |
| M19 · Combate Tibia | 9 | fechado (10/10, PR #412) | Tipos de dano, defesa/escudo/shielding, famílias de arma, condições e campos, crítico/leech/mana shield, perfil `combat-v1` (ADR 0031) |
| M18 · Motor de ações e automações | 8 | **aberto, só a issue-portão #362** — redesenhado aqui | Nada ainda: é o marco da barra e das Automações |
| M20 · Party e VIP | 11 | aberto (18 issues, PR #409 com o ADR em rascunho) | Toggles do líder em tempo de hunt, 8 membros, Amigos — converge com a imagem; falta DPS/HPS e o "sim de todos" |
| M16 · Mundo espacial (nº 10) | 10 | aberto (9 issues) | Ortogonal: render do mundo, câmera e andares |

### 1.2 O HUD de hoje contra a imagem, região a região

Status: **existe** (bate), **parcial** (peça está lá, falta dado ou comportamento), **ausente**.
A coluna "Decisão" aponta o item do ADR 0032; "Marco" é onde a lacuna fecha.

**Topo**

| Elemento da imagem | Hoje | Decisão | Marco |
|---|---|---|---|
| Retrato · nome · "VOCAÇÃO · LV n" | existe | — | — |
| Pill de gold "2.134.760 (+)" | parcial — saldo sem o "+" | 11, 16 | M22 |
| Pill "120" com gema | ausente (`account.coins` inerte) | 16 | M22 |
| Botão LOJA | ausente | 16 | M22 |
| "DRACONYA · N players online" | existe | — | — |
| Ícones: Personagem, Hunts, Analisador, Cyclopedia, Chat | existem (5 de 9) | — | — |
| Ícones: Amigos, Configurações, Guild, Prey | ausentes | 16 | M20 (Amigos), M22 (Configurações), E12/E7 depois |

**Coluna esquerda**

| Elemento da imagem | Hoje | Decisão | Marco |
|---|---|---|---|
| SKILLS: Experiência, HP, Mana, Capacidade, Speed, Stamina, Magic Level | existem | — | — |
| Level com barra de progresso | parcial — sem barra (curva de XP não trafega) | 13 | M21 |
| Soul Points | ausente (mecânica inexistente) | 13 | M21 |
| Sword Fighting · Shielding (por família) | parcial — "Corpo a Corpo" genérico e "Distância"; `shielding` existe no `sim` (CMB-04) e não aparece | 13 | M21 |
| AUTOMAÇÕES (5 linhas com toggle · nome · resumo · ⚙ · ×) e "+ Adicionar" | **ausente** — o painel é o `BotPanel` v1 (categorias Cura/Poções/Ataque/Runas/Suporte, "Lure e alvo", "Configurações avançadas · Ring swap") | 1, 9 | M18 |
| PARTY · N, membros com vocação/LV, barras HP/MP, Gasto, gasto médio, sua parte, ×, Sair da party | existem (SV-03/18/22, M17) | — | — |
| Sigla de vocação de duas letras (EK/RP/ED/MS) | parcial — primeira letra só | 14 | M20 |
| DPS · HPS por membro | ausente (mecânica inexistente) | 14 | M20 |
| Toggles "Rateio de custos"/"Dividir loot" editáveis | parcial — só texto do modo | 14 | M20 (#394/#405) |
| "Parar no meio da caçada exige o sim de todos" | texto existe, mecanismo não | 14 | M20 |

**Mundo**

| Elemento da imagem | Hoje | Decisão | Marco |
|---|---|---|---|
| "COVIL DOS DRAGÕES · OUSADO / N criaturas no alcance" | existe | — | — |
| Nome e barra das criaturas; arcos de HP/MP do jogador | existem | — | — |
| Moldura vermelha no alvo (no mundo) | ausente — só na lista de Batalha | 15 | M18 |
| Pills de buff com nome e tempo | parcial — nomes descritivos ("Cura contínua", "Escudo mágico") | 15 | M22 |
| Pill "EXP +64% 18h" | ausente (nenhum bônus temporário existe) | 16 | M22 |
| Pill "Bênção ativa" | ausente | 16 | M22 |
| ⓘ Detalhes da caçada · Sair da caçada » + legenda | existem; legenda ao lado, não acima | — | M18 (a fileira de 124 px sobe as pills para `bottom:130`) |
| Despachar loot » | ausente (loot não chega à mochila) | 12 | M21 |
| "● 42 ms · 60 fps" | parcial — "conectado · N ms · N fps" | 15 | M22 |

**Barra de ações (rodapé)**

| Elemento da imagem | Hoje | Decisão | Marco |
|---|---|---|---|
| Fileira de 124 px; "AÇÕES" · "Salva automaticamente" | **ausente** — o mundo vai até o rodapé | 1 | M18 |
| 2 × 12 slots com rótulo, tecla, elemento, contagem, cooldown | ausente (o primitivo `Slot` de 36 px existe) | 1–3, 6 | M18 |
| CONJUNTO [Energia ▾] | ausente | 4 | M18 |
| ALVO [Seguir Dragon Lord ▾] | ausente — política existe no modal de lure/alvo | 5 | M18 |
| ⌖ LURE · FOLLOW + "mín 4 · máx 8 / seguir alvo" | parcial — botão na coluna esquerda, modal pronto (SV-09), tudo travado abaixo do level 50 | 5 | M18 |
| Tecla dispara a ação | ausente (sem `use-slot`) | 3 | M18 |

**Coluna direita**

| Elemento da imagem | Hoje | Decisão | Marco |
|---|---|---|---|
| Barras HP/MP com "valor / máximo" | existem | — | — |
| Grade de equipamento 3 × 4 com os 10 slots | existe (bate com `ITEM_SLOTS`) | — | — |
| Munição: seleção por família no slot do Escudo | existe — `AmmoPicker`, preço por tiro e level gate | 7 | M18 |
| "CAP 612 / 3.715 oz" | existe (formatação) | — | M21 (CO-07) |
| Postura Defensiva/Balanceada/Atacante | **ausente** (nem o primitivo desabilitado foi montado) | 10 | M21 |
| BOLSA: GOLD · PLAT · GEM | ausente — grade genérica vazia | 11 | M21 |
| MOCHILA: itens com rótulo e contagem | parcial — sprites sem rótulo; a contagem vale para o que empilha (loot) | 6, 7 | M18 |
| BATALHA · N com %, barra e alvo | existe; ícone da criatura é um quadrado vazio | 15 | M18 (clique escolhe o alvo) |

**O que existe hoje e não está na imagem** (sai quando o substituto entrar): o `BotPanel` com as
cinco categorias, o `RuleEditor`, o botão "⌖ Lure e alvo", a seção "Configurações avançadas" e a
trava "Bot avançado a partir do level 50" da coluna esquerda; a Caixa de Loot em Redis (FUN-88); a
skill `melee` única.

---

## 2. As decisões, em uma linha cada (ADR 0032)

| # | Decisão | Substitui |
|---|---|---|
| 0 | A imagem é o contrato do jogo: fonte que não existe é construída; "omitido" é transitório com issue | ADR 0030 d.5; kit-fidelity-plan §3b |
| 1 | Barra = configuração do bot E disparo manual; 24 slots; categorias v1 saem; v1 → v2 migrado | ADR 0002 (forma), ADR 0026 (categorias) |
| 2 | Prioridade = ordem do slot; cooldown = grupo do conteúdo; pula o inelegível; +condição `condition` | #362 (grupo livre por slot) |
| 3 | A tecla dispara agora (`use-slot`); Shift+clique só desliga o automático | ADR 0030 d.2 ("fase E10") |
| 4 | Conjunto = 4 loadouts com nomes fixos (Energia/Fogo/Gelo/Sagrado) | — |
| 5 | ALVO = seguir / mais próximo / menor HP (`select-target`); ⌖ abre o modal SV-09; sem trava de level — tudo desde o level 1 | `advancedFromLevel` (FUN-87) |
| 6 | P1 = SIM: suprimento é abstrato; o gold sai no uso (`useSupply`), sem pilha nem lote | ADR 0026 d.8, economy §20.1 |
| 7 | P4 = SIM: munição é abstrata, escolhida por família (`select-ammo`); o gold sai no tiro | ADR 0026 d.3 |
| 8 | Anel gasta por tempo, colar por carga; o `sim` consome e destrói | campos mortos `charges`/`durationMs` |
| 9 | Cinco automações de catálogo, entrada OU / saída E; comida e "Comer comida" ficam para o plano de regeneração | ADR 0030/#362 |
| 10 | Postura = fight mode do TFS, perfil `combat-v2`, default Balanceada | ADR 0030 d.4, ADR 0031 (adiamento) |
| 11 | Bolsa = moedas físicas (1/100/10 000); topo = saldo no ledger | ADR 0030 d.6 |
| 12 | Loot cai na mochila; Despachar loot vende pelo ledger; cheio despacha sozinho | Caixa de Loot (FUN-88) |
| 13 | Skills por família; Soul Points (conjuração de munição); barra do Level | ADR 0026 d.4; kit-fidelity-plan §3b |
| 14 | DPS/HPS 60 s; toggles do líder em hunt; encerrar para todos exige o sim de todos | ADR 0027 (via M20) |
| 15 | Pill de buff com nome da fonte; moldura do alvo no mundo; "● ms · fps" | — |
| 16 | EXP +N% Xh, bênção, gemas, Loja, ícones cada um com o seu sistema | — |

---

## 3. Milestones

Os ids abaixo (AB-, CO-, PT-, TP-) têm objetivo e critério de aceite em
[hud-contract-tasks.md](hud-contract-tasks.md) — é de lá que o `/spec` parte, uma issue por tarefa,
com a spec completa no corpo (o executor não tem este documento nem o kit: a spec cola o JSX e o
"antes"); os números do GitHub entram na tabela do §4 quando forem criadas. Cada issue cita
"ADR 0032 decisão n".

### M18 · Barra de ações, suprimento e automações (milestone [8](https://github.com/funkcaipora/draconya/milestone/8), redesenhado)

O marco da coluna esquerda e do rodapé. A #362 fecha pelo ADR 0032 (P1/P4 confirmadas pela
diretriz; vocabulário v2 nas decisões 1–3 e 9). Ordem: a onda 0 é servidor e roda em cadeia
empilhada; a onda 1 é cliente e parte do fim da onda 0.

| Id | Issue | Camadas | Depende de | Notas |
|---|---|---|---|---|
| AB-01 | Suprimentos abstratos: poção e runa em `supplies/` (`price`, `effect`, `requires`, `group`); `blessing-charge` segue o único item `consumable`, não-empilhável; baseline por vocação | content | — | Decisão 6. Os números (preço) vêm da referência (ADR 0019) e ficam em `content` |
| AB-02 | Munição abstrata, colar e escudo: `arrow`/`burst-arrow`/`sniper-arrow`/`onyx-arrow` em `ammunition/` com família, `attack`, `price` e `requires.level`; o primeiro colar por carga; o primeiro escudo real | content | AB-01 | Decisões 7 e 8 |
| AB-03 | Vocabulário v2 do bot: `sets[4]` × `slots[24]` (`do`, `when[]` em E, `hotkey`, `auto`), `activeSet`, `automations[]` (seis modelos, `enter[]` OU, `exit[]` E, parâmetros), `stance`, `BOT_VOCABULARY_VERSION = 2`; `advancedFromLevel`/`advancedOnly` saem (sem trava de level em nada); função pura `migrateBotConfigV1` (categorias → conjunto 1, ordem cura→poções→ataque→runas→suporte, teclas em sequência) | content | AB-01, AB-02 | Decisões 1, 2, 4, 5, 9. A migração é testada com toda baseline v1 do repositório |
| AB-04 | Gold no uso: `useSupply` debita o `price` do saldo no ato e soma `goldSpent`; "acabar o gold" continua a regra de saída | sim, server | AB-01, AB-03 | Decisão 6. O débito é evento, não tick (invariante 2) |
| AB-05 | Munição por família: opcode 14 `select-ammo` restaurado, `requires.level` validado no servidor, `player-stats.ammo { arrow, bolt }`; cada tiro debita o `price`; sem munição paga o tiro não sai | sim, protocol, server | AB-02, AB-04 | Decisão 7 |
| AB-06 | Cargas e duração: anel vence por tempo equipado (evento na fila), colar por carga consumida no bloqueio elemental; item destruído ao esgotar; evento S2C de inventário como hoje | sim | AB-02 | Decisão 8 |
| AB-07 | Motor de slots v2: avaliação por grupo de cooldown do conteúdo, ordem do slot, condições em E, pula o inelegível no mesmo ciclo, condição `condition` (efeito ativo/ausente); motivo de bloqueio por slot exposto; o motor v1 por categoria sai | sim | AB-03, AB-04 | Decisão 2. Substitui `select()`/`#onBot` por categoria |
| AB-08 | Automações v2: os cinco modelos com entrada OU / saída E; atuadores de equipar/desequipar/trocar munição no `sim` (o bot não usa os opcodes do jogador); `swap-ring` absorve o `ringSwap` atual | sim, content | AB-05, AB-06, AB-07 | Decisão 9. Comida e "Comer comida" ficam para o plano de regeneração |
| AB-09 | Protocolo e servidor: C2S `use-slot { set, slot }`, `select-target { creatureId }` e `select-ammo { ammoId }`; S2C `slot-state` (por slot: pronto/cooldown restante/bloqueado por quê), `slot-result` (recusa com motivo) e `player-stats.ammo`; `catalogue` v2 (suprimentos, munição, grupos, teclas válidas, modelos de automação); gate de versão + migração v1 → v2 ao carregar (caminho do ADR 0028) | protocol, server | AB-03, AB-07 | Decisões 3 e 5. Campos novos opcionais com default |
| AB-10 | `ActionBar`: a fileira de 124 px volta (`grid-template-rows: minmax(0,1fr) 124px`), 2 × 12 `Slot` de 36 px com rótulo/tecla/elemento/cooldown, "AÇÕES" · "Salva automaticamente", CONJUNTO e ALVO (`Select inline`), ⌖ Lure·Follow com a legenda (sem trava de level: o estado "LV 50+" do kit não existe); montada na Cidade e na caçada; teclado → `use-slot`; Shift+clique → `auto: false`; as pills de caçada sobem para `bottom:130` e a legenda de saída fica acima, centralizada | client | AB-09 | Decisões 1–5. Régua: captura 10; JSX de `ActionBar` em `Hud.jsx:71-84` |
| AB-11 | `ActionConfigModal` (captura 34): ação por catálogo (magia ou suprimento), condições em E (`ConditionList`), tecla, chave automática | client | AB-10 | Decisão 3, 6. `NumField` = `Input` numérico pequeno (ADR 0029 D2) |
| AB-12 | `AutomationsPanel` + `AddAutomationModal` + `AutomationConfigModal` (capturas 35–38): lista toggle · nome · resumo · ⚙ · ×, "+ Adicionar" com o catálogo, entrada OU / saída E, montado na Cidade e na caçada; aposenta `BotPanel`, `RuleEditor`, o botão "Lure e alvo" e "Configurações avançadas" | client | AB-10 | Decisão 9. Régua: JSX `AutomationsPanel` em `Hud.jsx:39-47` |
| AB-13 | Coluna direita e alvo: `AmmoPicker` sobre o Escudo com bow/crossbow (preço por tiro e level gate; sem pilha), Mochila com rótulo curto + contagem quando o item tem `shortLabel` (o `Slot` já suporta `label`/`count`), clique na Batalha e no mundo → `select-target`, moldura vermelha no alvo sobre a criatura | client | AB-09 | Decisões 7, 15 |
| AB-14 | `docs/product` em dia: `bot.md` (v2 inteiro), `items.md` (suprimento abstrato, munição, cargas), `economy.md` (§20.1, gold no uso), `hunt.md`; `packages/*/AGENTS.md` onde a fronteira mudou | docs | AB-13 | Fecha o marco |

**Pronto quando:** um cavaleiro vê a barra, aperta a tecla e a magia sai,
muda de conjunto, liga "Trocar arma/escudo por vida" e o servidor troca; o gold acaba, o bot para
de pagar poção e tiro e, com a regra ligada, sai da hunt; o painel Bot antigo não existe mais e
nenhuma configuração salva se perdeu.

### M21 · Postura, moedas, loot e skills (milestone [12](https://github.com/funkcaipora/draconya/milestone/12))

| Id | Issue | Camadas | Depende de | Notas |
|---|---|---|---|---|
| CO-01 | Postura: `stance` no personagem (persistida com a configuração de combate), C2S `set-stance`, fatores do TFS em `resolveDamage`/defesa, perfil `combat-v2` com teste de conformidade (ADR 0031); `Stance` do set ligado, default Balanceada | content, sim, protocol, server, client | AB-09 (a config v2 carrega `stance`) | Decisão 10 |
| CO-02 | Moedas físicas: `gold-coin`/`platinum-coin`/`crystal-coin` como itens (rótulos GOLD/PLAT/GEM), loot deposita na bolsa com troca automática 100→1, crédito no ledger ao sair e ao despachar; a bolsa da party continua | content, sim, server | AB-01 | Decisão 11 |
| CO-03 | Loot na mochila e Despachar loot: o drop entra na mochila limitado pela capacidade; C2S `dispatch-loot` vende ao `value` pelo ledger (party: `shareLoot`); capacidade cheia despacha sozinho; a Caixa de Loot em Redis sai | sim, protocol, server | CO-02 | Decisão 12 |
| CO-04 | Cliente: Bolsa GOLD/PLAT/GEM, pill "Despachar loot »" + modal (captura 25), topo = saldo | client | CO-03 | Régua: `BagPanel` em `Hud.jsx:67-70`, `DispatchLootModal` |
| CO-05 | Skills por família: `fist`/`club`/`sword`/`axe`/`distance`/`shielding`/`magic` no conteúdo e no `sim` (a família da arma equipada treina a sua); migração copia `melee` para as três; `player-stats.skills` já é `Record` | content, sim, server | — | Decisão 13. ADR 0026 d.4 sai |
| CO-06 | Soul Points: `soul`/`maxSoul` no personagem, regeneração por evento (240 s; 120 s Premium), magia com custo `soul`; a conjuração de munição do paladino é o primeiro consumidor | content, sim, protocol | AB-05 | Decisão 13 |
| CO-07 | Protocolo e painel Skills: `xpPercentToNext` em `player-stats`, barra do Level, 11 linhas default (`exp, level, hp, mp, soul, cap, speed, stamina, ml, sword, shield`), Personalizar com as 15 skills reais, "CAP" com separador de milhar | protocol, server, client | CO-05, CO-06 | Régua: captura 10 e 39 |
| CO-08 | `docs/product` em dia: `combat.md` (postura, `combat-v2`), `economy.md` (moedas, venda), `items.md` (loot na mochila), `progression.md` (famílias, soul), `death.md` (bolsa preservada) | docs | CO-07 | Fecha o marco |

**Pronto quando:** um cavaleiro troca de postura e o dano/defesa mudam pelo fator do perfil; o
loot cai na mochila, a bolsa mostra GOLD/PLAT/GEM trocados automaticamente e "Despachar loot"
vira uma linha do ledger; o painel Skills mostra Sword Fighting e Shielding subindo separados,
Soul Points regenerando e o Level com barra.

### M20 · Party e VIP (milestone [11](https://github.com/funkcaipora/draconya/milestone/11), existente) — o que este plano acrescenta

O M20 já cobre os dois interruptores do líder em tempo de hunt (#394, #405), Amigos (#403, #404)
e 8 membros (#392). Este plano **não repete** nada disso; acrescenta duas issues e uma correção:

| Id | Issue | Camadas | Depende de | Notas |
|---|---|---|---|---|
| PT-01 | DPS/HPS por membro: acumulador por evento de dano causado e cura feita (carimbo lógico, janela de 60 s aparada na leitura) + totais da sessão; em `party-state.members[]` e no analisador; a linha "DPS · HPS" do painel e a sigla de duas letras por vocação | sim, protocol, server, client | M19 (eventos de dano) | Decisão 14. Régua: `PartyPanel` em `Hud.jsx:155-173` |
| PT-02 | Encerrar para todos exige o sim de todos: proposta do líder, aprovação por membro em 60 s, encerramento com settlement; sair sozinho continua livre; a nota do painel passa a ser verdade | sim, protocol, server, client | #394 | Decisão 14 |
| — | A PR #409 renumera o ADR de Party v2 para **0033** (0031 é combate, 0032 é este plano) e cita a decisão 14 do 0032 para DPS/HPS e o "sim de todos" | docs | — | Correção, não issue nova |

### M22 · Topo e mundo — Loja, bênção, boost e status (milestone [13](https://github.com/funkcaipora/draconya/milestone/13))

| Id | Issue | Camadas | Depende de | Notas |
|---|---|---|---|---|
| TP-01 | Gemas: `account.coins` lida e escrita pelo `api` com lançamento próprio (tabela de movimentos da conta), levada em `session-state`; pill "120 ◆" no topo | server, protocol, client | — | Decisão 16. Nenhuma compra com dinheiro real neste plano — o saldo nasce por crédito administrativo |
| TP-02 | Loja: catálogo `content/store` (boost de EXP 24 h, carga de bênção, Premium 30 d), `POST /api/store/buy` debitando gemas e entregando (item na mochila / atributo na conta), `ShopModal` (capturas 32–33) e o botão LOJA | content, server, protocol, client | TP-01, AB-01 | Decisão 16. A aba "Comprar gold" entra na TP-06 |
| TP-03 | Bênção: `blessed` no personagem, o slot BENÇÃO consome a carga (item da AB-01), a morte consome `blessed` e reduz a penalidade de XP por `blessing.lossFactor` do conteúdo; pill "Bênção ativa" | content, sim, protocol, client | TP-02, AB-08 | Decisão 16 |
| TP-04 | Boost de EXP: multiplicador temporário com vencimento na fila (invariante 2), somado ao bestiário; `xpBonus { percent, expiresAtMs }` em `player-stats`; pill "EXP +N% Xh" | content, sim, protocol, client | TP-02 | Decisão 16. Prey (E7) entra na mesma soma quando existir |
| TP-05 | Mundo: pill de buff com o nome da fonte (`active-conditions.sourceName`), "● 42 ms · 60 fps" sem a palavra "conectado" (tooltip) | protocol, client | — | Decisão 15 |
| TP-06 | "+" do gold → aba "Comprar gold" da Loja: livro de ordens gemas ↔ gold sem taxa (E13), com o ledger dos dois lados | server, protocol, client | TP-02 | Decisão 16. Pode escorregar para depois do marco sem quebrar o resto |
| TP-07 | Configurações: endpoint de preferências da conta e o modal (captura 31) com o que tem consumidor hoje (nomes/barras/texto de dano no viewport, som quando existir); ícone no topo | server, client | — | Decisão 16. i18n continua fora |
| TP-08 | `docs/product` em dia: `monetization.md` (gemas, Loja, boost, bênção), `death.md` (bênção), `settings.md`, `future-systems.md` (o que saiu de lá) | docs | TP-07 | Fecha o marco |

**Depois do M22:** Guild (E12) e Prey (E7) são os dois ícones que ainda faltam no topo — cada um
nasce de um PRD do dono e de um marco próprio; o ícone aparece com o sistema.

---

## 4. Ordem, dependências e números

```
M18 onda 0 (servidor, cadeia empilhada):  AB-01 → AB-02 → AB-03 → AB-04 → AB-05 → AB-06 → AB-07 → AB-08 → AB-09
M18 onda 1 (cliente, a partir da AB-09):  AB-10 → AB-11 → AB-12 → AB-13 → AB-14
M21 (a partir da AB-09; CO-05 pode começar antes):  CO-05 ‖ CO-01 → CO-02 → CO-03 → CO-04 ; CO-06 → CO-07 → CO-08
M20 (existente, em paralelo ao M21):  PT-01 ‖ PT-02 (depois da #394)
M22 (a partir da AB-08 e do M21):  TP-01 → TP-02 → TP-03 ‖ TP-04 ; TP-05 ‖ TP-07 ; TP-06 por último → TP-08
```

- Nada do M21/M22 abre antes da AB-09: tudo depende do vocabulário v2 e dos suprimentos
  abstratos.
- CO-05 (skills por família) e TP-05/TP-07 não dependem de nada e servem para ocupar a fila
  enquanto a onda 0 do M18 roda.
- As migrações de dado (bot v1 → v2, `melee` → famílias, loot da Caixa em Redis
  descartado com aviso no log) são idempotentes e testadas com as baselines do repositório;
  rodam ao carregar o personagem, nunca em job separado.
- Toda issue segue o padrão de execução do M14–M17: subagente em worktree própria, spec completa
  no corpo, `pnpm check` antes da PR, revisão adversarial, captura de tela como revisão humana do
  orquestrador contra `kit-reference/10-hud-hunt.png`.

| Marco | Ids | Issues no GitHub |
|---|---|---|
| M18 (8) | AB-01…AB-14 | a criar via `/spec` |
| M21 (12) | CO-01…CO-08 | a criar via `/spec` |
| M20 (11) | PT-01, PT-02 | a criar via `/spec` |
| M22 (13) | TP-01…TP-08 | a criar via `/spec` |

---

## 5. Verificação

- **Por issue:** `pnpm check` verde; conformidade de combate (`combat-v2` na CO-01) com a matriz
  do M19; testes de ledger para o débito do supply e do tiro, venda de loot e crédito da bolsa
  (retry não
  duplica); teste da migração v1 → v2 com todas as baselines; `prerender` das telas novas.
- **Por marco:** a captura do HUD atual refeita (procedimento em
  `reviews/hud-parity-audit-2026-09-18.md` §0) e comparada lado a lado com
  `kit-reference/10-hud-hunt.png` — revisão humana do orquestrador, nunca do executor.
- **Do plano:** o "pronto quando" de cada marco, com um personagem de cada vocação numa hunt com
  o navegador fechado por uma hora: o gold cai e o consumo para, o ledger tem os débitos, a
  configuração
  v1 de antes da virada continua funcionando.

## 6. Riscos

- **A economia mantém o débito por uso.** O custo por hora de toda hunt fica exposto a cada poção
  e a cada tiro (`goldSpent` no ato), sem estoque que amortize. Os
  números são do conteúdo e podem ser recalibrados sem ADR, mas a primeira semana vai precisar de
  `huntera-observed.md` §4–§5 e do analisador para achar o ponto.
- **Duas migrações de personagem no mesmo marco** (bot v1 → v2 e `melee` → famílias). Ambas
  puras, idempotentes e cobertas por teste — mas o dia da virada precisa de backup (#224) antes.
- **Perfil `combat-v2`** reabre a conformidade do M19: qualquer diferença de arredondamento na
  postura Balanceada (dano ÷ 1,2) aparece na matriz. É o preço de a postura funcionar.
- **O E13 entra antes do previsto** (gemas, Loja, bênção, boost). O plano recorta o mínimo que a
  imagem mostra e deixa o livro de ordens (TP-06) por último, escorregável.
- **Três reivindicações do número ADR 0031** (combate, na `main`; PR #409; issue #385). Este plano
  toma o 0032; a PR #409 renumera para 0033; a #385 usa o próximo livre na hora — o
  `docs-check` recusa buraco e duplicata, então a colisão não passa do PR.
