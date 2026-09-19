import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_FRIENDS, friends, friendsActions, setFriendsCharacter, setFriendsClient } from './store.js';
import type { FriendsClient, FriendView } from './api.js';

// A store de amigos (#404, DT-04): dado de PERSONAGEM, com ciclo de vida próprio — existe fora
// de qualquer party. O `POST /api/friends` mesclado (#403) responde `{ ok: true }`, não o
// `FriendView`, então `add` recarrega a lista em vez de anexar uma linha própria.

const friend = (over: Partial<FriendView> = {}): FriendView => ({
  characterId: 'f1', name: 'Seraphine', vocationId: 'paladin', level: 121, online: true, where: 'city', ...over,
});

function fakeClient(over: Partial<FriendsClient> = {}): FriendsClient {
  return {
    list: async () => [friend()],
    add: async () => {},
    remove: async () => {},
    ...over,
  };
}

beforeEach(() => {
  friends.set(() => ({ ...INITIAL_FRIENDS }));
  setFriendsClient(null);
});

describe('friends store (#404)', () => {
  it('does nothing without a character or a client', async () => {
    await friendsActions.refresh();
    expect(friends.get().friends).toEqual([]);
    expect(await friendsActions.add('Seraphine')).toBe(false);
  });

  it('refresh loads the list from the server', async () => {
    setFriendsCharacter('me');
    setFriendsClient(fakeClient());
    await friendsActions.refresh();
    expect(friends.get().friends).toHaveLength(1);
    expect(friends.get().friends[0]?.name).toBe('Seraphine');
  });

  it('add of an unknown name leaves the error filled and the list unchanged', async () => {
    // Mutação que mata: a mensagem de erro sumir, ou a lista ganhar uma entrada fantasma.
    setFriendsCharacter('me');
    const add = vi.fn<FriendsClient['add']>().mockRejectedValue(new Error('Não existe personagem com esse nome.'));
    setFriendsClient(fakeClient({ add }));
    const ok = await friendsActions.add('nome-inexistente');
    expect(ok).toBe(false);
    expect(add).toHaveBeenCalledWith('me', 'nome-inexistente');
    expect(friends.get().error).toBe('Não existe personagem com esse nome.');
    expect(friends.get().friends).toEqual([]);
    expect(friends.get().busy).toBe(false);
  });

  it('add of a valid name reloads the list (the POST does not return the row)', async () => {
    setFriendsCharacter('me');
    const list = vi.fn<FriendsClient['list']>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([friend()]);
    setFriendsClient(fakeClient({ list }));
    await friendsActions.refresh();
    expect(friends.get().friends).toEqual([]);
    expect(await friendsActions.add('Seraphine')).toBe(true);
    expect(list).toHaveBeenCalledTimes(2);
    expect(friends.get().friends).toHaveLength(1);
    expect(friends.get().error).toBeNull();
  });

  it('remove drops the row and calls the API', async () => {
    setFriendsCharacter('me');
    const remove = vi.fn<FriendsClient['remove']>().mockResolvedValue();
    setFriendsClient(fakeClient({ remove }));
    await friendsActions.refresh();
    await friendsActions.remove('f1');
    expect(remove).toHaveBeenCalledWith('me', 'f1');
    expect(friends.get().friends).toEqual([]);
  });

  it('setFriendsCharacter resets the list when the character changes', async () => {
    setFriendsCharacter('me');
    setFriendsClient(fakeClient());
    await friendsActions.refresh();
    expect(friends.get().friends).toHaveLength(1);
    setFriendsCharacter('other');
    expect(friends.get().friends).toEqual([]);
    expect(friends.get().characterId).toBe('other');
  });
});
