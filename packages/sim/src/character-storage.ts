// Storages por personagem (#731, ADR 0050 d.6 T2) — a semente do motor de quest.
//
// A pergunta é a mesma do Canary: `player:getStorageValue(key)`/`setStorageValue(key, value)`
// (ver ADR 0050, contexto — "porta de quest exige `player:getStorageValue(item.actionid) ~= -1`").
// **Ausência é SEMPRE "nunca setado"**, e o valor de ausência é `-1` — a mesma convenção do
// Tibia. Zero é um valor guardado como outro qualquer, não "sem storage": uma quest que usa
// `0` para "aceita mas não concluiu" e `1` para "concluiu" precisa que os dois sobrevivam.
//
// O modelo é o do overlay de item por instância (#604, `item-overlay.ts`): um objeto piano,
// lido defensivamente do que vier do banco ou de um snapshot antigo — campo torto some da
// leitura em vez de travar o login inteiro por causa de UMA chave (a régua do Bestiário).
//
// Invariante 6: um `storageKey` nunca carrega arte — é só uma chave de progresso; quem decide
// o que ela significa (que porta abre, que NPC fala diferente) é conteúdo, não este módulo.

/** O valor de AUSÊNCIA — a mesma convenção do Tibia (`getStorageValue` sem valor gravado). */
export const UNSET_STORAGE_VALUE = -1;

export type CharacterStorageMap = Readonly<Record<string, number>>;

/**
 * Um mapa de storages válido: toda chave não vazia, todo valor um inteiro seguro e DIFERENTE
 * do valor de ausência — gravar `-1` seria indistinguível de "nunca setado" e só infla a tabela
 * à toa (quem quer "esquecer" um storage apaga a linha, não escreve `-1` nela).
 */
export function isCharacterStorageMap(value: unknown): value is CharacterStorageMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, stored]) =>
    key.length > 0
    && typeof stored === 'number'
    && Number.isSafeInteger(stored)
    && stored !== UNSET_STORAGE_VALUE);
}

/**
 * Lê um mapa de storages GRAVADO (linha do banco reconstruída em objeto, ou snapshot antigo) de
 * forma defensiva, como `readItemOverlay`: a chave torta (valor não inteiro, ou `-1` gravado por
 * engano) some da leitura em vez de travar o login inteiro por sua causa.
 *
 * `undefined` para "nada sobrou" — o mesmo formato de `readItemOverlay`/`normalizeItemOverlay`:
 * um objeto vazio não é gravado como storage, é ausência.
 */
export function readCharacterStorage(stored: unknown): CharacterStorageMap | undefined {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return undefined;
  const clean: Record<string, number> = {};
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (key.length === 0 || typeof value !== 'number') continue;
    if (!Number.isSafeInteger(value) || value === UNSET_STORAGE_VALUE) continue;
    clean[key] = value;
  }
  return Object.keys(clean).length === 0 ? undefined : clean;
}
