# Fidelidade ao ui_kit — plano de execução (pós-M14)

**Status:** executado até o M17 (M16, M17 e M15 revisado fechados em 2026-09-17/18). Em 2026-09-18 o dono pediu a imagem exatamente — o §4/M18, o §3 (P1–P5) e o §3b ("decisões permanentes contra o kit") foram substituídos pelo [ADR 0032](adr/0032-the-rendered-hud-is-the-game-contract.md) e por [hud-contract-plan.md](hud-contract-plan.md); o resto é registro histórico. A decisão de arquitetura original é o [ADR 0030](adr/0030-strict-fidelity-to-the-rendered-ui-kit.md);
este documento é o desenho e o inventário. Substitui o §5/M15 e o §8 (Adiado) de
[design-system-plan.md](design-system-plan.md) no que conflitarem — aquele plano continua sendo o
registro do M14.
**Diretriz do dono (2026-09-16):** "siga o ui_kit na risca, tudo deve ficar exatamente como no
kit. Refaça as decisões e ADRs que forem necessárias."
**Especificação funcional:** [prd-ui-behavior.md](prd-ui-behavior.md) (PRD de comportamento v2 do
dono, 2026-09-14) — regras RG-*, casos UC-*, prioridade RP-* e cooldown compartilhado.
**Evidência:** [reviews/kit-fidelity-audit-2026-09-16.md](reviews/kit-fidelity-audit-2026-09-16.md)
— auditoria de 24 agentes (9 regiões, verificação adversarial, 148 achados confirmados, nenhum
refutado), sobre o cliente no commit `3299eb5`. Os ids `R0-01`…`R8-26` citados abaixo apontam
para lá, cada um com evidência arquivo:linha dos dois lados.
**Referência visual:** [kit-reference/](kit-reference/README.md) — o kit RENDERIZADO, capturado
tela a tela (27 PNGs: entrada, HUD em caçada e na Cidade, popover de saída e os 19 modais do kit
v3, incluindo as duas abas da Loja/leilão e os três formatos do modal de automação). É a régua de
toda issue deste plano: quem executa não tem o zip — tem estas capturas, o JSX colado na spec e o
achado da auditoria.

---

## 1. O que "na risca" significa

**Vale o que o kit RENDERIZA** — a composição de `ui_kits/draconya/App.jsx` mais as telas de
`Entry.jsx`, exatamente como o `index.html` do handoff mostra. É a tela que o dono aprovou.

**Não é especificação:**

- **Código morto do kit.** `BotPanel`, `RuleRow` e `RuleEditorModal` do kit nunca são montados —
  nenhum clique os alcança; a coluna esquerda renderizada é Skills + Automações + Party. O painel
  de bot do cliente atual não tem contrapartida na tela do kit (e nem por isso é jogado fora — ver
  M18).
- **Hacks de protótipo.** `transform: scale` do wrapper 1800×1010 (D3 do 0029 continua: pixel art
  borra e `@media` morre), o arraste por `mousemove`+`window.__drScale` (o COMPORTAMENTO arrastável
  entra; a implementação não), `localStorage dr.screen`, credenciais de demonstração
  (`aldric@draconya.gg`/`dragonfire`), o rodapé "v0.1 · design system" e o realm "Ignis" (o jogo
  não tem mundos).
- **Dados de mentira.** Nenhum número de `data.js` vira constante — todo dado vem do protocolo,
  como sempre (invariante 4, D8).
- **Controles que o próprio kit deixou inertes** valem como desenho, não como promessa: a Tabs
  Caçadas/Treino/Quests/Arena/Bosses não tem `onChange` nem no kit; o select ALVO da barra está
  fixo; o Pager da Cyclopedia mostra 9 páginas fixas. Cada um entra quando o sistema por trás
  existir (D8 emendado — sequenciar, nunca botão "em breve").

**Quando o kit se contradiz, vence o desenhado na tela renderizada** — a mesma regra do plano do
M14 (§1). Contradições catalogadas pela auditoria, com o lado que vence:

