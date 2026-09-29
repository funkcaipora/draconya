// A escolha de vocação (#154, ADR 0026 decisão 1) com os cards do design system (#249, ADR 0029
// D2/D7).
//
// Continua uma sobreposição que aparece quando o level chegou e ainda não há vocação, e some
// quando `vocationId` chega em `player-stats` — a confirmação é o estado, não uma mensagem.
// Recusa vira `system-message` no chat e NÃO fecha o diálogo. O level da escolha e as quatro
// vocações vêm do catálogo: nada de "8" aqui (a tela não pode ter o número em código).
//
// O chrome (scrim, painel, fio dourado) passa a vir do `Modal` (#247); esta tela só desenha os
// cartões e o rodapé. A escolha vira DUAS etapas — selecionar o cartão, depois "FORJAR" — como
// o `ClassCard`/`ClassSelect` do handoff (`ui_kits/draconya/Entry.jsx`): o clique no cartão não
// manda mais a intenção sozinho.
//
// A cor de cada vocação (D2: classes, nunca `style` em massa) vem por `data-vocation={id}` no
// `<button>` — NUNCA por `style`: o `id` é um de quatro valores fixos, cabe inteiro num seletor
// de atributo CSS (`shell.css`), e um atributo novo não toca `class="vocation-card"`, a string
// exata que `VocationChoice.test.ts` (inalterado) conta com regex — ver DT-03 (#249).

import { useState } from 'react';
import { sendIntent } from '../net/current.js';
import { useHudSlice } from '../state/useSlice.js';
import { ItemSprite } from './ItemSprite.js';
import { Modal } from './ui/Modal.js';
import { Button } from './ui/Button.js';

/**
 * O papel de cada vocação, em uma linha curta e colorida — `k.role` do kit
 * (`ui_kits/draconya/data.js:7-10`), sob o nome do cartão. Apresentação por id: um id sem linha
 * aqui mostra só o nome, e o jogo continua.
 */
const ROLE_SHORT: Readonly<Record<string, string>> = {
  knight: 'Tanque · corpo a corpo',
  paladin: 'Dano à distância · Sagrado',
  druid: 'Suporte e cura · Gelo e Terra',
  sorcerer: 'Dano mágico · Fogo e Energia',
};

/**
 * A descrição completa de cada vocação, em parágrafo — `k.desc` do kit (mesmo arquivo). Separada
 * de `ROLE_SHORT` porque o kit mostra as duas, uma embaixo da outra (R1-18): a linha curta no
 * cabeçalho do cartão, o parágrafo completo logo abaixo. As palavras de elemento ("Sagrado",
 * "Gelo e Terra", "Fogo e Energia") são texto estático de apresentação, copiado do kit — não uma
 * promessa de dano elemental: o sistema de elemento (R1-17) continua fora de escopo, sem badge
 * nenhum aqui (ver `docs/kit-fidelity-plan.md` §1, "Dados de mentira").
 */
const DESC_FULL: Readonly<Record<string, string>> = {
  knight: 'Tanque: mais vida e capacidade, bate de perto com espada, machado ou maça.',
  paladin: 'Dano à distância: atira com bow e munição. Canaliza a luz sagrada contra o que não devia andar.',
  druid: 'Suporte e cura: a maior mana, magias de cura. Congela e envenena o campo com a fúria da terra.',
  sorcerer: 'Dano mágico: a maior mana, magias de ataque. Chamas de dragão e raios que rasgam hordas — frágil, mas devastador.',
};

/**
 * A vocação escolhida no clique do cartão; sem seleção ainda (ou se a seleção não existir mais
 * na lista — reconexão com o catálogo trocado, não deveria acontecer com quatro vocações
 * fixas), cai na primeira. PURA e exportada: `VocationChoice.test.ts` (#249, RF-04) prende este
 * cálculo em vez de simular um clique — o ambiente de teste é Node sem DOM
 * (`environment: 'node'`, `vitest.config.ts`), o mesmo motivo que `shell/drag-intent.ts` testa
 * a decisão em vez do evento.
 *
 * Chamar com uma lista vazia é erro de quem chama: o componente só chega aqui depois do
 * `catalogue.vocations.length === 0` já ter voltado `null` mais acima.
 */
export function resolveChosenVocationId(
  selected: string | null,
  vocations: readonly { readonly id: string }[],
): string {
  const first = vocations[0];
  if (first === undefined) {
    throw new Error('resolveChosenVocationId: chamada sem vocação nenhuma no catálogo');
  }
  if (selected === null) return first.id;
  return vocations.some((vocation) => vocation.id === selected) ? selected : first.id;
}

