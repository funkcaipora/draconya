# 0038 — Catálogo do Tibia importado do Canary por ferramenta

**Status:** aceito; decisão 5 corroborada por evidência do Huntera em 2026-09-25 (ver emenda) —
decorre diretamente do pedido do usuário em 2026-09-24, no mesmo dia do
[ADR 0037](0037-tfs-canary-fidelity-except-action-bar-and-automation.md): *"copie todas as
mecânicas, magias, monstros, itens"*; usa o limite de licença do [ADR 0019](0019-opentibia-as-domain-specification.md)/[ADR 0031](0031-contrato-de-compatibilidade-de-combate-e-migracao.md)
e o precedente do [ADR 0025](0025-real-map-from-otbm.md) (o mapa real por importador)
**Data:** 2026-09-25
**Contexto técnico:** `scripts/` (importadores novos), `packages/content` (schemas e dados
gerados), `docs/reference/catalog/` (relatório de cobertura)
**Issues:** M34 — #572 a #577; M35 — #578 a #581

## Contexto

O ADR 0037 (decisão 6) já tinha convertido a mecânica de caça para a do Tibia; no mesmo dia o
usuário estendeu o pedido ao catálogo inteiro — monstros, itens, magias. O Canary `main` lista
1.656 monstros e algo entre 1.700 e 2.000 itens de caça relevantes (armas, defesa, poções,
munição, suprimento). Transcrever isso à mão é caro, erra, e qualquer correção futura do Canary
nunca seria absorvida — o mesmo argumento que já tinha justificado o importador de OTBM (ADR
0025) para o mapa. A diferença aqui é o volume: um arquivo por entidade, no padrão do mapa,
produziria milhares de arquivos e inviabilizaria a revisão de um PR.

Falta decidir onde o importador mora, o formato do que ele escreve, como uma correção nossa
convive com o dado gerado sem se perder na próxima reimportação, e até onde o catálogo vai — o
Canary `main` já carrega sistemas posteriores ao Tibia 13.32 (Monk, Weapon Proficiency, Animus
Mastery/Soulpit), mas o pacote de arte do Draconya é 13.32 (ADR 0031, DT-01) e não desenha nada
disso.

## Decisão

1. **Localização e fonte.** Os importadores entram em `scripts/catalog/`, na raiz, ao lado de
   `import-map.ts`, `otbm.ts` e `trace-route.ts` — o mesmo lugar do importador de mapa, e não
   `packages/tools`, para não duplicar a convenção que o ADR 0025 já fixou. Eles leem
   `CANARY_DIR` (padrão `things/sources/canary`, gitignorado, na mesma classe de risco de
   `THINGS_DIR`) e nunca escrevem de volta nele.
2. **Saída, um produto por tipo.** `packages/content/data/<tipo>/generated/<fatia>.json` — um
   array ordenado por id, fatiado por categoria ou pasta do Canary (ex.: `monsters/generated/
   vermin.json`, `items/generated/weapons.json`), para manter o diff de uma reimportação
   revisável. Cada arquivo carrega um bloco `source: { engine, commit, path }` por entidade,
   igual em espírito ao `source` que o mapa já grava (ADR 0025 decisão 3).
3. **Correção nossa vive à parte do dado gerado.** `packages/content/data/<tipo>/overrides/`
   guarda só o que diverge do Canary, sempre com motivo e citação — nunca um campo editado
   dentro do JSON gerado, que uma reimportação sobrescreveria em silêncio. Hoje são duas
   correções conhecidas: a velocidade de monstro na escala do TFS (o valor do TFS quando existe
   arquivo de mesmo nome, senão Canary × 2 — ADR 0037 decisão 4) e fato do TibiaWiki que nenhuma
   das duas engines carrega (preço de NPC, por exemplo — ADR 0037 decisão 4 já elege a
   TibiaWiki para isso).
4. **Checagem determinística.** `pnpm catalog:import <tipo> --check` regenera em memória e
   compara com o versionado quando as fontes locais estão presentes; sem `things/sources/canary`
   na máquina, avisa e pula — o mesmo comportamento que `map:import --check` já tem (ADR 0025
   decisão 3) e que entra no `pnpm check`.
5. **Corte pelo pacote de arte.** O importador só gera a entidade que o pacote 13.32
   (`packs/tibia-1332.json`) desenha e cuja mecânica o `sim` já executa. O que sobra — Monk,
   Weapon Proficiency, Animus Mastery e qualquer outro sistema do Canary posterior ao 13.32, ou
   mecânica ainda sem motor — sai num relatório **versionado**,
   `docs/reference/catalog/<tipo>-report.md`, e não é descartado em silêncio: reimportar sempre
   recupera o campo que um schema ainda não carrega, porque o relatório é gerado do mesmo dado
   bruto, não copiado à mão.
6. **Identidade e preço.** Id de entidade que já existe nunca muda (ADR 0014) — o importador
   apenas adiciona ou atualiza campos de um id conhecido. `item.value` (venda) é o maior `sell`
   entre os `npcConfig.shop` que compram o item; o preço de suprimento é o menor `buy` entre os
   que o vendem.
7. **Limite de licença, sem exceção.** TFS e Canary são GPL v2. O importador lê números e
   mecanismo — id, nome, stats, fórmula, estrutura de dado — e escreve JSON **nosso**; nenhuma
   linha de Lua ou C++ é copiada, traduzida ou adaptada (ADR 0019 limite 1, ADR 0031). O teste de
   conformidade, quando existir, prende o resultado — nunca a forma do importador.

