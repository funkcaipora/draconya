# 0029 — Sistema de design do cliente: tokens do handoff, chrome sobreposto e vidro ferro-forjado no lugar da pedra do pacote

**Status:** aceito
**Data:** 2026-09-16
**Contexto técnico:** `docs` (este ADR e `docs/design-system.md`); `packages/client` (regras que
as issues DS-02…DS-19 e SV-01…SV-17 do M14/M15 implementam a partir daqui — nenhum arquivo de
`packages/client` muda NESTA issue)

## Contexto

O handoff "Design System MMORPG Medieval", gerado pelo Claude Design em 2026-09-15, é uma
referência visual de alta fidelidade (tokens, quinze primitivos, o fluxo de entrada, o HUD e
catorze modais, em HTML/JSX de protótipo) para revestir `packages/client/src/shell`, hoje
funcional e sem identidade. O próprio handoff diz que não é código de produção. Ele também tem
cinco modais sem arquivo, números inconsistentes entre token e tela, e nenhuma regra de celular —
e o produto diverge dele em seis pontos que um agente só olhando o zip reintroduziria: layout
escalado por `transform`, barra de ações no lugar do chat, login com senha, vocação como tela de
entrada, fonte por CDN, janelas arrastáveis. O desenho completo, com as alternativas descartadas e
o porquê de cada divergência, está em `docs/design-system-plan.md` (aprovado pelo dono do produto
em 2026-09-16, §10); este ADR fixa o que ali é decisão de arquitetura.

## Decisão

1. **Tokens como variáveis CSS em `packages/client/src/shell/tokens.css`, fontes servidas da
   mesma origem.** Nomes iguais aos do handoff (`--gold-4`, `--ash-1`…); Cinzel, IBM Plex Sans e
   JetBrains Mono baixadas para `public/fonts/` com `OFL.txt`, nunca por CDN (ADR 0022).
2. **Primitivos de UI em `.tsx` com classes CSS, nunca estilo inline nem `useState` para hover.**
   `shell/ui/*.tsx` a partir dos quinze primitivos do handoff (quatorze entram; `Stance` fica de
   fora — não existe postura de combate no `sim`); nenhum primitivo importa store (ADR 0007).
3. **O mundo continua em tela cheia, sem `transform: scale`; o chrome do design é CSS absoluto
   sobreposto.** Topo de 65 px e colunas de 232 px opacas até o rodapé; o canvas mantém `inset: 0`
   e o zoom inteiro de sempre (`zoomFor`). Abaixo de 720 px, o modo página existente (mundo em
   faixa de 40vh, seções empilhadas) não muda.
4. **O vidro ferro-forjado do design substitui a pedra do pacote de assets na casca; o pacote
   fica só para sprite de item, outfit e mundo.** `assets/ui.ts`, `applyUiSkin` e as variáveis
   `--ui-*` são aposentados; slot vazio mostra o rótulo do lugar, não um ícone do pacote.
5. **O chat é uma janela flutuante fixa no canto inferior esquerdo, que abre e fecha pelo ícone do
   topo e nasce aberta; a barra de ações do handoff não entra.** Não existe intenção C2S de
   "usar agora" no protocolo — toda ação de combate é regra do bot avaliada no servidor
   (ADR 0002); "tecla dispara ação" é do E10 (motor manual), fora deste plano.
6. **Geografia fixa para o loop diário (seção de coluna, minimizável, nunca removida); modal para
   visita (scrim + Panel, um por vez); nada arrastável.** Bot, Personagem e Party-na-hunt à
   esquerda; Set, bolsa, mochila, Batalha, bolsa da party e Analisador à direita (mantém ADR 0026
   d.7); a formação da party continua dentro do modal de escolha de caçada (mantém ADR 0027), não
   separada como no handoff.
7. **A entrada não tem campo de senha; a escolha de vocação continua em jogo, no level 8.** O CTA
   "ENTRAR →" e o link "Criar conta" chamam `beginLogin()` (AuthKit, ADR 0012); sem e-mail, sem
   senha, sem "mundo"/realm (o jogo não tem); sem i18n (PT/EN fica de fora).
