/**
 * Um papel do servidor: `api`, `game` ou `jobs`.
 *
 * A mesma interface serve para o modo solo (os três num processo) e para produção
 * (um por container). É o que faz a validação numa VPS pequena não exigir um desenho
 * diferente do de escala.
 */
export interface Papel {
  readonly nome: string;
  iniciar(): Promise<void>;
  /** Chamado em SIGTERM. Precisa terminar dentro do prazo de encerramento do orquestrador. */
  drenar(): Promise<void>;
}
