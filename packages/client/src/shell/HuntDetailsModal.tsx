// "Detalhes da caçada" v1 (#325, RC-12; régua visual em
// `docs/kit-reference/24-modal-hunt-details.png`). Mostra nome, nível e dificuldades quando a
// aba sabe qual hunt ela acabou de pedir. O servidor ainda não transmite essa identidade após o
// ingresso (SV-05), então o estado de reconexão omite a tela em vez de fabricar um nome.
//
// "Seu recorde" é uma decisão de produto permanente: XP/h e gp/h não são métricas oficiais. Os
// demais blocos do kit entram somente quando forem verdade do servidor: monstros e loot em
// SV-02, contagem por dificuldade em SV-19, descrição em SV-21 e vender por item em E5.

import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import { currentHunt } from './current-hunt.js';
import { Button } from './ui/Button.js';
import { Kicker } from './ui/Kicker.js';
import { Modal } from './ui/Modal.js';
import { StatRow } from './ui/StatRow.js';

/** Os três tamanhos de pull (FUN-123), em palavras iguais às do seletor de hunts. */
const DIFFICULTY_TEXT: Record<string, string> = {
  cautious: 'Cauteloso',
  bold: 'Ousado',
  reckless: 'Agressivo',
};

/** O `Modal` só monta este corpo aberto, então não há assinatura de HUD durante a hunt inteira. */
function HuntDetailsBody() {
  const catalogue = useHudSlice((state) => state.catalogue);
  const known = useStoreSlice(currentHunt, (state) => state);
  const hunt = known === null ? null : (catalogue?.hunts.find((entry) => entry.id === known.huntId) ?? null);

  return (
    hunt === null ? (
      <p className="hunt-details-modal-empty">
        Esta caçada foi aberta antes desta sessão do navegador — o servidor ainda não diz qual
        é ela (chega com a issue de protocolo SV-05). Saia e reentre pela lista de caçadas para
        ver os detalhes desta vez.
      </p>
    ) : (
      <div className="hunt-details-modal-body">
        <h2 className="hunt-details-modal-name">{hunt.name}</h2>
        <section className="hunt-details-modal-info">
          <Kicker tone="muted">Sobre esta caçada</Kicker>
          <StatRow label="Nível recomendado" value={`${String(hunt.recommendedLevel)}+`} bar={false} />
          <StatRow
            label="Dificuldades"
            value={hunt.difficulties.map((difficulty) => DIFFICULTY_TEXT[difficulty] ?? difficulty).join(' · ')}
            bar={false}
          />
        </section>
        {/* Monstros com nome/sprite dependem de SV-02; a contagem por dificuldade, de SV-19;
            e a descrição, de SV-21. Loot possível também precisa de SV-02 e de autovenda por
            item em E5. Nenhum desses blocos recebe placeholder: o modal só cresce quando cada
            dado e ação forem verdade do servidor. */}
      </div>
    )
  );
}

export function HuntDetailsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      title="Detalhes da caçada"
      onClose={onClose}
      width={420}
      footer={(
        <Button variant="secondary" size="sm" className="hunt-details-modal-close" onClick={onClose}>
          Fechar
        </Button>
      )}
    >
      <HuntDetailsBody />
    </Modal>
  );
}
