---
name: design
description: Use ao criar ou revisar uma tela do cliente Draconya no sistema de design — que cor, que classe CSS, que primitivo (Panel vs Modal, Slot vs Badge) usar, e se uma tela segue os tokens. Acione com "que cor eu uso aqui", "isso é um Panel ou um Modal", "confere se essa tela segue o design system", "preciso de um botão gold", "qual classe para esse slot".
---

# Design system do cliente

Os fundamentos de marca — cores, tipografia, tom de texto, estados, o que é placeholder — vivem em
`docs/design-system.md`. Leia-o primeiro; ele é o documento vivo, atualizado quando a marca muda.

As variáveis CSS (`--gold-4`, `--ash-1`, `--shadow-panel`…) vivem em
`packages/client/src/shell/tokens.css` (a criar em DS-02). Nunca escreva uma cor ou sombra literal
num `.tsx` ou `.css` do cliente — use a variável; se a variável que você precisa não existir,
pare e pergunte antes de inventar um valor.

Os primitivos de UI (Button, Panel, Modal, Slot, VitalBar…) vivem em
`packages/client/src/shell/ui/` (a criar em DS-03/DS-04), um arquivo `.tsx` por primitivo, estilo
em `packages/client/src/shell/ui.css` por classe. Nunca estilo inline (`style={{…}}`) e nunca
`useState` para hover/foco/pressionado — isso é CSS puro por pseudo-classe. Nenhum primitivo
importa `state/`, `bot/`, `party/`, `account/` ou `net/`: primitivo é folha, não lê store
(ADR 0007).

## O que este skill NÃO faz

Não copia HTML/JSX de nenhum handoff externo direto para o repositório — código de produção do
cliente é sempre `.tsx` (ADR 0016 recusa `.jsx`). Não gera protótipo solto fora do fluxo de
issues do milestone M14/M15 (`docs/design-system-plan.md`); se o pedido for um mockup descartável
fora do produto, isso é trabalho de outra ferramenta, não desta skill.

## Onde a decisão de arquitetura está registrada

ADR 0029 tem as nove decisões (tokens sem CDN, primitivos sem estilo inline, mundo sem
`transform: scale`, vidro ferro-forjado no lugar da pedra do pacote, chat flutuante sem barra de
ações, geografia fixa com modal para visita, entrada sem senha, tela só mostra verdade do
servidor, marca em `docs/`). Cite-o (`ADR 0029 Dn`) em vez de redecidir.
