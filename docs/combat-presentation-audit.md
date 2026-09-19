# Auditoria de apresentação de combate

**Status:** bloqueada pela biblioteca parcial — auditoria executável, re-rodar quando o pacote
estiver completo
**Issue:** #242 (CMB-09)
**Contexto técnico:** `content` (tabela de aparências), `server` (host que resolve os ids);
método e exceções. Não muda mecânica, protocolo nem cliente.

Esta auditoria confere os ids de **efeito, projétil e impacto** que o combate desenha contra o
pacote de arte local. Ela existe porque um id de aparência não tem nome: o índice da biblioteca
não diz o que um número desenha, e um id trocado desenha outra coisa sem erro nenhum — foi o
defeito da #219, em que fogo e terra estavam trocados (15/16) e só a inspeção do PNG pegou.

O contrato do `sim` é uma **chave semântica**; o id de arte é resolvido pelo host a partir da
tabela versionada (`appearances/baseline.json`). A escolha do CMB-06 só entra depois da QA de
arte da mesma versão. Invariantes 1, 3, 6 e 7: `content/` só tem ids, `sim` não conhece
apresentação, e a versão da tabela participa da versão de conteúdo fixada na sessão.

## O contrato

```ts
interface CombatPresentationReference {
  readonly semanticKey: string;   // o que sim/server usam: `spell:divine-missile`, `ability:spit`
  readonly effect?: number;       // animação no tile, resolvida pela tabela versionada
  readonly missile?: number;      // projétil do conjurador ao alvo
  readonly verifiedAgainst: string; // o pacote/versão contra o que o id foi conferido
}
```

A chave semântica permanece o que `sim`/`server` usam; o host resolve o id pela tabela. Não é
payload de runtime: é o mapa que a auditoria percorre, e está materializado no teste
[`appearances.test.ts`](../packages/content/src/appearances.test.ts).

## Método

