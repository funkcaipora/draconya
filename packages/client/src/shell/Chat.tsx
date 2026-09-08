import { useHudSlice } from '../state/useSlice.js';

/** Chat no canto inferior esquerdo (§5.3). Enviar mensagem é F2; aqui só se lê. */
export function Chat() {
  const chat = useHudSlice((state) => state.chat);
  const systemMessages = useHudSlice((state) => state.systemMessages);

  return (
    <section className="chat" aria-label="chat">
      {systemMessages.slice(-3).map((line) => (
        <p key={`${line.atMs}-${line.text}`} className={`system system-${line.level}`}>
          {line.text}
        </p>
      ))}
      {chat.slice(-8).map((line) => (
        <p key={`${line.atMs}-${line.author}-${line.text}`}>
          <b>{line.author}</b>: {line.text}
        </p>
      ))}
      {chat.length === 0 && systemMessages.length === 0 ? <p className="quiet">—</p> : null}
    </section>
  );
}
