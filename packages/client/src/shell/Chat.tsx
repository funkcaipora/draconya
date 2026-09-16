import { useHudSlice } from '../state/useSlice.js';
import { Panel } from './ui/Panel.js';

/**
 * Chat no canto inferior esquerdo, como janela flutuante fixa (#252, ADR 0029 D5): sem arraste,
 * nasce aberta (`Shell.tsx`), fecha pelo × do `Panel` ou pelo ícone "Chat" da barra do topo — os
 * dois caminhos chamam o MESMO `onClose`. Enviar mensagem é F2; aqui só se lê.
 *
 * A moldura (cabeçalho "CHAT", fio dourado, ×) é do `Panel` (DS-04, `shell/ui/Panel.tsx`); sem
 * `onToggle`, ele não desenha botão de minimizar — o chat só tem aberto/fechado, nunca
 * minimizado. `.chat-window` só posiciona; quem dá a moldura é o `Panel`.
 * O `Panel` real não tem `onMinimize` nem `title="Fechar"` — atributos do handoff (spec §6) que
 * não sobreviveram à implementação de DS-04; quem ler a spec sem olhar o diff esperaria essas
 * props e não vai encontrá-las aqui.
 */
export function Chat({ onClose }: { onClose: () => void }) {
  const chat = useHudSlice((state) => state.chat);
  const systemMessages = useHudSlice((state) => state.systemMessages);

  return (
    <div className="chat-window" aria-label="chat">
      <Panel title="CHAT" onClose={onClose} bodyClassName="chat-body">
        {systemMessages.slice(-3).map((line) => (
          <p key={`${line.atMs}-${line.text}`} className={`chat-system chat-system-${line.level}`}>
            {line.text}
          </p>
        ))}
        {chat.slice(-8).map((line) => (
          <p key={`${line.atMs}-${line.author}-${line.text}`}>
            <b>{line.author}</b>: {line.text}
          </p>
        ))}
        {chat.length === 0 && systemMessages.length === 0 ? <p className="chat-quiet">—</p> : null}
      </Panel>
    </div>
  );
}
