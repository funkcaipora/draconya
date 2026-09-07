// Processo `jobs` — singleton com lock. Agendador, expirações e reconciliação.
//
// ESQUELETO. O laço existe; as tarefas entram depois: Guild War diária, expiração da
// Caixa de Loot, reset de Prey, expiração de Premium, recuperação de sessão órfã (FUN-28)
// e reconciliação de pagamento.

import type { Configuracao } from '../config.js';
import type { Log } from '../log.js';
import type { Papel } from '../papel.js';

const INTERVALO_MS = 10_000;

export function criarJobs(_cfg: Configuracao, log: Log): Papel {
  let timer: NodeJS.Timeout | null = null;
  let rodando = false;

  async function ciclo(): Promise<void> {
    // Reentrância: um ciclo lento não pode se sobrepor ao seguinte.
    if (rodando) {
      log.warn('ciclo anterior ainda rodando; pulando este');
      return;
    }
    rodando = true;
    try {
      // FUN-28: procurar sessões órfãs (lease expirado) e decidir retomar ou creditar.
      // Precisa de lock com fencing token — duas cópias da mesma sessão rodando é pior
      // que uma perdida, porque dobra loot e XP.
    } catch (erro) {
      log.error({ erro }, 'ciclo do agendador falhou');
    } finally {
      rodando = false;
    }
  }

  return {
    nome: 'jobs',
    async iniciar() {
      // TODO(FUN-28): tomar o lock de singleton no Redis antes de começar a agendar.
      timer = setInterval(() => void ciclo(), INTERVALO_MS);
      log.info({ intervaloMs: INTERVALO_MS }, 'jobs iniciado');
    },
    async drenar() {
      if (timer) clearTimeout(timer);
      timer = null;
      while (rodando) await new Promise((r) => setTimeout(r, 50));
      log.info('jobs encerrado');
    },
  };
}
