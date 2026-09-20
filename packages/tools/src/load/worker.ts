// Um worker do cliente de carga: abre a sua fatia de sessões e devolve as amostras (FUN-45).
//
// **Processo separado, não thread.** O limite de descritores de arquivo é POR PROCESSO, e é ele
// que decide quantos sockets cabem — cinco mil conexões num processo só esbarram nele muito
// antes de esbarrarem em CPU. N processos multiplicam o orçamento de descritores, e de quebra
// cada um ganha o próprio laço de eventos. Sem isso, o gargalo medido seria o do cliente de
// carga, e o relatório mediria a ferramenta em vez do servidor.

import { openParty, openSession, type LoadMode, type SyntheticSession } from './session.js';
import type { SessionSample } from './report.js';

export interface WorkerCommand {
  readonly apiUrl: string;
  readonly sessions: number;
  readonly mode: LoadMode;
  readonly durationMs: number;
  readonly huntId: string;
  readonly difficulty: string;
  readonly pingIntervalMs: number;
  /** Espaçamento entre aberturas, em ms. Ver `RAMP`. */
  readonly rampMs: number;
  /** Tamanho da party (#198). 1 é solo. */
  readonly party: number;
  /** Os dois eixos do ADR 0033 D1 (#407): substituem o antigo `partyMode`. */
  readonly shareCosts: boolean;
  readonly splitLoot: boolean;
}

export interface WorkerResult {
  readonly samples: SessionSample[];
}

async function run(command: WorkerCommand): Promise<WorkerResult> {
  const open: SyntheticSession[] = [];
  const pending: Array<Promise<void>> = [];

  const sessionOptions = {
    apiUrl: command.apiUrl,
    mode: command.mode,
    huntId: command.huntId,
    difficulty: command.difficulty,
    pingIntervalMs: command.pingIntervalMs,
  };
  // Parties de N (#198): as sessões deste worker vão de N em N; a sobra (`sessions % party`)
  // entra solo, e o relatório diz quantas parties foram formadas.
  const size = Math.max(1, command.party);
  const parties = size > 1 ? Math.floor(command.sessions / size) : 0;
  const solo = command.sessions - parties * size;
  for (let i = 0; i < parties + solo; i++) {
    // Rampa, não avalanche. Abrir mil sessões no mesmo tick mede o pico de handshake do
    // servidor, que é uma pergunta diferente de "quanto custa manter mil sessões" — e é a
    // segunda que a projeção de custo usa.
    if (command.rampMs > 0) {
      await new Promise((resolve) => { setTimeout(resolve, command.rampMs); });
    }
    if (i < parties) {
      pending.push(openParty({
        ...sessionOptions, size, shareCosts: command.shareCosts, splitLoot: command.splitLoot,
      }).then((sessions) => { open.push(...sessions); }));
    } else {
      pending.push(openSession(sessionOptions).then((session) => { open.push(session); }));
    }
  }
  await Promise.all(pending);

  await new Promise((resolve) => { setTimeout(resolve, command.durationMs); });

  const samples = open.map((session) => session.sample());
  for (const session of open) session.close();
  return { samples };
}

/**
 * Manda o resultado e SÓ ENTÃO sai.
 *
 * `process.send` é assíncrono. Sair no `finally` logo depois funcionava com payload pequeno e
 * perdia a mensagem inteira quando ela crescia — quinhentas sessões anexadas, com as
 * latências junto, voltavam como zero amostras enquanto o servidor via as quinhentas sessões
 * de pé. O relatório dizia "0 abertas, 0 falharam", que é a pior das duas mentiras possíveis.
 */
function reply(result: WorkerResult): void {
  const sent = process.send?.(result, undefined, undefined, () => { process.exit(0); });
  if (sent !== true) process.exit(0);
}

process.on('message', (command: WorkerCommand) => {
  void run(command)
    .then(reply)
    .catch((error: unknown) => {
      reply({
        samples: [{
          joinMs: 0, bytes: 0, frames: 0, messages: 0, latencies: [],
          failed: error instanceof Error ? error.message : String(error),
        }],
      });
    });
});
