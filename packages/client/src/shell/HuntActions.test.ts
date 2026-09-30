import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it, vi } from 'vitest';
import { HuntActions, leaveHunt } from './HuntActions.js';
import { stopTraining } from './TrainingStatus.js';
import { INITIAL_HUD, hud } from '../state/hud.js';

// As pills sobre o mundo (#259, #325). `prerender` roda sem DOM — um clique real não dispara
// (mesmo limite de VocationChoice.test.ts). A intenção de saída é uma função pura, testada
// direto; a fiação do clique é provada por inspeção do código-fonte.

async function render(hunting: boolean): Promise<string> {
  const { prelude } = await prerender(createElement(HuntActions, { hunting, onChoose: () => {} }));
  return new Response(prelude).text();
}

describe('HuntActions', () => {
  it('hunting=false: shows the "⚔ Escolher caçada" pill, and only that one', async () => {
    const html = await render(false);
    expect(html).toContain('Escolher caçada');
    expect(html).not.toContain('Sair da caçada');
    expect(html).not.toContain('Detalhes da caçada');
    expect(html).not.toContain('hunt-pill-icon');
    expect(html).toContain('class="hunt-pill"');
    expect(html).not.toContain('hunt-pill-danger');
  });

  it('hunting=true: puts details before the exit pair, without dispatching loot', async () => {
    const html = await render(true);
    const detailsIndex = html.indexOf('Detalhes da caçada');
    const exitIndex = html.indexOf('Sair da caçada');
    expect(detailsIndex).toBeGreaterThan(-1);
    expect(exitIndex).toBeGreaterThan(detailsIndex);
    expect(html).toContain('Sair da caçada');
    expect(html).not.toContain('Escolher caçada');
    expect(html).not.toContain('Despachar loot');
    expect(html).toContain('hunt-pill-danger');
    // Antes desta correção existiam DOIS "»": o decorativo dentro do texto da pill (removido
    // agora) e o funcional do `ExitRulesPopover`. O kit desenha só um, no mesmo botão partido.
    const chevronCount = (html.match(/»/g) ?? []).length;
    expect(chevronCount).toBe(1);
  });

  it('wires onChoose to the non-hunting pill, and leaveHunt(sendIntent) to the exit pill', async () => {
    const source = await readFile(new URL('./HuntActions.tsx', import.meta.url), 'utf8');
    const notHuntingIndex = source.indexOf('if (!hunting)');
    const onChooseIndex = source.indexOf('onClick={onChoose}');
    const huntingReturnIndex = source.lastIndexOf('return (');
    const leaveHuntCallIndex = source.indexOf('leaveHunt(sendIntent)');
    expect(notHuntingIndex).toBeGreaterThan(-1);
    // `onClick={onChoose}` mora DENTRO do bloco `if (!hunting)`, antes do segundo `return`.
    expect(onChooseIndex).toBeGreaterThan(notHuntingIndex);
    expect(onChooseIndex).toBeLessThan(huntingReturnIndex);
    // `leaveHunt(sendIntent)` mora DEPOIS do segundo `return` — o pill de saída.
    expect(leaveHuntCallIndex).toBeGreaterThan(huntingReturnIndex);
  });

  it('renders the details modal after the exit pill, with the exit click wired straight to leaveHunt', async () => {
    const source = await readFile(new URL('./HuntActions.tsx', import.meta.url), 'utf8');
    const exitIndex = source.indexOf('onClick={() => { leaveHunt(sendIntent); }}');
    expect(exitIndex).toBeGreaterThan(-1);
    expect(source.indexOf('<HuntDetailsModal', exitIndex)).toBeGreaterThan(exitIndex);
  });
});

describe('HuntActions com a saída pendente (#802)', () => {
  it('sem saída pendente a pill é a de sempre; com ela, o estado toma o lugar do "Sair da caçada"', async () => {
    hud.set(() => INITIAL_HUD);
    expect(await render(true)).toContain('Sair da caçada');

    hud.set((state) => ({
      ...state,
      exitPending: { reason: 'manual-exit', phase: 'countdown', remainingMs: 5_000, receivedAtMs: performance.now() },
    }));
    const html = await render(true);
    expect(html).not.toContain('Sair da caçada');
    expect(html).toContain('Saindo em 5 s');
    expect(html).toContain('Cancelar');
    // O botão partido continua inteiro: o chevron das regras não some com a espera.
    expect((html.match(/»/g) ?? []).length).toBe(1);
    // E o resto da faixa não muda: os detalhes continuam ao lado.
    expect(html).toContain('Detalhes da caçada');
    hud.set(() => INITIAL_HUD);
  });
});

