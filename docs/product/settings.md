# Configurações

**Status:** não implementado
**PRD:** não existe no PRD v0.9 — sistema criado pela decisão de produto de 2026-09-16
(`docs/design-system-plan.md` §10, item 7)
**Épico:** sem épico até o PRD absorver o sistema (`docs/design-system-plan.md` §8)

## Comportamento

O handoff do design system ("Design System MMORPG Medieval") desenha um modal "Configurações"
(440 px, aberto por um ícone fixo no topo) com três blocos: Idioma (PT/EN), Som (Efeitos, Música)
e Tela (nomes das criaturas, barras de vida, números de dano e cura, abrir loot ao matar). Nenhum
desses campos tem onde persistir hoje: não há coluna de idioma/som/tela em conta nem em
personagem, não há endpoint em `account/api.ts`, e o cliente é só pt-BR (D7 do
`docs/design-system-plan.md` — "sem infraestrutura de tradução no cliente"). A tela não é
construída no M14: a issue #262 (DS-19) resolve só documentar o sistema como `não implementado`,
seguindo a regra D8 do plano ("ícone do topo para sistema inexistente não aparece").

## Regras

- Nenhuma preferência de conta persiste hoje; o modal do handoff (`SettingsModal`,
  `ui_kits/draconya/Modals.jsx:147-157`) é referência visual, não contrato — ver a spec da issue
  #262 para o trecho.
- O ícone "Configurações" do topo (`TopBar`, `ui_kits/draconya/Hud.jsx:1-25`) não entra no HUD
  enquanto este sistema for `não implementado` (D8).
- Quando a primeira preferência real existir (o candidato natural é o idioma, quando a i18n for
  desenhada), a tela nasce com essa preferência só — não com as seis do handoff de uma vez
  (`docs/design-system-plan.md` §8: "a tela nasce com a primeira preferência").

## Parâmetros de balanceamento

Nenhum — não há número de jogo neste sistema (é preferência de interface, não regra de
progressão, combate ou economia).

## Em aberto

- Qual preferência de conta o produto quer priorizar primeiro (idioma? som? tela?) — sem decisão
  registrada além de "a i18n é a candidata quando vier" (D7).
- Se as preferências de tela (nomes das criaturas, barras de vida, números de dano) devem ser
  client-only (`localStorage`, conveniência de navegador) ou persistidas na conta (como o rodapé
  do modal do handoff promete: "Salvas na conta · valem em qualquer dispositivo") — hoje não há
  endpoint para nenhuma das duas, e a diferença importa: preferência de conta atravessa
  dispositivo, `localStorage` não.

## Divergências do PRD

Não se aplica — o sistema não existe no PRD v0.9; ele nasce diretamente como `não implementado`
em `docs/product/`, por decisão de produto de 2026-09-16.