| Contradição interna do kit | Vence |
|---|---|
| HP 3.165 (coluna) vs 3.065 (CharacterModal); Cap "612/3.715 oz" vs "52 oz"; ML 5 (64 %) vs 99; Stamina "41:40" vs "42h 00m" | Irrelevante — o dado real substitui os dois; o FORMATO segue a coluna (`data.js`-driven), não o literal do modal |
| Duas listas de regras de saída (`DR.exitRules` com 4 itens vs `DR.bot.exit` com 3) | `DR.exitRules` — é a do popover alcançável |
| Slot da bolsa da party: 30 px (PartyLootWindow renderizada) vs 38 px (PartyModal) | 30 px; a união `26\|30\|36` do `Slot` não cresce |
| Dois formatos de analisador (`analyzer.rows` embutindo /h vs `analyzerLive` com caixas separadas) | `analyzerLive` — é o renderizado |
| Tokens vs tela (topo 56 vs 65, barra 104 vs 124, trilho colorido vs neutro dos vitais) | A tela (65 / 124 / trilho neutro) — regra já fixada no M14 |
| Barra de ações a `bottom:130` pressupõe a fileira de 124 px | Os dois voltam juntos (M18) — até lá as pills ficam a 24 px do rodapé como hoje |

**Os cinco modais que faltavam foram entregues no kit v3** (`Medieval3.zip`, 2026-09-16, ainda no
mesmo dia): o `Modals.jsx` cresceu 54 linhas — só adições, nada existente mudou — definindo
`ActionConfigModal`, `AutomationConfigModal`, `AddAutomationModal`, `SkillsCustomizeModal`,
`AnalyzerModal` e os helpers `ConditionRow`/`ConditionList`. O que eles fixam de novo: as condições
da barra são as QUATRO de hoje (HP %, Mana %, Nº de alvos, HP do alvo %) combinadas em **E**;
atalhos F1–F12 por slot; switch "automática" por ação com o rodapé **"A ação dispara sozinha
enquanto ligada · o atalho continua manual"** (a fase manual do E10, dita pelo próprio kit); as
automações têm condições de entrada em **OU** e de saída em **E**, aviso de faixa morta, e
"Renovar" declara **"Pega o próximo da mochila principal"** (pressupõe a decisão P1 do §3); o
`AddAutomationModal` lista uma SEXTA automação, **"Comer comida"** (sem lastro no PRD de
comportamento e sem mecânica de fome no `sim` — o dono confirma na spec); o `AnalyzerModal`
expandido usa `analyzer.rows` (Tempo, XP, Gold, Gastos, Saldo, Mortos, Loot, Supplies, maiores
golpes, com /h na terceira coluna) — **tudo dado que já trafega hoje**. Sobra do protótipo: o
`NumField` CONTINUA indefinido (quebra Lure, Ring swap e a automação de arrow — a leitura do M14
vale: `Input` pequeno numérico), e o `App.jsx` passa `{i, a}` a um `ActionConfigModal` que espera
`{index, label}` (o título mostra "slot NaN" — bug de fiação do protótipo, não desenho).

---

## 2. As decisões revisadas (ADR 0030)

| | ADR 0029 dizia | Agora (ADR 0030) |
|---|---|---|
| D1 | Tokens same-origin | **Mantida**, com o limite corrigido: same-origin é sobre ORIGEM, não forma — os gradientes literais do kit voltam (vitais, R0-08), e os pesos reais das fontes entram (R0-03/R0-13) |
| D2 | Primitivos `.tsx`; `Stance` fora | **Emendada**: `Stance` entra como primitivo; o controle aparece no set DESABILITADO até a mecânica existir (E2) |
| D3 | Mundo em tela cheia, chrome sobreposto, sem `transform: scale` | **Mantida** na mecânica; a fileira inferior de 124 px volta JUNTO com a barra de ações (M18), e o mundo ganha os overlays do kit (área, buffs, latência+fps, arcos do próprio jogador) |
| D4 | Vidro ferro-forjado, pedra aposentada | **Mantida** |
| D5 | Chat flutuante; barra de ações não entra | **Revertida**: a barra entra como vista das ações do bot (M18, com o motor do PRD v2); o chat continua flutuante mas NASCE FECHADO — o kit não desenha chat |
| D6 | Nada arrastável; geografia fixa | **Revertida em parte**: Analisador e Party loot flutuam e arrastam (posição em `localStorage`); Personagem, Cyclopedia e Party viram modais com abas; colunas na composição do kit; abaixo de 720 px tudo vira seção do modo página |
| D7 | Sem senha; vocação em jogo; sem i18n | **Mantida** nas três exceções (ADR 0012, ADR 0026 d.1, i18n como épico) — são as únicas partes da tela em que o kit NÃO vale na risca, cada uma justificada no ADR 0030 §6 |
| D8 | Só verdade do servidor; sistema inexistente não aparece | **Núcleo mantido** + corolário: o estado FINAL da tela é o kit inteiro; o intermediário mostra o subconjunto que já é verdade. Nada mais é "fica de fora" permanente — tudo tem épico nomeado (§4) |
| D9 | Marca em docs, zip não versionado | **Mantida**; `docs/design-system.md` é atualizado pelas issues (gradientes, Stance, FloatingWindow, fileira de 124 px) |

