// A tela de entrada: quem é você, e com quem vai jogar (FUN-97).
//
// É o portão do M10. Antes dela, jogar exigia bater na API por fora, copiar um UUID e montar
// `?character=<id>` à mão — o staging estava no ar e ninguém conseguia entrar.
//
// HUD em DOM (§13), e nada aqui toca `world`: neste momento ainda não existe sessão de jogo.

import { useEffect, useState } from 'react';
import { useStoreSlice } from '../state/useSlice.js';
import { account } from '../account/store.js';
import { beginLogin } from '../account/api.js';
import { create, play, refresh, signOut } from '../account/actions.js';
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

function Character({ character, busy }: { character: CharacterSummary; busy: boolean }) {
  return (
    <li className="entry-character">
      <div>
        <strong>{character.name}</strong>
        <span className="entry-meta">
          {` level ${String(character.level)} · ${STATE_TEXT[character.state] ?? character.state}`}
        </span>
      </div>
      <button type="button" disabled={busy} onClick={() => { void play(character.id); }}>
        Jogar
      </button>
    </li>
  );
}

function CreateForm({ busy }: { busy: boolean }) {
  const [name, setName] = useState('');
  const trimmed = name.trim();

  return (
    <form
      className="entry-create"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed === '') return;
        void create(trimmed).then(() => { setName(''); });
      }}
    >
      <label htmlFor="entry-name">Nome do personagem</label>
      <div className="entry-create-row">
        <input
          id="entry-name"
          value={name}
          maxLength={30}
          autoComplete="off"
          onChange={(event) => { setName(event.target.value); }}
        />
        {/* Desabilitado com o campo vazio: o servidor recusaria, e mandar para receber "não"
            é um passo que a tela consegue evitar. As regras de nome continuam sendo dele. */}
        <button type="submit" disabled={busy || trimmed === ''}>Criar</button>
      </div>
    </form>
  );
}

export function Entry() {
  const state = useStoreSlice(account, (value) => value);

  // Uma pergunta só, na montagem: "quem sou eu, e quais personagens tenho". Repetir em laço
  // seria tráfego de volta gerado por nada — a lista não muda sozinha.
  useEffect(() => { void refresh(); }, []);

  if (state.phase === 'checking') {
    return <main className="entry"><p className="quiet">Verificando sua sessão…</p></main>;
  }

  if (state.phase === 'anonymous') {
    return (
      <main className="entry">
        <h1>Draconya</h1>
        <p className="quiet">Entre para escolher um personagem.</p>
        <div className="entry-create-row">
          <button type="button" onClick={() => { beginLogin(); }}>Entrar</button>
          <button type="button" onClick={() => { beginLogin(true); }}>Criar conta</button>
        </div>
        {state.error !== null && <p className="system-error">{state.error}</p>}
      </main>
    );
  }

  return (
    <main className="entry">
      <header className="entry-head">
        <h1>Draconya</h1>
        <button type="button" className="entry-quiet" onClick={() => { void signOut(); }}>
          {state.identity?.email ?? 'sair'} · sair
        </button>
      </header>

      {state.characters.length === 0
        ? <p className="quiet">Você ainda não tem personagem. Crie o primeiro.</p>
        : (
          <ul className="entry-characters">
            {state.characters.map((character) => (
              <Character key={character.id} character={character} busy={state.busy} />
            ))}
          </ul>
        )}

      {/* Duas contas ativas é o teto (§7.1), e quem recusa é o servidor — a tela não esconde
          o formulário, porque esconder transformaria uma recusa explicável em botão sumido. */}
      <CreateForm busy={state.busy} />
      {state.error !== null && <p className="system-error">{state.error}</p>}
    </main>
  );
}
