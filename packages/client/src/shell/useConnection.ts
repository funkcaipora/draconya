import { useEffect } from 'react';
import { createConnection } from '../net/connection.js';

const API_URL = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3000';

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
    connection.start();
    return () => connection.stop();
  }, [characterId]);
}
