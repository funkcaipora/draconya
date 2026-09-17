// O painel do bot (§13.3, §13.6, §13.9, FUN-89; fixo à esquerda desde #162, ADR 0026 d.7).
//
// **É a interação central de um jogo idle-first**: é o que o jogador faz antes de fechar o
// navegador. Depois disso ele não está lá para corrigir nada.
//
// A forma é a do vBot no OTClientV8 (MIT — organização, não código): uma seção FIXA na coluna
// da esquerda, um grupo por categoria, e uma linha compacta por regra com um INTERRUPTOR —
// verde ligado, vermelho desligado — que salva na hora. A edição fina (condição, operador,
// valor, ação) abre por cima, no `RuleEditor`, porque a linha larga não cabe em 300 px.
//
// **Nada aqui tem lista de opções em código.** As categorias, os slots, as magias e os supplies
// vêm do catálogo (FUN-73): se a tela e o servidor divergirem sobre o que existe, o jogador
// configura o que o bot recusa — e descobre isso pelo extrato que não fecha.
//
// **A ordem dos slots É a prioridade** (§13.4). O primeiro de cima é o que executa, e por isso
// dá para mover uma regra para cima e para baixo: reordenar é configurar — e salva.
//
// **Desligar não libera slot.** A regra desligada continua na configuração e conta para o
// teto da categoria; só sai da avaliação (`compileBot` a pula). Desligar para "ganhar slot"
// viraria o interruptor num truque.

import { useEffect, useState } from 'react';
import { BOT_CATEGORIES } from '@draconya/content';
import type { BotCategory, BotRule } from '@draconya/content';
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import { sendIntent } from '../net/current.js';
import { bot, moveRule, removeRule, setConfigSender, toggleRule } from '../bot/store.js';
import type { BotVocabulary } from '../state/hud.js';
import { RuleEditor, blankRule } from './RuleEditor.js';
import { ruleText } from './rule-text.js';
import { Panel } from './ui/Panel.js';
import { Switch } from './ui/Switch.js';
import { IconButton } from './ui/IconButton.js';
import { Button } from './ui/Button.js';

// `export`: o RuleEditor monta o título do Modal ("Editar regra · Cura") com o mesmo mapa —
// duas cópias do mesmo BotCategory → string divergiriam no primeiro nome novo (DT-06).
export const CATEGORY_TEXT: Record<BotCategory, string> = {
  heal: 'Cura',
  potion: 'Poções',
  attack: 'Ataque',
  rune: 'Runas e itens',
  support: 'Suporte',
};

type Editing = { readonly category: BotCategory; readonly index: number | null; readonly initial: BotRule };

/** A linha compacta: `[switch] HP ≤ 70 % → Cura [⚙] [▴▾] [×]`. */
export function RuleRow({ rule, index, total, category, vocabulary, onEdit }: {
  rule: BotRule; index: number; total: number; category: BotCategory;
  vocabulary: BotVocabulary; onEdit: () => void;
}) {
  const text = ruleText(rule, vocabulary);
  // Ausente é ligada (o schema): só `false` desliga.
  const enabled = rule.enabled !== false;
  return (
    <li className={`bot-rule${enabled ? '' : ' bot-rule-off'}`}>
      <Switch
        tone="traffic"
        on={enabled}
        title={enabled ? 'ligada' : 'desligada'}
        onChange={() => { toggleRule(category, index); }}
      />
      <span className="bot-rule-text" title={`${text.when} → ${text.do}`}>
        {`${text.when} → ${text.do}`}
      </span>
      <IconButton title="editar regra" onClick={onEdit}>⚙</IconButton>
      {/* As setas ▴▾ continuam botões simples: o handoff também não usa IconButton aqui — ele
          é 14×9, menor que o tamanho mínimo do IconButton (DT-07). */}
      <span className="bot-rule-order">
        <button type="button" aria-label="subir" disabled={index === 0} onClick={() => { moveRule(category, index, -1); }}>▴</button>
        <button type="button" aria-label="descer" disabled={index === total - 1} onClick={() => { moveRule(category, index, 1); }}>▾</button>
      </span>
      <IconButton title="remover regra" onClick={() => { removeRule(category, index); }}>×</IconButton>
    </li>
  );
}

