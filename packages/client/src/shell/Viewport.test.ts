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
    // #471: a intenção passa pelo rastreador, que antecipa a moldura e decide o toggle.
    expect(code).toContain('targetTracker.selectTarget(id, sendIntent)');
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

describe('o clique num cadáver (#722, ADR 0048 d.4 — ajuste do DT-01)', () => {
  it('sem criatura no ponto, tenta groundItemAt e GUARDA o pedido — não manda open-corpse direto', async () => {
    const code = await source('./Viewport.tsx');
    expect(code).toContain('handleRef.current?.groundItemAt(event.clientX, event.clientY)');
    expect(code).toContain('requestCorpseApproach(groundItem.id, groundItem.position, performance.now())');
    // O ajuste do DT-01: o clique NÃO manda `open-corpse` direto — quem manda é `useCorpseApproach`,
    // quando o `world` disser que o personagem chegou perto.
    expect(code).not.toMatch(/sendIntent\(\{ type: 'open-corpse'/);
  });

  it('escolher uma criatura cancela um pedido de cadáver em curso', async () => {
    const code = await source('./Viewport.tsx');
    expect(code).toContain('cancelCorpseApproach();');
  });

  it('o ViewportHandle expõe groundItemAt', async () => {
    const code = await source('../world/viewport.ts');
    expect(code).toContain('groundItemAt(clientX: number, clientY: number): GroundItem | null;');
  });
});

describe('use-on-map e look no viewport (#729, ADR 0050 d.7)', () => {
  it('o duplo-clique sem criatura chama tileAt e requestTileUse (RF-06)', async () => {
    const code = await source('./Viewport.tsx');
    expect(code).toContain('onDoubleClick={onCanvasDoubleClick}');
    expect(code).toContain('handleRef.current?.creatureAt(event.clientX, event.clientY)');
    expect(code).toContain('handleRef.current?.tileAt(event.clientX, event.clientY)');
    expect(code).toContain('requestTileUse(position, performance.now())');
  });

  it('o duplo-clique EM CIMA de uma criatura não manda nada (RF-06)', async () => {
    const code = await source('./Viewport.tsx');
    expect(code).toMatch(/const onCanvasDoubleClick[\s\S]*?if \(id !== null\) return;/);
  });

  it('o clique direito olha a posição, sem aproximação, e troca o menu do navegador', async () => {
    const code = await source('./Viewport.tsx');
    expect(code).toContain('onContextMenu={onCanvasContextMenu}');
    expect(code).toContain('event.preventDefault()');
    expect(code).toContain("sendIntent({ type: 'look', position })");
  });

  it('escolher uma criatura cancela um pedido de tile-approach em curso', async () => {
    const code = await source('./Viewport.tsx');
    expect(code).toMatch(/cancelTileApproach\(\);[\s\S]*?targetTracker\.selectTarget/);
  });

  it('o ViewportHandle expõe tileAt', async () => {
    const code = await source('../world/viewport.ts');
    expect(code).toContain(
      'tileAt(clientX: number, clientY: number): { readonly x: number; readonly y: number; readonly z: number };',
    );
  });
});
