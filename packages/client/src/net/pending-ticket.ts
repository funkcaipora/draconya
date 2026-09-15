// Um ticket que chegou por OUTRO caminho (#197): o `start` da party devolve o do líder, e o
// `GET /api/party/mine` devolve o de cada membro. A conexão pede ticket por `POST /api/tickets`
// ao (re)conectar; este módulo é a fila de um lugar só que ela olha ANTES de pedir — assim a
// party entra na hunt pelo mesmo `connect` de sempre, sem um segundo caminho de socket.
//
// Um só, e consumido ao pegar: um ticket é de uso único, e guardar dois seria guardar um que
// já não vale.

let pending: string | null = null;

export function offerWsUrl(wsUrl: string): void {
  pending = wsUrl;
}

export function takeWsUrl(): string | null {
  const taken = pending;
  pending = null;
  return taken;
}
