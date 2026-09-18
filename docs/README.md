# docs/

Índice. Ordem de leitura para quem chega no projeto: `prd-v0.9.md` → `architecture.md` →
`technical-architecture.md` → `system-architecture.md` → `harness-plan.md`.

| Documento | O que é | Natureza |
|---|---|---|
| [`prd-v0.9.md`](./prd-v0.9.md) | O que o produto pretendia ser na data do handoff técnico — a entrada deste projeto. | Instantâneo |
| [`architecture.md`](./architecture.md) | Restrições que o design do jogo impõe ao motor. | Instantâneo |
| [`technical-architecture.md`](./technical-architecture.md) | Arquitetura de sistema e plano de execução do MVP: épicos, fases, estimativas. | Instantâneo |
| [`system-architecture.md`](./system-architecture.md) | Visão integrada e atual de onde cada componente roda e de como uma hunt atravessa o sistema. | Vivo |
| [`harness-plan.md`](./harness-plan.md) | Como o harness deste repositório (`CLAUDE.md`, hooks, skills, CI) foi projetado, e por quê. | Instantâneo |
| [`adr/`](./adr/) | Uma decisão técnica por arquivo: contexto, decisão, alternativas descartadas, consequências. | Vivo — cresce a cada decisão |
| [`product/`](./product/) | O que cada sistema faz de fato, hoje, incluindo onde e por que divergiu do PRD. | Vivo — atualizado quando um sistema sai do papel |

## Instantâneo × vivo

Um documento **instantâneo** registra uma decisão ou um plano tomado numa data. Não é reescrito
para acompanhar o código depois — se ficar desatualizado, a resposta é um ADR novo ou uma
atualização em `product/`, nunca editar o instantâneo para fingir que ele previu o resultado.

Um documento **vivo** é atualizado no mesmo commit que muda o comportamento que ele descreve.
`adr/` só cresce — decisão nova é arquivo novo, decisão revista é um ADR que substitui o anterior,
nunca uma edição que apaga o histórico. `product/` é editado no lugar sempre que o sistema
descrito muda.

## PRD × product/

`prd-v0.9.md` é a entrada — o que se pretendia construir, congelado na data do handoff. Não é
reescrito depois, nem quando a implementação diverge dele: `docs/product/` é quem registra a
leitura do PRD confrontada com o que foi de fato construído, inclusive os pontos `[ABERTO]` que
a implementação teve que resolver sozinha, sem esperar resposta.
- [`infrastructure.md`](infrastructure.md) — fornecedores, recursos e custo estimado em três estágios. Vivo.
- [`deploy.md`](deploy.md) — como subir local e na VPS, os três papéis, drenagem e backup. Vivo.
- [`runtime-configuration.md`](runtime-configuration.md) — requisitos por papel, exemplos de ambiente e persistência do bot entre processos, com falhas, rollback e testes. Vivo.
- [`party-hunt-plan.md`](party-hunt-plan.md) — o desenho da party de hunt (M13), com os exemplos que o ADR 0027 referencia. Instantâneo.
- [`design-system-plan.md`](design-system-plan.md) — o plano de implementação do design system do cliente (M14), com as decisões que vão para o ADR 0029. Instantâneo; D5/D6 caíram no ADR 0030.
- [`kit-fidelity-plan.md`](kit-fidelity-plan.md) — o plano de fidelidade estrita ao ui_kit (pós-M14): decisões revisadas (ADR 0030), inventário de 148 achados e os marcos M16–M17 + M15 revisado, executados. Instantâneo; o M18 e o restante foram redesenhados em `hud-contract-plan.md`.
- [`hud-contract-plan.md`](hud-contract-plan.md) — o plano do contrato do HUD (pós-M17, ADR 0032): o que a imagem do kit já tem no cliente e o que falta, região a região, e os marcos M18 (barra de ações, estoque e automações), M21 (postura, moedas, loot e skills), M22 (topo e mundo) mais o que entra no M20. Instantâneo.
- [`hud-contract-tasks.md`](hud-contract-tasks.md) — as etapas e tarefas do plano do contrato do HUD, só com objetivo e critério de aceite: o ponto de partida do `/spec` de cada issue. Vivo até o último marco fechar.
- [`spatial-world-plan.md`](spatial-world-plan.md) — o brief técnico do mundo espacial (M23): janelas de câmera, cena por andar com painter order, walking tile e visibilidade de andares, em números do OTClient. Instantâneo.
- [`prd-ui-behavior.md`](prd-ui-behavior.md) — PRD de comportamento da interface e automações (v2, do dono do produto): a especificação funcional do motor de ações do M18. Instantâneo.
- [`reviews/kit-fidelity-audit-2026-09-16.md`](reviews/kit-fidelity-audit-2026-09-16.md) — a evidência da auditoria kit × cliente por trás do ADR 0030 (9 regiões, verificação adversarial, mapa de capacidade do protocolo). Instantâneo.
- [`reviews/hud-parity-audit-2026-09-18.md`](reviews/hud-parity-audit-2026-09-18.md) — a evidência do ADR 0032: a captura do HUD atual e os três levantamentos (cliente por região, modelo de jogo por sistema, decisões vigentes) sobre o commit `700ec7e`. Instantâneo.
- [`kit-reference/`](kit-reference/README.md) — o ui_kit renderizado e capturado tela a tela (19 PNGs): a régua visual das issues do plano de fidelidade, para quem executa sem o zip do handoff. Instantâneo.
