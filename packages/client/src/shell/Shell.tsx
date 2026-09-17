// A geografia do §5.3 (FUN-24), com a cara do Huntera (FUN-115).
//
// O mundo ocupa a tela inteira; a barra do topo, as janelas à esquerda e à direita e o chat
// flutuam por cima. Gold e o estado da conexão moram na barra; HP e mana moram no alto da
// coluna direita desde #253 (`Vitals`, primeiro filho de `windows-right`).
//
// A GEOGRAFIA É FIXA (§5.3, §5.5): inventário e analisador à direita, hunts e bot à esquerda,
// chat embaixo — nos mesmos lugares em hunt e em conteúdo manual. A tela não se reorganiza ao
// trocar de atividade; em PvP manual, procurar onde a poção foi parar é o que custa a luta.
//
// Nenhum componente daqui assina estado de MUNDO. Onde as criaturas estão é assunto do canvas,
// que lê `world` direto no laço de quadro — é o que faz 40 criaturas andando custarem zero
// render. Overlays que precisam de uma leitura resumida amostram em intervalo explícito;
// overlays de casca usam só fatias assináveis do HUD e da conta.
//
// O pacote de arte é montado AQUI (FUN-108) e desce por contexto: o viewport desenha o mundo
// com ele, e o inventário desenha o sprite de cada item. A casca (painéis, barras, slots) é
// CSS puro desde #250 — não lê nenhuma variável do pacote. Ver `AssetPackContext`.

import { useState } from 'react';
import { useHudSlice } from '../state/useSlice.js';
import { AssetPackContext } from './AssetPackContext.js';
import { useBrowserPack } from './useBrowserPack.js';
import { useWarmHuntOutfits } from './useWarmHuntOutfits.js';
import { useWalkKeys } from './useWalkKeys.js';
import { Viewport } from './Viewport.js';
import { BattlePanel } from './BattlePanel.js';
import { Chat } from './Chat.js';
import { Analyzer } from './Analyzer.js';
import { Bestiary } from './Bestiary.js';
import { HuntsModal } from './HuntsModal.js';
import { HuntActions } from './HuntActions.js';
import { PartyMembers } from './PartyMembers.js';
import { PartyBag } from './PartyBag.js';
import { BotPanel } from './BotPanel.js';
import { SkillsPanel } from './SkillsPanel.js';
import { EquipmentPanel } from './EquipmentPanel.js';
import { ContainerWindow } from './ContainerWindow.js';
import { VocationChoice } from './VocationChoice.js';
import { Vitals } from './Vitals.js';
import { TopBar } from './TopBar.js';
import { WorldOverlay } from './WorldOverlay.js';
import { PlayerVitalsOverlay } from './PlayerVitalsOverlay.js';
import type { WindowId } from './TopBar.js';

/**
 * Quais janelas nascem abertas: as do loop de todo dia. Bot e Bestiário são visita. Set,
 * mochila e bolsa são FIXOS (ADR 0026 d.7, #161): o botão da barra minimiza os três, nunca remove.
 * O analisador também é FIXO desde #258 (D6): `open.analyzer` só minimiza, nunca desmonta —
 * uma janela que existe sozinha continua não aparecendo sem sessão (`Analyzer.tsx` devolve
 * `null`). Chat nasce aberto (D5/DS-09, #252): "é onde chegam as recusas do servidor" — uma
 * janela que abre fechada esconderia a primeira recusa da sessão.
 */
const DEFAULT_WINDOWS: Readonly<Record<WindowId, boolean>> = {
  // 'hunts' agora é um MODAL, não uma seção fixa (#259, ADR 0029 D6): nasce FECHADO — modal que
  // nasce aberto empurraria uma decisão antes de a tela aparecer, e janela fixa é quem nasce
  // aberta (DT-02 de #259). A pill "Escolher caçada"/"Sair da caçada" (`HuntActions`) é quem
  // fica sempre visível, fora das colunas.
  hunts: false, bot: true, inventory: true, analyzer: true, bestiary: false, chat: true,
};

