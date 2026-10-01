// O estado por INSTÂNCIA de um item (ADR 0046, #604).
//
// **O catálogo continua fixo pelo id** (ADR 0046 d.1, `itemSchema`): duas espadas do mesmo id
// têm os mesmos atributos base. O que diverge de uma instância para outra — os imbuements que
// ela carrega, e depois o tier da Forja e o prazo restante de um anel — mora AQUI, num overlay
// opcional da entrada de inventário (d.2), e não num item novo de catálogo.
//
// **Ponto de extensão.** O overlay é um objeto de campos OPCIONAIS NOMEADOS, cada um de uma
// mecânica, e "ausente" sempre significa "o valor da definição". Uma mecânica nova acrescenta um
// campo aqui e o seu leitor em `readItemOverlay`; nada mais muda — nem o snapshot (campo
// opcional, sem bump), nem o banco (`item_instance.overlay` é `jsonb` e guarda o objeto inteiro),
// nem o extrato (leva o objeto inteiro). Os campos:
//   - `imbuements` (#604): os imbuements aplicados, um por slot.
//   - `durationRemainingMs` (#689): o prazo RESTANTE de um anel com `durationMs`, gravado ao
//     sair do corpo, "ausente é cheio" — a mesma regra de `CarriedItem.charges`.
//   - `charges` (#631): as cargas RESTANTES de uma exercise weapon, "ausente é cheia".
//   - `tier` (#617, previsto): o tier 0–10 da Forja da Exaltação.
//
// **Item com overlay não empilha** (ADR 0046 d.3): o estado de instância o torna não fungível
// com outro exemplar do mesmo id. `Inventory` confere isso em todo caminho que junta pilha.
//
// Invariante 6: o overlay nunca carrega arte — tipo e tempo, nunca `appearanceId`.

/**
 * Um imbuement aplicado a uma instância (ADR 0046 d.2). `slot` é a posição (0-based) entre os
 * `imbuementSlots` do item; `typeId` aponta o catálogo de imbuements (#605), que é conteúdo; e
 * `remainingMs` é o tempo de combate que sobra — o decaimento é sob demanda, nunca por tick
 * (ADR 0046 d.4, invariante 2), e é da #606.
 */
export interface ImbuementState {
  readonly slot: number;
  readonly typeId: string;
  readonly remainingMs: number;
}

/**
 * O overlay por instância. Todo campo é opcional e ausente é "o da definição"; um overlay sem
 * nenhum campo não existe — a entrada simplesmente não tem `overlay` (ver `normalizeItemOverlay`).
 */
export interface ItemInstanceOverlay {
  /** Os imbuements aplicados, um por slot ocupado, em ordem de slot (#604). */
  readonly imbuements?: readonly ImbuementState[];
  /**
   * O prazo RESTANTE (ms) de um item com `durationMs` (#689), gravado quando ele SAI do corpo:
   * fora do dedo o prazo pausa, e vestir de novo retoma daqui. Ausente é "cheio" — a mesma regra
   * de `CarriedItem.charges` —, e é o caso de todo anel que nunca foi vestido.
   */
  readonly durationRemainingMs?: number;
  /**
   * As cargas RESTANTES de uma exercise weapon (#631, ADR 0059 d.1): a definição traz o total
   * (`Item.charges`, 500/1 800/14 400) e cada golpe do Treino gasta UMA. Ausente é "cheia" — a
   * mesma regra de `CarriedItem.charges` e do prazo do anel —, e é o caso de toda exercise weapon
   * recém-comprada. Vive no overlay, e não em `CarriedItem.charges`, porque o overlay é o campo
   * que ATRAVESSA a sessão (`item_instance.overlay`, ADR 0046); o `charges` do colar não persiste.
   * Zero nunca é guardado: a exercise weapon esgotada é DESTRUÍDA (`Inventory.remove`), como no
   * Canary (`weapon:remove(1)`).
   */
  readonly charges?: number;
  // Próximo campo (ver o cabeçalho): `tier?: number` (#617).
}

/**
 * O overlay sem os campos vazios, ou `undefined` quando não sobra nada. É o que mantém a regra
 * "item com overlay não empilha" honesta: um `{ imbuements: [] }` esquecido depois de o último
 * imbuement vencer não pode deixar a peça presa como não empilhável para sempre.
 */
export function normalizeItemOverlay(
  overlay: ItemInstanceOverlay | undefined,
): ItemInstanceOverlay | undefined {
  if (overlay === undefined) return undefined;
  const rest: Record<string, unknown> = { ...overlay };
  if (overlay.imbuements !== undefined && overlay.imbuements.length === 0) delete rest.imbuements;
  for (const [key, value] of Object.entries(rest)) if (value === undefined) delete rest[key];
  return Object.keys(rest).length === 0 ? undefined : rest as ItemInstanceOverlay;
}

/** A instância carrega estado próprio? É a pergunta que o empilhamento faz (ADR 0046 d.3). */
export function hasItemOverlay(item: { readonly overlay?: ItemInstanceOverlay }): boolean {
  return normalizeItemOverlay(item.overlay) !== undefined;
}

/**
 * Lê um overlay GRAVADO (a coluna `jsonb` do `item_instance`, ou um snapshot) — ou `undefined`.
 *
 * A coluna não tem CHECK, então a leitura é defensiva, na régua do Bestiário no ticket: campo
 * torto cai (vira "o da definição") em vez de trancar o login. Campo DESCONHECIDO é preservado
 * como veio: é o campo de uma mecânica que um nó mais novo já escreve (#617), e descartá-lo
 * na leitura faria o próximo extrato apagá-lo do banco (ADR 0014: dado persistido não se
 * descarta às cegas).
 */
export function readItemOverlay(stored: unknown): ItemInstanceOverlay | undefined {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return undefined;
  const overlay: Record<string, unknown> = { ...(stored as Record<string, unknown>) };
  if ('imbuements' in overlay) {
    const imbuements = readImbuements(overlay.imbuements);
    if (imbuements === undefined) delete overlay.imbuements;
    else overlay.imbuements = imbuements;
  }
  if ('durationRemainingMs' in overlay) {
    const remaining = overlay.durationRemainingMs;
    // Zero não é prazo guardado: o anel esgotado é destruído, nunca volta à mochila.
    if (typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining <= 0) {
      delete overlay.durationRemainingMs;
    }
  }
  if ('charges' in overlay) {
    const charges = overlay.charges;
    // Só inteiro positivo é uma carga guardada: 0 é a arma destruída, e nada disso volta.
    if (typeof charges !== 'number' || !Number.isInteger(charges) || charges <= 0) delete overlay.charges;
  }
  return normalizeItemOverlay(overlay as ItemInstanceOverlay);
}

function readImbuements(stored: unknown): readonly ImbuementState[] | undefined {
  if (!Array.isArray(stored)) return undefined;
  const seen = new Set<number>();
  const imbuements: ImbuementState[] = [];
  for (const entry of stored as unknown[]) {
    if (entry === null || typeof entry !== 'object') return undefined;
    const { slot, typeId, remainingMs } = entry as Record<string, unknown>;
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || seen.has(slot)) return undefined;
    if (typeof typeId !== 'string' || typeId.length === 0) return undefined;
    if (typeof remainingMs !== 'number' || !Number.isFinite(remainingMs) || remainingMs < 0) return undefined;
    seen.add(slot);
    imbuements.push({ slot, typeId, remainingMs });
  }
  return imbuements.sort((a, b) => a.slot - b.slot);
}
