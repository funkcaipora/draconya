# 0030 — Fidelidade estrita ao ui_kit: a composição renderizada do kit é a especificação da tela

**Status:** aceito
**Data:** 2026-09-16
**Contexto técnico:** `packages/client` (toda a casca `shell/`); `packages/protocol`, `packages/sim`,
`packages/content`, `packages/server` (campos e mecânicas que as telas do kit exigem, sequenciados
em `docs/kit-fidelity-plan.md`); `docs` (este ADR, o plano e `docs/prd-ui-behavior.md`)

## Contexto

O M14 revestiu o cliente com o design system do handoff seguindo o ADR 0029, que deliberadamente
cortou ou adiou partes do kit: a barra de ações (D5), as janelas flutuantes e os modais com abas
(D6), o primitivo `Stance` (D2), e todo ícone de sistema inexistente (D8). Em 2026-09-16 o dono do
produto reviu a direção: **"siga o ui_kit na risca, tudo deve ficar exatamente como no kit"**. Uma
auditoria de 24 agentes (9 regiões, verificação adversarial, 148 achados confirmados — o inventário
completo está em `docs/kit-fidelity-plan.md`) mediu a distância entre o kit e o cliente e mostrou
que "na risca" não é um pedido de CSS: ele reabre decisões do 0029 e exige sistemas que não existem
(motor de prioridade de ações, posturas, DPS/HPS, analisador por item). A auditoria também mostrou
que o próprio kit se contradiz — componentes definidos e nunca montados (`BotPanel`, `RuleRow`,
`RuleEditorModal`), cinco modais referenciados sem arquivo, tokens que a tela desenhada desmente,
números divergentes para o mesmo dado (HP 3.165 na coluna vs 3.065 no modal) — então "o kit" precisa
de uma definição operacional antes de virar especificação.

## Decisão

1. **A composição RENDERIZADA do kit é a especificação da tela do cliente.** Vale o que
   `ui_kits/draconya/App.jsx` monta (mais as telas de `Entry.jsx`), como o `index.html` do handoff
   mostra. NÃO são especificação: código morto do kit (`BotPanel`/`RuleRow`/`RuleEditorModal`,
   nunca montados), token que a tela desmente (vale o desenhado, regra que o plano do M14 já
   fixou), dados de mentira de `data.js`, os hacks de protótipo (`transform: scale`, drag por
   `window.__drScale`, `localStorage dr.screen`), credenciais/e-mail de demonstração, o rodapé
   "v0.1 · design system" e o realm "Ignis" (o jogo não tem mundos). Quando o kit se contradiz,
   vence o que está desenhado na tela renderizada; os cinco modais sem arquivo
   (`AnalyzerModal`, `ActionConfigModal`, `AutomationConfigModal`, `AddAutomationModal`,
   `SkillsCustomizeModal`) e o `NumField` são especificados via `/spec` na língua do kit.
2. **Reverter a decisão 5 do ADR 0029: a barra de ações entra, e a fileira inferior de 124 px
   volta com ela.** As ações da barra são a nova vista das regras do bot — clicar num slot
   CONFIGURA (intenção `bot-config`, como hoje), quem executa é o servidor (ADR 0002, invariante
   11); o disparo manual por tecla entra quando o opcode de intenção manual existir (E10). O
   comportamento funcional da barra — prioridade por ordem de slot, cooldown compartilhado,
   condições em AND, tooltip de bloqueio — é o do PRD de comportamento v2, versionado em
   `docs/prd-ui-behavior.md`, e o vocabulário novo do bot que o sustenta tem ADR próprio quando o
   épico abrir. O painel Bot atual (`BotPanel`/`RuleEditor`) continua como vista interina e é
   aposentado quando a barra + Automações o substituírem — nunca antes de o motor existir.
3. **Reverter a decisão 6 do ADR 0029 em parte: a geografia do kit vale.** Analisador de caçada e
   Party loot viram janelas FLUTUANTES e arrastáveis sobre o mundo (posições iniciais do kit;
   posição por navegador em `localStorage`, como o próprio 0029 previa se um dia entrassem), e
   nascem abertas na hunt. Personagem e Cyclopedia viram modais com abas; a party ganha o modal
   "Gerenciar party" (abas Formação / Na hunt) — o mecanismo do ADR 0027 não muda, muda onde a
   tela mora. Coluna esquerda: Skills, Automações, Party; coluna direita: vitais, set com posturas
   e cap, Bolsa, Mochila, Batalha. O chat continua existindo como janela flutuante (não há chat no
   HUD do kit), mas **nasce fechado** e abre pelo ícone do topo; recusa do servidor com o chat
   fechado acende o ícone. Abaixo de 720 px nada disso flutua: janela flutuante vira seção do modo
   página — o kit não desenha celular, e a regra atual continua valendo lá.
