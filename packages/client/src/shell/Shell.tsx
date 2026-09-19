// A geografia do §5.3 (FUN-24), com a cara do Huntera (FUN-115).
//
// O mundo ocupa a tela inteira; a barra do topo, as janelas à esquerda e à direita e o chat
// flutuam por cima. Gold mora na barra; conexão, latência e FPS moram no overlay do mundo. HP
// e mana moram no alto da coluna direita desde #253 (`Vitals`, primeiro filho de `windows-right`).
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
import { CyclopediaModal } from './CyclopediaModal.js';
import { HuntsModal } from './HuntsModal.js';
import { HuntActions } from './HuntActions.js';
import { ActionBar } from './ActionBar.js';
import { PartyMembers } from './PartyMembers.js';
import { PartyLootWindow } from './PartyBag.js';
import { PartyModal } from './PartyModal.js';
import { SkillsPanel } from './SkillsPanel.js';
import { AutomationsPanel } from './AutomationsPanel.js';
import { CharacterModal } from './CharacterModal.js';
import { EquipmentPanel } from './EquipmentPanel.js';
import { ContainerWindow } from './ContainerWindow.js';
import { VocationChoice } from './VocationChoice.js';
import { Vitals } from './Vitals.js';
import { TopBar } from './TopBar.js';
import { WorldOverlay } from './WorldOverlay.js';
import { BuffBar } from './BuffBar.js';
import { PlayerVitalsOverlay } from './PlayerVitalsOverlay.js';
import type { WindowId } from './TopBar.js';
import { chatBadgeTier } from './chat-badge.js';

/**
 * Quais janelas nascem abertas: as do loop de todo dia. Bot e Bestiário são visita. Set,
 * mochila e bolsa são FIXOS (ADR 0026 d.7, #161): o botão do próprio `EquipmentPanel` minimiza
 * os três, nunca remove (RC-09/#322 — antes era um ícone na barra do topo).
 * O analisador é janela FLUTUANTE desde #315 (ADR 0030 decisão 3): `open.analyzer` monta e
 * desmonta a janela, e sem sessão — ou na Cidade — o próprio componente devolve `null`.
 * Hunts e Cyclopedia são modais e nascem fechados. Chat nasce fechado (#323, RC-10,
 * ADR 0030 §3): o kit não o desenha, e as recusas do servidor agora justificam o ícone acender
 * quando uma `system-message` chega com ele fechado.
 */
const DEFAULT_WINDOWS: Readonly<Record<WindowId, boolean>> = {
  // Personagem é modal como Hunts: começa fechado e só monta depois de uma intenção do jogador.
  character: false,
  // 'hunts' agora é um MODAL, não uma seção fixa (#259, ADR 0029 D6): nasce FECHADO — modal que
  // nasce aberto empurraria uma decisão antes de a tela aparecer, e janela fixa é quem nasce
  // aberta (DT-02 de #259). A pill "Escolher caçada"/"Sair da caçada" (`HuntActions`) é quem
  // fica sempre visível, fora das colunas.
  hunts: false, inventory: true, analyzer: true, bestiary: false, chat: false,
};

