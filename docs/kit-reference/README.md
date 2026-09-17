# Capturas de referência do ui_kit

**O que é:** o handoff "Design System MMORPG Medieval" renderizado, capturado tela a tela. É a
régua visual do [plano de fidelidade](../kit-fidelity-plan.md) (ADR 0030): quem executa uma issue
compara a captura da issue com a captura daqui, lado a lado — **sem precisar do zip**, que não é
versionado (ADR 0029 D9: é `.jsx` de protótipo) e fica com o dono do projeto.

**Proveniência:** renderizado em 2026-09-16 a partir do `ui_kits/draconya/index.html` do handoff,
em Chrome headless com `deviceScaleFactor: 1`, idioma PT. O jogo em **1800×1010** (a base do
`GameScreen`; nessa janela o `Scaled` do protótipo fica em escala 1 — pixel exato) e a entrada em
**1600×900** (o viewport que o próprio kit declara; a entrada é fluida). Estados escolhidos por
`localStorage` (`dr.screen`) e cliques nos controles reais do protótipo.

## Onde está cada coisa

| O quê | Onde |
|---|---|
| A régua visual (estas capturas) | `docs/kit-reference/*.png` |
| Ícones do topo e fontes | Já versionados desde o M14: `packages/client/public/hud-icons/`, `packages/client/public/fonts/` |
| Tokens (cores, espaçamento, efeitos) | `packages/client/src/shell/tokens.css` (código) + `docs/design-system.md` (marca) |
| Estrutura e medidas, arquivo:linha | [`reviews/kit-fidelity-audit-2026-09-16.md`](../reviews/kit-fidelity-audit-2026-09-16.md) |
| O JSX de cada tela | A spec de cada issue cola o trecho (mecanismo do M14 — quem executa não tem o zip) |
| O zip do handoff | Com o dono do projeto (`~/Downloads`), fora do repositório |

## As capturas

| Arquivo | O que mostra |
|---|---|
| `01-entry-login.png` | Login — com os campos de e-mail/senha do protótipo, que NÃO entram (ADR 0012 / 0030 §6); vale o resto do card |
| `02-entry-characters.png` | Seleção de personagem (duas etapas, ◆/◇, "Entrar no jogo →"); o "· Ignis" dos cards não entra (sem realm) |
| `03-entry-class.png` | Escolha de vocação como tela — referência VISUAL dos ClassCard; o fluxo continua em jogo no level 8 (ADR 0026 d.1) |
| `10-hud-hunt.png` | **A tela-mestra**: HUD em caçada com Analisador e Party loot flutuantes, colunas completas e barra de ações |
| `11-hud-hunt-exit-rules.png` | Popover "Sair sozinho quando…" aberto (4 regras, na ordem do kit) |
| `12-hud-city.png` | HUD na Cidade: "⚔ Escolher caçada", Batalha vazia, "Cidade · zona protegida" |
| `20-modal-character.png` | Personagem (aba Personagem) — atenção: HP/Cap/ML deste modal contradizem a coluna; vale a coluna (plano §1) |
| `21-modal-hunts.png` | Escolha de caçada (3 colunas: lista, detalhe+monstros, loot) — a Tabs do topo é inerte no próprio kit |
| `22-modal-cyclopedia.png` | Cyclopedia (abas Itens/Bestiary/Bosstiary; Pager decorativo) |
| `23-modal-party.png` | Gerenciar party (abas Formação / Na hunt) |
| `24-modal-hunt-details.png` | Detalhes da caçada — "Seu recorde" NÃO entra (decisão de produto, plano §3b) |
| `25-modal-dispatch-loot.png` | Despachar loot (E5) |
| `26-modal-lure-targeting.png` | Lure e alvo (SV-09) — **com shim** (ver abaixo) |
| `27-modal-swap-ring.png` | Ring swap (SV-17) — **com shim** (ver abaixo) |
| `28-modal-guild.png` | Guild (E12) |
| `29-modal-social.png` | Amigos (sem épico ainda) |
| `30-modal-prey.png` | Prey (E7) |
| `31-modal-settings.png` | Configurações — "Salvas na conta" exige endpoint que não existe |
| `32-modal-shop.png` | Loja (E13) — aba "Loja" do ShopModal: destaque, categorias, packs, painel de compra |
| `33-modal-shop-auction.png` | Casa de leilões (E13) — aba "Leilão" do mesmo modal: livro de ordens de compra e venda (o Market sem taxa da decisão de 2026-09-16), filtros, "Só leitura — negocia na cidade" |

**Shim do `NumField` (26 e 27):** esses dois modais quebram no protótipo original — usam um
componente `NumField` que o kit nunca define (lacuna catalogada na auditoria). Para a captura,
o `NumField` foi reconstruído minimamente na língua visual do kit (rótulo mono maiúsculo + campo
escuro `--surface-slot`), a mesma leitura que o M14 já fixou (`Input` pequeno numérico, ADR 0029
D2). **Os campos numéricos dessas duas capturas são reconstrução, não desenho original** — o
resto do modal é o kit intacto.

**O que não tem captura, e por quê:** os cinco modais sem arquivo (`AnalyzerModal`,
`ActionConfigModal`, `AutomationConfigModal`, `AddAutomationModal`, `SkillsCustomizeModal`) — não
existem nem no protótipo; nascem por `/spec` na língua do kit. Em particular, **clicar em
"+ ADICIONAR" (Automações) e nas engrenagens das automações comuns quebra o próprio protótipo** —
não há desenho a capturar; o único contrato que o kit dá para o "Adicionar automação" está em
`App.jsx:39`: o modal devolve um nome, e a automação nasce desligada com o resumo "Nova automação ·
configure as condições" (o resto é spec a escrever no M18, com o
[PRD de comportamento](../prd-ui-behavior.md) §5 como fonte: UC-AUT-001…005). O
`BotPanel`/`RuleEditorModal` do kit — código morto, nunca montado (plano §1). Estados de celular —
o kit não desenha mobile; a regra do modo página continua a do cliente.

## Como regenerar

Com o zip do handoff em mãos: servir a pasta do handoff por HTTP (o `index.html` usa `fetch` nos
`.jsx` — `file://` não funciona), abrir `ui_kits/draconya/index.html` num Chrome headless
(`puppeteer-core` serve) com viewport 1800×1010 (jogo) ou 1600×900 (entrada) e
`deviceScaleFactor: 1`, escolher a tela por `localStorage.setItem('dr.screen', …)`
(`login`/`characters`/`class`/`game`), esperar o "Carregando…" sumir e `document.fonts.ready`, e
clicar nos controles reais (ícones do topo por `title`, pills por texto). Para os modais 26/27,
definir `window.NumField` antes do clique. Capturar sem `fullPage`.
