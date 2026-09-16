// A tela de entrada: quem é você, e com quem vai jogar (FUN-97; redesenho #248, ADR 0029 D7/D8).
//
// É o portão do M10. Antes dela, jogar exigia bater na API por fora, copiar um UUID e montar
// `?character=<id>` à mão — o staging estava no ar e ninguém conseguia entrar.
//
// HUD em DOM (§13), e nada aqui toca `world`: neste momento ainda não existe sessão de jogo.
// Sem senha (ADR 0029 D7): as duas ações de login navegam para o AuthKit do WorkOS (ADR 0012).
// Sem i18n (ADR 0029 D7): os textos ficam fixos em pt-BR, sem toggle de idioma.

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useStoreSlice } from '../state/useSlice.js';
import { account } from '../account/store.js';
import type { AccountState } from '../account/store.js';
import { beginLogin } from '../account/api.js';
import { create, play, refresh, signOut } from '../account/actions.js';
import { Button } from './ui/Button.js';
import type { CharacterSummary } from '../account/api.js';

/** Onde o personagem está agora, em palavras. O diretório manda (FUN-30). */
const STATE_TEXT: Record<string, string> = {
  city: 'na cidade',
  hunt: 'numa hunt',
  training: 'treinando',
  quest: 'numa quest',
  boss: 'num boss',
  'guild-war': 'na guild war',
};

/**
 * O nome de cada vocação, em português — a mesma tradução por id que `STATE_TEXT` já faz acima.
 * `character.vocation` chega como o id cru de `content/data/vocations/*.json`; a tela real de
 * escolha (#249, DS-06) lê o nome do catálogo, mas aqui, ANTES de existir sessão, não há
 * catálogo — só os quatro ids fixos. Um id sem entrada aqui mostra o próprio id, sem cor (D8: a
 * tela nunca trava por um id que ela não conhece ainda).
 */
const VOCATION_NAME: Record<string, string> = {
  knight: 'Cavaleiro',
  paladin: 'Paladino',
  druid: 'Druida',
  sorcerer: 'Feiticeiro',
};

function EntryShell({ children, screen }: { children: ReactNode; screen: 'login' | 'select' }) {
  return (
    <div className="entry-shell" data-entry-screen={screen}>
      <i className="entry-hachure" aria-hidden="true" />
      <i className="entry-rings" aria-hidden="true" />
      <header className="entry-header">
        <span className="entry-wordmark">
          <span className="entry-wordmark-mark">D</span>DRACONYA
        </span>
        <span className="entry-tagline">UM MUNDO SOB O FOGO</span>
      </header>
      <main className="entry-main">{children}</main>
      <footer className="entry-footer">DRACONYA</footer>
    </div>
  );
}

function Brand({ emblem = true, compact = false }: { emblem?: boolean; compact?: boolean }) {
  return (
    <div className="entry-brand">
      {emblem && (
        <div className="entry-emblem" aria-hidden="true"><span>✦</span></div>
      )}
      <p className="entry-eyebrow">MMORPG</p>
      <h1 className={compact ? 'entry-title entry-title-compact' : 'entry-title'}>DRACONYA</h1>
      <div className="entry-rule" aria-hidden="true"><i /><span>✦</span><i /></div>
    </div>
  );
}

function EntryCard({ children }: { children: ReactNode }) {
  return <div className="entry-card">{children}</div>;
}

function Heading({ kicker, title, sub }: { kicker: string; title: string; sub?: string }) {
  return (
    <div className="entry-heading">
      <span className="entry-kicker">{kicker}</span>
      <h2>{title}</h2>
      {sub !== undefined && <p className="entry-heading-sub">{sub}</p>}
    </div>
  );
}

function LoginScreen({ error }: { error: string | null }) {
  return (
    <>
      <Brand />
      <EntryCard>
        <Heading
          kicker="Bem-vindo"
          title="Continue a jornada"
          sub="O próximo capítulo começa com você."
        />
        <div className="entry-card-actions">
          <Button variant="gold" size="lg" block onClick={() => { beginLogin(); }}>
            ENTRAR <span aria-hidden="true">→</span>
          </Button>
          <Button variant="text" size="md" block onClick={() => { beginLogin(true); }}>
            Criar conta
          </Button>
        </div>
      </EntryCard>
      {error !== null && <p className="entry-error">{error}</p>}
      <p className="entry-caption">Cada jornada deixa uma história.</p>
    </>
  );
}

