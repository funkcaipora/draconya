# Quests

**Status:** parcial — a semente do motor (storages por personagem, #731, ADR 0050 d.6 T2)
implementada, e consumida por porta de quest e baú com `uid` no cenário (#733, ADR 0050 d.6 T2);
quest de verdade (objetivo, mapa instanciado, checkpoints) ainda não
**PRD:** §28
**Épico:** E11

## Comportamento

Quests usam mapas instanciados, potencialmente maiores e mais exploráveis que uma hunt, nos quais o personagem pode precisar andar manualmente, descobrir caminhos e resolver um objetivo. Podem ser feitas solo ou em party — não existe tamanho mínimo global, e o tamanho máximo é definido individualmente por cada quest. Não existem checkpoints no modelo inicial: a quest não salva progresso parcial intermediário. Repetibilidade também depende da quest específica — algumas são únicas, outras repetíveis —, e o framework precisa suportar os dois casos.

A promoção de vocação (`progression.md`, §9.2) é o caso mais importante de quest única e permanente no MVP.

## Regras

- Mapas instanciados, com exploração e movimentação manual.
- Solo ou party; sem mínimo global de membros.
- Tamanho máximo de party definido individualmente por cada quest.
- Sem checkpoints no modelo inicial.
- Repetibilidade definida por quest: algumas únicas, outras repetíveis.
- A quest de promoção de vocação é única e permanente.

## Storages por personagem (#731, ADR 0050 d.6 T2)

A semente do motor: **antes de existir qualquer quest**, o personagem precisa de um lugar para
guardar "isto já aconteceu" que atravesse sessão — a mesma pergunta que o Canary responde com
`player:getStorageValue(key)`/`setStorageValue(key, value)`, e é o mecanismo que a porta de
quest, o baú com dono e o NPC que lembra do jogador (T2/T3 do ADR 0050) vão consumir.

**Ausência é SEMPRE "nunca setado" — o valor de ausência é `-1`, a convenção do Tibia.** Zero é
um valor guardado como outro qualquer ("aceitou mas não concluiu"), não "sem storage". Gravar
`-1` explicitamente nunca acontece: setar um storage para `-1` APAGA a linha
(`CharacterRuntime.setStorageValue`, `packages/sim/src/character.ts`), porque um `-1` gravado
seria indistinguível de "nunca setado" e só infla a tabela à toa.

**Persistência é uma linha por chave** (`character_storage`: `character_id`, `storage_key`,
`value`), e não uma coluna `jsonb` em `character` como `bestiary`/`ammo`/`supply_stock` — decisão
deliberada (DT-01 abaixo): só a Cidade de Thais tem ~110 interativos gated por storage (51
portas de chave + 59 baús, ADR 0050 contexto), e o motor de quest que este sistema semeia só
cresce daqui. Uma linha por chave é o que permite ler/escrever POR CHAVE mais tarde, sem
reescrever um blob inteiro a cada storage tocado.

**O caminho é o mesmo do overlay de item por instância** (#604, ADR 0046 — `item-overlay.ts` e
o caminho dele no server são o modelo): o extrato (`SessionReceipt.storages`) leva o mapa da
sessão para o `jobs`, que grava na mesma transação da progressão (`applyStorages`,
`jobs/ledger.ts`); o ticket (`InitialCharacter.storages`) carrega os storages de volta na
próxima entrada. Diferença de forma, não de espírito: o overlay é um PATCH por instância
(`instanceId → overlay | null`, só toca o que está listado); o storage é o ESTADO INTEIRO do
personagem por sessão — a mesma ideia de `supplyStock`, que também é absoluto e nunca gateado
por vazio (um storage apagado NESTA sessão é resultado real, e omitir a chave deixaria o valor
antigo do Postgres ressuscitar no próximo login — a lição do #536). Como o estado é por LINHA
(não por coluna), "estado inteiro" no extrato vira duas metades em `applyStorages`: upsert de
toda chave presente, e DELETE de toda chave que o banco tem e o extrato não lista mais.

Invariantes 9 e 10: o `CharacterRuntime.storages` é escrito só pela sessão dona (invariante 9,
como qualquer estado quente); a travessia entre sessões passa pelo extrato/ledger, na mesma
transação da progressão — não por um ledger próprio, porque storage não é valor monetário e não
precisa de `(session_id, seq)` dedicado; a idempotência que ele herda é a do `writeReceipts` que
já envolve toda a transação (invariante 10).

**Desde a #733, dois interativos do mundo já leem/escrevem um storage** (`docs/product/
scenery.md`, "Porta de quest e baú com `uid`"): a porta de quest confere
`getStorageValue(requires.storageKey) >= 1` no momento de usar; o baú com `uid` entrega um item
uma vez por personagem e marca `chestStorageKeyOf(uid) = 1` — sem tocar este mecanismo de novo,
como previsto. **O que ainda NÃO existe:** o motor de OBJETIVO de quest de verdade (mapa
instanciado, checkpoints, o que de fato marca um storage como "concluído") — os dois interativos
acima consomem `getStorageValue`/`setStorageValue`, mas nenhum conteúdo real ainda os SETA
(`requires.storageKey` real das portas e `reward` real dos baús de Thais ficam de fora da #733,
sem OTBM de origem nem quest desenhada — `docs/product/scenery.md`, "Em aberto").

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Tamanho máximo de party | definido individualmente por quest (sem valor global) | caminho previsto: `packages/content/quests` |
| Checkpoints | inexistentes no modelo inicial | caminho previsto: `packages/content/quests` |
| Repetibilidade | por quest (única ou repetível) | caminho previsto: `packages/content/quests` |
| Valor de ausência de storage | `-1` (convenção do Tibia, sem `[ABERTO]`: é mecanismo, não número de balanceamento) | `packages/sim/src/character-storage.ts` (`UNSET_STORAGE_VALUE`) |

## Em aberto

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema.

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