export function Shell() {
  const loaded = useBrowserPack();
  const [open, setOpen] = useState(DEFAULT_WINDOWS);
  // Party loot (#316): independente de `open.*` — o ▣ do painel da party controla isto, não a
  // barra do topo. Nasce `true`: a janela existe assim que `hunting` também for verdade.
  const [partyLootOpen, setPartyLootOpen] = useState(true);
  // "Gerenciar party" (#320): aberto pela engrenagem de PartyMembers, não pela TopBar — por
  // isso é um estado à parte de `open`/`WindowId`, no mesmo espírito do `open === "party"`
  // local do App.jsx do kit (não é um dos ícones do topo).
  const [partyModalOpen, setPartyModalOpen] = useState(false);
  // A marca de visto usa `performance.now()`, o mesmo relógio monotônico de `SystemLine.atMs`.
  // `Date.now()` faria uma mensagem da sessão parecer sempre anterior à época Unix.
  const [chatSeenAtMs, setChatSeenAtMs] = useState(0);
  const systemMessages = useHudSlice((state) => state.systemMessages);
  const chatBadge = chatBadgeTier(systemMessages, open.chat, chatSeenAtMs);
  const toggle = (id: WindowId): void => {
    if (id === 'chat' && !open.chat) {
      setChatSeenAtMs(systemMessages.at(-1)?.atMs ?? performance.now());
    }
    setOpen((state) => ({ ...state, [id]: !state[id] }));
  };
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
        {/* Condições ativas sobre o mundo (#348, SV-12): existe sozinha — devolve `null` sem
            nenhuma em `hud.conditions`. */}
        <BuffBar />
        <TopBar open={open} toggle={toggle} chatBadge={chatBadge} />
        <div className="windows windows-left" aria-label="janelas à esquerda">
          {/* Skills é FIXO à esquerda (#317): sempre montado, sem `open.*` — minimiza pelo próprio
              cabeçalho do Panel (DS-04), não pela barra do topo (não há ícone "Skills"). */}
          <SkillsPanel />
          {/* Automações é FIXO à esquerda (AB-12/#427, ADR 0032 d.9): montado na Cidade e na
              caçada, sem condição de `hunting` — como o painel v1 era, e minimizável pelo próprio
              cabeçalho. A configuração é editável em qualquer lugar; a execução é da hunt. */}
          <AutomationsPanel />
          {/* Party na hunt é FIXO à esquerda (#259, `docs/design-system-plan.md` §2 D6 — "Bot,
              Skills, Party na hunt (esquerda)"). A LISTA de hunts saiu daqui com o antigo
              menu de hunts; a formação (ADR 0027) virou a coluna direita do `HuntsModal`, e o
              que sobra aqui são os COMPANHEIROS durante a hunt — `PartyMembers` já se esconde
              sozinho fora de party (`state.party === null`), então não há `open.*` para ele. */}
          <PartyMembers
            partyLootOpen={partyLootOpen}
            onToggleLoot={() => { setPartyLootOpen((value) => !value); }}
            onManage={() => { setPartyModalOpen(true); }}
          />
        </div>
        <div className="windows windows-right" aria-label="janelas à direita">
          {/* As vitais no alto da coluna (#253, ADR 0029 D3): saíram do topo — a barra do topo
              não desenha HP/mana no design (#251). */}
          <Vitals />
          {/* A coluna do OTClient (#161): set, bolsa e mochila FIXOS — o botão do próprio
              `EquipmentPanel` minimiza os três juntos (RC-09/#322 — antes era um ícone na barra
              do topo; R7-02: a Bolsa vem antes da Mochila, como App.jsx do kit) —,
              e abaixo deles o analisador. */}
          <EquipmentPanel collapsed={!open.inventory} onToggle={() => { toggle('inventory'); }} />
          <ContainerWindow container="satchel" collapsed={!open.inventory} />
          <ContainerWindow container="backpack" collapsed={!open.inventory} />
          {/* A batalha (#254, DS-11): quem está na tela, fora o próprio personagem e a party —
              esses já têm painel próprio. Minimiza sozinha (DT-02). */}
          <BattlePanel />
        </div>
        {/* O Analisador é janela FLUTUANTE fora das colunas desde #315 (R4-14, ADR 0030 decisão 3):
            abre e fecha pelo ícone "Analisador" do topo — nunca mais minimiza, porque uma janela
            flutuante fecha, não encolhe. Continua SEMPRE montado: é o próprio componente quem
            decide, por dentro, se há o que desenhar (sem sessão, na Cidade, ou fechada) — é assim
            que o `forceOpen` ao encerrar a hunt continua funcionando mesmo com a janela fechada. */}
        <Analyzer open={open.analyzer} onToggle={() => { toggle('analyzer'); }} />
        {/* Party loot (#316): fora das colunas, como o Analisador — a mesma sobreposição sobre o
            mundo inteiro. Só existe durante a hunt (ADR 0030 decisão 3: "nascem abertas na
            hunt"); o CONTEÚDO (party em `shared` com bolsa) é decidido dentro de
            `PartyLootWindow`, não aqui. */}
        {hunting && partyLootOpen && (
          <PartyLootWindow onClose={() => { setPartyLootOpen(false); }} />
        )}
        {/* "Gerenciar party" (#320): aberto pela engrenagem do painel da party, fora de
            `open`/`WindowId` — o kit não desenha um ícone de party na TopBar. */}
        {partyModalOpen && (
          <PartyModal hunting={hunting} onClose={() => { setPartyModalOpen(false); }} />
        )}
        {/* Fora das colunas: é uma sobreposição, e as colunas são um contexto de empilhamento
            abaixo da barra do topo — dentro delas o diálogo ficaria por baixo da barra. */}
        {/* A escolha de vocação (#154): sobreposição pela mesma razão do bot, e some sozinha
            quando `vocationId` chega — quem decide se ela existe é o estado, não a barra. */}
        <VocationChoice />
        {/* As pills de caçada (#259, D3/D6): centralizadas sobre o mundo, ACIMA da barra de
            ações desde o AB-10 (`bottom: calc(var(--actionbar-h) + 6px)`). O modal abre pelo
            MESMO `open.hunts` que a pill aciona, ou pelo ícone "Hunts" do topo — os dois só
            alternam a mesma fatia. */}
        <HuntActions hunting={hunting} onChoose={() => { toggle('hunts'); }} />
        {/* A barra de ações 2 × 12 na fileira de 124 px (AB-10, ADR 0032 d.1–5): montada na
            Cidade e na caçada, como o kit. É a configuração do bot E o disparo manual — a
            tecla manda `use-slot`, o conjunto/alvo e o Shift+clique mandam `bot-config`. */}
        <ActionBar />
        {open.hunts && <HuntsModal hunting={hunting} onClose={() => { toggle('hunts'); }} />}
        {open.character && <CharacterModal onClose={() => { toggle('character'); }} />}
        {/* Cyclopedia (#321, RC-08): o mesmo ícone de topo agora abre um modal, não um painel
            da coluna. Só a aba Bestiary é montada enquanto as demais não têm sistema atrás. */}
        {open.bestiary && <CyclopediaModal onClose={() => { toggle('bestiary'); }} />}
        {/* O chat permanece fixo (#252, ADR 0029 D5), mas nasce fechado desde #323/RC-10: o
            ícone que o abre pode acender com uma `system-message`. A posição ainda é dada por
            `.chat-window`, fora das colunas. */}
        {open.chat && <Chat onClose={() => { toggle('chat'); }} />}
      </div>
    </AssetPackContext.Provider>
  );
}
