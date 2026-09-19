import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

// A fiação do alvo no viewport (AB-13, #428). Não há fake de Pixi no cliente e `prerender` não
// dispara evento: a regra pura (`pick.ts`, `fromScreen`) é testada direto, e o que sobra — o
// clique, a exclusão do próprio e a moldura — é preso por leitura da fonte, o precedente de
// `HuntActions.test.ts` e `drag-intent.test.ts`.

async function source(relative: string): Promise<string> {
  return readFile(new URL(relative, import.meta.url), 'utf8');
}

describe('a fiação do alvo no Viewport (#428)', () => {
  it('o clique no canvas chama creatureAt e manda select-target (RF-06)', async () => {
    const code = await source('./Viewport.tsx');
    expect(code).toContain('onClick={onCanvasClick}');
    expect(code).toContain('handleRef.current?.creatureAt(event.clientX, event.clientY)');
    expect(code).toContain("sendIntent({ type: 'select-target', creatureId: id })");
  });

  it('o clique ignora o overlay e o próprio personagem (RF-08)', async () => {
    const code = await source('./Viewport.tsx');
    expect(code).toContain('event.target instanceof HTMLCanvasElement');
    expect(code).toContain('id === world.selfId');
  });

  it('a moldura segue hud.targetId por useEffect (RF-07)', async () => {
    const code = await source('./Viewport.tsx');
    expect(code).toContain('useHudSlice((state) => state.targetId)');
    expect(code).toContain('handleRef.current?.setTargetId(targetId)');
    expect(code).toMatch(/useEffect\(\(\) => \{[\s\S]*?setTargetId\(targetId\)[\s\S]*?\}, \[targetId\]\)/);
  });

  it('o ViewportHandle expõe creatureAt e setTargetId', async () => {
    const code = await source('../world/viewport.ts');
    expect(code).toContain('creatureAt(clientX: number, clientY: number): number | null;');
    expect(code).toContain('setTargetId(id: number | null): void;');
  });
});
