import { useEffect } from 'react';
import { createConnection } from '../net/connection.js';
import { restartConnection, setConnection } from '../net/current.js';
import { offerWsUrl } from '../net/pending-ticket.js';
import { API_URL } from '../account/api.js';
import type { TicketEntry } from '../account/api.js';
import { leaveGame } from '../account/actions.js';
import { partyApi } from '../party/api.js';
import { setEnterHunt, setPartyCharacter, setPartyClient } from '../party/store.js';
import { friendsApi } from '../friends/api.js';
import { setFriendsCharacter, setFriendsClient } from '../friends/store.js';

/**
 * Liga o socket enquanto o componente estiver montado.
 *
 * O `characterId` vem de fora porque escolher personagem é uma tela de HTTP (FUN-11), não
 * do socket: o cliente já sabe quem vai entrar antes de abrir a conexão.
 */
export function useConnection(characterId: string | null, entry: TicketEntry = 'world'): void {
  // O `entry` é um objeto novo a cada escolha, e dependência por identidade recriaria a conexão sem que nada
  // tivesse mudado: o que decide é a hunt pedida (ou nenhuma).
  const entryHunt = entry === 'world' ? null : entry.hunt;
  useEffect(() => {
    if (characterId === null) return;
    const connection = createConnection({
      apiUrl: API_URL,
      characterId,
      // Por onde a primeira sessão nasce (#846, OW-23): o mundo ou uma hunt idle direta.
      entry: entryHunt === null ? 'world' : { hunt: entryHunt },
      // O servidor fechou porque o personagem saiu (logout aceito): volta à escolha de personagem, em vez
      // de reconectar e recriar a sessão que o jogador acabou de deixar.
      onLeft: leaveGame,
    });
    // Registrada enquanto viva: é por aqui que um botão manda intenção sem o socket passar
    // por props ou por contexto do React (FUN-79).
    setConnection(connection);
    // A party (#197): a store recebe quem fala HTTP e quem entra na hunt — oferecer o ticket
    // à conexão e reconectar. A store não importa `net/` (ADR 0007); a casca liga os dois.
    setPartyCharacter(characterId);
    setPartyClient(partyApi);
    // Amigos (#403/#404): mesmo padrão da party — a store `friends/` não importa `net/`.
    setFriendsCharacter(characterId);
    setFriendsClient(friendsApi);
    setEnterHunt((wsUrl) => {
      offerWsUrl(wsUrl);
      restartConnection();
    });
    connection.start();
    return () => {
      setEnterHunt(null);
      setFriendsClient(null);
      setFriendsCharacter(null);
      setPartyClient(null);
      setPartyCharacter(null);
      setConnection(null);
      connection.stop();
    };
  }, [characterId, entryHunt]);
}
