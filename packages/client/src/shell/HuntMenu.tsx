// A seleção de hunt (§14.2, §14.7, FUN-79).
//
// **Level recomendado aparece; estimativa de XP/h e gold/h não.** A regra é de produto e já é
// estrutura: o protocolo não tem campo onde guardar a estimativa. Um número oficial de XP/h vira
// a métrica pela qual toda hunt é julgada, e a partir daí só existe uma hunt boa — o jogo passa
// a ter uma escolha, não quatro.
//
// **O cliente só manda INTENÇÃO** (invariante 4): `enter-hunt { huntId, difficulty }`. Quem
// decide se cabe é o servidor, e a recusa dele vira `system-message` — que o chat já mostra.

import { useState } from 'react';
import { sendIntent } from '../net/current.js';
import { useHudSlice } from '../state/useSlice.js';
import type { HuntListing } from '../state/hud.js';

/**
 * Os três tamanhos de pull do Huntera (FUN-123): Cauteloso, Ousado, Agressivo. Uma hunt define
 * os que fazem sentido para ela; o texto é o que o jogador vê no botão.
 */
const DIFFICULTY_TEXT: Record<string, string> = {
  cautious: 'Cauteloso',
  bold: 'Ousado',
  reckless: 'Agressivo',
};

function Hunt({ hunt, level }: { hunt: HuntListing; level: number }) {
  // Level recomendado é RECOMENDAÇÃO, não trava: quem decide se a entrada vale é o servidor, e
  // no MVP ele não recusa por level. Avisar sem impedir é o que o §14.3 pede — e esconder o
  // botão transformaria um conselho em regra que ninguém escreveu.
  const below = level > 0 && level < hunt.recommendedLevel;

  return (
    <li className="hunt">
      <div className="hunt-head">
        <strong>{hunt.name}</strong>
        <span className={below ? 'hunt-warn' : 'entry-meta'}>
          {`level ${String(hunt.recommendedLevel)}+`}
        </span>
      </div>
      {/* A linha do Huntera: quantos pulls a hunt tem e quantos drops distintos os monstros
          dela soltam (FUN-123). A lista do loot é da tela de detalhe, que ainda não existe. */}
      <div className="entry-meta">
        {`${String(hunt.difficulties.length)} tamanhos de pull · ${String(hunt.lootDrops)} drops de loot`}
      </div>
      <div className="hunt-difficulties">
        {hunt.difficulties.map((difficulty) => (
          <button
            key={difficulty}
            type="button"
            onClick={() => {
              sendIntent({ type: 'enter-hunt', huntId: hunt.id, difficulty });
            }}
          >
            {DIFFICULTY_TEXT[difficulty] ?? difficulty}
          </button>
        ))}
      </div>
    </li>
  );
}

export function HuntMenu() {
  const catalogue = useHudSlice((state) => state.catalogue);
  const level = useHudSlice((state) => state.level);
  const [open, setOpen] = useState(true);

  // Quem está numa hunt vê "sair"; quem está na cidade vê a lista. O `sessionType` do
  // analisador é o que o servidor disse por último — o cliente não adivinha onde está.
  const sessionType = useHudSlice((state) => state.analyzer.sessionType);
  const hunting = sessionType !== null && sessionType !== 'city';

  return (
    <section className="hunt-menu" aria-label="hunts">
      <header className="analyzer-head">
        <button
          type="button"
          className="analyzer-toggle"
          aria-expanded={open}
          onClick={() => { setOpen((value) => !value); }}
        >
          {open ? '▾' : '▸'} Hunts
        </button>
        {hunting && (
          // Trocar de dificuldade é ENTRAR de novo: o servidor encerra a instância e cria
          // outra (§14.7). Por isso não há botão de "trocar" — há sair, e há entrar.
          <button
            type="button"
            className="entry-quiet"
            onClick={() => { sendIntent({ type: 'leave-hunt' }); }}
          >
            sair da hunt
          </button>
        )}
      </header>

      {open && (
        catalogue === null
          ? <p className="quiet">Carregando…</p>
          : (
            <ul className="hunt-list">
              {catalogue.hunts.map((hunt) => (
                <Hunt key={hunt.id} hunt={hunt} level={level} />
              ))}
            </ul>
          )
      )}
    </section>
  );
}