- **DT-01 — um PNG de verdade é evidência.** Descartado: nome ou id vizinho. Motivo: os ids já
  foram trocados por palpite uma vez (#219).
- **DT-02 — `_open` registra a incerteza.** Descartado: declarar equivalência sem prova. Motivo:
  a auditoria tem que ser re-rodável, e um id "confirmado" que ninguém consegue reconferir é
  pior que um id marcado como pendente.
- **DT-03 — não versionar arte.** Descartado: commitar sprites. Motivo: limite jurídico
  ([ADR 0008](adr/0008-tibia-client-assets-with-indirection.md)) e invariante 6.

O procedimento, por referência:

1. ler o id na tabela `appearances/baseline.json`;
2. localizar a aparência em `things/<versão>/library/appearances/<effect|missile>.jsonl`;
3. pegar o **primeiro** `spriteIds[0]` do primeiro `frameGroup` e abrir
   `things/<versão>/library/sprites/<milhar>/<id>.png`;
4. comparar com a semântica aprovada (fogo é chama, terra é respingo verde, gelo é azul, sagrado
   é dourado, …) e só então gravar ou corrigir o id.

A skill [`/assets`](../.claude/skills/assets/SKILL.md) é o passo a passo da consulta. Nenhum
caminho de PNG, nome de folha ou binário entra em `packages/content` (invariante 6).

## Versão e integridade do pacote

| Campo | Valor |
|---|---|
| Pacote / versão | `tibia-1332` (`things/1332/`) |
| Inventário versionado | `packages/content/data/packs/tibia-1332.json` |
| SHA-256 do `.dat` | `896c96e6ab490a7063ff0fb5ce95cfd0b2717e9dc0ed355605fc08e84555d6ec` |
| `pnpm assets:inventory --check` | **confere** (o inventário bate com o `.dat`) |
| Biblioteca | `things/1332/library/`, `modern-cip`, gerada em `2026-09-18T01:21:07.909Z` |
| Aparências no índice | object 36147, outfit 1280, effect 160, missile 54 |
| Folhas | **47 de 4171** (`complete: false`, faltam 4124) |
| Sprites | **5508 de 184443** |

### O bloqueio: biblioteca parcial

A biblioteca local foi construída de um pacote-fonte **incompleto**: o `.dat` de aparências está
inteiro, mas faltam 4124 das 4171 folhas de sprite. O gerador não chama um pacote incompleto de
completo — as folhas ausentes entram no índice com `png: null` (ver
[`asset-library.md`](asset-library.md)).

Consequência para esta auditoria: **os 33 ids de efeito/projétil do combate existem no índice de
aparências** (a definição está no `.dat`), mas o primeiro sprite de **nenhum** deles tem PNG
disponível. As folhas de efeito e projétil ficam nas faixas `159852–162508`; as folhas presentes
cobrem `0–2447`, `3611–3646`, `162530–164977`, `217614–217757`, `221831–221974` e
`226068–226355` — nenhuma sobrepõe os efeitos/projéteis de combate. Portanto **nenhuma
conferência visual foi possível**, e nenhum id foi corrigido: sem PNG não há evidência (DT-01).

Isto não contradiz a #219 (2026-09-15), que viu fogo e terra com o pacote. O pacote desta máquina
mudou — a biblioteca atual é parcial —, e a auditoria registra o estado de HOJE em vez de herdar
uma confirmação que não consegue reproduzir.

## Os 33 ids auditados

Todos existem no inventário versionado (o `pnpm assets:inventory --check` e o
`appearances.test.ts` prendem isso). `sprite` é o primeiro `spriteIds[0]`; `PNG` diz se a folha
dele está na biblioteca parcial. **Nenhum tem PNG.**

| tipo | id | sprite | PNG | usado por |
|---|---|---|---|---|
| effect | 1 | 159852 | ausente | `hit:melee` |
| effect | 2 | 159858 | ausente | lesser-ethereal-spear, ethereal-spear, ethereal-barrage |
| effect | 7 | 160899 | ausente | scorch, fire-wave, great-fire-wave, hells-core |
| effect | 9 | 159908 | ausente | recovery-knight, recovery-paladin |
| effect | 10 | 159916 | ausente | lesser-front-sweep, brutal-strike, whirlwind-throw, berserk, front-sweep, physical-strike |
| effect | 12 | 159935 | ausente | strike, buzz, energy-strike (sorcerer/druid), lightning, strong-energy-strike |
| effect | 13 | 159951 | ausente | heal, bruise-bane, wound-cleansing, protector, intense-wound-cleansing, light/intense/divine healing, salvation, magic-patch, magic-shield, ultimate-healing, mass-healing, mana-potion |
| effect | 14 | 159973 | ausente | haste (4 vocações), blood-rage, charge, sharpshooter, swift-foot, health-potion |
| effect | 16 | 160913 | ausente | apprentices-strike, flame-strike, strong-flame-strike (#219: chama) |
| effect | 17 | 160017 | ausente | terra-strike, mud-attack, strong-terra-strike, death-strike, great-death-beam (#219: respingo verde) |
| effect | 34 | 160932 | ausente | groundshaker |
| effect | 37 | 160954 | ausente | energy-beam, great-energy-beam, energy-wave, rage-of-the-skies |
| effect | 38 | 160205 | ausente | blast |
| effect | 39 | 160826 | ausente | divine-defiance, **divine-missile, divine-barrage** |
| effect | 41 | 160962 | ausente | chill-out, ice-wave, strong-ice-wave, **avalanche-rune** |
| effect | 42 | 160979 | ausente | eternal-winter |
| effect | 43 | 160996 | ausente | ice-strike (sorcerer/druid), strong-ice-strike |
| effect | 45 | 160962 | ausente | terra-wave, forked-thorns |
| effect | 49 | 160232 | ausente | divine-caldera |
| effect | 54 | 161139 | ausente | wrath-of-nature |
| missile | 3 | 162053 | ausente | ammunition:arrow |
| missile | 4 | 162061 | ausente | apprentices-strike, flame-strike, strong-flame-strike, ammunition:burst-arrow |
| missile | 5 | 162069 | ausente | strike, buzz, energy-strike, lightning, strong-energy-strike, weapon:wand-of-vortex |
| missile | 10 | 162102 | ausente | physical-strike |
| missile | 11 | 162103 | ausente | death-strike |
| missile | 22 | 162139 | ausente | ammunition:sniper-arrow |
| missile | 23 | 162147 | ausente | ammunition:onyx-arrow |
| missile | 25 | 162500 | ausente | whirlwind-throw |
| missile | 28 | 162508 | ausente | lesser-ethereal-spear, ethereal-spear, ethereal-barrage |
| missile | 29 | 162179 | ausente | ice-strike (sorcerer/druid), strong-ice-strike |
| missile | 30 | 162187 | ausente | terra-strike, mud-attack, strong-terra-strike |
| missile | 31 | 162195 | ausente | **divine-missile, divine-barrage** |
| missile | 39 | 162259 | ausente | forked-thorns, weapon:snakebite-rod |

A decisão de cada id fica registrada no `_open` do arquivo de conteúdo que o possui — as 75
magias, a `avalanche-rune`, as quatro munições e as duas armas com projétil —, e a tabela completa
está aqui. Os ids vivem só em `appearances/baseline.json` (invariante 6); nenhum caminho de PNG
entra no conteúdo.

## Decisões

### Divine Missile e Divine Barrage — manter, incerteza explícita

O levantamento original apontou o **effect 39** (sprite 160826) sem confirmação satisfatória, e a
#219 já tinha olhado os divinos e os deixado: "no PNG in the pack convincingly matched a holy
effect". A biblioteca de hoje é parcial e o sprite 160826 não está nela, então não há PNG para
comparar. A decisão é **manter o effect 39 e o missile 31**, com a incerteza registrada — não
inventar fidelidade (DT-02). O `_open` de `divine-missile` e `divine-barrage` diz isso, e o
mesmo vale para `divine-defiance` (39), `divine-caldera` (49) e `divine-healing` (13).

Re-rodar quando a folha de 160826 existir: se o sprite não for dourado/sagrado, corrigir com
evidência e atualizar a tabela.

### Avalanche Rune — manter, QA por tile pendente

O efeito da Avalanche é o **41** (sprite 160962), o mesmo de `ice-wave` e `strong-ice-wave` —
efeito de gelo em área, coerente com a runa de gelo. Como o `sim` desenha um efeito por tile da
forma (`circle` raio 3), a QA é **por tile**, não de um efeito só: a pergunta é se 160962 repete
por tile sem artefato. Sem PNG não dá para responder, e o id fica **mantido** com o bloqueio
registrado em [`product/combat.md`](product/combat.md) e no `_open` da runa.

### Abilities de monstro (CMB-06) — nenhuma chave usada nesta versão

O único monstro do conteúdo é o rato, que **não declara `abilities`**: o boot o normaliza para a
básica, que usa `hits.melee` (effect 1) e não tem projétil. `appearances.abilities` é `{}`, e não
há chave semântica do CMB-06 para conferir visualmente. É uma **omissão documentada**, não uma
lacuna escondida: o teste `appearances.test.ts` prende que a seção está vazia, e reprova quando o
primeiro monstro declarar uma ability — forçando a auditoria da chave nova.

O CMB-06 não pode declarar fidelidade visual sem os seus ids verificados; como não há id ainda,
não há fidelidade a declarar. Quando houver, a chave entra em `appearances.abilities` e passa
pelo mesmo método (a conferência de que os ids existem no pacote já está em `packProblems`,
abaixo).

## Exceções verificadas (#219)

Fogo e terra foram corrigidos em 2026-09-15 com o PNG aberto: `flame-strike`,
`apprentices-strike` e `strong-flame-strike` passaram do effect 15 (`CONST_ME_MAGIC_GREEN`, brilho
verde) para o **16** (`CONST_ME_HITBYFIRE`, chama); `terra-strike`, `mud-attack` e
`strong-terra-strike` passaram do 16 para o **17** (`CONST_ME_HITBYPOISON`, respingo verde). Esses
ids **não** foram re-conferidos nesta rodada porque as folhas 160913 e 160017 também estão
ausentes — a auditoria herda a correção da #219 e marca o resto como pendente. O `_open` desses
arquivos mantém o registro histórico da troca, sem a frase genérica antiga.

## Cobertura reprodutível

- [`appearances.test.ts`](../packages/content/src/appearances.test.ts): toda referência cai nas
  faixas do inventário versionado; as cinco famílias com arte estão cobertas; `abilities` está
  vazia; nenhum `_open` do conteúdo carrega a frase genérica. Com a biblioteca presente, confere
  o `assetVersion` do manifesto, exige que cada aparência exista no índice dela, e — só com
  `complete: true` — exige o PNG do primeiro sprite. Sem a biblioteca, o bloco **pula**.
- `packProblems` em [`pack.ts`](../packages/content/src/pack.ts) agora confere os ids de
  `appearances.abilities` contra o pacote (o registro que faltava), com teste em `pack.test.ts`.
- `pnpm assets:inventory --check` continua sendo a conferência do inventário contra o `.dat`.

### Como re-rodar quando o pacote estiver completo

```bash
pnpm assets:library -- --source <pacote-completo> --version 1332
THINGS_DIR=things pnpm assets:inventory --check
pnpm exec vitest run packages/content/src/appearances.test.ts
```

Se o `assetVersion` mudar, a tabela e o inventário têm que ser remapeados juntos — os ids de um
pacote não são os do outro, e a auditoria não mistura versões.
