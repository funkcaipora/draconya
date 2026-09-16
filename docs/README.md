# docs/

Índice. Ordem de leitura para quem chega no projeto: `prd-v0.9.md` → `architecture.md` →
`technical-architecture.md` → `harness-plan.md`.

| Documento | O que é | Natureza |
|---|---|---|
| [`prd-v0.9.md`](./prd-v0.9.md) | O que o produto pretendia ser na data do handoff técnico — a entrada deste projeto. | Instantâneo |
| [`architecture.md`](./architecture.md) | Restrições que o design do jogo impõe ao motor. | Instantâneo |
| [`technical-architecture.md`](./technical-architecture.md) | Arquitetura de sistema e plano de execução do MVP: épicos, fases, estimativas. | Instantâneo |
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
- [`design-system-plan.md`](design-system-plan.md) — o plano de implementação do design system do cliente (M14), com as decisões que vão para o ADR 0029. Instantâneo.
