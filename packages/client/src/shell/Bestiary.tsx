// O Bestiário (§18, FUN-113): quantos de cada monstro o personagem já abateu, e o que isso
// rende.
//
// **HUD em DOM, mundo em canvas.** Isto é nome e número, então é DOM — e nada aqui toca
// `world`.
//
// **O cliente não conta abate.** Os contadores chegam INTEIROS em `bestiary` — no attach e a
// cada mudança —, e os marcos e o bônus por marco vêm no `catalogue`, fixados na sessão
// (invariante 7). O que se calcula aqui é apresentação — "que marco vem depois", "quanto o
// cabeçalho mostra" — e mora em `bestiary-progress.ts`, puro e testável. Se a conta daqui
// divergisse da do `sim`, a do `sim` é a verdadeira: nada disto volta pelo socket (invariante 4).
//
// A mesma linguagem do analisador — cabeçalho que abre e fecha — e as MESMAS classes: são
// duas janelas da mesma coluna, e uma folha de estilo por janela é como elas passam a parecer
// de jogos diferentes. Nasce aberta (FUN-115): quem decide se a janela existe é a barra do
// topo, e uma janela que abre minimizada é uma janela que abre vazia. Minimizada, o bônus
// fica no cabeçalho — é o que muda em ritmo de hunt.

import { useState } from 'react';
import type { BestiaryConfig, BestiaryCounts, MonsterListing } from '../state/hud.js';
import { useHudSlice } from '../state/useSlice.js';
import { bonusPercent, progressOf } from './bestiary-progress.js';
import { Panel } from './ui/Panel.js';

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/** `1.234` — abates e marcos, com separador, como o jogador lê. */
const count = (value: number): string => integer.format(value);
/** `+1 %` — o bônus em pontos percentuais. Duas casas: o conteúdo pode dar meio ponto. */
const bonusText = (value: number): string => `+${percent.format(value)} %`;

function Monster({ monster, kills, config }: {
  monster: MonsterListing; kills: number; config: BestiaryConfig | null;
}) {
  // Sem config não há marco: o servidor não tem Bestiário configurado, e a linha mostra só a
  // contagem. "—" e não "0/0": zero marcos é uma afirmação, e o servidor não afirmou nada.
  const progress = config === null ? null : progressOf(kills, config.milestones);
  const next = progress?.next ?? null;
  return (
    <li className="bestiary-monster">
      <div className="analyzer-row">
        <span className="analyzer-label">{monster.name}</span>
        <span className="analyzer-value">{count(kills)}</span>
      </div>
      <div className="bestiary-meta">
        <span>{`próximo marco ${next === null ? '—' : count(next)}`}</span>
        <span>
          {`marcos ${progress === null || config === null
            ? '—'
            : `${String(progress.reached)}/${String(config.milestones.length)}`}`}
        </span>
      </div>
    </li>
  );
}

/**
 * O corpo da janela, com o que a tela recebe já resolvido. Exportado à parte porque um teste
 * sem DOM não clica o cabeçalho: o que vale provar — o rato com a contagem e o próximo
 * marco — é isto.
 */
export function BestiaryBody({ monsters, counts, config }: {
  monsters: readonly MonsterListing[]; counts: BestiaryCounts; config: BestiaryConfig | null;
}) {
  return (
    <div className="analyzer-body">
      {config !== null && (
        // GLOBAL (DT-01): marcos de todos os monstros, somados. A linha fica em cima da lista
        // porque é a resposta que o jogador veio buscar; a lista é o caminho até ela.
        <div className="bestiary-bonus">
          {`Bônus de XP PvE: ${bonusText(
            bonusPercent(counts, config.milestones, config.xpBonusPercentPerMilestone),
          )}`}
        </div>
      )}
      <ul className="bestiary-monsters">
        {monsters.map((monster) => (
          // Monstro sem entrada é zero de verdade: o `sim` não grava zero para todo monstro
          // do conteúdo, então a ausência É a contagem.
          <Monster
            key={monster.id}
            monster={monster}
            kills={counts[monster.id] ?? 0}
            config={config}
          />
        ))}
      </ul>
    </div>
  );
}

export function Bestiary() {
  const catalogue = useHudSlice((state) => state.catalogue);
  const counts = useHudSlice((state) => state.bestiary);
  const [open, setOpen] = useState(true);

  // A janela EXISTE sempre que a barra do topo a abriu (FUN-115): sem catálogo ela diz que
  // está carregando, e sem MONSTRO no catálogo — um nó anterior à FUN-113, que nunca manda
  // `bestiary` — ela diz que este servidor não tem Bestiário. Devolver `null` deixava o botão
  // da barra aceso sem nada acontecer; e um painel com "Bônus +0 %" e lista vazia afirmaria um
  // Bestiário que aquele servidor não tem — por isso a frase, e não a lista.
  if (catalogue === null || catalogue.monsters.length === 0) {
    return (
      <Panel dock title="Bestiário" className="bestiary">
        <p className="quiet">
          {catalogue === null ? 'Carregando…' : 'Este servidor não tem Bestiário.'}
        </p>
      </Panel>
    );
  }

  const config = catalogue.bestiary ?? null;
  // `null` é "ainda não chegou" — o intervalo entre o catálogo e o `bestiary` do attach, que
  // é da ordem de milissegundos. Zero por esse intervalo custa menos que uma terceira tela.
  const known = counts ?? {};
  const collapsed = !open;
  const bonus = config === null
    ? null
    : bonusPercent(known, config.milestones, config.xpBonusPercentPerMilestone);
  // Aberta, o bônus já é a primeira linha do corpo — repetir no cabeçalho diria o mesmo número
  // duas vezes (mesmo padrão de Analyzer.tsx:201-205).
  const meta = collapsed && bonus !== null ? `${bonusText(bonus)} XP` : undefined;
  const metaProps = meta === undefined ? {} : { meta };

  return (
    <Panel
      dock
      title="Bestiário"
      className="bestiary"
      collapsed={collapsed}
      onToggle={() => { setOpen((v) => !v); }}
      {...metaProps}
    >
      <BestiaryBody monsters={catalogue.monsters} counts={known} config={config} />
    </Panel>
  );
}
