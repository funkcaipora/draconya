// A pill permanente "Party" (#503, DT-03 de #499) — irmã de `HuntActions`, sobre o mundo, na
// Cidade e na hunt: a party tem ponto de entrada SEMPRE visível, e o modal é UMA instância no
// `Shell` (RF-10/RF-11). A pill é CSS puro (o mesmo `.hunt-pill` do kit); a party não tem
// ícone PNG na barra do topo, e ícone inventado não é a geografia do kit.
//
// O modal é IRMÃO de `div.party-actions`, nunca filho: o contêiner deixa os cliques passarem ao
// mundo, como `.hunt-actions` já faz.

export function PartyActions({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="party-actions">
      <button type="button" className="hunt-pill" onClick={onOpen}>
        <span aria-hidden="true">⚑</span> Party
      </button>
    </div>
  );
}