## Alternativas

- **Um arquivo por entidade**, como o padrão inicial do mapa por região. Descartada: com 1.656
  monstros e milhares de itens, a revisão de PR fica inviável e o histórico de `git blame` vira
  ruído.
- **Transcrever o catálogo à mão**, entidade por entidade. Descartada pelo mesmo argumento do
  OTBM: caro, sujeito a erro de digitação, e qualquer correção do Canary nunca chegaria ao
  Draconya sem outra rodada manual.
- **Importar tudo, sem corte pelo pacote de arte.** Descartada: geraria conteúdo sem
  `appearanceId` jogável (invariante 6) e sem mecânica que o executasse, inflando o catálogo com
  entidade morta. O relatório versionado preserva a informação sem sujar `content/`.
- **Guardar um "saco de campos crus" do Canary por entidade**, para nunca perder dado que um
  schema ainda não usa. Descartada: reimportar já recupera qualquer campo assim que o schema o
  declarar, e um saco de campos sem tipo é exatamente o tipo de dado que ninguém audita.

## Consequências

- M34 (itens) e M35 (monstros) ficam desbloqueados por esta decisão; o extrator de magias do M37
  (M37-08) e o catálogo de imbuements do M40 (M40-02) seguem a mesma forma — leitor do Canary,
  gerado versionado, override à parte — sem precisar de um ADR próprio para o formato.
- Toda reimportação é idempotente: rodar o importador de novo sobre o mesmo commit do Canary
  produz o mesmo JSON, e um id existente nunca desaparece nem muda de identidade.
- Fica uma nota para mais adiante, sem bloquear esta decisão: se o pacote de arte trocar de
  13.32 para outro (13.40, 14.x), o corte da decisão 5 muda junto — é o mesmo tipo de gatilho que
  o ADR 0031 (DT-01) já separa da fórmula de combate. Não há indicação de troca de pacote hoje;
  quando houver, é uma reimportação, não uma reescrita.
- O custo é a manutenção de dois diretórios por tipo de conteúdo (`generated/` e `overrides/`) e
  um relatório a mais para manter atualizado a cada corte de pacote.

## Invariantes afetados

Nenhum muda de texto. O invariante 6 (`content/` nunca contém arte) ganha um mecanismo concreto:
o importador nunca escreve `appearanceId` para uma entidade que o pacote 13.32 não desenha. O
invariante 7 (versão de conteúdo fixada na sessão) continua valendo porque o catálogo gerado é
conteúdo versionado como qualquer outro — `computeVersion` o inclui sem tratamento especial.

## Emenda — 2026-09-25: decisões do dono ("copie do Huntera") — decisão 5 corroborada

Em 2026-09-25 o dono respondeu as doze questões em aberto do `docs/tibia-parity-plan.md` §5 com
"copie do Huntera": onde o Huntera (o Tibia-idle observado em `docs/reference/huntera-observed.md`)
foi de fato observado fazendo algo, a decisão de produto segue o Huntera; onde não foi observado,
a regra provisória atual permanece e a captura que falta fica registrada. Ver
`docs/tibia-parity-plan.md` §5 para a tabela cheia e §6 para a lista de capturas pendentes.

A questão 1 do plano ("corte de versão: 13.32 ou planejar troca de pacote?") já estava resolvida
por esta decisão 5, pela razão de licença/pacote de arte — não por observação do Huntera. A
evidência do Huntera **corrobora de forma independente**, sem mudar a decisão: o Huntera serve o
pacote de assets em `/things/1332/` (`catalog-content.json`, `appearances-<hash>.dat` — Parte I
§1-2, linha 22) — a mesma versão 13.32 que o pacote do Draconya usa —, e os termos `Monk`,
`Soulpit`, `Weapon Proficiency` e `Animus Mastery` não aparecem em nenhuma das seis partes do
documento (grep de texto completo, zero ocorrências), incluindo a Parte IV, que mostra uma party
level 300+ com quatro vocações nomeadas (Elite Knight, Elder Druid, Master Sorcerer, Royal
Paladin) e nenhuma quinta.

Confiança: média. A URL do pacote é observação direta (alta confiança); a ausência de sistemas
pós-13.32 é ausência ao longo de seis capturas, não confirmação negativa direta — a vocação da
party foi lida da UI/prosa, não de um valor decodificado de `party-update.vocation`. Imbuements
existem na captura (`imbuementSlots`/`imbuable` na mochila, Parte III §18 linha 406; 2 slots de
imbuement na espada de loot da Rotworm Caves, Parte V §31 linha 709) — sistema anterior ao
13.32, consistente com o corte, não contra ele.

**Captura pendente:** abrir a tela de escolha de vocação na criação de personagem do Huntera para
checar uma quinta opção "Monk", e checar a ficha de um personagem de level alto por um painel de
Wheel of Destiny, um menu de Bosstiary/Hazard ou um slot de inventário de soul core — nenhuma
dessas telas foi capturada.

(Evidência: `docs/reference/huntera-observed.md` Parte I §1-2 linha 22; Parte IV linhas 474-475 e
655-656; Parte III §18 linha 406; Parte V §31 linha 709.)
