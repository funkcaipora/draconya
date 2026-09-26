# 0046 — Estado por instância de item: imbuement e tier da Forja

**Status:** proposto — decorre do [ADR 0037](0037-tfs-canary-fidelity-except-action-bar-and-automation.md)
decisão 1; nenhuma das doze questões do plano bloqueia esta decisão diretamente (ver seção
própria)
**Data:** 2026-09-25
**Contexto técnico:** `packages/content` (`schemas.ts` — entrada de inventário, item), `packages/sim`
(cálculo de decaimento sob demanda, resolver de combate lendo o overlay)
**Issues:** M40 — #604 a #607; M43-02 (#617)

## Contexto

`packages/content/src/schemas.ts:576-577` fixa, por decisão de produto (§21.2,
`docs/product/items.md:58`), que **duas espadas do mesmo id são idênticas** — "item melhor é item
diferente", sem rolagem aleatória por instância. É uma regra central: apaga toda a matemática de
variação de item e a pergunta "por que a minha é pior".

Imbuement e a Forja da Exaltação quebram essa regra no Tibia real: dois exemplares do mesmo item
podem ter imbuements diferentes (tipo e tempo restante) e tier diferente (0–10, com procs
próprios — Onslaught, Ruse, Momentum, Transcendence, Amplification). O decaimento de imbuement no
Canary só corre **em combate e fora de zona de proteção**
(`ImbuementDecay::canDecayImbuement`, `src/creatures/players/imbuements/imbuements.cpp:~473-497`
— checa `hasCondition(CONDITION_INFIGHT)` e `hasFlag(TILESTATE_PROTECTIONZONE)`), nunca por tick
de relógio; a duração de um imbuement é **20 horas** (`duration="72000"` em segundos,
`data/XML/imbuements.xml:2-4`), a mesma para as três categorias (Basic/Intricate/Powerful).

O problema de arquitetura é reconciliar as duas coisas: a regra de identidade fixa por id
continua valendo para o **catálogo**, mas a **instância no inventário de um personagem**
precisa de um lugar para guardar o que diverge dela.

## Decisão

1. **O item do catálogo continua fixo pelo id** — a regra de `schemas.ts:576-577` não muda; dois
   itens do mesmo id continuam com os mesmos atributos base.
2. **A entrada de inventário ganha um overlay por instância**, opcional e persistido, com
   imbuements (tipo, slot, tempo restante) e tier (0–10). É a exceção explícita à identidade fixa,
   escopada à entrada de inventário — não ao item de catálogo.
3. **Item com overlay não empilha.** Um item que carrega estado de instância deixa de ser
   fungível com outro exemplar do mesmo id sem esse estado — a mesma lógica que já distingue
   consumível empilhável de equipamento único, estendida a "tem overlay" como um terceiro caso.
4. **O decaimento de imbuement é calculado sob demanda**, a partir do tempo acumulado em combate
   fora de zona de proteção — nunca por tick de relógio (invariante 2), na mesma disciplina que
   stamina e cooldown de skill já usam.
5. **Tier e imbuement entram nas fórmulas de combate pelo perfil vigente** — `combat-v3` (ADR
   0040) ou o que estiver aceito quando M40/M43 chegarem —, como modificador declarado, nunca como
   ramo condicional fora do resolver canônico.

## Questões em aberto (decisão do dono)

Nenhuma das doze questões em aberto do plano de paridade trava esta decisão especificamente — a
duração de 20 h, o gatilho de decaimento e os ids de categoria já foram verificados contra o
`imbuements.xml`/`imbuements.cpp` locais, sem ambiguidade de número a resolver. O status
**proposto** existe porque esta é a primeira exceção formal à regra "item é fixo por id"
(`schemas.ts:576-577`, `items.md:58`) desde que ela foi escrita, e uma mudança nesse nível — ainda
que aditiva — merece a confirmação explícita do dono do produto antes de entrar em
`packages/content`, na mesma régua que qualquer decisão que reabre uma regra já registrada em
`docs/product/`.

## Alternativas

- **Multiplicar ids de catálogo por combinação de imbuement/tier.** Descartada: o catálogo já
  tem milhares de entradas (ADR 0038); multiplicar por imbuement (dezenas de tipos) e tier (11
  valores) por item explodiria o catálogo sem necessidade, e ADR 0014 proíbe id de entidade
  mudar — uma "espada +2 com imbuement de fogo" não é uma entidade nova, é uma instância.
- **Decair imbuement por tick, como um cooldown de relógio.** Descartada pelo invariante 2: nada
  é escrito por tick; o cálculo sob demanda a partir do tempo acumulado em combate é a mesma forma
  que já resolveu stamina e defesa por `blockCount` (ADR 0040).
- **Ignorar a regra de identidade fixa e permitir rolagem por instância em qualquer item.**
  Descartada: contradiria `docs/product/items.md` §21.2 diretamente, e o problema que essa regra
  resolve (variação infinita da mesma peça) continua válido para todo item sem imbuement/tier.

## Consequências

- M40 (#604–#607: overlay e slots, catálogo de imbuements, efeitos em combate, Santuário de
  Imbuement na Cidade) e M43-02 (#617, tier por instância e procs) ficam desbloqueados quanto ao
  contrato de dado.
- `docs/product/items.md` ganha uma seção nova descrevendo o overlay como exceção nomeada à regra
  de identidade fixa, com o motivo — para que a exceção não pareça uma violação silenciosa na
  próxima leitura do documento.
- Snapshot de personagem ganha um campo opcional por entrada de inventário; ausente continua
  lendo como "sem overlay", sem bump de `SNAPSHOT_FORMAT_VERSION`.
- M43-01 e M43-03 (criaturas Influenced/Fiendish no spawn e a Forja como tela de Cidade) dependem
  desta decisão para ter onde escrever o tier resultante de uma fusão, mas não fazem parte do
  escopo deste ADR — só a decisão 2 (a forma do overlay) é compartilhada.

## Invariantes afetados

Nenhum muda de texto. O invariante 2 é quem exige que o decaimento seja calculado sob demanda. O
invariante 6 continua intocado: overlay carrega tipo e tempo restante, nunca `appearanceId` nem
caminho de arte.