4. **Emendar a decisão 2 do ADR 0029: o primitivo `Stance` entra** (`shell/ui/Stance.tsx`), e o
   controle aparece no set como o kit desenha — **desabilitado** até a mecânica de postura existir
   no `sim` (épico E2). Controle visível e inerte é fidelidade; controle interativo sem mecânica
   seria mentira na tela.
5. **Emendar a aplicação da decisão 8 do ADR 0029: superfície do kit não se corta, se sequencia.**
   O estado FINAL da tela é o kit inteiro; o estado intermediário mostra o subconjunto que já é
   verdade do servidor. Ícone/linha/painel de sistema inexistente continua não aparecendo enquanto
   o sistema não existe (nada de botão "em breve", nada de dado inventado — invariante 4 intocado),
   mas cada superfície do kit agora tem épico nomeado e destino registrado no plano; nenhuma é
   "fica de fora" permanente.
6. **Exceções nomeadas que permanecem**, cada uma pelo motivo original e nenhuma por costume:
   `transform: scale` não entra (pixel art borra e `@media` morre — D3 continua); o login não tem
   campos de e-mail/senha (ADR 0012 — o card é fiel no resto, e reverter isso é decisão de
   autenticação, não de fidelidade); a vocação continua sendo escolhida em jogo no level 8
   (ADR 0026 d.1 — o próprio README do kit admite que a tela de vocação na entrada é
   simplificação); o toggle PT/EN espera o épico de i18n; gold continua saldo no ledger
   (invariante 10) — o tile GOLD da Bolsa mostra o saldo, nunca um item; o "+20 % de premium" do
   modal Personagem não é reproduzido (o benefício real do premium é outra coisa).
7. **Cinco decisões de produto que o kit e o PRD v2 pressupõem ficam nomeadas no plano e são
   confirmadas pelo dono na primeira issue de cada uma:** supply/munição como estoque contável
   (o PRD v2 pressupõe quantidade; hoje é débito de gold por uso), rateio de custos e divisão de
   loot como dois eixos independentes (reabre ADR 0027 d.5), a saída com contagem de cinco
   segundos que o texto do popover promete, munição como slot físico sempre visível (reabre
   ADR 0026 d.3) e o formulário de login próprio (reabre ADR 0012).

## Alternativas

- **Fidelidade ao código-fonte do kit, não ao renderizado** — descartado: metade do fonte é morto
  (o `BotPanel` do kit nunca é montado; cinco modais não têm arquivo) e o dono aprovou a TELA, não
  o repositório do protótipo.
- **`transform: scale` como o protótipo** — descartado de novo pelas razões do 0029: escala
  fracionária borra pixel art e mata o modo página do celular.
- **Stance interativo já, sem mecânica** — descartado: um controle que muda de cor e não muda o
  jogo ensina ao jogador uma mecânica que não existe.
- **Cortar permanentemente o que não tem sistema (manter o D8 como teto)** — descartado: era a
  leitura do 0029, e é exatamente o que o dono reverteu; o teto agora é o kit, o D8 governa o
  caminho.
- **Reproduzir contagens de consumível como decoração** — descartado: inventa um estoque que o
  motor não modela; a contagem entra quando a decisão de produto (estoque vs débito) for tomada.
- **Manter o painel Bot e a barra de ações lado a lado para sempre** — descartado: duas vistas
  permanentes da mesma configuração divergem; a barra substitui o painel quando o motor chegar.

## Consequências

O que fica mais fácil: as issues de fidelidade citam "ADR 0030" em vez de reabrir D5/D6 uma a uma;
o inventário completo (148 achados, região por região, com evidência arquivo:linha) vive em
`docs/kit-fidelity-plan.md` e cada spec nasce de lá; o PRD de comportamento v2 entra no repositório
e vira a especificação funcional do motor de ações. O que fica mais difícil: janelas flutuantes
exigem regra própria de celular e posição persistida; o cliente convive com duas vistas do bot
(painel interino + barra) durante a transição do motor; o topo diverge do kit até Loja/Guild/
Amigos/Prey/Configurações existirem — e isso é intencional, não bug. O que precisa mudar: o
ADR 0029 recebe o status "parcialmente substituído pelo 0030" (D5 e D6 caem; D2, D3 e D8 são
emendados; D1, D4, D7 e D9 continuam); `docs/design-system-plan.md` aponta para o plano novo;
`docs/design-system.md` é atualizado pelas issues do plano (gradientes dos vitais, Stance,
FloatingWindow, geometria com a fileira de 124 px).

## Invariantes afetados

Nenhum. O invariante 4 é reforçado: a barra de ações entra como superfície de CONFIGURAÇÃO
(intenção `bot-config`), e o disparo manual só existe quando houver opcode de intenção — nunca
resultado calculado no cliente. O invariante 10 é a razão de o tile GOLD mostrar saldo e não item.
O invariante 11 é o motivo de a barra ser primeiro uma vista do bot: automação é o modo default do
jogo, o manual é o extra.
