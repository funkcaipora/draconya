# Plano do mapa do mundo — o Tibia inteiro no navegador

**Status:** proposto em 2026-09-26.
**Objetivo do dono (2026-09-26):** *"ter o mapa completo do Tibia, no Draconya, com todos os
elementos"* — e sem mexer em nada muito complexo.
**Fonte:** o mesmo `otservbr.otbm` do Canary v3.6.1 que o [ADR 0025](adr/0025-real-map-from-otbm.md)
já fixou (`pnpm map:fetch`, SHA-256 fixado), mais os arquivos de mundo do Canary
(`data-otservbr-global/world/otservbr-{monster,npc,house,zones}.xml`), lidos do clone local em
`CANARY_DIR` como qualquer outro importador do [ADR 0038](adr/0038-tibia-catalog-import-tooling.md).

## 1. O que existe hoje, e o que falta

O importador (`scripts/import-map.ts`, ADR 0025) já lê o OTBM real e escreve os dois produtos:
geometria para o servidor (`packages/content/data/maps/<id>.json`) e pilha de aparências para o
cliente (`things/<versão>/maps/<id>.json`). O cliente já desenha a pilha do Tibia com andares,
ordem espacial e visibilidade de andar (ADR 0034, M23). Quatro recortes estão importados: Thais,
Rat Cellars, Rotworm Caves e Darashia Dragon Lair.

O que impede o mapa inteiro é **tamanho e formato**, não mecanismo:

- O recorte é um JSON único, carregado de uma vez. Thais sozinha tem 40 mil tiles; o mundo tem
  dezenas de milhões (medido na Fase 0). Um arquivo só não cabe no navegador.
- Escadas são autoradas à mão (`floorChanges`); no mundo inteiro são milhares.
- O importador lê só tiles. Cidades, templos, waypoints, casas, teleportes e zonas estão no
  OTBM ou nos XML de mundo e são ignorados.
- NPCs, spawns de monstro, luz e minimapa não existem no cliente.

## 2. A regra que mantém isto simples

**O mapa do mundo é primeiro um produto de visualização, não de simulação.** As fases 0 a 5
entregam um **explorador do mundo** no navegador — câmera livre, todos os andares, todos os
elementos desenhados — sem tocar em `sim/`, em sessão, em protocolo ou em invariante. As hunts e
a Cidade continuam sendo recortes, como hoje.

Andar pelo mundo inteiro com outros jogadores (mundo aberto) é outro projeto: mexe no invariante 8
(a Cidade é um shard, ADR 0023), na sessão e no custo de servidor. Fica registrado na Fase 6 como
opcional e só começa com ADR próprio.

## 3. Fases

Cada fase é um conjunto pequeno de issues, entregável e testável sozinho.

### Fase 0 — Censo do mapa (tools, só leitura)

`pnpm map:census`: lê o `otservbr.otbm` inteiro e escreve um relatório, sem gerar produto.

- tiles por andar, caixa (bbox) por andar, tiles sem chão, conflitos de bloco;
- aparências usadas que o pacote 1332 não tem (hoje contornado com `--allow-unknown`);
- nós que o OTBM carrega além de tile: cidades/templos, waypoints, casas, teleportes (atributo de
  destino), portas;
- estimativa de tamanho do produto por formato (JSON, binário, binário comprimido).

**Aceite:** o relatório existe e responde às decisões da §4 com número, não com palpite.

### Fase 1 — O mundo em setores (tools + things)

`pnpm map:world`: o importador passa a escrever o mundo inteiro **em setores**, não num arquivo
só.

- setor de 32×32 tiles por andar, em `things/<versão>/world/<z>/<sx>-<sy>.bin`, binário compacto
  (chão + pilha por tile, a mesma informação do JSON de recorte);
- `things/<versão>/world/index.json` com a bbox por andar e a lista de setores que existem;
- determinístico e com `--check`, como `map:import`;
- nada entra em `content/` nem no repositório: é dado derivado da CipSoft, mesma classe de risco
  do ADR 0008/0025.

**Aceite:** o mundo inteiro gera, o `--check` confirma que regenerar dá bytes idênticos, e um
setor lido de volta bate tile a tile com o `map:import` da mesma região.

### Fase 2 — Explorador do mundo no cliente (client)

Uma tela `/world` (atrás de flag de desenvolvimento no início) que reaproveita o `viewport` do
M23:

- carrega só os setores em volta da câmera e descarta os que saem (culling por setor, D6 do
  ADR 0034);
- câmera livre (arrastar, teclado), troca de andar, zoom;
- "ir para": coordenada, ou nome de cidade (da Fase 4).