export function VocationChoice() {
  const level = useHudSlice((state) => state.level);
  const vocationId = useHudSlice((state) => state.vocationId);
  const catalogue = useHudSlice((state) => state.catalogue);
  // Hook sempre chamado, nas mesmas posições em toda renderização — mesmo quando o diálogo
  // não existe (os `if` abaixo retornam DEPOIS dele). Mover para depois dos `if` violaria a
  // ordem de hooks assim que o diálogo aparecesse no meio de uma sessão.
  const [selected, setSelected] = useState<string | null>(null);
  // Sem catálogo, ou catálogo de um nó anterior (`vocationLevel` 0): sem diálogo. Um "0" aqui
  // abriria a escolha no level 1 para todo mundo — e um nó antigo recusaria cada clique.
  if (catalogue === null || catalogue.vocationLevel <= 0 || catalogue.vocations.length === 0) return null;
  if (vocationId !== null || level < catalogue.vocationLevel) return null;

  const itemsById = new Map(catalogue.items.map((item) => [item.id, item]));
  const chosen = resolveChosenVocationId(selected, catalogue.vocations);

  return (
    // O `aria-label` fica FORA do `Modal`: `VocationChoice.test.ts` (inalterado) prende esta
    // string exata, e o `Modal` (#247) usa `title` como o próprio rótulo de acessibilidade —
    // "Escolha a sua vocação", um texto diferente do que o teste procura.
    <div aria-label="escolha de vocação">
      <Modal
        open
        // A escolha é definitiva e obrigatória (ADR 0026 d.1): não há personagem sem vocação
        // depois do level 8. `onClose` não fecha nada — Esc, o scrim e o × do `Modal` ficam
        // sem efeito.
        onClose={() => {}}
        title="Escolha a sua vocação"
        footer={
          <div className="vocation-footer">
            <p className="quiet">A escolha é definitiva. Cada vocação recebe a arma dela; a machete vai para a mochila.</p>
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                // INTENÇÃO (invariante 4): o cliente diz QUAL vocação; level, arma e slot são
                // do servidor — a recusa vem como `system-message`, e o diálogo não fecha.
                sendIntent({ type: 'choose-vocation', vocationId: chosen });
              }}
            >
              FORJAR
            </Button>
          </div>
        }
      >
        <p className="vocation-subtitle">
          A vocação define suas armas, elementos e o papel no grupo. Não pode ser alterada depois.
        </p>
        <ul className="vocation-cards">
          {catalogue.vocations.map((vocation) => {
            const weapon = itemsById.get(vocation.startingWeaponItemId);
            const isSelected = vocation.id === chosen;
            return (
              <li key={vocation.id}>
                <button
                  type="button"
                  className="vocation-card"
                  // A cor da vocação vem daqui, via CSS (`shell.css`, seletor
                  // `[data-vocation="…"]`) — nunca de `style`. Um id sem cor cadastrada cai no
                  // dourado neutro (`--gold-4`), a regra padrão de `.vocation-card`.
                  data-vocation={vocation.id}
                  aria-pressed={isSelected}
                  // Seleção LOCAL (invariante 4): este clique só muda `useState`, nunca a rede
                  // — a intenção sai só do "FORJAR" no rodapé do `Modal`, acima.
                  onClick={() => { setSelected(vocation.id); }}
                >
                  <span className="vocation-card-head">
                    <span className="vocation-card-icon">{vocation.name.charAt(0)}</span>
                    <span className="vocation-card-title">
                      <strong>{vocation.name} <span className="vocation-card-id">{vocation.id.toUpperCase()}</span></strong>
                      <span className="vocation-role">{ROLE_SHORT[vocation.id] ?? ''}</span>
                    </span>
                  </span>
                  <span className="vocation-desc">{DESC_FULL[vocation.id] ?? ''}</span>
                  <span className="vocation-weapon">
                    <ItemSprite appearanceId={weapon?.appearanceId} name={weapon?.name} />
                    <span>{weapon?.name ?? vocation.startingWeaponItemId}</span>
                  </span>
                  <span className="vocation-gains">
                    {`+${String(vocation.healthPerLevel)} HP · +${String(vocation.manaPerLevel)} mana · +${String(vocation.capacityPerLevel)} cap por level`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Modal>
    </div>
  );
}
