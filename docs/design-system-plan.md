# Design system do cliente — plano de implementação (E14)

**Status:** aprovado em 2026-09-16 — as decisões de arquitetura estão registradas no ADR 0029
(#244); este documento é o desenho, e as issues do milestone M14 apontam para cá (o M15 existe só
como milestone com a lista do §5).
**PRD:** §5 (plataforma e experiência do client), §8.2 (hotkeys guiadas), §13 (bot)
**Origem:** o handoff "Design System MMORPG Medieval" gerado pelo Claude Design em 2026-09-15 —
tokens, quinze primitivos, o fluxo de entrada, o HUD e catorze modais, em HTML/JSX de protótipo.
**Diverge do handoff em:** layout escalado por `transform`, barra de ações no lugar do chat, login
com senha, vocação como tela de entrada, fonte por CDN, janelas arrastáveis, e todo dado que o
servidor ainda não sabe dizer — ver §2 e §4.

---

## 1. O que o handoff entrega, e o que ele não é

O pacote é uma **referência visual de alta fidelidade**, não código. O próprio `README.md` dele
diz: "protótipos que mostram aparência e comportamento, não código de produção... recriar estas
telas no cliente existente". O que vale como especificação:

| Parte do handoff | O que é | Como entra no repositório |
|---|---|---|
| `tokens/{colors,typography,spacing,effects,fonts}.css` | ~190 variáveis CSS: ash, blood, gold, parchment, elementos, vocações, vitais, sombras, gradientes, motion | Quase literal, em `packages/client/src/shell/tokens.css` (a criar) — é a única parte que se copia |
| `components/core/*.jsx` + `.d.ts` | 15 primitivos: Button, IconButton, Input, Select, Checkbox, Switch, Tabs, Kicker, Panel, Modal, Slot, VitalBar, StatRow, Badge, Stance | Reescritos em `.tsx` com classes CSS (ADR 0016; `scripts/source-policy.ts` recusa `.jsx`); os `.d.ts` viram as props |
| `ui_kits/draconya/{Entry,Hud,Modals,App}.jsx` + `data.js` | O fluxo inteiro com dados de mentira (`DR.*`) | Só a aparência; todo dado vem do `catalogue`, do `hud` e da `account` — nenhuma lista de `data.js` vira constante |
| `assets/fonts/*.woff2` | Cinzel e IBM Plex Sans (OFL), sem o `OFL.txt` junto | Baixadas de novo da distribuição oficial, com licença, em `packages/client/public/fonts/` |
| `assets/hud-icons/*.png` | 14 ícones 128×128: 8 do tibia-idle (projeto do dono), 6 gerados em canvas — arte do dono, confirmado em 2026-09-16 | `packages/client/public/hud-icons/`, com glifo de reserva enquanto a imagem carrega |
| `guidelines/*.html`, `DESIGN_SYSTEM.md`, `README.md` | Os fundamentos da marca em prosa | `docs/design-system.md` (a criar) e a skill `/design` |

**O que o handoff não tem, e o plano precisa cobrir sozinho:**

- Cinco modais que `App.jsx` abre e nenhum arquivo define: `AnalyzerModal`, `ActionConfigModal`,
  `AutomationConfigModal`, `AddAutomationModal`, `SkillsCustomizeModal`. E o campo `NumField`,
  usado por três modais e nunca definido. O protótipo quebra ao abri-los.
- Nenhuma regra para celular: nem `@media`, nem menção a mobile. O HUD é uma tela fixa de
  1800×1010 (ou 1600×900 — o `DESIGN_SYSTEM.md` e o `README.md` do próprio pacote divergem)
  escalada por `transform: scale`.
- Números internos inconsistentes: `--hud-topbar-h: 56px` no token, 65 px na tela; barra inferior
  104 px no token, 124 px na tela; título de painel 36 px no token, 34 px no componente; slots
  documentados em 39/46/34 px e desenhados em 36/30/26 px; ícone de navegação 44 px no demo e
  36 px no topo. **O plano adota o que está desenhado nas telas** (65 / 232 / 124 / 34; slots
  36 ação, 30 equipamento e party, 26 container; ícone 36) e corrige os tokens ao copiá-los.
- Nenhum lugar para o estado da conexão (`ConnectionBadge`), que é regra obrigatória do cliente
  ("jogo idle silencioso é indistinguível de jogo travado").

---

## 2. Decisões — o que vai para o ADR 0029

Cada uma com a alternativa descartada e o porquê. A regra que decide quase todas: **o cliente nunca
mostra o que o servidor não disse** (invariante 4, e a regra do "—" do `AGENTS.md` do cliente).

### D1. Tokens como variáveis CSS, fontes na mesma origem

`packages/client/src/shell/tokens.css` (a criar) com as escalas do handoff, nomes iguais aos do
design (`--gold-4`, `--ash-1`, `--shadow-panel`…) para a skill e o documento de marca falarem a
mesma língua do CSS; importado por `shell.css`. As três fontes — Cinzel, IBM Plex Sans e
**JetBrains Mono** — em `packages/client/public/fonts/`, declaradas por `@font-face` em
`shell/fonts.css` (a criar).