**Aceite:** dá para atravessar o continente de ponta a ponta sem travar e sem crescer memória sem
limite; Thais no explorador é idêntica a Thais no recorte de hoje.

### Fase 3 — Minimapa e mapa-múndi (tools + client)

- o importador gera o minimapa por andar a partir da cor de automapa de cada aparência (a mesma
  informação que o minimapa do Tibia usa), em ladrilhos PNG por setor;
- o explorador ganha minimapa no canto e um mapa-múndi com zoom para navegar.

**Aceite:** o mapa-múndi mostra o continente reconhecível em todos os andares, e clicar leva a
câmera ao ponto.

### Fase 4 — Elementos estáticos do mundo (tools + client)

Tudo que é dado do mapa e não precisa de simulação:

- **escadas, rampas, buracos e cordas derivados automaticamente** do `floorchange` do `items.xml`
  do Canary, com a regra de pouso do `Tile::queryDestination` já documentada na emenda #519 do
  ADR 0025 — é o "trabalho futuro" que aquela emenda deixou;
- **teleportes** (destino gravado no item, no OTBM);
- **portas** (tipo de porta do `items.xml`);
- **cidades e templos** (nó de towns do OTBM) — alimentam o "ir para";
- **casas** (tiles de casa do OTBM + `otservbr-house.xml`): contorno e nome no explorador;
- **zonas** (flags de tile: PZ, no-logout; `otservbr-zones.xml`): camada que liga e desliga.

**Aceite:** clicar numa escada no explorador leva ao andar de destino certo; as camadas de casa e
zona aparecem sobre o mapa; toda cidade do OTBM está no "ir para".

### Fase 5 — Criaturas, luz e animação (tools + client)

- **NPCs** nas posições do `otservbr-npc.xml`, com o outfit do script de cada NPC;
- **spawns de monstro** do `otservbr-monster.xml`, desenhados parados no ponto de spawn, com o
  outfit do monstro (reaproveita o leitor de monstro do M35, #578);
- **luz**: escuro por andar subterrâneo e luz de item (a flag de luz da aparência);
- **itens animados** (água, fogo, fontes), se o renderer ainda não anima tudo.

**Aceite:** Thais tem os NPCs no lugar; a caverna de rotworms de Darashia mostra os 35 pontos de
spawn que o ADR 0025 citou; andares subterrâneos ficam escuros com as tochas acesas.

### Fase 6 (opcional, com ADR) — O mundo vira o chão do jogo

Só depois das fases 0–5, e só se o dono pedir:

- recortes de hunt e Cidade passam a ser **referências a regiões do mundo** em vez de importações
  separadas (uma fonte só, sem JSON duplicado);
- geometria do servidor por setor, para hunts em qualquer lugar do mapa;
- mundo aberto (andar entre cidades com outros jogadores) — mexe no invariante 8, exige ADR e
  plano próprios.

## 4. Decisões que esperam o dono

| Pergunta | Recomendação |
|---|---|
| Qual pacote de arte cobre o mundo inteiro? O 1332 tem lacunas (as bordas da Dragon Lair precisaram de `--allow-unknown`). | Medir na Fase 0; se a lacuna for pequena, desenhar retângulo no lugar, como o cliente já faz. |
| O explorador fica aberto a qualquer jogador ou só para desenvolvimento? | Só desenvolvimento nas fases 1–3; decidir na Fase 4 se vira funcionalidade (ex.: mapa-múndi no HUD). |
| Mapa do Canary v3.6.1 (o fixado) ou o da `main` atual? | Continuar no v3.6.1: é o que o ADR 0025 fixou por SHA, e os recortes existentes vieram dele. |
| Fase 6 entra no plano agora? | Não. Decidir depois de ver o explorador funcionando. |

## 5. Pré-requisitos nesta máquina

- `pnpm map:fetch` (baixa o `otservbr.otbm`, ~184 MB, para `things/maps/`);
- o pacote de arte 1332 em `things/1332/` — hoje ausente neste Mac;
- `CANARY_DIR=/Users/joseoliveira/Desktop/Projetos/canary` para os XML de mundo e o `items.xml`
  (Fases 4 e 5).

## 6. Limites que não mudam

- **Invariante 6:** nada de arte em `content/`; setores, minimapa e pilhas moram em `things/`.
- **ADR 0019/0038:** Canary é GPL v2 — o importador lê números e dados, nenhum código é copiado.
- **ADR 0008/0025:** o mapa é dado derivado da CipSoft, nunca versionado.
- **Nenhum invariante é afetado pelas fases 0–5:** não há simulação, sessão nem protocolo novo.
