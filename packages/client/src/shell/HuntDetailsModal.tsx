import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import { currentHunt } from './current-hunt.js';
import { Modal } from './ui/Modal.js';
import { Button } from './ui/Button.js';
import { Kicker } from './ui/Kicker.js';
import { StatRow } from './ui/StatRow.js';

/** Os três tamanhos de pull (FUN-123) — os mesmos textos de `event-text.ts` e `HuntsModal.tsx`. */
const DIFFICULTY_TEXT: Record<string, string> = {
  cautious: 'Cauteloso',
  bold: 'Ousado',
  reckless: 'Agressivo',
};

export function HuntDetailsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const catalogue = useHudSlice((state) => state.catalogue);
  const known = useStoreSlice(currentHunt, (state) => state);
  const hunt = known !== null ? (catalogue?.hunts.find((h) => h.id === known.huntId) ?? null) : null;

  return (
    <Modal open={open} title="Detalhes da caçada" onClose={onClose} width={420}
      footer={<Button variant="secondary" size="sm" className="hunt-details-modal-close" onClick={onClose}>Fechar</Button>}>
      {hunt === null ? (
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
            <StatRow label="Dificuldades"
              value={hunt.difficulties.map((d) => DIFFICULTY_TEXT[d] ?? d).join(' · ')} bar={false} />
          </section>
        </div>
      )}
    </Modal>
  );
}
