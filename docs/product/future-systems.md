# Sistemas futuros

**Status:** não implementado (as quatro seções abaixo)
**PRD:** nenhuma seção do PRD v0.9 cobre Amigos, Bênçãos ou Soul; §31 cobre PvP/Arena, mas só
para excluí-la do MVP (ver "Divergências do PRD" de cada seção)
**Épico:** sem épico até o PRD absorver cada sistema (`docs/design-system-plan.md` §8)

## Por que um arquivo só

Diferente de `prey.md` ou `guilds.md` — que já têm seção do PRD e épico atribuído —, os quatro
sistemas abaixo não têm nenhum dos dois: eles só existem porque o handoff do design system os
desenhou ou mencionou, sem que o produto tenha decidido construí-los. Um arquivo por sistema
deixaria "Parâmetros de balanceamento" e "Em aberto" vazios em quatro lugares; aqui eles
compartilham a mesma pergunta ("quando o PRD adotar isto, o que muda") e a mesma resposta ("nada
ainda"). Quando um PRD chegar para um deles, ele ganha arquivo próprio, como `prey.md` tem hoje.

## Amigos

**Status:** não implementado

O handoff desenha um modal "Amigos" (440 px, abas Amigos/Pedidos/Bloqueados; lista com nome,
vocação, level, localização, mensagem e convite para party — `SocialModal`,
`ui_kits/draconya/Modals.jsx:158-166`, ver a spec da issue #262 para o trecho). Não existe lista
de amigos, pedido de amizade, bloqueio nem status online-para-amigo em nenhuma camada do código
(`protocol`, `server`, `sim`, `content`). Sem seção do PRD.

## Arena

**Status:** não implementado

O handoff cita "Arena" só como rótulo de uma aba dentro do modal "Escolha uma caçada"
(`HuntsModal`, `ui_kits/draconya/Modals.jsx:42`), sem conteúdo atrás — não há tela, dado nem
sistema de pontuação desenhados. O PRD §31 ("PvP fora da Guild War") já fecha isso:
"[MVP] Não existe PvP aberto, arena ranqueada, duelo ou outros modos no vertical slice. Arenas e
modos competitivos padronizados podem ser explorados futuramente […] mas estão fora do escopo
atual." Arena não é, então, um `[ABERTO]` do PRD — é uma exclusão explícita do MVP, sem data.

## Bênçãos

**Status:** não implementado

O handoff mostra um badge "Bênção ativa" fixo no canto superior direito do mundo (`World`,
`ui_kits/draconya/Hud.jsx:92`), sem modal, sem regra de compra nem efeito descrito em lugar
nenhum do pacote. Não existe conceito de bênção em `packages/sim` nem `packages/content`, e o
PRD não tem seção sobre o assunto.

## Soul

**Status:** não implementado

O handoff lista "Soul Points" como uma das estatísticas de personagem (`DR.allSkills` e
`DR.defaultSkills`, `ui_kits/draconya/data.js:17-21`), usada só para popular o seletor da tela
"Personalizar skills" — um dos cinco modais que `App.jsx` abre e nenhum arquivo do handoff define
(`docs/design-system-plan.md` §1: `SkillsCustomizeModal`). Não há campo de soul em
`CharacterRuntime`, no protocolo nem no conteúdo (confirmado: `grep -rli "soul" packages/sim
packages/content` vazio), e nenhuma mecânica do PRD depende dele (invocação com custo de soul,
por exemplo, não existe no Draconya).

## Divergências do PRD

Não se aplica a Amigos, Bênçãos e Soul — nenhum dos três existe no PRD v0.9. Arena diverge só no
sentido de já ter uma seção que a EXCLUI (§31): citar essa seção aqui é o registro de que "Arena"
não é uma lacuna do PRD, é uma decisão do PRD, e o rótulo do handoff é o único lugar em que ela
aparece com esse nome.
