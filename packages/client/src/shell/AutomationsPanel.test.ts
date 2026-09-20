import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BotAutomation } from '@draconya/content';
import { AutomationsPanel } from './AutomationsPanel.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue, PartyView } from '../state/hud.js';
import { INITIAL_BOT, bot, edit } from '../bot/store.js';

// O painel AUTOMAÇÕES (AB-12, #427), régua `docs/kit-reference/10-hud-hunt.png`. `prerender` roda
// sem DOM: o que se prende é a ESTRUTURA — as linhas com interruptor/nome/resumo/⚙/×, o
// "Carregando…" sem catálogo e o painel igual na Cidade e na caçada. A fiação (toggle/×/modais) é
// presa por inspeção de fonte, porque `prerender` não dispara evento.

const catalogue = (): Catalogue => ({
  hunts: [],
  monsters: [],
  vocations: [],
  vocationLevel: 0,
  items: [
    { id: 'life-ring', name: 'Life Ring', appearanceId: 1, weight: 1, slot: 'finger', twoHanded: false, kind: 'ring' },
    { id: 'steel-axe', name: 'Steel Axe', appearanceId: 4, weight: 1, slot: 'hand', twoHanded: false, kind: 'weapon' },
    { id: 'spike-sword', name: 'Spike Sword', appearanceId: 5, weight: 1, slot: 'hand', twoHanded: true, kind: 'weapon' },
    { id: 'wooden-shield', name: 'Wooden Shield', appearanceId: 6, weight: 1, slot: 'shield', twoHanded: false, kind: 'shield' },
  ],
  ammunition: [
    { id: 'burst-arrow', name: 'Burst Arrow', family: 'arrow', attack: 30, price: 5, appearanceId: 2, requires: {} },
    { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 25, price: 1, appearanceId: 3, requires: {} },
  ],
  bot: {
    vocabularyVersion: 2,
    spells: [],
    automations: [
      { model: 'renew-ring', label: 'Renovar anel', params: [{ name: 'itemId', kind: 'item' }] },
      { model: 'renew-amulet', label: 'Renovar colar', params: [{ name: 'itemId', kind: 'item' }] },
      { model: 'swap-ammo-by-targets', label: 'Trocar munição por alvos', params: [{ name: 'ammoA', kind: 'item' }, { name: 'ammoB', kind: 'item' }] },
      { model: 'swap-weapon-shield-by-hp', label: 'Trocar arma/escudo por vida', params: [{ name: 'oneHanded', kind: 'item' }, { name: 'shield', kind: 'item' }, { name: 'twoHanded', kind: 'item' }] },
      { model: 'swap-ring', label: 'Trocar anel por vida', params: [{ name: 'itemId', kind: 'item' }, { name: 'manaFloor', kind: 'number' }, { name: 'restorePrevious', kind: 'boolean' }] },
    ],
  },
});

const ammo: BotAutomation = {
  model: 'swap-ammo-by-targets',
  params: { ammoA: 'burst-arrow', ammoB: 'arrow' },
  enter: [{ kind: 'targets', op: '>=', count: 3 }],
  exit: [{ kind: 'targets', op: '<', count: 3 }],
};
const weaponShield: BotAutomation = {
  model: 'swap-weapon-shield-by-hp',
  params: { oneHanded: 'steel-axe', shield: 'wooden-shield', twoHanded: 'spike-sword' },
  enter: [{ kind: 'hp', op: '<', percent: 50 }],
  exit: [{ kind: 'hp', op: '>', percent: 80 }],
};

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(AutomationsPanel, {}));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, catalogue: catalogue() }));
  bot.set(() => ({ ...INITIAL_BOT, draft: { ...INITIAL_BOT.draft, automations: [ammo, weaponShield] } }));
});

describe('AutomationsPanel — as linhas do kit (RF-02)', () => {
  it('uma linha por automação: toggle · nome · resumo · ⚙ · ×', async () => {
    const html = await render();
    expect((html.match(/role="switch"/g) ?? []).length).toBe(2);
    expect(html).toContain('Trocar munição por alvos');
    expect(html).toContain('Trocar arma/escudo por vida');
    expect(html).toContain('alvos maior ou igual a 3 → Burst Arrow · senão Arrow');
    expect(html).toContain('HP menor que 50 % → Escudo + Steel Axe · HP maior que 80 % → Spike Sword');
    expect((html.match(/⚙/g) ?? []).length).toBe(2);
    expect((html.match(/×/g) ?? []).length).toBe(2);
    expect(html).toContain('+ Adicionar');
  });

  it('não traz a sexta automação nem a trava de level do kit', async () => {
    const html = await render();
    expect(html).not.toContain('Comer comida');
    expect(html).not.toContain('LV 50');
  });
});

describe('AutomationsPanel — sem catálogo (RF-11)', () => {
  it('diz Carregando… e não inventa linha', async () => {
    hud.set((state) => ({ ...state, catalogue: null }));
    const html = await render();
    expect(html).toContain('Carregando…');
    expect(html).not.toContain('automation-row');
  });
});