describe('HuntActions e o Treino (#631, ADR 0059)', () => {
  const rules = {
    perCharge: { tries: 7, manaSpent: 600 }, bankCapMs: 43_200_000, graceMs: 600_000,
    spendCapMs: { free: 21_600_000, premium: 43_200_000 },
    offlineSkills: [{ skillId: 'sword', name: 'Espada', kind: 'attacks' as const }],
  };
  const withTraining = (): void => {
    hud.set((state) => ({
      ...state,
      catalogue: {
        hunts: [], monsters: [], ammunition: [], vocations: [], charms: [], vocationLevel: 8,
        bot: { vocabularyVersion: 1, slots: {}, spells: [], supplies: [] },
        items: [{
          id: 'exercise-sword', name: 'exercise sword', appearanceId: 1, weight: 10, slot: null,
          twoHanded: false, exercise: { skillId: 'sword', charges: 500 }, buyPrice: 100,
        }],
        training: rules,
      } as never,
    }));
  };
  const renderTraining = async (props: { hunting: boolean; training?: boolean; onTraining?: () => void }): Promise<string> => {
    const { prelude } = await prerender(createElement(HuntActions, { onChoose: () => {}, ...props }));
    return new Response(prelude).text();
  };

  it('na Cidade o pill "Treino" existe só com o servidor que tem Treino e com quem o abre', async () => {
    hud.set(() => INITIAL_HUD);
    expect(await renderTraining({ hunting: false, onTraining: () => {} })).not.toContain('Treino');
    withTraining();
    expect(await renderTraining({ hunting: false })).not.toContain('Treino');
    const html = await renderTraining({ hunting: false, onTraining: () => {} });
    expect(html).toContain('Escolher caçada');
    expect(html).toContain('Treino');
    hud.set(() => INITIAL_HUD);
  });

  it('no Treino mostra a arma, a skill e as cargas que restam, com "Parar treino" — e nada de caçada', async () => {
    withTraining();
    hud.set((state) => ({
      ...state,
      training: {
        offlineBankMs: 0, offlineSkill: null, activeInstanceId: 'w1',
        weapons: [{ instanceId: 'w1', itemId: 'exercise-sword', charges: 431 }],
      },
    }));
    const html = await renderTraining({ hunting: false, training: true });
    expect(html).toContain('Treinando Espada · 431/500 cargas');
    expect(html).toContain('Parar treino');
    expect(html).not.toContain('Escolher caçada');
    expect(html).not.toContain('Sair da caçada');
    expect(html).not.toContain('Detalhes da caçada');
    // O botão de parar é o `leave-hunt` de sempre, e não é a metade de um botão partido.
    expect(html).toContain('training-stop');
    expect(html).not.toContain('»');
    hud.set(() => INITIAL_HUD);
  });

  it('antes de o primeiro `training-state` chegar, só "Treinando" — sem inventar um número', async () => {
    hud.set(() => INITIAL_HUD);
    const html = await renderTraining({ hunting: false, training: true });
    expect(html).toContain('Treinando');
    expect(html).not.toContain('cargas');
    expect(html).toContain('Parar treino');
  });

  it('parar o treino manda o leave-hunt, o mesmo opcode de toda sessão privada', async () => {
    const send = vi.fn(() => true);
    expect(stopTraining(send)).toBe(true);
    expect(send).toHaveBeenCalledWith({ type: 'leave-hunt' });
    const source = await readFile(new URL('./TrainingStatus.tsx', import.meta.url), 'utf8');
    expect(source.indexOf('stopTraining(sendIntent)')).toBeGreaterThan(-1);
    // E o `HuntActions` delega o estado do Treino a ele, sem duplicar o botão.
    const actions = await readFile(new URL('./HuntActions.tsx', import.meta.url), 'utf8');
    expect(actions).toContain('if (training) return <TrainingStatus />;');
  });
});

describe('leaveHunt (RF-07)', () => {
  it('sends exactly the leave-hunt intent (opcode 10), and returns what send() returns', () => {
    const send = vi.fn(() => true);
    expect(leaveHunt(send)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'leave-hunt' });
  });

  it('propagates a silent failure (no connection) as false', () => {
    const send = vi.fn(() => false);
    expect(leaveHunt(send)).toBe(false);
  });
});