8. **Toda tela mostra só o que o protocolo mandou.** Campo opcional ausente é "—"; dado que não
   existe em mensagem nenhuma não aparece a linha; ícone do topo para sistema inexistente (Loja,
   Guild, Amigos, Prey, Configurações) não aparece.
9. **A referência de marca vive em `docs/design-system.md` (documento vivo); os tokens vivem em
   `tokens.css` (código); a skill `/design` aponta para os dois.** O zip do handoff não é
   versionado (é `.jsx`, proibido pelo ADR 0016, e é protótipo). Os catorze PNGs do topo (oito
   autorais do dono, do projeto tibia-idle; seis gerados em canvas) entram versionados em
   `packages/client/public/hud-icons/`, com nota de origem no documento de marca.

## Alternativas

- **`@import` de Google Fonts para as três fontes** — descartado: o deploy é de origem única
  (ADR 0022); seria a primeira requisição externa do cliente.
- **CSS Modules, CSS-in-JS ou pré-processador para os primitivos** — descartado: o repositório
  tem uma folha e classes; é o padrão que `TopBar.tsx` e o resto já seguem.
- **Portar o `style={{…}}` do handoff literalmente, com hover em `useState`** — descartado: custa
  um render por movimento de mouse numa base que hoje tem zero estilo inline.
- **Canvas de 1800×1010 escalado por `transform: scale()`, como o protótipo** — descartado: escala
  fracionária borra pixel art, e `transform` não dispara `@media`, matando o modo celular.
- **Manter a pedra do pacote ao lado do vidro do design, ou fundir os dois conjuntos de token** —
  descartado: o chrome novo não usa PNG nenhum, o mecanismo ficaria vivo sem consumidor, e a pedra
  do Tibia é justamente o risco jurídico do §13.1 do PRD.
- **Barra de ações 2×12 como espelho das regras do bot** — descartado: não há intenção C2S para
  disparar ação manual; duplicaria o painel do bot sem mudar comportamento nenhum.
- **Janelas flutuantes arrastáveis (Analisador, bolsa da party)** — descartado: exige posição por
  janela sem sentido no modo página do celular, e o handoff a implementa com `mousemove` manual.
- **Vocação como tela de entrada, como o handoff desenha** — descartado: contraria ADR 0026 d.1,
  que já fixou a escolha em jogo, no level 8.
- **Login com e-mail e senha, como o card do handoff sugere no rodapé** — descartado: contraria o
  ADR 0012 (autenticação delegada ao WorkOS).
- **Versionar o zip do handoff no repositório** — descartado: contém `.jsx` (ADR 0016 recusa) e é
  protótipo, não produção; vira ruído no histórico do git sem nunca ser a fonte de verdade.

## Consequências

O que fica mais fácil: as dezoito issues seguintes do M14 citam "ADR 0029 Dn" em vez de reabrir a
discussão; um agente que só leia o repositório (sem o handoff) tem em `docs/design-system.md` e
`tokens.css` tudo que precisa para não reintroduzir login com senha ou barra de ações. O que fica
mais difícil: aposentar `assets/ui.ts` é irreversível na prática — reverter exige reescrever a
skin de pedra do zero, e por isso o ADR registra a decisão para ela não ser desfeita por costume
(D4). O que precisa mudar: `docs/design-system-plan.md` sai de "proposto" para "aprovado";
`docs/adr/README.md` ganha a linha 0029; nenhum `CLAUDE.md` muda, porque nenhum dos onze
invariantes é afetado.

## Invariantes afetados

Nenhum. O invariante 4 (cliente só manda intenção) é reforçado, não alterado: a decisão 5 explica
por que a barra de ações NÃO entra — seria a primeira tela a tentar mandar mais que intenção sem
um opcode que sustente isso, e por isso fica para o E10. O invariante 6 (`content/` nunca contém
arte) não muda: a decisão 4 aposenta a skin de pedra da CASCA do cliente (painéis, molduras), não
o pipeline de sprite de item/outfit/mundo, que continua indexado por `appearanceId`/`outfitId`. O
invariante 7 (versão de conteúdo fixada na sessão) não muda: nenhuma issue deste marco cresce o
`catalogue`; quando M15 crescer, cada issue mede o tamanho antes e depois (plano §5, nota do M15).