describe('AutomationsPanel — vale o tempo todo (RF-13, ADR 0032 d.5)', () => {
  it('monta o MESMO painel na Cidade e na caçada', async () => {
    hud.set((state) => ({ ...state, analyzer: { ...state.analyzer, sessionType: 'city' } }));
    const city = await render();
    hud.set((state) => ({ ...state, analyzer: { ...state.analyzer, sessionType: 'hunt' } }));
    const hunt = await render();
    expect(city).toBe(hunt);
    expect(city).toContain('Trocar munição por alvos');
  });
});

describe('AutomationsPanel — a fiação (RF-08)', () => {
  it('chama as ações da store e os dois modais', async () => {
    const source = await readFile(new URL('./AutomationsPanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('toggleAutomation');
    expect(source).toContain('removeAutomation');
    expect(source).toContain('AddAutomationModal');
    expect(source).toContain('AutomationConfigModal');
    // O remetente é da `Shell` (dono único do singleton): o painel não o instala nem o limpa.
    expect(source).not.toContain('setConfigSender');
  });
});

describe('AutomationsPanel — Follow de membro (#406, ADR 0035 d.9/§24-25.1)', () => {
  const member = (characterId: string, name: string) => ({
    characterId, name, alive: true, healthPercent: 100, vocationId: null,
  });
  const party = (members: ReturnType<typeof member>[]): PartyView => ({
    leaderId: members[0]?.characterId ?? 'p1', mode: 'split', members,
  });

  it('RF-01: fora de party o Select "Seguir" não aparece', async () => {
    const html = await render();
    expect(html).not.toContain('>Seguir<');
    expect(html).not.toContain('Não seguir');
    expect(html).not.toContain('Líder da party');
  });

  it('RF-01: em party lista Não seguir, Líder e cada membro pelo nome', async () => {
    hud.set((state) => ({
      ...state,
      characterId: 'me',
      party: party([member('p1', 'Ana'), member('p2', 'Bru'), member('p3', 'Cid')]),
    }));
    const html = await render();
    expect(html).toContain('>Seguir<');
    expect(html).toContain('Não seguir');
    expect(html).toContain('Líder da party');
    for (const name of ['Ana', 'Bru', 'Cid']) expect(html).toContain(`>${name}<`);
  });

  it('DT-04: o próprio personagem não entra na lista de membros', async () => {
    hud.set((state) => ({
      ...state,
      characterId: 'p1',
      party: party([member('p1', 'Ana'), member('p2', 'Bru')]),
    }));
    const html = await render();
    expect(html).toContain('>Bru<');
    // "Ana" só apareceria se a opção do próprio fosse oferecida de novo (o `none` já é isso).
    expect(html).not.toContain('>Ana<');
  });

  it('RF-03: a lista é AO VIVO — um novo `party-state` muda as opções sem remontar', async () => {
    hud.set((state) => ({
      ...state,
      characterId: 'me',
      party: party([member('p1', 'Ana'), member('p2', 'Bru')]),
    }));
    expect(await render()).toContain('>Bru<');

    hud.set((state) => ({ ...state, party: party([member('p3', 'Cid')]) }));
    const html = await render();
    expect(html).toContain('>Cid<');
    expect(html).not.toContain('>Bru<');
  });

  it('o follow do rascunho vem selecionado — member, leader e none', async () => {
    hud.set((state) => ({
      ...state,
      characterId: 'me',
      party: party([member('p1', 'Ana'), member('p2', 'Bru')]),
    }));

    edit((draft) => ({ ...draft, follow: { kind: 'member', characterId: 'p2' } }));
    expect(await render()).toMatch(/<option[^>]*value="member:p2"[^>]*selected/);

    edit((draft) => ({ ...draft, follow: { kind: 'leader' } }));
    expect(await render()).toMatch(/<option[^>]*value="leader"[^>]*selected/);

    edit((draft) => ({ ...draft, follow: { kind: 'none' } }));
    expect(await render()).toMatch(/<option[^>]*value="none"[^>]*selected/);
  });

  it('RF-02: escolher uma opção chama `setFollow` (o painel agenda o bot-config) — por fonte', async () => {
    const source = await readFile(new URL('./AutomationsPanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('setFollow(');
    expect(source).toContain("{ kind: 'member', characterId: value.slice('member:'.length) }");
    expect(source).toContain("{ kind: 'leader' }");
    expect(source).toContain("{ kind: 'none' }");
  });

  it('RF-04: `followState.active === false` mostra o texto exato do §25.1; `null`/`true` não', async () => {
    // Sem o servidor ter dito nada, a tela NÃO inventa "interrompido" (D8).
    expect(await render()).not.toContain('Follow interrompido');

    hud.set((state) => ({
      ...state,
      followState: { active: false, targetId: 'p1', reason: 'dead' },
    }));
    expect(await render()).toContain('Follow interrompido — alvo indisponível.');

    hud.set((state) => ({ ...state, followState: { active: true, targetId: 'p1' } }));
    expect(await render()).not.toContain('Follow interrompido');
  });
});
