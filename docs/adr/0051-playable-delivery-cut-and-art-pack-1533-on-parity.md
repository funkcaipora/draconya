# 0051 — O corte da entrega jogável: três hunts e 82 itens provam o fluxo; o catálogo inteiro vem em paralelo; o pacote 15.33 entra na `tibia-parity` agora

**Status:** proposto — organiza a execução dos [ADR 0048](0048-corpse-loot-and-per-character-quick-loot-filter.md),
[0049](0049-manual-item-use-click-to-fire-and-targeted-runes.md) e
[0050](0050-session-tile-overrides-for-usable-scenery.md); emenda o
[ADR 0008](0008-tibia-client-assets-with-indirection.md) na branch `tibia-parity`
(a mesma emenda que a PR #676 faz na `main`)
**Data:** 2026-09-26
**Contexto técnico:** branch `tibia-parity`; `packages/content` (`appearances/baseline.json.pack`,
`packs/tibia-1533.json`), `packages/server` (`config.ts` `THINGS_VERSION`, `served-pack.ts`),
`.env.example`, `Dockerfile`, `compose.coolify.yml`, `scripts/map:*`; `docs/local-dragon-party.md`
**Issues:** #675 (pacote 15.33, PR #676 na `main`); cadeia #573 → #574 → #580 → #581, #582 → #583 →
#584 → #585 → #586 → #587; #699/#718 (semente Caiporinha, na `main`)

## Contexto

O pedido do dono tem duas metades que pedem coisas diferentes. A frase de aceite é concreta e
curta: *"Me entregue quando eu conseguir selecionar uma hunt de algum monstro, caçar, selecionar
quais itens pegar do loot, equipar itens da backpack, usar runas, usar itens"*. A frase de escopo é
larga: *"completar a paridade 100% e todo sistema de luta, skills, dano, curas, runas, itens, bolsa
de itens, troca de itens, dano de acordo com armas, defesa e skills de acordo com itens equipados,
uso de itens, itens consumíveis, cenário [...] tudo 100%"*.

O que existe (auditoria de 2026-09-26): três hunts (Rat Cellars, Rotworm Caves, Darashia Dragon
Lair — esta com 47 spawns do Canary), quatro monstros, **82 itens** no catálogo — inclusive o loot
completo de Dragon e Dragon Lord (#520) e os sete da Rotworm Caves —, equipar/mover/atributos no
combate funcionando ponta a ponta, `use-slot` por tecla. O que falta para a frase de aceite é
exatamente o que os ADRs 0048–0050 decidem: loot escolhido, uso por clique e por item, cenário
usável. O que falta para a frase de escopo é a cadeia de importadores e de motor: 939 monstros no
`staging/` não carregados, 1.439 `itemId` de loot com 82 no catálogo, #573 sem existir, mais os
marcos M29–M44 do `docs/tibia-parity-plan.md`.

Há um obstáculo operacional que trava tudo antes: a `tibia-parity` valida contra o pacote de arte
13.32 (`appearances.baseline.pack: "tibia-1332"`, `THINGS_VERSION` default `1332`), e **esta máquina
só tem `things/1533/`**. `served-pack.ts` recusa subir o `game` quando `THINGS_VERSION` não é a
versão contra a qual o conteúdo foi conferido (`.env.example:37`) — variável de ambiente não
resolve. A adoção do 15.33 está na PR #676, empilhada em cima da pilha do mapa-múndi (M45, PRs
#667–#675, base `main`), e o corpo dela diz o que importa: **nenhum id de aparência mudou**; muda
`packs/`, `THINGS_VERSION`, um tile de Thais e os testes que leem o pacote real.

## Decisão

1. **Dois portões, não um. O Portão 1 ("jogável") é a frase de aceite, literal, sobre o que já
   existe:** Rotworm Caves e Darashia Dragon Lair (e Rat Cellars), os quatro monstros, os 82
   itens. Entrega = W1–W11 do `PLAN.md` (grupo 1): ADR 0048 (cadáver com loot, filtro, janela,
   venda/descarte, Caixa retirada), ADR 0049 (clique dispara, `use-item`/`use-item-on`, estoque
   visível, comida, mira), ADR 0050 T1 (portas, capim, pile/buraco, rope, ladder, alavanca, placa —
   os 3 rope spots da Rotworm Caves e as 2 alavancas da Rat Cellars ficam usáveis). "Hunt de algum
   monstro" é satisfeita por qualquer das três; o fluxo é o mesmo para as 939.
   **Critério de aceite** (QA no navegador, como #527, com a semente de personagens local): abrir o
   `HuntsModal`, entrar na Rotworm Caves, ver o bot matar e coletar pelo filtro, editar o filtro
   (ignorar `worm`), ver o próximo `worm` ficar no cadáver, abrir o cadáver e pegá-lo à mão, vestir o
   `legion-helmet` da mochila, disparar a runa por clique e por mira num rotworm, comer um `ham`,
   usar a rope num rope spot; fechar o navegador dois minutos e reabrir com o extrato e a mochila
   coerentes.

2. **O Portão 2 ("qualquer monstro do Tibia") é a cadeia #573 → #574 → #580 → #581 e #582 → #583 →
   #584 → #585 → #586 → #587, executada em PARALELO ao Portão 1 por outro agente.** A cadeia é
   ferramenta e conteúdo (`scripts/catalog/`, `packages/content/data/*/generated/`), toca o `sim`
   só no fim (#583, #585) e não muda o fluxo que o Portão 1 prova. Os únicos pontos de contato são
   declarados: #585 substitui `corpseTtlMs` pela cadeia `decayTo` (o ADR 0048 d.6 já lê "vida do
   cadáver" como um número só, de onde vier); #573 preenche `use.tool` em rope/shovel/pick/chaves
   (ADR 0050 d.5 — até lá, os três itens entram à mão no catálogo, como os 82 entraram); #584 tira
   `difficulty` do protocolo — o Portão 1 **não** espera por isso, o seletor de pull continua até
   #583/#584 pousarem.

3. **O pacote 15.33 entra na `tibia-parity` agora, por cherry-pick da #676, como PR própria contra
   a `tibia-parity`.** Não se espera a pilha do M45 chegar à `main` e a `main` ser mesclada na
   parity: sem o 15.33 ninguém roda o Portão 1 nesta máquina. O cherry-pick leva só o que #676 muda
   (`packs/tibia-1533.json`, `baseline.pack`, `THINGS_VERSION`, `.env.example`, `Dockerfile`,
   `compose.coolify.yml`, os `map:*`, os testes do pacote real, o tile `(181, 137, 7)` de Thais, docs)
   — nenhum id de aparência, nenhuma mecânica. Quando a `main` (com #676) for mesclada na parity, os
   hunks são idênticos e o merge é no-op; se a #676 mudar antes de pousar, o conflito é nesses
   arquivos e só neles. É a mesma emenda ao ADR 0008 nas duas branches, na mesma data.

4. **"Troca de itens" lê-se como mover/trocar de lugar (existe: `move-item`, C2S 16) mais vender e
   descartar (ADR 0048 d.8). Comércio entre jogadores fica fora dos dois portões.** A janela de
   Trade do Tibia exige dois personagens adjacentes na mesma sessão — só a Cidade (shard) tem isso —
   e move item entre dois estados quentes de donos diferentes, o que pelo invariante 9/10 passa por
   extrato e ledger, não por uma troca em memória. É o mesmo mecanismo do Market (E13, livro de
   ordens, `economy.md`) e vai com ele; registrado como divergência temporária em `items.md`.

5. **Ordem de pouso e quem mescla.** Toda PR do Portão 1 tem base `tibia-parity` e é empilhada
   quando depende de outra (W2 → W3/W4; W8 → W9 → W10); o dono mescla na ordem do `PLAN.md`. As PRs
   do Portão 2 também têm base `tibia-parity`. `pnpm check` antes de cada PR (inclusive
   `map:import --check`, que passa a validar `interactables`). A `main` continua recebendo só o que
   já recebe (M45, #718); a `tibia-parity` mescla a `main` quando #718 (semente Caiporinha) pousar,
   porque a QA do Portão 1 usa essa semente.

6. **O que fica explicitamente FORA dos dois portões, com o motivo**, para não ser reproposto no
   meio: PvP e Guild War (`tibia-parity-plan.md` §3); casas; storages/quest (T2 do ADR 0050 — grupo
   3 do plano, logo depois do Portão 1); Market e Trade (E13); Loja/Coins (M22); M38–M44 na ordem do
   plano de paridade (grupo 4).

## Alternativas

- **Um portão só: entregar quando as 939 criaturas estiverem em hunts reais.** Descartada: a
  frase de aceite do dono é sobre o FLUXO, não sobre a largura do catálogo; a cadeia #573→#587 tem
  seis issues paradas e um gargalo (#573) que não muda nada do que o jogador faz na tela. Trancar
  o fluxo atrás do catálogo atrasaria o feedback do dono sobre loot, uso e cenário — que é onde as
  decisões de produto ainda podem mudar.
- **Portão 1 sobre o Rat Cellars só (um monstro, um item).** Descartada: o queijo (`value: 0`) não
  exercita venda nem filtro com sentido; a Rotworm Caves tem sete itens e três rope spots — é o
  menor recorte que exercita as três ADRs; a Dragon Lair exercita a party e o loot grande.
- **Esperar a `main` (com #676) chegar à parity.** Descartada: a pilha do M45 tem oito PRs
  empilhadas esperando merge em ordem; o Portão 1 não pode depender do ritmo de outro marco para
  ser sequer executável localmente.
- **Fazer o `served-pack.ts` aceitar `THINGS_VERSION` diferente do `pack` com um `--force`.**
  Descartada: a recusa existe para o servidor nunca servir arte que o conteúdo não conferiu; um
  desvio local viraria caminho de deploy errado. Trocar o `pack` é a operação certa, e #676 já a fez.
- **Incluir a remoção da dificuldade (#583/#584) no Portão 1 por fidelidade.** Descartada: é
  mudança de protocolo/servidor/cliente com compatibilidade a preservar (ADR 0014) e não afeta
  nenhuma das seis ações da frase de aceite.

## Consequências

- O `PLAN.md` ao lado deste ADR é a lista ordenada: grupo 1 (Portão 1, W1–W11), grupo 2 (Portão 2 e a
  paridade de combate/skills/itens restante), grupo 3 (cenário T2/T3), grupo 4 (M33, M38–M44).
- `docs/local-dragon-party.md` ganha a receita do Portão 1 (semente, `THINGS_VERSION=1533`, o
  roteiro de aceite acima) — a QA é repetível por qualquer agente.
- `docs/adr/README.md` da parity recebe 0048–0051; `docs/tibia-parity-plan.md` ganha um §7 "Portão
  jogável" apontando para eles e corrige o §3 (cadáver).
- O que piora: por algumas semanas a `tibia-parity` e a `main` carregam a mesma mudança de pacote
  por caminhos diferentes; e o Portão 1 pousa com o seletor de pull ainda na tela — divergência
  conhecida até #584.

## Invariantes afetados

Nenhum. Este ADR só ordena trabalho; as decisões de arquitetura estão nos 0048–0050. O invariante
**6** é a razão de o pacote 15.33 ser uma troca barata (só `packs/` e uma versão, nenhum id no
`content/`), e o **7** é a razão de a QA do Portão 1 valer mesmo com o catálogo crescendo em
paralelo — cada sessão fixa a versão que carregou.
