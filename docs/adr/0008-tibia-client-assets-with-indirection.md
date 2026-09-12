# 0008 — Assets do cliente Tibia com indireção por id

**Status:** aceito
**Data:** 2026-09-07
**Contexto técnico:** `content/`, `client` (pipeline de assets, pacote `things/`)

## Contexto

A arte de um MMORPG em pixel art é um dos maiores custos de produção do gênero, e o documento de
restrições do motor já registrava a tensão diretamente: usar os arquivos de um cliente comercial
existente é risco jurídico direto, não questão de estilo, e a recomendação original era começar
com tileset licenciado provisório e encomendar arte definitiva depois que o jogo se provasse.

A decisão de produto foi em outra direção: usar o pacote de assets do cliente Tibia, cujo formato
já foi mapeado por engenharia reversa do Huntera (`catalog-content.json` como índice,
`appearances-<hash>.dat` em protobuf, folhas `sprites-<hash>.bmp.lzma` comprimidas). Isso destrava
a engenharia imediatamente, sem esperar por um pipeline de arte própria.

A mitigação para essa troca de rumo já existia antes, na separação entre um registro de
aparências e as folhas de sprite propriamente ditas: essa separação é o que permite trocar toda a
arte depois sem tocar no renderizador.

## Decisão

Usar o pacote de assets do cliente Tibia como fonte de arte do MVP. Todo conteúdo em `content/`
referencia apenas `appearanceId` (itens, efeitos) ou `outfitId` (monstros, personagens) — nunca
um caminho de arquivo de sprite. A arte vive isolada em `/things/<versão>/`, com decoder próprio
(varint protobuf para o `.dat`, LZMA para as folhas), decodificação em Web Worker e cache
persistente em IndexedDB/Cache Storage.

## Alternativas

- Tileset comercial licenciado como provisório, com arte definitiva encomendada depois — era a
  recomendação original do documento de restrições do motor; superada por decisão de produto em
  favor do pacote do Tibia, que já vem com engenharia reversa pronta.
- Encomendar arte original desde o início do MVP — descartada pelo mesmo motivo de velocidade:
  não há pipeline de arte própria no plano do MVP.
- `content/` referenciando diretamente arquivos de sprite do pacote, sem indireção por id —
  descartada porque tornaria qualquer troca futura de pacote uma reescrita de conteúdo em vez de
  um remapeamento de tabela.

## Consequências

- Risco jurídico assumido conscientemente: usar arquivos de um cliente comercial existente é
  descrito, no próprio documento de arquitetura, como risco jurídico direto. Esta decisão aceita
  esse risco em troca de velocidade, com o produto ciente da troca — não há mitigação jurídica
  documentada além da reversibilidade técnica abaixo.
- A indireção por id é o que sobra como mitigação: trocar o pacote de assets no futuro é remapear
  `appearanceId`/`outfitId` numa tabela, não reescrever `content/` — praticamente de graça, mas
  só se nenhum atalho gravar caminho de arquivo direto em conteúdo.
- O servidor nunca precisa carregar arte, só ids — o processo `game` fica leve mesmo com o
  cliente lidando com um pacote de assets pesado.
- Junto da decisão vêm melhorias sobre o que o próprio Huntera faz: decodificação em Web Worker
  (o Huntera decodifica LZMA no thread principal), cache persistente (o Huntera redescomprime a
  cada sessão) e versionamento explícito do caminho `/things/<versão>/`.
- Não há plano documentado para o cenário em que a mitigação técnica não seja suficiente frente
  ao risco jurídico — a reversibilidade reduz o custo de trocar de pacote, não o risco de usar o
  atual.

## Invariantes afetados

6 (`content/` nunca contém arte — só `appearanceId` e `outfitId`).

## Emenda — 2026-09-10 (FUN-94): a tabela existe

Esta decisão sempre disse *"trocar o pacote de assets no futuro é remapear `appearanceId`/
`outfitId` numa tabela, não reescrever `content/`"*. **A tabela não existia.** Os ids viviam
inline em cada entidade:

```jsonc
// data/monsters/rat.json — antes
{ "id": "rat", "outfitId": 21, ... }
```

Isso cumpria a letra do invariante 6 — nenhum caminho de arte em `content/` — e não cumpria o
efeito: trocar de pacote era editar todo arquivo de conteúdo, exatamente o que a alternativa
descartada ("`content/` referenciando diretamente arquivos de sprite") custaria.

Agora existe `data/appearances/baseline.json`, uma linha por id de conteúdo, e `buildContent`
resolve a aparência de cada monstro e item a partir dela no boot. A troca de pacote é o diff de
um arquivo.

**A tabela é separada por tipo** (`monsters`, `items`) e não um mapa achatado: id é único dentro
de um tipo, não entre eles, e um dia existe o item "rat" ao lado do monstro "rat".

**O custo que a tabela cobra**, e que a decisão aceita: a aparência órfã. Com o id inline, apagar
a entidade levava o id junto; com a tabela, a linha fica para trás e ninguém percebe. Por isso a
referência cruzada reclama dos dois lados — entidade sem aparência **e** aparência sem entidade —
e por isso `itemSchema`/`monsterSchema` são `strictObject`: Zod descarta chave desconhecida em
silêncio, e um `appearanceId` escrito na entidade por hábito não iria a lugar nenhum sem nada
acusar.

**A versão de conteúdo inclui a tabela.** Trocar de pacote muda a versão, e o invariante 7 faz o
resto: uma hunt que começou com o pacote antigo termina com ele, em vez de trocar de arte no meio
de milhares de sessões desanexadas.

Nada disso muda a decisão nem o risco jurídico que ela assume — é a mitigação técnica passando a
funcionar como estava escrito. Validar que cada id existe no pacote CARREGADO continua sendo a
metade da FUN-21 que depende do pacote, e continua aberta.

## Emenda — 2026-09-12 (ADR 0025): o mapa também

O mapa real do Tibia entra pela mesma porta e com o mesmo tratamento: o `otservbr.otbm` do
Canary é uma reprodução comunitária do mapa da CipSoft, está na mesma classe de risco do pacote
de arte, e por isso **também nunca é versionado** — mora em `things/maps/`, e a pilha de
aparências por tile que o importador produz para o cliente mora em `things/<versão>/maps/`,
servida por `/things/` como as folhas. O que entra em `content/` é só geometria (bloqueio,
velocidade de chão, escadas), regenerável de qualquer fonte. Ver ADR 0025.