- *Descartado:* o `@import` de Google Fonts do `tokens/fonts.css`. O deploy é de origem única
  (ADR 0022; `deploy/nginx.conf` diz "nada externo: tudo que o Draconya desenha sai desta
  origem"), e uma fonte por CDN seria a primeira requisição externa do cliente.
- *Descartado:* um pré-processador, CSS Modules ou CSS-in-JS. O repositório tem uma folha
  (`shell.css`) e classes; é o padrão que `TopBar.tsx` e todos os outros seguem.
- Binário versionado no cliente hoje é só fixture de teste, e o `AGENTS.md` chama isso de
  exceção. Fonte OFL é a segunda exceção, pela mesma razão: não há como servir sem o arquivo, e
  a licença permite. Os três `.woff2` somam menos de 120 KB. Vêm da distribuição oficial de cada
  família, com o `OFL.txt` ao lado — os dois do handoff não trazem licença.

### D2. Primitivos em `.tsx` com classes, nunca estilo inline

`packages/client/src/shell/ui/` (a criar): um arquivo por primitivo, props tipadas a partir dos
`.d.ts` do handoff, estilo em `shell/ui.css` (a criar) por classe (`.ui-panel`, `.ui-button`,
`.ui-button-gold`, …). Estado de hover, foco e pressionado por pseudo-classe CSS, não por
`useState` como no protótipo. Teste por `prerender` de `react-dom/static`, o padrão de
`Shell.test.ts`: prende classes, `aria-*` e texto, sem DOM. Nenhum primitivo importa store.

- *Descartado:* portar os objetos `style={{…}}` do handoff. Seriam quinze componentes com
  estilo em JS numa base que tem zero — e o hover em `useState` custa um render por mouse.
- `Stance` **não entra**: não existe postura de combate no `sim` (ver §4). `NumField` entra
  como variante de `Input` (`size="sm"`, `type="number"`).

### D3. O mundo continua em tela cheia; o chrome do design é sobreposto, sem `transform: scale`

O layout do handoff — topo de 65 px, colunas de 232 px até o rodapé — entra como **CSS absoluto
por cima do canvas**, que segue ocupando `inset: 0`
com zoom inteiro (`zoomFor`: 1×, 2× a partir de 560 px, 3× a partir de 1400 — "pixel art a 1,5× é
borrão"). As colunas ganham fundo opaco (`--ash-1`), como no design; o centro visível fica entre
elas e vai até o rodapé — a faixa inferior de 124 px do handoff existia para a barra de ações, que
não entra (D5), então o mundo a ocupa e as pills de caçada ficam centralizadas no rodapé dele.
Nenhum arquivo de `world/` muda.

- *Descartado:* o canvas de 1800×1010 com `transform: scale()` do protótipo. Escala fracionária
  borra a pixel art se o `<canvas>` estiver dentro da árvore escalada, e `transform` não dispara
  `@media (max-width: 720px)` — o modo página do celular deixaria de existir.
- *Descartado:* o mundo como célula do grid. É voltar ao "três colunas de pedra com um canvas
  pequeno no meio" que a FUN-115 tirou; e obrigaria `resizeTo`/`zoomFor` a medir a célula.
- Abaixo de 720 px **nada muda**: o mundo numa faixa de 40vh e as seções empilhadas na ordem do
  `shell.css` (set → mochila → bolsa → bot → hunts → analisador → bestiário). O handoff não
  desenhou celular; a regra atual vale até alguém desenhar.

### D4. O vidro ferro-forjado substitui a pedra do pacote; o pacote fica só para sprites

Painéis, barras de HP/mana, molduras e slots passam a ser CSS puro (gradientes, sombras e fio
dourado do design). `assets/ui.ts`, `applyUiSkin` e as 18 variáveis `--ui-*` são **aposentados**,
junto com a pasta `library/ui/images` no volume de produção. O pacote de arte continua sendo a
única fonte de sprite de item, outfit e mundo (`ItemSprite`, `TextureBook`) — o ADR 0008 não muda.

- *Descartado:* manter as duas skins ou fundir os tokens nas variáveis `--ui-*`. O chrome do
  design não usa PNG nenhum, então o mecanismo ficaria vivo sem consumidor; e a pedra do Tibia é
  exatamente a arte de risco jurídico do §13.1 — menos PNG do cliente oficial na tela é ganho.
- *Variante possível, a decidir no §10:* manter só as dez `--ui-slot-<slot>` (o ícone cinza do
  lugar vazio) por cima do rótulo do design. Por padrão, o slot vazio mostra o rótulo do lugar
  em mono 6,5 px ("PESCOÇO", "MÃO"…), como o `EquipmentSet` do handoff desenha.
- `docs/deploy.md` perde o passo do `rsync` de `library/ui/images`; o `AGENTS.md` do cliente
  perde a seção "A arte de UI vem do pacote" e ganha a do design system. **No mesmo commit.**

### D5. O chat é uma janela flutuante sobre o mundo; a barra de ações espera o motor manual

O **chat** é um `Panel` flutuante no canto inferior esquerdo, por cima do mundo, que **abre e fecha
pelo ícone "Chat" do topo** (decisão do dono, 2026-09-16). Nasce aberto — é onde chegam as recusas
do servidor (`system-message`) — e fica fixo no lugar (sem arraste, como as outras janelas). A
barra de ações 2×12 do handoff não entra.

- *Por quê o chat continua embaixo à esquerda:* PRD §5.3 e ADR 0026 (decisão 7). Fechá-lo é
  escolha do jogador; a tela não o esconde por padrão.
- *Por quê a barra não entra:* não existe intenção C2S de "usar magia/item agora" (a tabela
  `CLIENT_TO_SERVER` de `packages/protocol/src/messages.ts` tem dezesseis opcodes, de
  `authenticate` a `move-item`, sem `cast` nem `use-item`); toda ação de combate é regra do bot
  avaliada no servidor (ADR 0002, PRD §13.4). "Tecla dispara ação" pertence ao E10 (motor manual:
  "alvo manual, hotkeys e ação por clique", `technical-architecture.md` §17). Uma barra que só
  ESPELHA as regras duplicaria o painel do bot, e a "quantidade" desenhada nos slots pressupõe
  estoque de poção, que o produto trocou por débito de gold (§20.1).
- *Fica em aberto* (§10): se o dono do produto quiser a barra como vista das regras antes do E10.

### D6. Fixo para o loop de todo dia, modal para visita; nada arrastável

| Fixo (seção da coluna, minimizável, nunca removido) | Modal (scrim + `Panel`, um por vez) |
|---|---|
| Bot, Personagem, Party na hunt (esquerda) | Escolha uma caçada, com a formação da party dentro (ADR 0027) |
| Set, bolsa, mochila, Batalha, bolsa da party, Analisador (direita) | Cyclopedia (aba Bestiário; Itens no M15) |
| Chat (janela flutuante fixa no canto inferior esquerdo, abre e fecha pelo topo) | Editor de regra, Lure e alvo, Ring swap, Detalhes da caçada (M15) |

- *Descartado:* janelas flutuantes arrastáveis (Analisador, bolsa da party). Exigem posição por
  janela, não fazem sentido no modo página do celular, e o handoff as implementa com `mousemove`
  manual dividido por `window.__drScale`. Se um dia entrarem, posição em `localStorage` por
  navegador.
- *Descartado:* Bestiário como seção fixa. O design o põe na Cyclopedia; ele é visita, não loop.
  Analisador continua fixo e nasce aberto ("janela que abre minimizada é janela que abre vazia").
- *Mantido do ADR 0027:* a formação da party mora na escolha de caçada ("propor uma hunt É
  escolher uma hunt"). O design a separa num modal "Party"; aqui ela é a coluna direita do modal
  de caçada, e o ícone "Party" do topo abre esse modal já nessa coluna.
- *Telas do handoff que viram outra coisa:* o modal "Party" (abas Formação / Na hunt) não existe
  — a formação é a coluna do modal de caçada e "na hunt" é o painel fixo da esquerda (DS-14); o
  modal "Personagem" (abas Personagem / Outfit) vira o painel fixo Personagem (DS-13, completado
  em SV-10) — a aba Outfit espera uma intenção de trocar cor que não existe (§8).

### D7. Entrada sem senha; vocação continua em jogo

O card de login tem o kicker, o título, o CTA dourado **"ENTRAR →"** e o link **"Criar conta"**,
e os dois chamam `beginLogin()` — que navega para o AuthKit do WorkOS (ADR 0012). Sem campo de
e-mail, sem senha, sem "lembrar", sem "mostrar".

- A escolha de vocação **não** vira tela de entrada: ela acontece no level do catálogo, em jogo,
  por `choose-vocation` (ADR 0026 d.1). Os `ClassCard` do handoff vestem o `VocationChoice`
  existente. A tela "class" do fluxo do protótipo não é construída.
- "Mundo" do card de personagem (o handoff mostra "Lv 12 · Ignis") não existe: o jogo não tem
  realms. No lugar, o estado que a API já manda ("na cidade", "numa hunt").
- Sem i18n neste plano: o toggle PT/EN não entra, os textos seguem em pt-BR como hoje. Não há
  infraestrutura de tradução no cliente, e "idioma salvo na conta" exige endpoint que não existe.

### D8. Só verdade do servidor na tela

Cada painel mostra o que chega pelo protocolo, "—" para campo opcional ausente, e **omite a linha**
para dado que não existe em mensagem nenhuma. Ícone do topo para sistema inexistente (Loja,
Guild, Amigos, Prey, Configurações) **não aparece** — um botão que abre "em breve" é uma promessa
que a barra não tem como cumprir. Quando um campo entra no protocolo (M15), a linha entra com ele.

### D9. A referência de marca vive em `docs/`, os tokens vivem no código

`docs/design-system.md` (a criar) resume os fundamentos do `DESIGN_SYSTEM.md` e do `README.md` do
handoff (cores, tipo, tom de texto, estados, o que é placeholder, os números fixados no §1). A
skill `.claude/skills/design/` (a criar, a partir do `SKILL.md` do handoff) aponta para esse
documento e para `tokens.css`. O zip do handoff não é versionado: é `.jsx` (proibido) e protótipo;
fica com o dono do projeto. Os três emojis de hoje no topo (🎒 📈 📖) saem — o design diz "nenhum
emoji", só glifos e PNG. Os catorze PNGs do topo são arte do dono (os oito do tibia-idle são
autorais, não sprites do cliente oficial — confirmado em 2026-09-16) e entram versionados em
`packages/client/public/hud-icons/`, com uma nota de origem em `docs/design-system.md`.

---

## 3. O que muda de estrutura no cliente

| Hoje | Depois | Onde |
|---|---|---|
| `shell.css` com paleta própria (`--text`, `--accent`, `--window-bg`) e a skin de pedra | `tokens.css` + `fonts.css` + `ui.css` + `shell.css` reescrita sobre os tokens | `packages/client/src/shell/` |
| Estilo por seção, cada janela com a própria moldura | Toda seção é um `Panel` (`dock`); todo diálogo é um `Modal` | `shell/ui/Panel.tsx`, `shell/ui/Modal.tsx` (a criar) |
| Barra do topo de 46 px com emoji e nome em `system-ui`; vitais no topo | Topo de 65 px: retrato-inicial, nome em Cinzel, "VOCAÇÃO · LV N", pill de gold, wordmark ao centro, seis ícones PNG de 36 px (Hunts, Bot, Inventário, Analisador, Cyclopedia, Chat) com glifo de reserva, `ConnectionBadge` à direita | `TopBar.tsx` |
| Janelas de 300 px flutuando sobre o mundo, esquerda parando a 190 px do rodapé | Colunas de 232 px opacas até o rodapé; o mundo ocupa o centro inteiro, com as pills de caçada no rodapé dele | `Shell.tsx`, `shell.css` |
| Chat solto no canto, 340×170, sempre visível | `Panel` flutuante "CHAT" no canto inferior esquerdo sobre o mundo, que abre e fecha pelo ícone do topo (nasce aberto) | `Chat.tsx` |
| HP/mana no topo, a 2×, com PNG do pacote | `VitalBar` de 14 px no alto da coluna direita, CSS puro; os arcos circulares ao redor do jogador ficam para o viewport (PRD §5.4, item próprio — §8) | `Vitals.tsx` → `shell/ui/VitalBar.tsx` |
| Set em `grid-template-areas` com ícone do pacote no slot vazio | Set 3×4 de slots de 30 px com rótulo no vazio e linha "Cap usado / total oz" | `EquipmentPanel.tsx` |
| Mochila e bolsa em grade de 5 × 34 px | Mesmas 5 colunas (uma linha da tela é uma linha do container, #160 cresce de 5 em 5), slot de 26 px do design | `ContainerWindow.tsx` |
| Bot: lista por categoria, interruptor verde/vermelho próprio | Mesma lista, com `Switch tone="traffic"`, cabeçalho de categoria "n/slots", linha `⚙ ▴ ▾ ×`, "+ regra" | `BotPanel.tsx` |
| `RuleEditor` como sobreposição fixa | `Modal` de 480 px, meta "slot n/N", rodapé "Salvar manda agora · quem decide é o servidor" | `RuleEditor.tsx` |
| Hunts como lista fixa na coluna esquerda | Modal "Escolha uma caçada" + pills sobre o mundo ("⚔ Escolher caçada" na Cidade; "↩ Sair da caçada »" na hunt) | `HuntMenu.tsx` → `HuntsModal.tsx` + `HuntActions.tsx` (a criar) |
| Bestiário como seção fixa da direita | Aba "Bestiary" do modal Cyclopedia | `Bestiary.tsx` → `CyclopediaModal.tsx` (a criar) |
| Analisador com linhas soltas | `Panel` com caixas "Sessão" e "Por hora", linhas em mono, eventos notáveis | `Analyzer.tsx` |
| `PartyMembers` texto + barra de 8 px | ★ líder, nome (você em ouro), `VitalBar` de HP de 4 px | `PartyMembers.tsx` |
| Nada | Painel "Personagem" (Experiência, Level, HP, Mana, Capacidade, Stamina) e painel "Batalha" (criaturas na tela com HP %) | `CharacterPanel.tsx`, `BattlePanel.tsx` (a criar) |

O que **não muda**: `state/`, `world/`, `net/`, `account/`, `party/`, `bot/store.ts` (fora o
rascunho passar a editar `lure` no M15), o `Viewport`, `ItemSprite`, `useWalkKeys`,
`AssetPackContext`. O ADR 0007 continua valendo palavra por palavra — nenhum estado de jogo entra
em contexto React; o painel Batalha lê o `world` por intervalo, como `PartyMembers` já faz.

---

## 4. O que o design pede e o servidor não sabe dizer

Levantado contra `packages/protocol/src/messages.ts` e `types.ts`, `state/hud.ts`, `account/api.ts`
e `docs/product/`. **Destino:** *M14* (entra, só cliente), *M15* (campo novo em mensagem existente
ou mensagem nova barata, e a tela junto), *fica de fora* (a tela omite; sem prazo), *sistema*
(espera o épico).

| Elemento desenhado | Existe? | Destino | Onde estaria |
|---|---|---|---|
| Nome, vocação, level, gold, HP/mana, capacidade, stamina, XP | sim | M14 | `player-stats`, `account.characters` |
| Retrato do personagem | derivável | M14 como inicial do nome; M15 o sprite do outfit | `world.creatures.get(selfId)` por amostragem |
| Latência | sim | M14, no `ConnectionBadge` | `hud.latencyMs` |
| FPS | derivável no cliente | fica de fora (custo sem leitor) | laço do viewport |
| Cristais, botão Loja | não | sistema (E13) | `monetization.md` não implementado |
| "N players online" | não — ninguém conta | M15 (SV-07) | diretório de sessões + mensagem nova |
| Skills com %, Magic Level, Speed | o `sim` calcula skills (FUN-75) e speed; nada trafega | M15 (SV-04) | `player-stats` |
| Soul | não existe em camada nenhuma | sistema | — |
| Automações (renovar anel/colar, trocar munição por alvos, trocar arma por HP, comer) | não — o vocabulário do bot tem 4 condições e 3 ações, uma por regra | sistema (E4: vocabulário novo; `charges`/`durationMs` nunca consumidos; nenhum anel no conteúdo) | `botActionSchema` |
| Ring swap (modal) | mecanismo pronto e opaco em `bot_config.ringSwap`; nenhum anel no catálogo | M15 (SV-16 cria Energy Ring e Life Ring; SV-17 a tela) | `content/data/items/`, `bot/store.ts` |
| Lure e alvo (min/max, política, priorizar/ignorar, postura parado/seguir/manter distância) | sim (`lure` opaco; `targeting` já editável na store) | M15 (SV-09), com o gate de `catalogue.bot.advancedFromLevel` | `bot/store.ts` |
| Regras de saída: HP abaixo de N %, acabar o gold, alguém do grupo sair | sim (`hp-below`, `out-of-gold`, `party-member-lost`), editáveis em `draft.exit` | M14 (DS-17) | `bot/store.ts` |
| Regra de saída "acabar a capacidade" | não | M15 (SV-06: `kind` novo em `content` + `sim`) | `botExitRuleSchema` |
| Barra de ações, "Conjunto" por elemento, tecla, quantidade | não (sem intenção manual; sem elementos; sem estoque) | sistema (E10 / #226) | — |
| Postura Defensiva/Balanceada/Atacante | não — não é o `posture` do bot; as "stances" reais são magias por vocação com mana e cooldown | sistema (combate) | `combat.md` |
| Party: vocação, level, mana de cada membro | só nome, líder, vivo, HP % | M15 (SV-03) | `PartyState.members[]` |
| Party: gasto de cada membro, DPS/HPS | não; gasto só do próprio, DPS não existe | fica de fora / sistema | `aggregates` |
| Rateio de custos e Dividir loot como dois interruptores na hunt | o modo é um só (`split`/`shared`), fixado na proposta | fica de fora; o painel mostra o modo como texto | `party.md` |
| Badge de EXP, bênção ativa | multiplicador efetivo e blessings não existem | fica de fora / sistema | — |
| Nome da área, buffs com tempo, moldura do alvo | `huntId` da instância, condições ativas e `targetId` não trafegam (o `sim` tem os três) | M15 (SV-05) | `instance-enter`, `conditions.ts`, `player-stats` |
| Detalhes da caçada: recorde XP/h e gp/h | não, por decisão de produto ("estimativa de XP/h e gold/h NÃO", `hunt.md`) | fica de fora | — |
| Detalhes da caçada: monstros, loot possível | composição e loot existem no conteúdo, não no `catalogue` | M15 (SV-02, SV-13) | `catalogue.hunts[]` |
| Raridade do loot, PEGAR/VENDER por hunt | raridade não existe; autovenda é por item, na conta | sistema (E5) | — |
| Despachar loot (mensageiro) | não (a Caixa de Loot é outra coisa) | sistema (E5) | `items.md` |
| Analisador: suprimentos e loot por item, dano por criatura/fonte, "próximo level" | só contagens e maiores golpes; a curva de XP não vai ao cliente | fica de fora; linhas atuais entram (DS-15) | `aggregates` |
| Bolsa da party: valor estimado | `value` do item não trafega | M15 (SV-01) | `catalogue.items[]` |
| Bolsa da party: cap reservado | reserva não existe no servidor | fica de fora | — |
| Personagem: armadura, defesa, dano | `armor`/`attack` só no conteúdo | M15 (SV-01) | `catalogue.items[]` |
| Personagem: crítico, leech; Outfit com cores | não existem; cor própria só se lê | sistema | — |
| Cyclopedia: Itens (Atq/Def, peso, descrição, dropado por) | peso sim; Atq/Def com SV-01; descrição e "dropado por" não existem | M15 (SV-08) parcial | `catalogue.items[]` |
| Cyclopedia: Bosstiary; Bestiário com "estágios ★" | Bestiário sim (marcos e contagens, sem estágio nomeado); bosses não | Bestiário M14→M15 (SV-08); Bosstiary: sistema (E11) | `hud.bestiary` |
| Abas Treino, Quests, Arena, Bosses na escolha de caçada | não | sistema (E8, E11; Arena não existe no PRD) | — |
| Guild, Prey, Loja/Leilão | não | sistema (E12, E7, E13 — o Leilão é livro de ordens sem taxa, decisão de 2026-09-16) | `docs/product/` |
| Configurações, Amigos, Arena, Bênçãos, Soul | não existem no PRD | DS-19 registra Configurações como preferências de conta e os outros quatro como sistemas futuros em `docs/product/`; nenhuma tela até lá | `docs/product/` |
| Login com e-mail e senha | contraria o ADR 0012 | fica de fora (D7) | `account/api.ts` |

---

## 5. Milestones e issues

Dois marcos. **M14** é só `client` e `docs`: fundação, revestimento e o fluxo de caçada — o jogo
inteiro fica com a cara nova sem tocar `protocol`, `sim` ou `content`. **M15** é o servidor
contando mais: seis mudanças pequenas de protocolo, cada uma com a tela que ela destrava, mais os
dois anéis que destravam o ring swap. A separação existe para o M14 nunca misturar CSS com
mensagem nova, e para o M15 poder ser reordenado sem travar o M14. Em 2026-09-16 o M14 foi aberto
com as suas issues; o M15 existe só como milestone, com esta lista na descrição, e as specs dele
são escritas quando o M14 fechar, com os nomes reais dos componentes.

Labels `E14 · Cliente` + `client` (`docs` para DS-01; `protocol`/`sim`/`content`/`server` conforme
o pacote nas SV-*). Toda issue segue o template da skill `/spec`, cabe numa PR de um subagente e
tem `pnpm check` verde mais captura no navegador com o pacote de arte como critério. Tamanho:
**P** cabe numa tarde, **M** num dia, **G** só quando não dá para partir — e não há G.

### M14 · Design system — fundação e revestimento

Milestone [4](https://github.com/funkcaipora/draconya/milestone/4), aberto em 2026-09-16 com as issues:

| DS-01 | DS-02 | DS-03 | DS-04 | DS-05 | DS-06 | DS-07 | DS-08 | DS-09 | DS-10 |
|---|---|---|---|---|---|---|---|---|---|
| #244 | #245 | #246 | #247 | #248 | #249 | #250 | #251 | #252 | #253 |

| DS-11 | DS-12 | DS-13 | DS-14 | DS-15 | DS-16 | DS-17 | DS-18 | DS-19 |
|---|---|---|---|---|---|---|---|---|
| #254 | #255 | #256 | #257 | #258 | #259 | #260 | #261 | #262 |

#### Fase A — Fundação (nenhuma tela muda de cara)

| # | Issue | Pacotes | Depende de | Tam. | Entrega | Aceite |
|---|---|---|---|---|---|---|
| DS-01 | docs: ADR 0029, plano do design system, `docs/design-system.md` e skill `/design` | docs | — | P | ADR com D1–D9; este plano com Status "aprovado"; o resumo de marca com os números fixados; `.claude/skills/design/SKILL.md` | `pnpm docs-check` verde; ADR no índice; links resolvem |
| DS-02 | client: tokens do design system e fontes locais | client | DS-01 | P | `shell/tokens.css` (nomes do handoff, valores corrigidos: topo 65, barra 124, título 34), `shell/fonts.css`, `public/fonts/{cinzel,plex-sans,jetbrains-mono}-latin.woff2` da distribuição oficial com `OFL.txt` ao lado; `shell.css` importa os dois; `body` em `--font-body`/`--text-primary` sobre `--bg-app` | `pnpm check`; nenhuma requisição fora da origem (aba de rede); `tokens.css` sem `@import`; a tela atual abre igual |
| DS-03 | client: primitivos de controle — Button, IconButton, Input, Select, Checkbox, Switch, Tabs, Kicker, Badge | client | DS-02 | M | `shell/ui/*.tsx` + `shell/ui.css`; variantes e tamanhos dos `.d.ts`; estados por CSS; `Switch` com `role="switch"` e `tone="traffic"`; `Input` com `size="sm"` numérico (o `NumField`) | Um `*.test.ts` por primitivo em `prerender` prendendo classes, `aria-*`, `disabled`; `grep -rl "state/\|bot/\|party/\|account/\|net/" packages/client/src/shell/ui` vazio (primitivo é folha, nunca lê store); `pnpm check` |
| DS-04 | client: primitivos de contêiner — Panel, Modal, Slot, VitalBar, StatRow | client | DS-03 | M | `Panel` (título 34 px, fio dourado, `dock`, minimizar, rodapé), `Modal` (scrim, fecha no ×, no scrim e em Esc, um por vez), `Slot` (26/30/36, tecla, quantidade, vazio tracejado ou rótulo), `VitalBar` (hp/mp/exp), `StatRow` | Testes em `prerender`; `Modal` sem `open` não renderiza nada; o mesmo `grep` de DS-03 continua vazio; `pnpm check` |

#### Fase B — Entrada

| # | Issue | Pacotes | Depende de | Tam. | Entrega | Aceite |
|---|---|---|---|---|---|---|
| DS-05 | client: a entrada no design — login, seleção e criação de personagem | client | DS-04 | M | `Entry.tsx` sobre `EntryShell` (vinheta, hachura, anéis, cabeçalho com wordmark e tagline, rodapé), card de login com "ENTRAR →" e "Criar conta" → `beginLogin`, grade de cards de personagem (inicial, nome em Cinzel, vocação na cor, "Lv N · na cidade"), card tracejado "+ NOVO PERSONAGEM" abrindo o formulário de nome, "Trocar de conta" → `signOut`, erro em `--blood-7` | `Entry.test.ts` (a criar) em `prerender` para `checking`/`anonymous`/`ready`; sem `<input type="password">`; captura das três telas |
| DS-06 | client: escolha de vocação com os cards do design | client | DS-04 | P | `VocationChoice.tsx` como `Modal` com os `ClassCard`: ícone tracejado na cor da vocação, nome + id, papel, ganhos por level do catálogo, arma inicial com `ItemSprite`, CTA "FORJAR" em sangue; sem badges de elemento (não existem) | `VocationChoice.test.ts` continua passando (o diálogo existe só pelo estado); captura com level 8 no banco local |

#### Fase C — A casca do HUD

| # | Issue | Pacotes | Depende de | Tam. | Entrega | Aceite |
|---|---|---|---|---|---|---|
| DS-07 | client: aposentar a skin de pedra do pacote | client, docs | DS-04 | P | Remove `assets/ui.ts`, `ui.test.ts`, `applyUiSkin` no `Shell`, toda `var(--ui-*)` de `shell.css`; `.slot-empty` vira rótulo; `docs/deploy.md` e `AGENTS.md` do cliente atualizados | `grep -r "ui-" packages/client/src/shell/shell.css` vazio; sem `library/ui/images` na rede; `pnpm check` |
| DS-08 | client: a casca e o topo do design | client | DS-07 | M | `Shell.tsx`/`shell.css`: topo 65 px, colunas 232 px opacas até o rodapé, mundo intocado ocupando o centro até o rodapé; `TopBar.tsx`: retrato-inicial, nome Cinzel, "VOCAÇÃO · LV N", pill de gold, wordmark ao centro (sem "players online"), seis ícones PNG de 36 px de `public/hud-icons/` (Hunts, Bot, Inventário, Analisador, Cyclopedia, Chat) com glifo de reserva, `ConnectionBadge`; `WindowId` ganha `chat`; media query ≤720 preservada | `Shell.test.ts` continua prendendo a ordem da direita; teste novo prende os seis ícones e a ausência de ícone sem janela; sem emoji no HTML; captura desktop e `resize_window` mobile |
| DS-09 | client: o chat como janela flutuante | client | DS-08 | P | `Chat.tsx` num `Panel` "CHAT" flutuante no canto inferior esquerdo sobre o mundo, `open.chat` no `Shell` (nasce aberto), fecha pelo × e pelo ícone do topo; mensagens de sistema em `--warn`/`--danger`, rolagem fina; no celular vira seção da página como as outras | Recusa do servidor (ex.: `bot-config` inválido) aparece no chat aberto; teste em `prerender` prende que nasce aberto; captura |

#### Fase D — As colunas

| # | Issue | Pacotes | Depende de | Tam. | Entrega | Aceite |
|---|---|---|---|---|---|---|
| DS-10 | client: coluna direita — vitais, set, bolsa e mochila | client | DS-08 | M | `VitalBar` HP/MP de 14 px no alto; `EquipmentPanel` 3×4 de 30 px com rótulo no vazio, linha "Cap usado / total oz" e gold; `ContainerWindow` com `Slot` de 26 px em 5 colunas; `AmmoPicker` como `Panel` ancorado | Testes existentes passam; arrastar item slot↔mochila↔bolsa continua mandando `move-item`; captura |
| DS-11 | client: painel Batalha | client | DS-08 | P | `BattlePanel.tsx` (a criar): criaturas do `world` lidas por intervalo (o padrão de `PartyMembers`), nome, HP % e barra de 3 px verde/amarela/vermelha; vazio na Cidade; sem moldura de alvo (`targetId` é M15) | `BattlePanel.test.ts` em `prerender` com `world` populado; `apply.test.ts` continua contando zero avisos por `creature-move` |
| DS-12 | client: coluna esquerda — bot no vBot do design e editor como modal | client | DS-08 | M | `BotPanel` em `Panel dock` "BOT": cabeçalho de categoria com n/slots, linha com `Switch traffic` · texto · ⚙ ▴ ▾ ×, "+ regra" secundário, aviso de gate; `RuleEditor` em `Modal` 480 com meta "slot n/N"; a ordem dos slots continua a prioridade | `BotPanel.test.ts` e `RuleEditor.test.ts` passam com as classes novas; ligar/desligar salva sozinho (debounce) e a meta diz "salvando… / salvo"; captura |
| DS-13 | client: painel Personagem | client | DS-08 | P | `CharacterPanel.tsx` (a criar): `StatRow` de Experiência, Level, HP, Mana, Capacidade, Stamina — só o que chega; sem barra de % (a curva não trafega) | Teste em `prerender`; nenhuma linha para dado inexistente |
| DS-14 | client: party na hunt e bolsa da party | client | DS-08 | M | `PartyMembers` com ★ líder, nome (você em ouro), `VitalBar` HP de 4 px, "caiu"; `PartyBag` como `Panel dock` "BOLSA DA PARTY" com grade de `Slot` 30 px, cap total/em uso com barra, texto do settlement; modo como texto | `PartyPanel.test.ts`/`PartyBag.test.ts` passam; captura com dois personagens em party (dev-login) |
| DS-15 | client: analisador no design | client | DS-08 | M | `Analyzer.tsx` em `Panel dock` "ANALISADOR": caixas "Sessão" (Tempo, XP, Gold, Gastos, Saldo, Mortos, Loot, Supplies, Maior golpe, Maior magia, Mortes) e "Por hora"; eventos notáveis; minimizável; "—" para opcional ausente; sem abas (só "Sessão" tem dado) | `Analyzer.test.ts` passa; `perHour` continua a única derivada; captura |

#### Fase E — Caçada e fechamento

| # | Issue | Pacotes | Depende de | Tam. | Entrega | Aceite |
|---|---|---|---|---|---|---|
| DS-16 | client: escolha de caçada como modal, com a party dentro, e as pills sobre o mundo | client | DS-12, DS-14 | M | `HuntsModal.tsx` (a criar) 860×560: lista com sprite dos outfits, nome, "level N+", "n tamanhos de pull · n drops", seleção de pull, rodapé "Level recomendado é conselho, não trava" e "Entrar na caçada"/"Trocar de caçada"; coluna direita com o `PartyPanel` de formação; `HuntActions.tsx` (a criar): pill "⚔ Escolher caçada" na Cidade, "↩ Sair da caçada »" na hunt; `HuntMenu.tsx` removido; `Bestiary` continua na coluna até SV-08 | `HuntsModal.test.ts` em `prerender` (lista do catálogo, sem estimativa de XP/h); entrar e sair continuam `enter-hunt`/`leave-hunt`; formação da party inalterada; captura na Cidade e na hunt |
| DS-17 | client: popover "Sair sozinho quando…" | client | DS-16 | P | Popover de 262 px no » da pill: HP abaixo de N %, acabar o gold, alguém do grupo sair (os três `kind` reais), gravando `draft.exit` pela store do bot; resumo "Saindo sozinho: …" | Teste em `prerender`; salvar manda `bot-config` com `exit`; captura |
| DS-18 | client: passe de celular e QA visual do M14 | client, docs | DS-05…DS-17 | M | Cada tela a 375 px (`resize_window`) e a 1440/1920; capturas anexadas às issues de origem; defeitos viram issue própria; `docs/product/*.md` e `AGENTS.md` do cliente conferidos; milestone fechado | Lista de capturas completa; `pnpm check`; "Pronto quando" satisfeito |
| DS-19 | docs: Configurações como preferências de conta e os sistemas futuros em `docs/product/` | docs | — | P | `docs/product/settings.md` (a criar; preferências de conta: idioma, som, tela — `não implementado`), e uma seção "sistemas futuros" ou arquivos próprios para Amigos, Arena, Bênçãos e Soul (`não implementado`, sem épico até o PRD os absorver); tabela de `docs/product/README.md` atualizada; `economy.md` registra o Market como livro de ordens de compra e venda sem taxa (decisão de 2026-09-16) | `pnpm docs-check` verde; cada arquivo novo com `**Status:**` na primeira linha não vazia |

**Pronto quando (M14):** um jogador entra pelo login novo, escolhe o personagem num card, vê o HUD
com topo, colunas e o chat flutuante no design, entra numa hunt pelo modal, liga e desliga regras
no painel do bot, escolhe quando sair sozinho, e lê o analisador — tudo com `pnpm check` verde,
sem requisição fora da origem, e sem nenhuma tela mostrando dado que o servidor não mandou.

### M15 · Design system — o servidor conta mais

Milestone [5](https://github.com/funkcaipora/draconya/milestone/5), só com esta lista na descrição — as specs vêm depois do M14.

Cada mudança de protocolo é **um campo, um schema, um teste**, e sempre opcional com `default`
para um nó `game` anterior num deploy em rolagem não quebrar o cliente novo (o precedente de
`bestBasicHit`). Toda expansão do `catalogue` mede o tamanho da mensagem antes e depois
(invariante 7: ela é fixada por sessão) e registra o número na PR.

| # | Issue | Pacotes | Depende de | Tam. | Entrega | Aceite |
|---|---|---|---|---|---|---|
| SV-01 | protocol/server: `value`, `attack` e `armor` em `catalogue.items[]` | protocol, server | M14 | P | Três campos opcionais lidos do conteúdo que já os tem (`itemSchema`) | Teste do codec; tamanho do catálogo medido |
| SV-02 | protocol/server/content: monstros e loot por hunt no catálogo | protocol, server, content | M14 | M | `catalogue.hunts[].monsterIds` (da `composition` por dificuldade), `catalogue.hunts[].loot[]` (item, sem raridade), `catalogue.monsters[].{health,experience}`; nunca XP/h ou gold/h | Teste do codec; `hunt.md` atualizado |
| SV-03 | protocol/server: vocação, level e mana dos membros da party | protocol, server | M14 | P | `PartyState.members[].{vocationId,level,manaPercent}` | Teste de `party-state`; `party.md` |
| SV-04 | protocol/sim/server: skills e magic level em `player-stats` | protocol, sim, server | M14 | M | `player-stats.skills` (melee, distance, magic: nível e % para o próximo) e `speed`; quanto expor é decisão registrada em `progression.md` | Teste do `sim` para a % (a fórmula já existe em `content/data/skills`); codec |
| SV-05 | protocol/sim/server: alvo atual, condições ativas e a hunt da instância | protocol, sim, server | M14 | M | `player-stats.targetId`; mensagem `active-conditions` (kind, expira em); `instance-enter.{huntId,difficulty}` | Codec; teste de `sim` para a expiração lógica (nunca por tick) |
| SV-06 | content/sim: regra de saída "acabar a capacidade" | content, sim | M14 | P | `kind: 'out-of-capacity'` em `botExitRuleSchema` e a avaliação no `sim`; `bot.md` | Teste do `sim`; `bot-config` não muda (é opaco) |
| SV-07 | server/protocol: jogadores online | server, protocol | M14 | P | Contagem no diretório de sessões, publicada numa mensagem própria a cada N s | Teste; "—" sem a mensagem |
| SV-08 | client: Cyclopedia — Bestiário e Itens | client | SV-01, SV-02 | M | `CyclopediaModal.tsx` (a criar) 860×600 com abas "Bestiary" (busca, cards com sprite, abates / próximo marco, barra, bônus no rodapé) e "Itens" (nome, categoria pelo slot, Atq/Def, peso); `Bestiary.tsx` deixa a coluna | Testes migrados de `Bestiary.test.ts`; "Este servidor não tem Bestiário" sem monstro; captura |
| SV-09 | client: modal Lure e alvo (bot avançado) | client | M14 | M | `LureTargetingModal.tsx` (a criar) 620: lure min/max com `max >= min`, política, priorizar/ignorar (monstros do catálogo), postura + tiles; `bot/store.ts` passa a editar `lure`; gate por `advancedFromLevel` | `store.test.ts` prende `ringSwap` opaco e `lure` editado; captura com level 50 |
| SV-10 | client: painel Skills completo e "Personalizar skills" | client | SV-04 | M | `CharacterPanel` ganha Magic Level, Speed e as skills com barra de %; modal de seleção de linhas com a escolha em `localStorage` (é conveniência de tela, não estado de jogo) | Testes; captura |
| SV-11 | client: party completa | client | SV-03 | P | Sigla da vocação na cor, "LV N", barra de MP por membro | Testes; captura |
| SV-12 | client: o mundo diz onde está — nome da área, buffs e moldura do alvo | client | SV-05 | M | Overlays sobre o viewport: "Rat Cellars · Ousado", badges de condição com tempo restante (lidos por intervalo), moldura `--blood-6` no alvo em Batalha e no mundo | Testes em `prerender` dos overlays; captura na hunt |
| SV-13 | client: modal Detalhes da caçada e loot possível | client | SV-02 | M | `HuntDetailsModal.tsx` (a criar) 680: monstros com vida e XP, loot possível; sem recorde de XP/h | Teste; captura |
| SV-14 | client: retrato com o sprite do outfit | client | M14 | P | `Portrait.tsx` (a criar): canvas de 32 px do outfit do próprio personagem, lido do `world` por intervalo, no topo e nos cards de entrada quando houver | Teste; captura |
| SV-15 | client: "N players online" no topo | client | SV-07 | P | O sub-título do wordmark, "—" sem a mensagem | Teste; captura |
| SV-16 | content/sim: Energy Ring e Life Ring | content, sim | M14 | M | Dois itens de dedo (`slot: finger`, `appearanceId` pelo `/assets`): **Energy Ring** — enquanto vestido, o dano que o personagem sofre é descontado da mana em vez da vida (o que passar da mana vai à vida); **Life Ring** — +300 % da regeneração base de vida e mana. Números em `content`, efeito no `sim` com teste; sem carga por enquanto (`charges` continua não consumido) | Testes do `sim` para os dois efeitos; `content:check` verde; `items.md` |
| SV-17 | client: modal Ring swap | client | SV-16 | P | `RingSwapModal.tsx` (a criar) 520: anel (do catálogo, `slot: finger`), equipar HP <, retirar HP > (validação `removeAbove > equipBelow`), piso de mana, ao retirar (restaurar / deixar vazio), diagrama; `bot/store.ts` passa a editar `ringSwap`; gate `advancedFromLevel` | `store.test.ts` prende `ringSwap` editado; teste do modal em `prerender`; captura com level 50 |

**Pronto quando (M15):** a Cyclopedia lista itens com ataque e armadura; a escolha de caçada mostra
os monstros e o loot de cada hunt; o painel Skills tem magic level e as skills com progresso; a
party mostra vocação e mana de cada membro; o mundo diz a área, os buffs e o alvo; o topo conta os
jogadores online; um Knight de level 50 configura o ring swap com o Energy Ring e vê a mana cair no
lugar da vida; e nenhuma dessas mensagens quebra um cliente antigo em deploy em rolagem.

---

## 6. Ordem de PRs e o que cada uma deixa funcionando

```
M14
DS-01 ─ DS-02 ─ DS-03 ─ DS-04 ─┬─ DS-05 ─ DS-06            (entrada; o jogo continua o de hoje)
                               └─ DS-07 ─ DS-08 ─┬─ DS-09  (casca; a partir daqui o HUD é o novo)
                                                 ├─ DS-10 ─ DS-11
                                                 ├─ DS-12 ─┐
                                                 ├─ DS-13  ├─ DS-16 ─ DS-17
                                                 ├─ DS-14 ─┘
                                                 └─ DS-15
                                                            DS-18 fecha
DS-19 (docs, independente, a qualquer momento)
M15
SV-01 ─┬─ SV-08          SV-04 ─ SV-10          SV-07 ─ SV-15
SV-02 ─┴─ SV-13          SV-05 ─ SV-12          SV-09, SV-14 (só M14)
SV-03 ─── SV-11          SV-06 (a quarta regra de saída entra em DS-17)
SV-16 ─── SV-17
```

- Até DS-04 nada muda na tela: tokens e primitivos entram sem consumidor, e o cliente abre igual.
- DS-07 é o único momento de "cor lisa": entre aposentar a pedra e DS-08 entrar, a casca fica
  com o fallback que já existe hoje sem pacote. As duas PRs são mescladas em sequência.
- A partir de DS-08, cada seção migra sozinha; uma seção velha ao lado de uma nova é aceitável
  entre PRs, e é por isso que `Panel` existe antes das seções.
- DS-10 a DS-15 são independentes entre si: cabem em subagentes paralelos, cada um na própria
  worktree, desde que nenhum toque nas mesmas classes de `shell.css` — cada seção ganha o próprio
  bloco na folha, prefixado (`.equipment-`, `.bot-`, `.analyzer-`).
- No M15, cada par servidor → tela é independente dos outros; a ordem dentro do marco é a que o
  dono do produto preferir ver primeiro.

---

## 7. Verificação

- **Testes.** Todo componente novo tem `*.test.ts` em `prerender` (`react-dom/static`), o padrão
  do pacote: prende estrutura, texto e `aria`, sem DOM. Não há teste de pixel; a fidelidade visual
  é conferida por captura.
- **`pnpm check`** em toda PR: lint (fronteiras), typecheck (o cliente entrou no `tsc` desde a
  FUN-22), testes, `docs-check`, `source-policy` (que recusa qualquer `.jsx` que sobrar).
- **QA no navegador**, com o stack local (`pnpm dev` + cliente na 5174, `POST /api/auth/dev-login`)
  e o pacote `things/1332`: captura por issue, anexada no comentário de entrega. Abaixo de 720 px
  por `resize_window` mobile. Aba de rede sem nenhuma origem externa. A captura é evidência para
  a revisão humana (o dono do projeto compara com o protótipo); o aceite que o agente fecha
  sozinho é o teste, o `grep` e o `pnpm check` — as duas coisas aparecem separadas em cada spec.
- **Ponto de partida verificado.** A #219 (QA visual do M12 com o pacote de arte) foi fechada em
  2026-09-16, com a PR #231 corrigindo os ids de efeito de fogo e terra: sprites, set, containers,
  bot, magias e runa já foram vistos com `things/1332`. As capturas deste plano comparam a casca
  nova contra essa base, não contra telas nunca conferidas.
- **Regressão de comportamento.** No M14 as intenções não mudam (`enter-hunt`, `leave-hunt`,
  `bot-config`, `move-item`, `select-ammo`, `choose-vocation`); cada issue lista os testes
  existentes que precisam continuar verdes, e a revisão adversarial confere que nenhum
  `sendIntent` novo apareceu. No M15, cada campo novo tem teste de codec e é opcional.

---

## 8. Adiado — e o que destrava cada coisa

| O que | Por quê agora não | Destrava |
|---|---|---|
| Arcos circulares de HP/mana ao redor do jogador (PRD §5.4) | é desenho no viewport (Pixi), não HUD em DOM | issue própria no E14, fora deste plano |
| Barra de ações com teclas, "Configurar ação" | não há intenção manual; hotkeys são do motor manual | **E10** |
| Automações (anel/colar por carga, munição por alvos, arma por HP, comer) | vocabulário do bot não tem essas ações; `charges`/`durationMs` nunca consumidos | **E4** — vocabulário novo, com PRD |
| Postura de combate; "Conjunto" por elemento; DPS/HPS; crítico e leech; gasto de outro membro | mecânicas de combate e agregações inexistentes | **E2** (#226, #235), analisador |
| Despachar loot; raridade e PEGAR/VENDER por hunt | mecânicas de economia inexistentes | **E5** |
| Loja, Leilão, cristais, Premium | E13 não começou | **E13** — decidido em 2026-09-16: o Market é um livro de ordens de compra e venda (vendedor, quantidade, preço, total), **sem taxa**; `economy.md` registra em DS-19 |
| Guild, Prey, Bosstiary, Treino, Quests | sistemas não implementados | **E12, E7, E11, E8** |
| Configurações (preferências de conta: idioma, som, tela) | entra no PRD como sistema (2026-09-16), mas não há preferência real para persistir ainda | `docs/product/settings.md` em DS-19; a tela nasce com a primeira preferência (o idioma, quando a i18n vier) |
| Amigos, Arena, Bênçãos, Soul; mundo/realm | viram sistemas futuros em `docs/product/` (DS-19), sem épico | um PRD para cada antes de qualquer issue |
| i18n PT/EN | sem infraestrutura nem persistência de preferência | decisão de produto; endpoint de preferências |
| Janelas arrastáveis, modal expandido do analisador, cap reservado da bolsa, "próximo level" | sem dado a mais, sem sentido no celular, ou a curva de XP não trafega | quando houver o que mostrar |
| Aba Outfit do modal Personagem (editor de cores) | a cor própria só se lê (`world.creatures`); não há intenção C2S para trocá-la | intenção nova + gravação no `sim` (E7, aparência pós-tutorial do §7.4) |

---

## 9. Riscos

- **Sem teste de pixel, a fidelidade depende de olho.** O `prerender` prende estrutura, não
  aparência. Mitigação: captura obrigatória por issue, e o dono do projeto compara com o
  `index.html` do handoff aberto ao lado.
- **O handoff está incompleto e inconsistente** (cinco modais sem arquivo, três tamanhos para o
  mesmo slot, duas bases de tela). As issues fixam os números do §1; quem executa não abre o
  protótipo para decidir.
- **Dezenove PRs pequenas, dezessete delas em `shell.css`.** Conflito é o risco de subagentes paralelos; a
  mitigação é o bloco prefixado por seção (§6) e mesclar a fundação antes de abrir o leque.
- **A expectativa de "barra de ações" e "loja" no topo.** O design vende telas que o produto não
  tem; a decisão D8 deixa o topo com cinco ícones. Está no §10 para o dono do produto confirmar.
- **Aposentar a skin de pedra é irreversível na prática.** `assets/ui.ts` sai do código; voltar é
  reescrever. O ADR registra a decisão para ela não ser revertida por costume.
- **`transform: scale` vai ser pedido de novo** quando alguém abrir o protótipo numa tela grande
  e vir o HUD "pequeno". A resposta é D3: as colunas têm largura fixa e o mundo cresce.
- **Um agente que só olhe o handoff reintroduz o que o ADR cortou** (login com senha, barra de
  ações, modais flutuantes). Cada spec cola D1–D9 no "Contexto arquitetural", como o template manda.
- **Crescer o `catalogue` no M15 cresce a mensagem fixada por sessão.** Cada SV-* mede e registra
  o tamanho; se passar do razoável, o campo vira mensagem própria sob demanda.
- **O experimento da engine web (E16) corre em paralelo.** As issues #109–#127 (branch
  `claude/otclient-web-experiment`, sem milestone, decisão pendente) estudam trocar o viewport
  Pixi por um OTClient em WebAssembly, com "o que fica na HUD Lua e o que fica no React" (#122) em
  aberto. Este plano só toca `shell/` e nunca `world/`, então não bloqueia nem depende dele — mas
  os primitivos e os tokens são o que sobrevive a qualquer troca de engine, e é mais um motivo
  para eles virem antes das telas.

---

## 10. Decidido — as respostas do dono do produto (2026-09-16)

1. **Barra de ações:** adiada para o E10. O painel do bot é a única vista das regras.
2. **Chat:** janela flutuante sobre o mundo, no canto inferior esquerdo, que abre e fecha pelo
   ícone do topo; nasce aberta. Sem faixa inferior no layout — o mundo vai até o rodapé.
3. **Ícones PNG:** são arte do dono; os catorze entram versionados em `public/hud-icons/`.
4. **Slot vazio:** o rótulo do design. `assets/ui.ts` sai inteiro.
5. **i18n:** adiada; o cliente continua só em pt-BR.
6. **Market:** livro de ordens de compra e venda (vendedor, quantidade, preço, total), **sem
   taxa** — os dois modelos juntos. `economy.md` registra; o E13 herda.
7. **Fora do PRD:** Configurações entra como sistema (preferências de conta); Amigos, Arena,
   Bênçãos e Soul viram sistemas futuros em `docs/product/`, sem épico ainda (DS-19).
8. **Skills expostas:** nível e % para o próximo, das três skills (SV-04).
9. **Anéis:** entram no M15 — Energy Ring (o dano vai na mana em vez da vida) e Life Ring
   (+300 % da regeneração base), e o modal Ring swap junto (SV-16, SV-17).
10. **Milestones:** "M14 · Design system — fundação e revestimento" com as issues DS-01…DS-19;
    "M15 · Design system — o servidor conta mais" criado só como milestone, com a lista do §5 na
    descrição, para as specs serem escritas depois do M14. A PR #243 é mesclada quando o CI passar.
