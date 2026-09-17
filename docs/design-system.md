# Sistema de design do cliente

**Status:** vivo — atualizado sempre que uma decisão de marca muda; a decisão de arquitetura em
si vive no ADR 0029. Condensa `DESIGN_SYSTEM.md` e `README.md` do handoff "Design System MMORPG
Medieval" (Claude Design, 2026-09-15) — o zip não é versionado; fica com o dono do projeto.

Draconya é um MMORPG 2D em pixel art no estilo Tibia — medieval sombrio, dragões, sangue e ouro
antigo. Quatro vocações: Cavaleiro (corpo a corpo), Paladino (distância/sagrado), Druida
(cura/gelo/terra), Feiticeiro (dano/fogo/energia).

## Tom e conteúdo

Português do Brasil, solene e direto, segunda pessoa, frases curtas, sem exclamação e sem emoji.
Kickers em caixa alta com tracking largo ("BEM-VINDO DE VOLTA"); títulos em Cinzel, sentence case
("Continuar a jornada"); rótulos de HUD em mono caixa alta ("EXP/H"); valores abreviados em kk/k,
separador de milhar pt-BR (2.134.760); CTA no infinitivo, Cinzel caixa alta ("ENTRAR", "FORJAR
PERSONAGEM"). Frase-assinatura: "Cada jornada deixa uma história."

## Cores

Pretos quentes de cinza (`--ash-*`, base #070505/#0d0908) — nunca azul-preto. Vermelho-sangue
`--blood-3 #6e0f14` é o primário (CTA in-game, HP, alvo, perigo). Ouro velho `--gold-4 #c9a24d` é
o acento (bordas, kickers, títulos de janela, CTA de entrada). Texto em pergaminho (`--parchment-*`),
nunca branco puro. Elementos e vocações têm matiz própria.

## Tipografia

Cinzel (display, 400–900) para títulos; IBM Plex Sans para corpo; JetBrains Mono para dados de HUD
(substitui o `ui-monospace` de hoje). As três vêm de `packages/client/public/fonts/`, nunca de
CDN (ADR 0022, D1 do ADR 0029) — Cinzel e Plex Sans com `OFL.txt` ao lado.

## Janelas, slots e estados

Painel: vidro ferro-forjado — borda 1px, anel interno preto, fio dourado de 1px no topo, barra de
título 34px, corpo com sombra `0 18px 45px #000b`. Slots: 36px (ação), 30px (equipamento e party),
26px (container) — números da TELA do handoff, que divergem dos tokens do zip; o plano adota a
tela (`docs/design-system-plan.md` §1). Hover = borda dourada + brilho; selecionado = anel dourado
interno; foco = 2px ouro; pressionar = `translateY(1px)`; desabilitado = opacidade .55. Nenhuma
sombra colorida fora de glow de ouro/sangue em foco ou seleção.

Janelas flutuantes usam FloatingWindow: arrastam pela faixa do título, fora dos 60 px dos botões,
e lembram a posição por navegador em localStorage, nunca por conta ou sessão. Abaixo de 720 px
viram blocos estáticos do modo página.

## Layout fixado (números que DS-02/DS-08 leem daqui)

Topo: **65 px**. Colunas laterais: **232 px**, opacas até o rodapé. Título de painel: **34 px**.
A barra de ações do handoff (124 px) não entra (ADR 0029 D5) — o mundo ocupa o espaço até o
rodapé, com as pills de caçada centralizadas nele.

## O que é placeholder

Sprites, outfits, montarias e imagens de loja não existem no handoff — entram como retângulo
tracejado com rótulo até o produto os ter (o cliente já segue essa regra para sprite ausente).
Nenhuma dessas telas ganha imagem nesta issue.

## Ícones do topo

Catorze PNGs 128×128 em `packages/client/public/hud-icons/` (DS-08): oito são arte autoral do
dono do projeto, do repositório pessoal tibia-idle (character, combat, chat, actions, analyzer,
inventory, loot, party); seis são gerados em canvas sobre a mesma moldura (analyzer-chart,
bestiary, guild, social, prey, settings) — provisórios até a arte oficial, confirmados como uso
autorizado em 2026-09-16. Nenhum é sprite do cliente oficial do Tibia.

## O que este documento NÃO decide

Toda escolha de arquitetura (D1–D9: por que sem `transform: scale`, por que o chat é flutuante,
por que a barra de ações fica de fora) está no ADR 0029, não aqui — este documento é fundamento de
marca; a decisão de engenharia é registro à parte, para não divergirem quando um mudar sem o
outro.
