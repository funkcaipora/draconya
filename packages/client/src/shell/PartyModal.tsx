// A superfície própria da party (#503, DT-01/DT-02 de #499): criar, buscar e gerenciar num
// modal só, com TRÊS views internas em vez de abas — `home` (sem party: Criar/Buscar), `mine`
// (roster + configuração do líder) e `search` (salas ELEGÍVEIS que o servidor filtrou).
//
// A view inicial e o filtro de hunt nascem dos PROPS a cada montagem — o `Shell` recria o modal
// quando muda o ponto de entrada (pill, engrenagem, "Encontrar Party") — e a navegação interna
// NUNCA mora na `party/store.ts` (ADR 0007): é UI, não estado de jogo.
//
// Tudo é INTENÇÃO (invariante 4): a tela desenha o `PartyView`/`RoomView` que o servidor
// devolveu. O julgamento de lotação/faixa no cliente (`joinReason`, o motivo do botão
// desabilitado) SAIU — o servidor só manda salas elegíveis, e "Entrar" nunca fica desabilitado
// por julgamento próprio. O `maxMembers` não é hardcode: quando o nó `game` manda
// `catalogue.party.maxMembers`, a soma da composição é validada localmente; sem o campo, quem
// recusa é o servidor (`composition-too-large`).
//
// Aba "Na hunt" aposentada (DT-04): durante a hunt o modal mostra o roster em leitura — o painel
// fixo `PartyMembers` é quem mostra HP, e os DOIS eixos de rateio em tempo de hunt ficam no
// rodapé dele, via `party-settings`.

import { useEffect, useState } from 'react';
import { sendIntent } from '../net/current.js';
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import type { Catalogue, HuntListing } from '../state/hud.js';
import { party, partyActions, fetchRooms } from '../party/store.js';
import type { PartyView, RoomView } from '../party/api.js';
import { leaveHunt } from './HuntActions.js';
import { pullLabel } from './HuntsModal.js';
import type { SelectOption } from './ui/Select.js';
import { Button } from './ui/Button.js';
import { Input } from './ui/Input.js';
import { Kicker } from './ui/Kicker.js';
import { Modal } from './ui/Modal.js';
import { Select } from './ui/Select.js';
import { Switch } from './ui/Switch.js';

/**
 * A cadência do polling de SALAS — constante PRÓPRIA de propósito: o ritmo do `/mine` é do
 * `Shell`, e o ÚNICO dono dele é o `Shell` (RF-10). Este é o da listagem, e só paga enquanto a
 * view de busca está montada.
 */
export const ROOMS_POLL_MS = 2_000;

export type PartyModalView = 'home' | 'mine' | 'search';

/**
 * O polling da lista de salas, separado do React para ser testável sem DOM (mesmo padrão de
 * `startFpsPolling` em WorldStatusOverlay.tsx): o `prerender` não roda efeitos, e um `setInterval`
 * preso dentro de um componente só seria exercitado por um DOM que o cliente não tem.
 *
 * A query leva o CANDIDATO (RF-08): `characterId` é o que o servidor usa para filtrar level e
 * vocação — sala inelegível não chega nem desabilitada.
 */
export function startRoomsPolling(
  query: { readonly characterId: string; readonly huntId?: string },
  setRooms: (rooms: readonly RoomView[]) => void,
): () => void {
  let cancelled = false;
  const load = (): void => {
    void fetchRooms(query).then((next) => { if (!cancelled) setRooms(next); });
  };
  load();
  const id = setInterval(load, ROOMS_POLL_MS);
  return () => { cancelled = true; clearInterval(id); };
}

/** O rótulo de uma vocação pelo id — a busca é pelo catálogo, nunca uma lista escrita à mão. */
export function vocationLabelOf(
  vocationId: string,
  vocations: ReadonlyArray<{ readonly id: string; readonly name: string }>,
): string {
  if (vocationId === 'none') return 'Sem vocação';
  return vocations.find((vocation) => vocation.id === vocationId)?.name ?? vocationId;
}

