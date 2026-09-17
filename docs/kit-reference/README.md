# Capturas de referência do ui_kit

**O que é:** o handoff "Design System MMORPG Medieval" renderizado, capturado tela a tela. É a
régua visual do [plano de fidelidade](../kit-fidelity-plan.md) (ADR 0030): quem executa uma issue
compara a captura da issue com a captura daqui, lado a lado — **sem precisar do zip**, que não é
versionado (ADR 0029 D9: é `.jsx` de protótipo) e fica com o dono do projeto.

**Proveniência:** renderizado em 2026-09-16 a partir do `ui_kits/draconya/index.html` do handoff,
em Chrome headless com `deviceScaleFactor: 1`, idioma PT. O jogo em **1800×1010** (a base do
`GameScreen`; nessa janela o `Scaled` do protótipo fica em escala 1 — pixel exato) e a entrada em
**1600×900** (o viewport que o próprio kit declara; a entrada é fluida). Estados escolhidos por
`localStorage` (`dr.screen`) e cliques nos controles reais do protótipo. As capturas 01–33 vêm do
kit v2 (`Medieval2.zip`) e as 34–40 do **kit v3** (`Medieval3.zip`, mesmo dia), que acrescentou ao
`Modals.jsx` — só por adição, nada existente mudou — os cinco modais que faltavam; as capturas
anteriores continuam válidas.

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
| `34-modal-action-config.png` | Configurar ação (kit v3, M18): Tipo/Ação/Atalho F1–F12, switch "automática", condições em E, rodapé "A ação dispara sozinha enquanto ligada · o atalho continua manual". O título mostra "SLOT NAN" — bug de fiação do protótipo (`App.jsx` passa `{i, a}`, o modal espera `{index, label}`); o desenho vale |
| `35-modal-add-automation.png` | Adicionar automação (kit v3, M18): as seis automações, incluindo "Comer comida" — sem lastro no PRD e sem mecânica de fome; o dono confirma na spec |
| `36-modal-automation-renew-ring.png` | Automação "Renovar anel" (kit v3, M18): item + "Renovar quando" (cargas/tempo), "Pega o próximo da mochila principal" — pressupõe a decisão P1 (estoque) |
| `37-modal-automation-arrow.png` | Automação "Trocar arrow por alvos" (kit v3, M18) — **com shim** do `NumField` (ver abaixo) |
| `38-modal-automation-weapon-shield.png` | Automação "Trocar arma/escudo por vida" (kit v3, M18): sets defensivo/ofensivo, condições de entrada em OU e de saída em E, aviso de faixa morta |
| `39-modal-skills-customize.png` | Personalizar skills (kit v3, RC-04): checkboxes em duas colunas, meta "N de M visíveis", Padrão/Salvar; a ordem do painel é a da lista — sem arrastar |
| `40-modal-analyzer-expanded.png` | Analisador expandido (kit v3, RC-02): as linhas de `analyzer.rows` com /h na terceira coluna — todo dado já trafega hoje (`Aggregates` + /h no cliente) |

**Shim do `NumField` (26, 27 e 37):** esses modais quebram no protótipo original — usam um
componente `NumField` que o kit nunca define, nem no v3 (lacuna catalogada na auditoria). Para a captura,
o `NumField` foi reconstruído minimamente na língua visual do kit (rótulo mono maiúsculo + campo
escuro `--surface-slot`), a mesma leitura que o M14 já fixou (`Input` pequeno numérico, ADR 0029
D2). **Os campos numéricos dessas duas capturas são reconstrução, não desenho original** — o
resto do modal é o kit intacto.

**O que não tem captura, e por quê:** o `BotPanel`/`RuleEditorModal` do kit — código morto, nunca
montado (plano §1; no v3 o `ActionConfigModal` assume o papel do editor de regra). Estados de
celular — o kit não desenha mobile; a regra do modo página continua a do cliente. (Os cinco modais
que faltavam no v2 foram entregues no kit v3 e estão nas capturas 34–40; o comportamento por trás
deles é o do [PRD de comportamento](../prd-ui-behavior.md) §5, §15–§24.)

## Como regenerar

Com o zip do handoff em mãos: servir a pasta do handoff por HTTP (o `index.html` usa `fetch` nos
`.jsx` — `file://` não funciona), abrir `ui_kits/draconya/index.html` num Chrome headless
(`puppeteer-core` serve) com viewport 1800×1010 (jogo) ou 1600×900 (entrada) e
`deviceScaleFactor: 1`, escolher a tela por `localStorage.setItem('dr.screen', …)`
(`login`/`characters`/`class`/`game`), esperar o "Carregando…" sumir e `document.fonts.ready`, e
clicar nos controles reais (ícones do topo por `title`, pills por texto). Para os modais 26/27,
definir `window.NumField` antes do clique. Capturar sem `fullPage`.