function CharacterCard({ character, busy }: { character: CharacterSummary; busy: boolean }) {
  // `== null` e não `!== null`: um nó anterior a esta task pode mandar o campo ausente
  // (`undefined`) em vez de `null` explícito — os dois viram "—", nunca "undefined" na tela.
  const known = character.vocation != null && character.vocation in VOCATION_NAME;
  const vocationText = character.vocation == null
    ? '—'
    : (VOCATION_NAME[character.vocation] ?? character.vocation);

  return (
    <button
      type="button"
      className="entry-character-card"
      disabled={busy}
      onClick={() => { void play(character.id); }}
    >
      <span className="entry-avatar" aria-hidden="true">{character.name.charAt(0)}</span>
      <span className="entry-character-info">
        <strong className="entry-character-name">{character.name}</strong>
        <span className={known ? `entry-vocation entry-vocation-${character.vocation}` : 'entry-vocation'}>
          {vocationText}
        </span>
        <span className="entry-character-meta">
          {`Lv ${String(character.level)} · ${STATE_TEXT[character.state] ?? character.state}`}
        </span>
      </span>
    </button>
  );
}

function CreateForm({ busy, onDone }: { busy: boolean; onDone: () => void }) {
  const [name, setName] = useState('');
  const trimmed = name.trim();

  return (
    <form
      className="entry-create"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed === '') return;
        void create(trimmed).then(() => { setName(''); onDone(); });
      }}
    >
      <label htmlFor="entry-name">Nome do personagem</label>
      <div className="entry-create-row">
        <input
          id="entry-name"
          className="entry-input"
          value={name}
          maxLength={30}
          autoComplete="off"
          onChange={(event) => { setName(event.target.value); }}
        />
        {/* Botão nativo, não o primitivo `Button`: é o único controle da tela que precisa de
            `type="submit"` para o `Enter` funcionar dentro do formulário. */}
        <button type="submit" className="entry-create-submit" disabled={busy || trimmed === ''}>
          Criar
        </button>
      </div>
      <Button variant="ghost" size="sm" onClick={onDone}>Cancelar</Button>
    </form>
  );
}

function CharacterGrid({ state }: { state: AccountState }) {
  const [creating, setCreating] = useState(false);

  return (
    <>
      <Brand emblem={false} compact />
      <div className="entry-select">
        <div className="entry-select-head">
          <Heading
            kicker="Sua próxima aventura"
            title="Escolha seu personagem"
            sub={`${state.identity?.email ?? '—'} · ${String(state.characters.length)} personagens disponíveis`}
          />
          <Button variant="ghost" size="md" onClick={() => { void signOut(); }}>
            Trocar de conta
          </Button>
        </div>

        {state.characters.length === 0 && (
          <p className="entry-hint">Você ainda não tem personagem. Crie o primeiro.</p>
        )}

        <div className="entry-grid">
          {state.characters.map((character) => (
            <CharacterCard key={character.id} character={character} busy={state.busy} />
          ))}
          {/* Duas contas ativas é o teto (§7.1), e quem recusa é o servidor — o cartão nunca
              some, porque escondê-lo transformaria uma recusa explicável em botão sumido. */}
          <button
            type="button"
            className="entry-new-card"
            disabled={state.busy}
            onClick={() => { setCreating(true); }}
          >
            + NOVO PERSONAGEM
          </button>
        </div>

        {creating && <CreateForm busy={state.busy} onDone={() => { setCreating(false); }} />}
      </div>
      {state.error !== null && <p className="entry-error">{state.error}</p>}
      <p className="entry-caption">Cada jornada deixa uma história.</p>
    </>
  );
}

export function Entry() {
  const state = useStoreSlice(account, (value) => value);

  // Uma pergunta só, na montagem: "quem sou eu, e quais personagens tenho". Repetir em laço
  // seria tráfego de volta gerado por nada — a lista não muda sozinha.
  useEffect(() => { void refresh(); }, []);

  if (state.phase === 'checking') {
    return (
      <EntryShell screen="login">
        <p className="entry-checking">Verificando sua sessão…</p>
      </EntryShell>
    );
  }

  if (state.phase === 'anonymous') {
    return (
      <EntryShell screen="login">
        <LoginScreen error={state.error} />
      </EntryShell>
    );
  }

  return (
    <EntryShell screen="select">
      <CharacterGrid state={state} />
    </EntryShell>
  );
}
