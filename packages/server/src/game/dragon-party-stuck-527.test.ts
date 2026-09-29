import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import type { Content } from '@draconya/content';
import type { SessionSnapshot } from '@draconya/sim';
import { createSessionRestorer } from './sessions.js';

// Reprodução exata de uma QA ao vivo (#527): a party de dragões, num nó real, ficou parada por
// 200+ s no meio da rota — Knight (líder, sem alvo, nada bloqueando visivelmente) simplesmente
// não andava. `dragon-party-stuck-527.json` é o snapshot REAL dessa sessão travada, capturado
// direto do Redis do nó (`Session.snapshot()`, o mesmo formato que `jobs`/`game` gravam e
// `#resume` (`host.ts`) restaura) — não uma reconstrução: a mesma composição de spawn, a mesma
// semente de RNG, o mesmo índice de rota onde o Knight parou.
//
// Causa raiz: o ÍNDICE do `RouteWalker` do Knight (44) estava UM ATRÁS da posição real dele
// (que já correspondia ao índice 45) — um desvio que os ramos de recuperação de
// `HuntRuleset#playerStep` produzem quando o personagem chega a um tile da rota por outro
// caminho que não `RouteWalker#step` (o desvio ao redor de um companheiro, por exemplo, que
// aplica o passo físico e SEGURA o índice no mesmo movimento). Com o índice atrasado,
// `walker.step()` pede o PRÓXIMO tile — que já é onde o Knight está —, `move()` recusa por
// `same-tile`, e o `hold()` do ramo genérico desfazia o avanço do índice a cada vencimento,
// repetindo o MESMO passo recusado para sempre. Corrigido tratando `same-tile` como "o índice
// já está certo, só ainda não tinha alcançado" — sem `hold()`, o vencimento seguinte pede o
// tile de verdade seguinte.
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
const SNAPSHOT_PATH = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'dragon-party-stuck-527.json');

let cached: Content | null = null;
const real = (): Content => {
  cached ??= loadContent(DATA);
  return cached;
};

function loadStuckSnapshot(): SessionSnapshot {
  const raw = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as { snapshot: SessionSnapshot };
  return raw.snapshot;
}

// O snapshot fixa `contentVersion` (invariante 7) — o MESMO formato que produziu o travamento
// ao vivo. Se `packages/content/data` mudar o bastante para mudar o hash, `createSessionRestorer`
// recusa por design (§7: nunca simular uma sessão antiga com conteúdo novo) e este teste teria
// que recapturar um snapshot novo — `pula`, em vez de falhar, avisa exatamente isso em vez de
// quebrar o CI por uma mudança de conteúdo sem relação com o bug.
describe('a party travada de uma QA ao vivo volta a andar (#527)', () => {
  const content = real();
  const snapshot = loadStuckSnapshot();
  const restorable = snapshot.contentVersion === content.version;

  it.runIf(restorable)('o Knight sai do tile onde ficou parado, a 1 Hz e a 20 Hz', () => {
    const outcomeAt = (stepMs: number) => {
      const session = createSessionRestorer(content)(snapshot);
      if (session === null) throw new Error('restore devolveu null com a mesma contentVersion');
      const knight = session.participants.find((p) => p.vocationId === 'knight');
      if (knight === undefined) throw new Error('snapshot sem o Knight');
      const startPosition = { ...knight.position };
      let moved = false;
      const TOTAL_MS = 3 * 60_000;
      for (let elapsed = 0; elapsed < TOTAL_MS && session.ended === null; elapsed += stepMs) {
        session.advanceBy(stepMs);
        if (knight.position.x !== startPosition.x || knight.position.y !== startPosition.y) moved = true;
      }
      return moved;
    };

    const movedAt1Hz = outcomeAt(1_000);
    const movedAt20Hz = outcomeAt(50);

    // O snapshot foi capturado NO MEIO do travamento — o Knight tem que sair do tile onde
    // parou, nas duas taxas (a hunt desanexada tica a 1 Hz — ADR 0003/0020 — e o resultado
    // lógico não pode depender disso, invariante 3).
    expect(movedAt1Hz, 'a 1 Hz: Knight nunca saiu do tile onde a QA ao vivo o flagrou parado')
      .toBe(true);
    expect(movedAt20Hz, 'a 20 Hz: Knight nunca saiu do tile onde a QA ao vivo o flagrou parado')
      .toBe(true);
    // 20 s de teto (#527) — a variante 20 Hz roda 3600 vencimentos de 50 ms, e a suíte inteira
    // (CI, `pnpm check`) competindo por CPU o bastante ocasionalmente estoura o teto padrão de
    // 5 s sem nenhuma regressão de verdade.
  }, 20_000);
});
