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