export function Shell() {
  const loaded = useBrowserPack();
  const [open, setOpen] = useState(DEFAULT_WINDOWS);
  const toggle = (id: WindowId): void => { setOpen((state) => ({ ...state, [id]: !state[id] })); };
  // As folhas dos monstros das hunts, decodificadas na Cidade (FUN-112): sem isto o rato era
  // um quadrado por seis a dez segundos na primeira entrada.
  useWarmHuntOutfits(loaded?.pack ?? null);
  // Setas e WASD andam (FUN-122): a janela inteira ouve, o canvas não tem foco.
  useWalkKeys();
  // Quem está numa hunt vê "Sair da caçada"; quem está na Cidade vê "Escolher caçada". O
  // `sessionType` do analisador é o que o servidor disse por último — o cliente não adivinha
  // onde está (#259, o mesmo cálculo que o menu de hunts de antes já fazia).
  const sessionType = useHudSlice((state) => state.analyzer.sessionType);
  const hunting = sessionType !== null && sessionType !== 'city';

  // A geografia do Huntera (FUN-115): o mundo ocupa a tela inteira, e o resto FLUTUA por cima —
  // a barra do topo, as janelas à esquerda e à direita, o chat embaixo. Cada janela é a seção
  // de sempre, só que posicionada; abrir e fechar é da barra do topo. A seção que devolve
  // `null` (analisador na Cidade, bestiário sem catálogo) não deixa moldura vazia para trás,
  // porque a moldura É a seção.
  return (
    <AssetPackContext.Provider value={loaded}>
      <div className="shell">
<div className="world-stage">
          <Viewport />
          {/* Arcos e nome do próprio jogador (#328, RC-15): sempre no centro da câmera, tanto
              na Cidade quanto em hunt. Não pertence ao `Viewport`, cujo canvas é montado por
              Pixi de forma imperativa. */}
          <PlayerVitalsOverlay />
        </div>
        <WorldOverlay hunting={hunting} />
        <TopBar open={open} toggle={toggle} />
        <div className="windows windows-left" aria-label="janelas à esquerda">
          {/* O bot é FIXO à esquerda (#162, ADR 0026 d.7 — o vBot no `getLeftPanel()`): sempre
              montado; a barra do topo MINIMIZA, nunca remove. A edição fina abre por cima. */}
          <BotPanel collapsed={!open.bot} onToggle={() => { toggle('bot'); }} />
          {/* Skills é FIXO à esquerda (#317): sempre montado, sem `open.*` — minimiza pelo próprio
              cabeçalho do Panel (DS-04), não pela barra do topo (não há ícone "Skills").
              CharacterPanel fica parado até #319 reaproveitá-lo no modal Personagem. */}
          <SkillsPanel />
          {/* Party na hunt é FIXO à esquerda (#259, `docs/design-system-plan.md` §2 D6 — "Bot,
              Skills, Party na hunt (esquerda)"). A LISTA de hunts saiu daqui com o antigo
              menu de hunts; a formação (ADR 0027) virou a coluna direita do `HuntsModal`, e o
              que sobra aqui são os COMPANHEIROS durante a hunt — `PartyMembers` já se esconde
              sozinho fora de party (`state.party === null`), então não há `open.*` para ele. */}
          <PartyMembers />
        </div>
        <div className="windows windows-right" aria-label="janelas à direita">
          {/* As vitais no alto da coluna (#253, ADR 0029 D3): saíram do topo — a barra do topo
              não desenha HP/mana no design (#251). */}
          <Vitals />
          {/* A coluna do OTClient (#161): set, bolsa e mochila FIXOS — um botão da barra
              minimiza os três juntos (R7-02: a Bolsa vem antes da Mochila, como App.jsx do kit) —,
              e abaixo deles o analisador e o Bestiário. */}
          <EquipmentPanel collapsed={!open.inventory} onToggle={() => { toggle('inventory'); }} />
          <ContainerWindow container="satchel" collapsed={!open.inventory} />
          <ContainerWindow container="backpack" collapsed={!open.inventory} />
          {/* A batalha (#254, DS-11): quem está na tela, fora o próprio personagem e a party —
              esses já têm painel próprio. Minimiza sozinha (DT-02). */}
          <BattlePanel />
          {/* A bolsa da party (#197): só no modo compartilhado; minimiza com o inventário. */}
          <PartyBag collapsed={!open.inventory} />
          {/* O analisador é FIXO (#258, D6): sempre montado; a barra do topo MINIMIZA, nunca
              desmonta — o mesmo padrão de `BotPanel`/`EquipmentPanel` acima. */}
          <Analyzer collapsed={!open.analyzer} onToggle={() => { toggle('analyzer'); }} />
          {open.bestiary && <Bestiary />}
        </div>
        {/* Fora das colunas: é uma sobreposição, e as colunas são um contexto de empilhamento
            abaixo da barra do topo — dentro delas o diálogo ficaria por baixo da barra. */}
        {/* A escolha de vocação (#154): sobreposição pela mesma razão do bot, e some sozinha
            quando `vocationId` chega — quem decide se ela existe é o estado, não a barra. */}
        <VocationChoice />
        {/* As pills de caçada (#259, D3/D6): centralizadas sobre o mundo, no rodapé — a faixa
            de 124 px do handoff que as hospedaria não entra neste marco (D5), então o mundo a
            ocupa e as pills flutuam direto sobre ele. O modal abre pelo MESMO `open.hunts` que a
            pill aciona, ou pelo ícone "Hunts" do topo — os dois só alternam a mesma fatia. */}
        <HuntActions hunting={hunting} onChoose={() => { toggle('hunts'); }} />
        {open.hunts && <HuntsModal hunting={hunting} onClose={() => { toggle('hunts'); }} />}
        {/* O chat é janela flutuante fixa (#252, ADR 0029 D5): mesmo padrão de open/close das
            outras (hunts, analyzer, bestiary) — a diferença é só a POSIÇÃO, dada pelo próprio
            componente via `.chat-window`, e não por uma coluna do `windows-left`/`windows-right`. */}
        {open.chat && <Chat onClose={() => { toggle('chat'); }} />}
      </div>
    </AssetPackContext.Provider>
  );
}
