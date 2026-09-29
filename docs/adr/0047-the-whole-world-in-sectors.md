# 0047 — O mundo inteiro em setores de 32×32, fora do repositório, lido sob demanda

**Status:** aceito
**Data:** 2026-09-26
**Contexto técnico:** `tools` (`scripts/world-map.ts`), `client` (`src/world/sector.ts`),
`things/<versão>/world/`
**Issues:** M45 — #659 (censo), #660 (esta decisão), #661 (o explorador que a consome)

## Contexto

O [ADR 0025](0025-real-map-from-otbm.md) trouxe o mapa real como **recorte**: uma região, um JSON
de pilha por mapa, carregado inteiro pelo cliente. Serve para Thais (40 mil tiles) e para as
hunts. O M45 (`docs/world-map-plan.md`) pede o mapa **inteiro**, e o censo (#659) mediu o que
isso é: 17,97 milhões de tiles em 16 andares, 29 425 setores de 32×32, 344 MB no formato JSON do
recorte e 97 MB num binário de `u16` por id — que o gzip só reduz em 11 %.

## Decisão

1. **O mundo é escrito em setores de 32×32 tiles por andar**, um arquivo por setor, em
   `things/<versão>/world/<z>/<sx>-<sy>.bin`, com um índice `world/index.json` (bbox e lista de
   setores por andar). 32 divide o tile area do OTBM (256) e cobre a janela de render do cliente
   com poucos setores por andar.
2. **Binário com paleta por setor** (`DWS1`, `packages/client/src/world/sector.ts`): cada setor
   lista os ids que usa e o tile guarda o índice — `u8` até 256 ids, `u16` acima. Mesma
   informação do JSON de recorte (chão + pilha + contagem), mais as flags de zona e a casa do
   tile, que a fase 4 desenha. Resultado no mapa real: 77,9 MB (−20 % contra o binário simples).
3. **Um codec só, no cliente, importado pelo importador.** Quem escreve e quem lê não divergem
   sobre um byte; `tools` já importa de `client` para o leitor de aparências.
4. **Fora do repositório, como toda a arte** (ADR 0008/0025). `pnpm map:world` gera;
   `pnpm map:world --check` regera em memória e compara byte a byte, e entra no `pnpm check` —
   pulando com aviso onde o OTBM ou a pasta gerada não estão.
5. **Não precisa do pacote de arte.** O setor guarda ids; bloqueio e flags de aparência são do
   cliente, que tem o pacote.
6. **Os recortes do ADR 0025 continuam.** Hunts e Cidade seguem lendo o JSON de recorte e a
   geometria versionada em `content/`; o mundo em setores é, por ora, só para o explorador. Unir
   as duas fontes é a fase 6 do plano, com ADR próprio.

## Alternativas

- **Um JSON único do mundo** — descartada: 344 MB não cabem num navegador.
- **Binário sem paleta, comprimido pelo HTTP** — descartada: 97 MB e o gzip tira só 11 %; a
  paleta tira 20 % sem depender do servidor comprimir.
- **Setor maior (64 ou 256)** — descartada: cada passo na borda traria 4× ou 64× mais tiles do
  que a tela usa.
- **Guardar o mundo em IndexedDB** — descartada: o HTTP já guarda com `Cache-Control` longo, como
  as folhas (mesma razão do `loadStackMap`).

## Consequências

- O volume `things` ganha ~160 MB em disco (29 425 arquivos pequenos); o deploy que quiser o
  explorador precisa gerar a pasta, como gera as folhas.
- Quem troca o OTBM regera o mundo; o `--check` aponta setor faltando, diferente ou sobrando.
- O cliente ganha uma cena que carrega setores sob demanda (#661) sem mudar o pintor: ela
  satisfaz o mesmo `Scene.tileAt` dos recortes.

## Invariantes afetados

Nenhum. O **6** continua: o setor é arte por id e mora em `things/`, nunca em `content/`. O **7**
não é tocado: o mundo em setores não entra em sessão nenhuma.