Duas exclusões pontuais do plano do M14 caem junto com D5/D6: o contador de FPS entra (o kit o
desenha — "custo sem leitor" deixou de ser verdade) e os arcos de HP/mana ao redor do próprio
sprite entram (PRD §5.4/§10 do PRD de comportamento; dado 100 % local).

---

## 3. Decisões de produto que o kit pressupõe

**(a) O dono confirma na primeira issue de cada uma** (ADR 0030 §7 — o plano assume o default):

| # | Decisão | Reabre | Default do plano |
|---|---|---|---|
| P1 | Supply/munição como ESTOQUE contável (contagens nos slots da barra e da mochila; UC-BAR-004, UC-RES-002 do PRD pressupõem quantidade) — hoje é débito de gold por uso | ADR 0026 (supply/munição), modelo econômico | Sim, dentro do M18, com ADR próprio — o PRD do dono já pressupõe |
| P2 | Rateio de custos e Dividir loot como DOIS eixos independentes (switches do painel da party) | ADR 0027 d.5 (`mode` único) | Sim (SV-23); até lá o painel mostra o modo como texto |
| P3 | Saída com contagem de cinco segundos ("A mesma saída de cinco segundos, iniciada para você") | comportamento de `leave-hunt` (hoje imediato) | Sim (SV-24) — o texto do popover só entra com a mecânica |
| P4 | Munição como slot físico sempre visível (Escudo e Munição separados no set) | ADR 0026 d.3 (seletor no lugar do escudo) | Decide junto com P1 — sem estoque físico, o seletor atual fica |
| P5 | Formulário de e-mail/senha próprio na entrada | ADR 0012 (WorkOS) | NÃO — card fiel sem os campos; reverter exige ADR de autenticação |

**(b) Já decididas contra o kit — só o dono reabre, nenhuma issue nasce sozinha:** recorde de
XP/h e gp/h por hunt (decisão do `hunt.md`: nunca vira métrica oficial), curva de XP no cliente
("Próximo level" do analisador e a barra de % do Level — `catalogue.ts` deixa a fórmula de fora de
propósito), "+20 % de premium" (o benefício real do premium é a penalidade de morte menor —
publicar outro número seria mentir), "cap reservado" da bolsa da party (conceito sem mecânica).

---

## 4. Milestones

Quatro marcos novos + o M15 revisado. Convenções iguais ao plano do M14: labels
`E14 · Cliente` + escopo do pacote; toda issue via `/spec` com o achado `Rn-nn` colado; **P** cabe
numa tarde, **M** num dia. As issues são criadas quando o marco abrir, com os nomes reais dos
componentes — este plano é a fonte.

### M16 · Fidelidade pura (só `client`, nenhum ADR envolvido)

