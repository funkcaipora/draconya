import { describe, expect, it } from 'vitest';
import { createHuntSession } from '@draconya/sim';
import type { HuntRuleset } from '@draconya/sim';
import {
  COMBAT_BACKPACK_ID, COMBAT_HUNT_ID, COMBAT_SHIELD_ID, COMBAT_SWORD_ID,
  combatCharacter, combatScenario,
} from './combat-scenario.js';

// O bench (`pnpm bench:hunts SCENARIO=combat`) não roda no CI. O que quebrou o cenário frio
// (#179) não foi o número, foi o CONTRATO: `buildContent` mudou e o cenário sintético ficou para
// trás por meses. Este teste monta o cenário misto e avança uma hunt — é o que reprova no PR
// quando o contrato mudar de novo, e é o que prende que a composição do M19 continua de pé.

describe('the combat bench scenario (CMB-10, #336)', () => {
  it('builds with the current buildContent contract and runs a full hunt', () => {
    const content = combatScenario();
    const session = createHuntSession({
      id: 'combat-0', content, huntId: COMBAT_HUNT_ID, difficulty: 'reckless', createdAtMs: 0,
    });
    session.enter(combatCharacter(content, 'p0', { x: 1, y: 1, z: 7 }));
    for (let tick = 0; tick < 10; tick++) {
      session.advanceBy(1_000);
      session.drainEvents();
    }
    // A instância é CHEIA — é a razão de o cenário ser sintético e não uma hunt do jogo.
    expect((session.ruleset as HuntRuleset).monsters.length).toBeGreaterThanOrEqual(30);
    expect(session.snapshot()).toBeDefined();
  });

  it('a composição do marco está declarada: ability, área, resistência, defesa, condição/campo e modificadores', () => {
    const content = combatScenario();
    // CMB-06/CMB-07: a ability em área carrega condição (DOT) e campo por tile.
    const flamer = content.monsters.get('flamer');
    expect(flamer).toBeDefined();
    const ability = flamer?.abilities.find((candidate) => candidate.id === 'flame-burst');
    expect(ability?.target.area?.shape).toBe('circle');
    expect(ability?.condition?.effect.kind).toBe('damage-over-time');
    expect(ability?.field?.condition.effect.kind).toBe('damage-over-time');
    // CMB-03: resistência e vulnerabilidade no mesmo monstro.
    expect(flamer?.mitigation.resistances.fire).toBe(0.5);
    expect(flamer?.mitigation.resistances.ice).toBe(-0.25);
    // CMB-04: a defesa do perfil aponta uma skill que existe e sobe por bloqueio.
    expect(content.combat.defense?.blockTypes).toContain('physical');
    expect(content.combat.defense?.skillId).toBe('shielding');
    // CMB-08: os modificadores avançados do atacante.
    expect(content.combat.modifiers?.critical?.multiplier).toBeGreaterThan(1);
    // CMB-05: a arma do cenário tem família e o escudo tem defesa.
    expect(content.items.get(COMBAT_SWORD_ID)?.weapon?.family).toBe('sword');
    expect(content.items.get(COMBAT_SHIELD_ID)?.defense).toBeGreaterThan(0);
    expect(content.items.get(COMBAT_BACKPACK_ID)?.initialSlots).toBe(20);
  });

  it('o personagem entra vestido: arma, escudo e mochila equipados', () => {
    const content = combatScenario();
    const character = combatCharacter(content, 'p1', { x: 1, y: 1, z: 7 });
    const wearer = { level: 1, vocationId: null };
    // `Inventory.weapon()` e `defenseSource` leem daqui — sem isto o cenário mediria identidade.
    expect(character.inventory.weapon(content.items, wearer)?.id).toBe(COMBAT_SWORD_ID);
    expect(character.inventory.defenseSource(content.items, wearer).kind).toBe('shield');
    expect(character.inventory.equippedAt('back')?.itemId).toBe(COMBAT_BACKPACK_ID);
  });
});