function Category({ category, vocabulary, vocationId, onEdit }: {
  category: BotCategory; vocabulary: BotVocabulary; vocationId: string | null; onEdit: (editing: Editing) => void;
}) {
  const rules = useStoreSlice(bot, (state) => state.draft.rules[category]);
  const [open, setOpen] = useState(true);
  const slots = vocabulary.slots[category] ?? 0;
  const fresh = blankRule(category, vocabulary, vocationId);

  return (
    <section className="bot-category">
      <header className="bot-category-head">
        <button type="button" className="entry-quiet" aria-expanded={open} onClick={() => { setOpen(!open); }}>
          {open ? '▾' : '▸'}
        </button>
        <strong>{CATEGORY_TEXT[category]}</strong>
        <span className="bot-category-slots">{`${String(rules.length)}/${String(slots)}`}</span>
      </header>
      {open && (
        <>
          <ul className="bot-rules">
            {rules.map((rule, index) => (
              <RuleRow
                key={index}
                rule={rule}
                index={index}
                total={rules.length}
                category={category}
                vocabulary={vocabulary}
                onEdit={() => { onEdit({ category, index, initial: rule }); }}
              />
            ))}
          </ul>
          {/* O teto vem do catálogo, e a tela para de oferecer ao chegar nele — o servidor recusa
              de qualquer jeito, e deixar clicar para receber "não" é um passo evitável. */}
          {rules.length < slots && fresh !== null && (
            <Button variant="secondary" size="sm" block onClick={() => { onEdit({ category, index: null, initial: fresh }); }}>
              + regra
            </Button>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Uma seção FIXA da coluna da esquerda (#162): sempre montada, minimizável pela barra do topo
 * (`collapsed` esconde tudo menos o cabeçalho), nunca removida. Sem catálogo o painel EXISTE e
 * diz que carrega — sumir deixaria o botão da barra aceso sem nada acontecer.
 */
export function BotPanel({ collapsed = false, onToggle }: { collapsed?: boolean; onToggle?: () => void }) {
  const catalogue = useHudSlice((state) => state.catalogue);
  const level = useHudSlice((state) => state.level);
  const vocationId = useHudSlice((state) => state.vocationId);
  const save = useStoreSlice(bot, (state) => state.save);
  const reason = useStoreSlice(bot, (state) => state.reason);
  const [editing, setEditing] = useState<Editing | null>(null);

  // A store não importa `net/` (ADR 0007: o socket fica fora do render); o painel liga o
  // remetente ao montar. Intenção (invariante 4): o cliente manda a configuração, e quem
  // decide se ela vale é o servidor — a resposta vem em `bot-config-result`.
  useEffect(() => {
    setConfigSender((config) => sendIntent({ type: 'bot-config', config }));
    return () => { setConfigSender(null); };
  }, []);

  const meta = save === 'pending' ? 'salvando…' : save === 'saved' ? 'salvo' : undefined;

  // `exactOptionalPropertyTypes` não deixa passar `undefined` explícito onde a prop é opcional
  // (mesmo padrão de Modal.tsx): só entra na chamada quem de fato veio.
  const panelProps = {
    ...(meta !== undefined ? { meta } : {}),
    ...(onToggle !== undefined ? { onToggle } : {}),
  };

  if (catalogue === null) {
    return (
      <Panel dock title="Bot" collapsed={collapsed} className="bot-panel" {...panelProps}>
        <p className="quiet">Carregando…</p>
      </Panel>
    );
  }
  const vocabulary = catalogue.bot;
  const vocationNames = new Map(catalogue.vocations.map((vocation) => [vocation.id, vocation.name]));
  const advanced = level >= vocabulary.advancedFromLevel;

  return (
    <Panel dock title="Bot" collapsed={collapsed} className="bot-panel" {...panelProps}>
      {!advanced && (
        // §13.2: o gate é por level, e quem recusa é o servidor. Dizer POR QUÊ aqui evita
        // que o jogador descubra montando uma configuração inteira e levando um não.
        <p className="quiet">{`Bot avançado a partir do level ${String(vocabulary.advancedFromLevel)}.`}</p>
      )}
      {BOT_CATEGORIES.map((category) => (
        <Category key={category} category={category} vocabulary={vocabulary} vocationId={vocationId} onEdit={setEditing} />
      ))}
      {/* A recusa fica na tela, e o rascunho FICA junto: descartar seria a pior resposta a
          "corrija isto" — apagar justamente o que precisa ser corrigido. */}
      {save === 'refused' && reason !== null && <p className="system-error">{reason}</p>}
      {/* Aninhar o Modal aqui é seguro (DT-02: backdrop-filter não cria bloco de contenção para
          position: fixed) e é o menor diff em relação ao código de antes. */}
      {editing !== null && (
        <RuleEditor
          category={editing.category}
          index={editing.index}
          initial={editing.initial}
          vocabulary={vocabulary}
          level={level}
          vocationId={vocationId}
          vocationNames={vocationNames}
          onClose={() => { setEditing(null); }}
        />
      )}
    </Panel>
  );
}