Fecha ~60 achados `[fidelidade]` — CSS, markup, texto, formatação — sem tocar protocolo nem
reabrir decisão nenhuma. Os três QA abertos do M14 (#287, #288, #289) entram aqui.

Milestone [6](https://github.com/funkcaipora/draconya/milestone/6), aberto em 2026-09-17 com as
issues (specs completas no corpo de cada uma):

| FD-01 | FD-02 | FD-03 | FD-04 | FD-05 | FD-06 | FD-07 | FD-08 | FD-09 | FD-10 | FD-11 | FD-12 | FD-13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| #301 | #302 | #303 | #304 | #305 | #306 | #307 | #308 | #309 | #310 | #311 | #312 | #313 |

| # | Issue | Dep. | Tam. | Entrega (achados) |
|---|---|---|---|---|
| FD-01 | Reset global `box-sizing: border-box` e `:focus-visible` dourado em todos os primitivos | — | P | R0-01; anel de foco do kit em Button/IconButton/Select/Slot/Switch/Tab (hoje só o Checkbox tem) |
| FD-02 | Fontes com os pesos reais | — | P | R0-03 (JetBrains Mono 500/600/700 estáticos ou variável verdadeira — o arquivo atual é Regular puro; NÃO só editar o `@font-face`), R0-13 (Plex 100–700) |
| FD-03 | Button/IconButton/Checkbox fiéis | FD-01 | P | R0-04 (font-size por variante; 14 px só em primary/gold `lg`), pesos 500/400 de secondary/danger/ghost/text, R0-05 (IconButton 36 px + hover; TopBar passa a usá-lo), R0-07 (Checkbox `size`) |
| FD-04 | VitalBar e Vitals do kit | FD-01 | P | R0-08/R6-10 (gradiente de dois tons + bisel, trilho neutro), R6-01 ("3.165 / 3.165" pt-BR dentro da barra) |
| FD-05 | Migrar as sete seções para `Panel dock` | FD-01 | M | R0-02/R3-01/R7-01: PartyPanel, PartyMembers, BattlePanel, Bestiary, EquipmentPanel, ContainerWindow, AmmoPicker; aposenta `.analyzer-head` e as `--window-*`; R0-09 (sombra do Panel flutuante); comentário desatualizado de `shell.css` limpo |
| FD-06 | TopBar fino | FD-03 | P | R1-13 (moldura 4 lados + vinheta + inset), R0-11 + pill de gold (sombras, borda da moeda), R0-12 (brilho do wordmark), retrato com anéis internos, R1-10 (remover rótulo sob ícone — só `title`) |
| FD-07 | Slots e set fiéis | FD-01 | M | R6-05 (tracejado por lugar; Mão/Peito/Escudo sólidos), borda dourada e fundo vazio-vs-ocupado do `Slot` do kit, R7-11/R7-15 (contagem dourada, sem contorno, sempre visível), R7-03 (grade de 6 colunas — largura de exibição desacoplada do crescimento por linha do ADR 0026 d.6; comentário atualizado), R7-02 (Bolsa antes da Mochila), R7-04 (cabeçalho sem ícone/contador), R6-06 (padding 6), R6-02/R6-03 (linha "Cap" com pt-BR e letter-spacing .08em), R6-04 (gold sai da linha de cap — já vive no topo) |
| FD-08 | Batalha fiel | FD-05 | P | R7-06 (coluna de 16 px), R7-05 (Ordenar ↕ — com ordenação client-side real), R7-13 (minimizar do Panel), espaçamento 1 px e `%` sem espaço |
| FD-09 | Popover de saída fiel | — | P | R4-11 (ordem: gold, grupo, HP por último), pill+chevron como botão partido (um só "»"), R4-13 registrado como exceção mantida (o input de % é o único lugar de edição) |
| FD-10 | Entrada fiel | FD-03 | M | R1-14 ("Pronto para entrar" ligado ao estado real da conexão), R1-16 (seleção em duas etapas: ◆/◇ + "ENTRAR NO JOGO →" + hint), R1-18 (textos e ordem dos ClassCard, subtítulo), sem realm/versão (exceção D7); fecha #287 |
| FD-11 | Party visual com os dados de hoje | FD-05 | P | R3-02 ("Party · N"), R3-13 (★ sempre dourada), R3-11 (sair da party no painel da hunt), R3-14 (título com o modo), R3-17 (pt-BR), token `--ok` no "✓ aprovou", texto de status de aprovação |
| FD-12 | Analisador — texto e formato | — | P | R4-15 ("Analisador de caçada"), R4-18 (" gp" em Gold/Gasto/Saldo) |
| FD-13 | Passe de altura e chat vs coluna | FD-05 | P | Fecha #288 e #289 |

### M17 · Recomposição do HUD (ADR 0030 estrutural, só `client`)

A geografia do kit, com os dados que já trafegam. Depende de FD-01/FD-05.

Milestone [7](https://github.com/funkcaipora/draconya/milestone/7), aberto em 2026-09-17 com as
issues (specs completas no corpo de cada uma):

| RC-01 | RC-02 | RC-03 | RC-04 | RC-05 | RC-06 | RC-07 | RC-08 | RC-09 | RC-10 | RC-11 | RC-12 | RC-13 | RC-14 | RC-15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| #314 | #315 | #316 | #317 | #318 | #319 | #320 | #321 | #322 | #323 | #324 | #325 | #326 | #327 | #328 |

| # | Issue | Dep. | Tam. | Entrega |
|---|---|---|---|---|
| RC-01 | `FloatingWindow` (componente da casca) | FD-05 | M | Arrastável (implementação própria, não o hack do kit), posição inicial por janela, persistida por navegador em `localStorage`; abaixo de 720 px degrada para seção do modo página; anima `dsAppear`; faixa de arraste exclui os 60 px dos botões |
| RC-02 | Analisador como janela flutuante + modal expandido | RC-01 | M | Nasce aberto na hunt em (250, 12); estrutura do kit (cabeçalho Sessão/—, caixas); "⤢ abrir completo" abre o `AnalyzerModal` do kit v3 — as linhas dele são os `Aggregates` que JÁ chegam, com /h derivado no cliente; abas "Dano recebido/causado" esperam E2; "Próximo level" fica de fora (§3b) |
| RC-03 | Party loot como janela flutuante | RC-01 | M | Título "Party loot", meta "vendido e dividido ao fim", grade fixa 6×2 com vazios (R4-23), barra de uso, nota de rateio (texto da janela renderizada); "valor est." entra com SV-01; "cap reservado" fora (§3b); abre/fecha pelo ▣ do painel da party (R3-03) |
| RC-04 | Coluna esquerda: painel Skills | FD-05 | M | R2-01/R2-05/R2-06: título "Skills", "Experiência total", valor único de HP/Mana com `tone` vital, Stamina "41:40", ⚙ "Personalizar skills" com o `SkillsCustomizeModal` do kit v3 (checkboxes em 2 colunas, meta "N de M visíveis", Padrão/Salvar, ordem = a da lista — sem arrastar), preferência em `localStorage`; linhas ML/Sword/Shield/Speed acendem com SV-04; Soul e barra do Level ficam (§3b / futuro); `CharacterPanel` deixa a coluna (vira modal, RC-06) |
| RC-05 | Party na hunt com a estrutura do kit | FD-11 | M | Linhas do kit (nome/você, siglas de vocação COM SV-03 — sem inventar "EK/RP": a abreviação real é decidida na spec da SV-03 —, barras HP e MP com SV-03, Gasto com SV-18, DPS/HPS esperam E2); rodapé: gasto médio/sua parte (SV-18), nota "Parar no meio…", switches (SV-23), Sair da party |
| RC-06 | Personagem como modal com abas | FD-05 | M | R8-01/R8-02: retrato clicável + ícone na nav (R1-08); aba Personagem: identidade ("Vocação · LV n"), VitalBar de HP/Mana, atributos existentes; bônus do Bestiário (dado já chega, R8-05); regen/velocidade/ML com SV-04; combate com SV-01; aba Outfit espera intenção de cor (E7); "+20 % premium" nunca (§3b) |
| RC-07 | Party: modal "Gerenciar party" | RC-05 | M | R3-12: abas Formação / Na hunt, título "Party · N/4", status "Todos aprovaram/Aguardando"; alcançável DURANTE a hunt (fecha a barreira estrutural R3-11/R3-12); nomes na formação melhoram com SV-22 |
| RC-08 | Cyclopedia como modal — aba Bestiary completa | FD-05 | M | R8-21/R8-22: modal 860×600; busca, grade/lista, ordenação, estrelas (`progress.reached`), barra por monstro, box de progresso geral — TUDO com dado que já chega; SideList de categorias entra com SV-20; abas Itens (SV-01/SV-25) e Bosstiary (E11) acendem depois; `Bestiary.tsx` deixa a coluna |
| RC-09 | TopBar na ordem do kit | RC-06, RC-08 | P | Ordem: Personagem, Hunts, Analisador (toggla a janela), Cyclopedia, Chat, Configurações-quando-existir; Guild/Amigos/Prey/Loja/gems/online entram cada um com seu sistema (§4-épicos); ícones Bot/Inventário saem do topo quando os painéis tiverem o próprio minimizar (– do Panel, FD-05) |
| RC-10 | Chat nasce fechado | — | P | Abre pelo ícone; recusa do servidor com o chat fechado acende o ícone (badge); no celular continua seção |
| RC-11 | HuntsModal: busca | — | P | R8-09 (filtro por nome; por criatura com SV-02); Tabs de sistemas inexistentes NÃO entra (§1); "Completar o time" só faz sentido fora da hunt e já existe como "Procurar party" (R8-12 corrigido) |
| RC-12 | Pill "Detalhes da caçada" + modal v1 | — | M | R4-08: pill ⓘ; modal com nome/nível/dificuldades hoje; monstros+loot com SV-02, contagem por pull com SV-19, descrição com SV-21; "Seu recorde" fica (§3b); "Despachar loot" espera E5 |
| RC-13 | Latência + FPS sobre o mundo | — | P | R1-11/R1-12/R4-07: overlay no canto inferior direito do viewport (ponto verde + "N ms" + "N fps" por `requestAnimationFrame`); `ConnectionBadge` migra para lá |
| RC-14 | Overlay de área e criaturas | — | P | R4-03 parcial: "Cidade · zona protegida / a praça não credita nada" e a CONTAGEM de criaturas (derivável do `world`) já; nome da hunt + dificuldade acendem com SV-05 |
| RC-15 | Arcos de HP/mana do próprio jogador | — | M | R4-06: arcos + nome sobre o sprite próprio (dado local; PRD §9/§10); overlay DOM sobre o canvas, sem tocar `world/` |

### M15 · O servidor conta mais — revisado

Milestone [5](https://github.com/funkcaipora/draconya/milestone/5), com as issues abertas em
2026-09-17: SV-01…SV-25 = #337…#361, na ordem (SV-01 → #337, SV-02 → #338, … SV-25 → #361).

SV-01…SV-17 continuam como especificados no
[plano do M14 §5](design-system-plan.md#m15--design-system--o-servidor-conta-mais), com uma
diferença: **as specs do lado cliente são escritas kit-exatas** (cada uma cola o trecho do kit e o
achado da auditoria — SV-10 é o painel Skills do RC-04, SV-11 são as linhas do RC-05, SV-12 são os
overlays do RC-14 + moldura de alvo, SV-08 vira a aba Itens do RC-08). Novos, achados pela
auditoria:

| # | Issue | Pacotes | Tam. | Entrega |
|---|---|---|---|---|
| SV-18 | Gasto da party agregado + prévia de rateio | protocol, server, sim | M | R3-06/R3-09: os `Aggregates` de cada membro agregados e mandados a TODOS os viewers (hoje cada um só recebe o próprio — `host.ts` "quem olha um membro vê os dele"); "sua parte estimada" calculada no servidor |
| SV-19 | Contagem de monstros por dificuldade | protocol, server | P | `catalogue.hunts[].difficulties` de `string[]` para `{id, monsterCount}` (o dado já existe em `huntDifficultySchema.monsterCount`) — destrava "Cauteloso · 2" dos pulls |
| SV-20 | Classe/categoria do monstro | content, protocol, server | P | Campo `class` no `monsterSchema` + catálogo — destrava a SideList de categorias da Cyclopedia |
| SV-21 | Descrição da hunt | content, protocol, server | P | Campo `description` opcional no `huntSchema` + catálogo + autoria dos textos (R8-13) |
| SV-22 | Party: expulsar membro e nomes na formação | server, client | P | R3-08 (rota `kick` só-líder + `PartyClient.kick()` + o ×) e o gap da API de formação que só devolve `characterId` sem nome |
| SV-23 | Rateio e loot como dois eixos **[P2 — dono confirma]** | content, sim, protocol | M | `PartyState.mode` vira `{shareCosts, splitLoot}`; o settlement define os 4 combos; os dois switches do kit acendem |
| SV-24 | Saída com cinco segundos **[P3 — dono confirma]** | sim, content | P | `leave-hunt` e as regras de saída ganham a contagem de 5 s (cancelável); o texto do popover entra junto |
| SV-25 | Estáticos de vocação no catálogo | protocol, server | P | R8-07: `startingSpeed`/`speedPerLevel`/`regen` em `catalogue.vocations` (o vivo — speed/ML — já é SV-04) |

### M18 · Motor de ações e automações (E10 + E4, o coração do kit)

O maior marco: é o que faz a coluna esquerda e o rodapé do kit existirem de verdade. **Abre com um
ADR próprio** (vocabulário v2 do bot) e com as decisões P1/P4 do §3 confirmadas — a issue-portão é
a [#362](https://github.com/funkcaipora/draconya/issues/362), no milestone
[8](https://github.com/funkcaipora/draconya/milestone/8). A especificação
funcional é o [PRD de comportamento](prd-ui-behavior.md) inteiro (RG-001…007, §15–§24, §28, §30–§33).

Escopo por camada — as issues nascem via `/spec` quando o ADR do marco fechar:

- **`content`** — vocabulário v2: ações em slots ordenados (prioridade = ordem, RP-002 — o
  ActionConfig do kit v3 confirma em texto: "a ordem dos slots é a prioridade"), condições
  múltiplas em AND (RG-006; as quatro condições atuais, como o kit v3 desenha), grupos de cooldown
  compartilhado (§23), conjuntos nomeados de slots (UC-BAR-001 — os NOMES elementais
  "Energia/Fogo/Gelo/Sagrado" só chegam com o E2; o mecanismo de conjuntos não espera por eles),
  automações nomeadas com condições de entrada em OU e de saída em E (o desenho do
  `AutomationConfigModal` v3): renovar anel/colar por carga — exige consumir
  `charges`/`durationMs`, hoje mortos —, munição por alvos, arma/escudo por HP, e "Comer comida"
  (sexta do `AddAutomationModal` v3; sem lastro no PRD e sem mecânica de fome — confirmar com o
  dono), e a decisão P1 (estoque de supply/munição — que o v3 pressupõe: "Pega o próximo da
  mochila principal").
- **`sim`** — o motor: avaliação determinística por prioridade (RP-001…011), cooldown individual
  vs compartilhado (§28), consumo de carga/duração, exposição do "porquê bloqueada" para o tooltip
  (UC-TIP-001/002).
- **`protocol`** — `bot-config` v2 (compatível: campo novo opcional, precedente do
  `bestBasicHit`), contagens/cooldowns/ação-vencedora S2C; a intenção manual `use-slot` (C2S) é a
  fase 2 — a barra nasce como CONFIGURAÇÃO (invariante 4/11).
- **`client`** — a fileira de 124 px volta; `ActionBar` 2×12 (Slot 36 com tecla/nome/contagem),
  "Salva automaticamente", CONJUNTO/ALVO, ⌖ Lure·Follow com o gate LV 50 (o modal já é SV-09);
  `ActionConfigModal`, `AutomationsPanel` + `AddAutomationModal`/`AutomationConfigModal` (os três
  desenhados no kit v3 — capturas 34–38); Shift+clique desabilita (UC-BAR-005; o switch
  "automática" do v3 é a mesma alavanca); as pills de caçada
  sobem para `bottom:130`; **`BotPanel`/`RuleEditor` são aposentados SÓ quando a barra +
  Automações cobrirem 100 % do que eles fazem** — nunca antes.

SV-16/SV-17 (anéis + modal Ring swap) continuam no M15 e são pré-requisito da automação "Swap
ring" deste marco (o mecanismo `#applyRingSwap` já roda no `sim` — falta só a tela e os itens).

### Épicos que o kit desenha (fora dos marcos — um PRD/`/spec` cada, na ordem do dono)

| Superfície do kit | Épico | O que falta (da auditoria) |
|---|---|---|
| Posturas Defensiva/Balanceada/Atacante (controle ativo), badges de elemento, MonsterTip com resistências, DPS/HPS da party, crítico/leech, "Dano recebido/causado" por fonte no analisador | **E2 · Combate** | Mecânica de postura, sistema de dano elemental (não existe em NENHUMA camada), acumuladores por fonte e janela deslizante de DPS/HPS |
| Suprimentos usados e Loot recolhido POR ITEM no analisador | E2/economia | `Aggregates` só tem contadores únicos; breakdown por id é estrutura nova no `sim` |
| Despachar loot (pill + modal do mensageiro), raridade, PEGAR/VENDER | **E5 · Economia de loot** | Mecânica inteira; job periódico de venda |
| Cyclopedia · Bosstiary | **E11 · Bosses** | `'boss'` é só um `SessionType` reservado — sem ruleset nem entidade |
| Guild (modal completo, bônus, expedições) | **E12 · Guildas** | Sistema inteiro; doação passa pelo ledger (invariante 10) |
| Amigos (SocialModal) | **social — sem épico no roadmap hoje** | Nem épico existe; nasce por PRD do dono |
| Prey (cartas, reroll, wildcards) | **E7 · Progressão** | Só um esqueleto de scheduler cita "reset de Prey" |
| Loja, gems/cristais, botão +, Premium store, leilão (livro de ordens sem taxa — decisão de 2026-09-16), boost de EXP, Bênção | **E13 · Monetização/Market** | `account.coins` já existe como coluna (inerte); todo o resto é sistema novo |
| Configurações ("salvas na conta"), i18n PT/EN | **preferências de conta** | Endpoint de preferências; os toggles de Tela/Som dependem de os consumidores existirem (nomes/barras/damage text no viewport) |
| Soul Points | decisão de design via `/product` antes de qualquer camada | Não existe em camada nenhuma |
| Aba Outfit (cores) | E7 (§7.4 do PRD) | Intenção C2S de trocar cor + gravação |

---

## 5. Ordem e dependências

```
M16 (fidelidade pura)  ──┬──>  M17 (recomposição)          [client]
M15 revisado (servidor) ─┴──>  acende linhas de M17         [protocol/sim/content/server]
ADR do vocabulário v2 + P1/P4 confirmadas ──> M18 (motor)   [todas as camadas]
E2/E5/E7/E11/E12/E13 ──> na ordem que o dono priorizar, um PRD por vez
```

- M16 é paralelizável em subagentes (blocos prefixados no `shell.css`, como no M14); FD-01 e
  FD-05 vêm primeiro porque quase tudo depende deles.
- M17 pode começar com o M15 no meio — cada linha "acende com SV-nn" degrada para omissão (D8).
- M18 não começa sem o ADR do vocabulário e sem P1 decidida — a barra sem motor seria decoração, e
  o plano não constrói decoração.
- A auditoria vale para o commit `3299eb5`; issue criada muito depois confere o achado contra o
  código atual antes de colar a evidência.

## 6. Verificação

- Tudo do plano do M14 §7 continua: `prerender` por componente, `pnpm check`, captura por issue —
  agora **lado a lado com a captura correspondente de [kit-reference/](kit-reference/README.md)**,
  no mesmo tamanho (1800×1010 no jogo). Quem executa anexa as duas no comentário de entrega; o
  dono, se quiser, ainda compara com o `index.html` do zip — mas a régua versionada é a pasta.
- `/compliance` roda em todo diff que tocar `sim/`, `protocol/` ou `content/` (M15/M18 inteiros).
- Regressão de intenção: no M16/M17 nenhum `sendIntent` novo aparece; no M18 os novos opcodes
  passam pelo codec com teste, sempre opcionais com default (deploy em rolagem).
- Celular: toda janela flutuante tem captura a 375 px provando a degradação para seção.

## 7. Riscos

- **O kit mente em detalhes** (números internos divergentes, controles inertes, código morto).
  Mitigação: §1 é a regra de desempate; nenhuma spec cita o kit sem citar o achado verificado.
- **Copiar `data.js` por engano.** O protótipo tem números realistas ("1.284 players online",
  contagens de poção). Mitigação: a regra do M14 continua — dado de mentira nunca vira constante;
  a revisão adversarial procura literais do kit no diff.
- **Duas vistas do bot durante a transição** (painel interino + barra do M18). Mitigação: o painel
  só sai com paridade completa; até lá a barra não existe (nada de meia-barra).
- **Janela flutuante no celular.** O kit não desenha mobile. Mitigação: RC-01 define a degradação
  UMA vez, todas as janelas herdam.
- **P1 (estoque) muda economia.** É a decisão mais pesada do §3 — muda `sim`, `content`, ledger de
  compra e o texto de metade das automações. Por isso ela mora no ADR do M18, não numa issue de
  tela.
- **Expectativa de "igual ao kit" antes do M18.** O topo sem Loja/Guild/Prey e a ausência da barra
  são INTENCIONAIS até os sistemas existirem — o ADR 0030 §5 é a resposta pronta.
