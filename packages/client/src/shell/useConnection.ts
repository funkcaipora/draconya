import { useEffect } from 'react';
import { createConnection } from '../net/connection.js';
import { setConnection } from '../net/current.js';
import { API_URL } from '../account/api.js';

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
    connection.start();
    return () => {
      setConnection(null);
      connection.stop();
    };
  }, [characterId]);
}