/** "Cavaleiro ×2 · Paladino ×1" — as vagas EXPLÍCITAS de uma sala (RF-07), só as que existem. */
export function slotsLabel(
  openSlots: Readonly<Record<string, number>>,
  vocations: ReadonlyArray<{ readonly id: string; readonly name: string }>,
): string {
  return Object.entries(openSlots)
    .filter(([, slots]) => slots > 0)
    .map(([id, slots]) => `${vocationLabelOf(id, vocations)} ×${String(slots)}`)
    .join(' · ');
}

/** A composição TOTAL desejada — "Cavaleiro 2 · Paladino 1". */
export function targetsLabel(
  targets: Readonly<Record<string, number>>,
  vocations: ReadonlyArray<{ readonly id: string; readonly name: string }>,
): string {
  return Object.entries(targets)
    .filter(([, total]) => total > 0)
    .map(([id, total]) => `${vocationLabelOf(id, vocations)} ${String(total)}`)
    .join(' · ');
}

/**
 * O teto de membros, QUANDO o nó `game` o manda no `catalogue` (`catalogue.party.maxMembers`).
 * O campo ainda não viaja no fio (pendência) — e enquanto não viaja NÃO há número inventado:
 * `null` desliga a validação local de soma, e quem recusa é o servidor
 * (`composition-too-large`, em palavras). Um "8" fixo aqui seria o defeito que a DT-05 proíbe.
 */
export function maxMembersOf(catalogue: Catalogue | null): number | null {
  if (catalogue === null) return null;
  const partyConfig = (catalogue as { party?: { maxMembers?: unknown } }).party;
  return typeof partyConfig?.maxMembers === 'number' && Number.isInteger(partyConfig.maxMembers) && partyConfig.maxMembers > 0
    ? partyConfig.maxMembers
    : null;
}

function sameTargets(
  current: Readonly<Record<string, number>>, draft: Readonly<Record<string, number>>,
): boolean {
  const currentKeys = Object.keys(current);
  if (currentKeys.length !== Object.keys(draft).length) return false;
  return currentKeys.every((key) => current[key] === draft[key]);
}

function huntNameOf(huntId: string, hunts: readonly HuntListing[]): string {
  return hunts.find((hunt) => hunt.id === huntId)?.name ?? huntId;
}

/** Os três tamanhos de pull do Huntera, em palavras — quando não há hunt do catálogo à mão. */
const DIFFICULTY_TEXT: Record<string, string> = {
  cautious: 'Cauteloso', bold: 'Ousado', reckless: 'Agressivo',
};

function difficultyLabelOf(difficulty: string): string {
  return DIFFICULTY_TEXT[difficulty] ?? difficulty;
}

function PartyHome({ formation, busy, onCreate, onOpenMine, onSearch }: {
  formation: PartyView | null;
  busy: boolean;
  onCreate: () => void;
  onOpenMine: () => void;
  onSearch: () => void;
}) {
  return (
    <div className="party-modal-home">
      {formation === null
        ? <Button variant="primary" block disabled={busy} onClick={onCreate}>Criar Party</Button>
        : <Button variant="primary" block disabled={busy} onClick={onOpenMine}>Abrir minha party</Button>}
      <Button variant="secondary" block disabled={busy} onClick={onSearch}>Buscar Party</Button>
    </div>
  );
}

/**
 * "Minha Party": roster em leitura e, para o líder EM FORMAÇÃO, a configuração da sala —
 * caçada, dificuldade, `minLevel`, composição por vocação (TOTAL desejado, incluindo quem já
 * está), os DOIS toggles independentes (cada clique manda SÓ o seu patch) e abrir/fechar vagas.
 *
 * O rascunho de edição nasce do estado REAL (`useState` inicializa com o `PartyView` da
 * montagem) e o botão "Aplicar" manda o patch — as validações de UI espelham as do servidor,
 * que é a autoridade: recusa aparece em palavras no rodapé.
 */
