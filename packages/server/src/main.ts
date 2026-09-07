// Entrada única dos três papéis.
//
//   PROCESSOS=api,game,jobs   modo solo — tudo num processo (desenvolvimento e validação)
//   PROCESSOS=game            um papel por container (escala)
//
// A mesma imagem serve aos dois. Validar numa VPS pequena não exige desenho diferente
// do de escala — muda só a variável.

import { carregarConfiguracao } from './config.js';
import { criarLog } from './log.js';
import { criarApi } from './api/servidor.js';
import { criarGame } from './game/servidor.js';
import { criarJobs } from './jobs/agendador.js';
import type { Papel } from './papel.js';

const PAPEIS_VALIDOS = ['api', 'game', 'jobs'] as const;
type NomeDePapel = (typeof PAPEIS_VALIDOS)[number];

/** Prazo para drenar antes de o orquestrador mandar SIGKILL. */
const PRAZO_DE_DRENAGEM_MS = 25_000;

function papeisPedidos(): NomeDePapel[] {
  const cru = process.env['PROCESSOS'] ?? 'api,game,jobs';
  const pedidos = cru.split(',').map((p) => p.trim()).filter(Boolean);
  const invalidos = pedidos.filter((p) => !PAPEIS_VALIDOS.includes(p as NomeDePapel));
  if (invalidos.length > 0) {
    throw new Error(
      `PROCESSOS inválido: ${invalidos.join(', ')}. Válidos: ${PAPEIS_VALIDOS.join(', ')}`,
    );
  }
  if (pedidos.length === 0) throw new Error('PROCESSOS não pode ser vazio');
  return pedidos as NomeDePapel[];
}

async function principal(): Promise<void> {
  const cfg = carregarConfiguracao();
  const nomes = papeisPedidos();
  const log = criarLog(cfg.LOG_LEVEL, nomes.join('+'));

  const construtores: Record<NomeDePapel, () => Papel> = {
    api: () => criarApi(cfg, log.child({ papel: 'api' })),
    game: () => criarGame(cfg, log.child({ papel: 'game' })),
    jobs: () => criarJobs(cfg, log.child({ papel: 'jobs' })),
  };

  const papeis = nomes.map((n) => construtores[n]());
  log.info({ papeis: nomes, solo: nomes.length > 1 }, 'iniciando');

  for (const papel of papeis) await papel.iniciar();

  let encerrando = false;
  const encerrar = (sinal: string): void => {
    // Segundo sinal força a saída: se o operador mandou duas vezes, ele quer agora.
    if (encerrando) {
      log.warn({ sinal }, 'segundo sinal — saindo imediatamente');
      process.exit(1);
    }
    encerrando = true;
    log.info({ sinal }, 'drenando');

    const prazo = setTimeout(() => {
      log.error({ prazoMs: PRAZO_DE_DRENAGEM_MS }, 'drenagem estourou o prazo — saindo');
      process.exit(1);
    }, PRAZO_DE_DRENAGEM_MS);
    prazo.unref();

    // Ordem importa: `api` primeiro para parar de emitir ticket, depois `jobs` para
    // não competir por sessão órfã, e `game` por último para ter o prazo inteiro —
    // é ele que precisa creditar progresso de quem não está olhando.
    const ordem = ['api', 'jobs', 'game'];
    const drenagem = [...papeis].sort(
      (a, b) => ordem.indexOf(a.nome) - ordem.indexOf(b.nome),
    );

    void (async () => {
      for (const papel of drenagem) {
        try {
          await papel.drenar();
        } catch (erro) {
          log.error({ erro, papel: papel.nome }, 'falha ao drenar');
        }
      }
      clearTimeout(prazo);
      log.info('encerrado com limpeza');
      process.exit(0);
    })();
  };

  process.on('SIGTERM', () => encerrar('SIGTERM'));
  process.on('SIGINT', () => encerrar('SIGINT'));

  // Estado inconsistente não pode continuar servindo: melhor cair e ser reiniciado.
  process.on('uncaughtException', (erro) => {
    log.fatal({ erro }, 'exceção não tratada');
    process.exit(1);
  });
  process.on('unhandledRejection', (motivo) => {
    log.fatal({ motivo }, 'promessa rejeitada sem tratamento');
    process.exit(1);
  });
}

principal().catch((erro: unknown) => {
  console.error('falha ao iniciar:', erro);
  process.exit(1);
});
