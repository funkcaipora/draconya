# Relatórios de importação de catálogo

**Como ler:** cada `<tipo>-report.md` nesta pasta é gerado por `pnpm catalog:import <tipo>`
(ADR 0038) — nunca escrito à mão. Ele lista quantas entidades cada fatia de
`packages/content/data/<tipo>/generated/` recebeu e, principalmente, o que o Canary tem mas o
Draconya **não gerou**: um sistema posterior ao pacote de arte 13.32 (Monk, Weapon Proficiency,
Animus Mastery/Soulpit), ou uma mecânica que o `sim` ainda não executa. Nada some em silêncio —
reimportar sempre recupera o campo que um schema futuro passar a aceitar, porque o relatório sai
do MESMO dado bruto que o `generated/`, não é copiado à mão.

Sem data de geração de propósito: o mesmo commit do Canary sempre produz o mesmo relatório, byte
a byte — um timestamp sujaria o diff de toda reimportação sem nenhuma entidade ter mudado.

Nenhum `<tipo>` está registrado ainda (M34-01, #572 — infraestrutura pura). O primeiro relatório
real nasce com o importador de itens (#573): `items-report.md`.

Ver `docs/adr/0038-tibia-catalog-import-tooling.md` para a decisão completa. A documentação de
como o importador funciona (`scripts/catalog/`) vive em `packages/tools/AGENTS.md`, porque
`scripts/` não é um pacote e não tem `AGENTS.md` próprio.