function PartyMine({ setView }: { setView: (view: PartyModalView) => void }) {
  const catalogue = useHudSlice((state) => state.catalogue);
  const me = useHudSlice((state) => state.characterId);
  const formation = useStoreSlice(party, (state) => state.party);
  const busy = useStoreSlice(party, (state) => state.busy);
  const [draft, setDraft] = useState(() => ({
    huntId: formation?.huntId ?? '',
    difficulty: formation?.difficulty ?? '',
    minLevel: formation?.minLevel ?? 1,
    targets: { ...(formation?.vocationTargets ?? {}) } as Record<string, number>,
  }));
  const [inviteeId, setInviteeId] = useState('');

  if (me === null || formation === null) {
    return (
      <div className="party-modal-mine">
        <p className="party-modal-empty">Você não está numa party.</p>
        <Button variant="secondary" block onClick={() => { setView('search'); }}>Buscar Party</Button>
      </div>
    );
  }

  const leader = formation.leaderId === me;
  const forming = formation.state === 'forming';
  const hunts = catalogue?.hunts ?? [];
  const vocations = catalogue?.vocations ?? [];

  // O rascunho resolve a seleção como `resolveSelection`: caçada fora do catálogo cai na
  // primeira; dificuldade que não pertence mais à caçada cai na primeira DELA.
  const draftHunt = draft.huntId !== ''
    ? hunts.find((hunt) => hunt.id === draft.huntId) ?? null
    : (hunts[0] ?? null);
  const effectiveHuntId = draftHunt?.id ?? '';
  const effectiveDifficulty = draftHunt !== null && draftHunt.difficulties.includes(draft.difficulty)
    ? draft.difficulty
    : (draftHunt?.difficulties[0] ?? '');
  const draftChanged = (formation.huntId ?? '') !== effectiveHuntId
    || (formation.difficulty ?? '') !== effectiveDifficulty
    // `null` → 1 é mudança: aplicar compromete o piso que `publish` exige.
    || (formation.minLevel ?? null) !== draft.minLevel
    || !sameTargets(formation.vocationTargets, draft.targets);
  const sumTargets = Object.values(draft.targets).reduce((total, slots) => total + slots, 0);
  const cap = maxMembersOf(catalogue);
  const draftInvalid = effectiveHuntId === '' || effectiveDifficulty === ''
    || draft.minLevel < 1
    // Sem o campo no catálogo, a soma não é validada aqui — quem recusa é o servidor (D8).
    || (cap !== null && sumTargets > cap);

  const setTarget = (vocationId: string, next: number): void => {
    setDraft((current) => ({ ...current, targets: { ...current.targets, [vocationId]: Math.max(0, next) } }));
  };
  const capReached = cap !== null && sumTargets >= cap;
  const applyDraft = (): void => {
    if (!draftChanged || draftInvalid) return;
    void partyActions.configure({
      huntId: effectiveHuntId,
      difficulty: effectiveDifficulty,
      minLevel: draft.minLevel,
      vocationTargets: draft.targets,
    });
  };

  // Abrir vagas espelha o `/publish` (RF-03): caçada configurada, level mínimo e pelo menos
  // uma vaga pública — contadas sobre o ESTADO REAL, não sobre o rascunho.
  const canPublish = formation.huntId !== null && formation.difficulty !== null
    && formation.minLevel !== null && formation.minLevel >= 1
    && Object.values(formation.openSlots).some((slots) => slots > 0);
  const published = formation.published;
  const publishReason = published
    ? 'Fechar as vagas da sala'
    : (canPublish
      ? 'Abrir as vagas da sala em Buscar Party'
      : 'Configure caçada, level mínimo e pelo menos uma vaga antes de abrir.');

  const huntOptions: readonly SelectOption[] = hunts.map((hunt) => ({ value: hunt.id, label: hunt.name }));
  const difficultyOptions: readonly SelectOption[] = draftHunt === null
    ? []
    : draftHunt.difficulties.map((difficulty) => ({ value: difficulty, label: pullLabel(draftHunt, difficulty) }));

  return (
    <div className="party-modal-mine">
      <ul className="party-members" aria-label="membros da party">
        {formation.members.map((member) => (
          <li key={member.characterId} className="party-member">
            <span>
              {member.characterId === formation.leaderId && <span className="party-leader-star">★</span>}
              {member.characterId === me ? 'você' : member.name}
            </span>
            {leader && member.characterId !== me && (
              <button
                type="button"
                className="party-kick"
                title="Remover da party"
                disabled={busy}
                onClick={() => { void partyActions.kick(member.characterId); }}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="entry-meta">{`Vagas abertas: ${slotsLabel(formation.openSlots, vocations) || '—'}`}</p>
      {leader && forming && (
        <div className="party-config">
          <Kicker tone="muted">Configuração da sala</Kicker>
          <div className="party-row">
            <Select size="sm" ariaLabel="caçada" options={huntOptions} value={effectiveHuntId}
              disabled={busy}
              onChange={(value) => { setDraft((current) => ({ ...current, huntId: value, difficulty: '' })); }} />
            <Select size="sm" ariaLabel="dificuldade" options={difficultyOptions} value={effectiveDifficulty}
              disabled={busy}
              onChange={(value) => { setDraft((current) => ({ ...current, difficulty: value })); }} />
          </div>
          <div className="party-row">
            <Input
              type="number"
              size="sm"
              min={1}
              aria-label="level mínimo da sala"
              value={draft.minLevel}
              onChange={(event) => { setDraft((current) => ({ ...current, minLevel: Number(event.target.value) })); }}
            />
          </div>
          <Kicker tone="muted">Composição por vocação · total desejado</Kicker>
          <div className="party-config-vocations">
            {vocations.map((vocation) => {
              const value = draft.targets[vocation.id] ?? 0;
              return (
                <div key={vocation.id} className="party-config-vocation">
                  <span className="party-config-vocation-name">{vocation.name}</span>
                  <button type="button" aria-label={`menos ${vocation.name}`} disabled={busy || value <= 0}
                    onClick={() => { setTarget(vocation.id, value - 1); }}>
                    −
                  </button>
                  <span className="party-config-vocation-count">{String(value)}</span>
                  <button type="button" aria-label={`mais ${vocation.name}`} disabled={busy || capReached}
                    onClick={() => { setTarget(vocation.id, value + 1); }}>
                    +
                  </button>
                </div>
              );
            })}
          </div>
          <p className="entry-meta">
            {cap !== null
              ? `Soma da composição: ${String(sumTargets)} de ${String(cap)}`
              : `Soma da composição: ${String(sumTargets)}`}
          </p>
          {/* Os DOIS eixos são independentes (ADR 0035 d.1): cada clique manda SÓ o seu patch,
              e o `PartyView` que volta é a verdade desenhada — nunca os dois juntos. */}
          <div className="party-config-toggles">
            <Switch
              title="Compartilhar custos"
              on={formation.shareCosts}
              disabled={busy}
              onChange={(on) => { void partyActions.configure({ shareCosts: on }); }}
            />
            <Switch
              title="Compartilhar lucros"
              on={formation.splitLoot}
              disabled={busy}
              onChange={(on) => { void partyActions.configure({ splitLoot: on }); }}
            />
          </div>
          <Button variant="primary" size="sm" block disabled={busy || !draftChanged || draftInvalid}
            {...(draftInvalid ? { title: 'Escolha caçada, dificuldade, level mínimo e uma composição válida.' } : {})}
            onClick={applyDraft}>
            Aplicar configuração
          </Button>
          <div className="party-row">
            <Input
              size="sm"
              aria-label="convidar por id"
              placeholder="id do personagem"
              value={inviteeId}
              onChange={(event) => { setInviteeId(event.target.value); }}
            />
            <Button size="sm" disabled={busy || inviteeId.trim() === ''}
              onClick={() => { void partyActions.invite(inviteeId.trim()); setInviteeId(''); }}>
              Convidar
            </Button>
          </div>
          <Button variant={published ? 'secondary' : 'gold'} size="sm" block
            disabled={busy || (!published && !canPublish)}
            title={publishReason}
            onClick={() => { void (published ? partyActions.unpublish() : partyActions.publish()); }}>
            {published ? 'Fechar vagas' : 'Abrir vagas'}
          </Button>
          {published && <p className="entry-meta">Sala aberta — aparece em Buscar Party.</p>}
        </div>
      )}
      {!leader && forming && (
        <div className="party-config-summary">
          <Kicker tone="muted">Sala do líder</Kicker>
          <p className="entry-meta">
            {`Caçada: ${formation.huntId !== null ? huntNameOf(formation.huntId, hunts) : '—'}`}
          </p>
          <p className="entry-meta">
            {`Tamanho do pull: ${formation.difficulty !== null ? difficultyLabelOf(formation.difficulty) : '—'}`}
          </p>
          <p className="entry-meta">
            {`Level mínimo: ${formation.minLevel !== null ? String(formation.minLevel) : '—'}`}
          </p>
          <p className="entry-meta">{`Composição: ${targetsLabel(formation.vocationTargets, vocations) || '—'}`}</p>
          {/* O membro VÊ o estado; só não pode mudá-lo (mesmo padrão de `PartyMembers`). */}
          <div className="party-config-toggles">
            <Switch title="Compartilhar custos" on={formation.shareCosts} disabled />
            <Switch title="Compartilhar lucros" on={formation.splitLoot} disabled />
          </div>
        </div>
      )}
      {/* Em formação, sair é HTTP; na hunt, a party É a sessão — o `leave-hunt` de sempre
          retira só este personagem, como no rodapé de `PartyMembers`. */}
      <Button variant="danger" size="sm" block disabled={busy}
        onClick={() => {
          if (forming) {
            void partyActions.leave();
          } else {
            leaveHunt(sendIntent);
          }
        }}>
        Sair da party
      </Button>
    </div>
  );
}

/**
 * A LISTA de salas, presentacional de propósito — entra por prop, o que a torna verificável com
 * `prerender` (o efeito que a busca fica no `PartySearch`). O servidor SÓ manda salas elegíveis:
 * "Entrar" nunca fica desabilitado — julgar vaga/faixa no cliente era o que a #503 removeu.
 * As vagas por vocação são EXPLÍCITAS (`openSlots`), não um members/max.
 */
export function PartyRooms({ rooms, busy, onJoin }: {
  rooms: readonly RoomView[];
  busy: boolean;
  onJoin: (partyId: string) => void;
}) {
  const catalogue = useHudSlice((state) => state.catalogue);
  const hunts = catalogue?.hunts ?? [];
  const vocations = catalogue?.vocations ?? [];
  if (rooms.length === 0) {
    return (
      <>
        {/* A lista vazia continua na árvore: o "onde estão as salas" não some com elas. */}
        <ul className="party-rooms-list" aria-label="salas públicas" />
        <p className="party-modal-empty">Nenhuma sala elegível agora.</p>
      </>
    );
  }
  return (
    <ul className="party-rooms-list" aria-label="salas públicas">
      {rooms.map((room) => (
        <li key={room.partyId} className="party-room-row">
          <span className="party-room-leader">
            {`${room.leader.name} · LV ${String(room.leader.level)} · ${String(room.members)}/${String(room.maxMembers)}`}
          </span>
          <span className="entry-meta">
            {`${huntNameOf(room.huntId, hunts)} · ${difficultyLabelOf(room.difficulty)} · level ${String(room.minLevel)}+`}
          </span>
          <span className="party-room-slots" aria-label={`vagas da sala de ${room.leader.name}`}>
            {slotsLabel(room.openSlots, vocations) || '—'}
          </span>
          <Button size="sm" disabled={busy} onClick={() => { onJoin(room.partyId); }}>
            Entrar
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Encontrar Party": o seletor de hunt (pré-preenchido pelo filtro que a abriu, limpável — a
 * hunt do filtro pode ter sumido do catálogo numa reconexão), a lista de salas ELEGÍVEIS que o
 * servidor mandou e o "Entrar por id" FORA da ação principal (RF-04).
 */
function PartySearch({ huntFilter, onJoined }: {
  huntFilter?: string;
  onJoined: () => void;
}) {
  const catalogue = useHudSlice((state) => state.catalogue);
  const me = useHudSlice((state) => state.characterId);
  const busy = useStoreSlice(party, (state) => state.busy);
  const [rooms, setRooms] = useState<readonly RoomView[]>([]);
  const [huntId, setHuntId] = useState(huntFilter ?? '');
  const [joinId, setJoinId] = useState('');

  // A lista só é buscada enquanto a view está montada: sair dela (ou fechar o modal) para o
  // polling (RF-10). Trocar o filtro recria o polling com a query nova.
  useEffect(() => {
    if (me === null) return undefined;
    return startRoomsPolling(huntId === '' ? { characterId: me } : { characterId: me, huntId }, setRooms);
  }, [me, huntId]);

  const joinRoom = (partyId: string): void => {
    void partyActions.join(partyId).then(() => {
      // Formou: a party própria agora existe — mostre-a. Entrou em curso: a tela inteira
      // entra pela reconexão (`entering`), nada a navegar aqui.
      if (party.get().party !== null) onJoined();
    });
  };

  const hunts = catalogue?.hunts ?? [];
  const options: SelectOption[] = [{ value: '', label: 'Todas as caçadas' }];
  for (const hunt of hunts) options.push({ value: hunt.id, label: hunt.name });
  if (huntId !== '' && !hunts.some((hunt) => hunt.id === huntId)) {
    // O filtro aponta para hunt que o catálogo atual não tem: a opção crua permanece, e o
    // jogador pode limpar ou trocar (§7) — a busca vazia é a resposta honesta.
    options.push({ value: huntId, label: huntId });
  }

  return (
    <div className="party-modal-search">
      <Select size="sm" ariaLabel="filtrar por caçada" options={options} value={huntId}
        onChange={(value) => { setHuntId(value); }} />
      <PartyRooms rooms={rooms} busy={busy} onJoin={joinRoom} />
      <div className="party-search-invite">
        <Kicker tone="muted">Recebeu um id de convite?</Kicker>
        <div className="party-row">
          <Input
            size="sm"
            aria-label="id da party"
            placeholder="id da party"
            value={joinId}
            onChange={(event) => { setJoinId(event.target.value); }}
          />
          <Button size="sm" disabled={busy || joinId.trim() === ''}
            onClick={() => { const id = joinId.trim(); setJoinId(''); joinRoom(id); }}>
            Entrar
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PartyModal(props: {
  /** A view inicial — o `Shell` decide pelo ponto de entrada e recria o modal ao mudá-la. */
  readonly view: PartyModalView;
  /** O filtro de hunt da busca, pelo ID — "Encontrar Party" na hunt selecionada (RF-02). */
  readonly huntFilter?: string;
  readonly hunting: boolean;
  readonly onClose: () => void;
}) {
  const { view: initialView, hunting, onClose } = props;
  const [view, setView] = useState<PartyModalView>(initialView);
  const formation = useStoreSlice(party, (state) => state.party);
  const busy = useStoreSlice(party, (state) => state.busy);
  const error = useStoreSlice(party, (state) => state.error);
  const entering = useStoreSlice(party, (state) => state.entering);

  const title = view === 'search'
    ? 'Encontrar Party'
    : view === 'mine' && formation !== null
      ? `Party · ${String(formation.members.length)}`
      : 'Party';
  const footer = (
    <>
      {error !== null && <span className="system-error">{error}</span>}
      {hunting && (
        <span className="party-modal-note">
          Os eixos de rateio da hunt ficam no painel Party, à esquerda.
        </span>
      )}
    </>
  );

  return (
    <Modal open title={title} onClose={onClose} width={440}
      {...(error !== null || hunting ? { footer } : {})}>
      {entering && <p className="party-modal-empty">Entrando na hunt…</p>}
      {!entering && view !== 'home' && (
        <button type="button" className="party-modal-back" onClick={() => { setView('home'); }}>
          ← Party
        </button>
      )}
      {!entering && view === 'home' && (
        <PartyHome
          formation={formation}
          busy={busy}
          onCreate={() => {
            void partyActions.create().then(() => {
              if (party.get().party !== null) setView('mine');
            });
          }}
          onOpenMine={() => { setView('mine'); }}
          onSearch={() => { setView('search'); }}
        />
      )}
      {!entering && view === 'mine' && <PartyMine setView={setView} />}
      {!entering && view === 'search' && (
        <PartySearch
          {...(props.huntFilter !== undefined ? { huntFilter: props.huntFilter } : {})}
          onJoined={() => { setView('mine'); }}
        />
      )}
    </Modal>
  );
}
