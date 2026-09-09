// Sessões órfãs: o que sobra quando um nó morre (FUN-28).
//
// Órfã = **o snapshot existe e o lease do diretório não**. O lease morre com o nó, o snapshot
// não; a diferença entre os dois é exatamente "alguém estava rodando isto e parou de renovar".
//
// O que este código NÃO faz, de propósito: retomar. Retomar é hospedar, e hospedar é do
// `game`. Quem retoma é o próprio nó ao qual o jogador reconecta — a retomada acontece no
// caminho que já existe (`prepare`), sem fila entre processos nem nó escolhido a dedo.
//
// Aqui fica o caso de quem NÃO volta: passado o prazo, o slot da conta é devolvido para o
// jogador conseguir usar seus outros personagens, e o snapshot permanece até o TTL dele —
// porque §38.4 diz que uma hunt AFK não pode sumir em silêncio, e apagar cedo é sumir.

import type { SessionDirectory } from '../directory.js';
import type { Logger } from '../log.js';
import type { SnapshotStore } from '../snapshots.js';

export interface OrphanSweepOptions {
  readonly directory: SessionDirectory;
  readonly snapshots: SnapshotStore;
  readonly logger: Logger;
  /**
   * Quanto tempo uma sessão pode ficar sem lease antes de o slot ser devolvido.
   *
   * Folgado contra o lease: o nó pode estar numa pausa de GC ou reiniciando. Devolver o slot
   * cedo demais deixa o jogador entrar com um terceiro personagem enquanto o nó volta com o
   * primeiro — e aí o teto de dois foi furado por dentro.
   */
  readonly graceMs?: number;
  readonly now?: () => number;
}

const DEFAULT_GRACE_MS = 120_000;

export interface OrphanSweepResult {
  readonly examined: number;
  readonly orphaned: number;
  readonly released: number;
}

export async function sweepOrphanedSessions(
  options: OrphanSweepOptions,
): Promise<OrphanSweepResult> {
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const now = options.now ?? Date.now;

  const characterIds = await options.snapshots.storedCharacterIds();
  let orphaned = 0;
  let released = 0;

  for (const characterId of characterIds) {
    // Lease vivo: o nó dono está renovando, não há órfã nenhuma.
    if ((await options.directory.lookup(characterId)) !== null) continue;

    const stored = await options.snapshots.load(characterId);
    // Sumiu entre o SCAN e a leitura, ou está corrompido. Nos dois casos não há o que fazer.
    if (stored === null) continue;
    orphaned += 1;

    if (now() - stored.savedAtMs < graceMs) continue;

    // O snapshot FICA. O que volta é o slot: sem isso o jogador não consegue jogar os outros
    // personagens enquanto este espera alguém reconectar (FUN-52).
    await options.directory.releaseSlot(stored.accountId, characterId);
    released += 1;
    options.logger.info(
      { characterId, accountId: stored.accountId, sinceMs: now() - stored.savedAtMs },
      'Released the slot of an orphaned session; the snapshot is kept for resumption',
    );
  }

  return { examined: characterIds.length, orphaned, released };
}
