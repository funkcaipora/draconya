import { useEffect } from 'react';
import { createConnection } from '../net/connection.js';
import { restartConnection, setConnection } from '../net/current.js';
import { offerWsUrl } from '../net/pending-ticket.js';
import { API_URL } from '../account/api.js';
import { partyApi } from '../party/api.js';
import { setEnterHunt, setPartyCharacter, setPartyClient } from '../party/store.js';

/**
 * Liga o socket enquanto o componente estiver montado.
 *
 * O `characterId` vem de fora porque escolher personagem é uma tela de HTTP (FUN-11), não
 * do socket: o cliente já sabe quem vai entrar antes de abrir a conexão.
 */
export function useConnection(characterId: string | null): void {
  useEffect(() => {
    if (characterId === null) return;
    const connection = createConnection({ apiUrl: API_URL, characterId });
    // Registrada enquanto viva: é por aqui que um botão manda intenção sem o socket passar
    // por props ou por contexto do React (FUN-79).
    setConnection(connection);
    // A party (#197): a store recebe quem fala HTTP e quem entra na hunt — oferecer o ticket
    // à conexão e reconectar. A store não importa `net/` (ADR 0007); a casca liga os dois.
    setPartyCharacter(characterId);
    setPartyClient(partyApi);
    setEnterHunt((wsUrl) => {
      offerWsUrl(wsUrl);
      restartConnection();
    });
    connection.start();
    return () => {
      setEnterHunt(null);
      setPartyClient(null);
      setPartyCharacter(null);
      setConnection(null);
      connection.stop();
    };
  }, [characterId]);
}
