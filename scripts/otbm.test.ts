import { describe, expect, it } from 'vitest';
import { NODE, OtbmError, otbmNode, readOtbmHeader, readOtbmTiles, u16, u32, u8 } from './otbm.js';
import type { Region } from './otbm.js';

// Um OTBM sintético, montado a partir do formato — nunca um arquivo real de 184 MB. A fixture
// é a estrutura, escrita em código, para o dia em que ela reprovar dizer o que dizia.

const header = (): number[] => [0, 0, 0, 0];
const root = (children: number[][]): number[] =>
  otbmNode(NODE.root, [...u32(4), ...u16(2048), ...u16(2048), ...u32(4), ...u32(4)], children);
const mapData = (children: number[][]): number[] =>
  // description (0x01) e um atributo de extensão do Canary (0x17), os dois com tamanho.
  otbmNode(NODE.mapData, [0x01, ...u16(3), 0x61, 0x62, 0x63, 0x17, ...u16(1), 0x7a], children);
const area = (x: number, y: number, z: number, children: number[][]): number[] =>
  otbmNode(NODE.tileArea, [...u16(x), ...u16(y), ...u8(z)], children);
const tile = (dx: number, dy: number, attrs: number[], children: number[][] = []): number[] =>
  otbmNode(NODE.tile, [...u8(dx), ...u8(dy), ...attrs], children);
const houseTile = (dx: number, dy: number, houseId: number, attrs: number[]): number[] =>
  otbmNode(NODE.houseTile, [...u8(dx), ...u8(dy), ...u32(houseId), ...attrs]);
const item = (id: number, attrs: number[] = [], children: number[][] = []): number[] =>
  otbmNode(NODE.item, [...u16(id), ...attrs], children);
const ground = (id: number): number[] => [0x09, ...u16(id)];
const flags = (bits: number): number[] => [0x03, ...u32(bits)];
const count = (n: number): number[] => [0x0f, ...u8(n)];

const file = (areas: number[][]): Uint8Array =>
  Uint8Array.from([...header(), ...root([mapData(areas)])]);

const EVERYWHERE: Region = { x: [0, 65535], y: [0, 65535], z: [0, 15] };
const all = (bytes: Uint8Array, region: Region = EVERYWHERE) =>
  [...readOtbmTiles(bytes, region)];

describe('readOtbmHeader', () => {
  it('lê versão e dimensões do nó raiz', () => {
    expect(readOtbmHeader(file([]))).toEqual({
      version: 4, width: 2048, height: 2048, itemsMajorVersion: 4, itemsMinorVersion: 4,
    });
  });

  it('recusa o que não começa com 00 00 00 00 FE 00', () => {
    expect(() => readOtbmHeader(Uint8Array.from([1, 2, 3]))).toThrow(OtbmError);
  });
});

describe('readOtbmTiles', () => {
  it('devolve tile com chão, itens na ordem do arquivo, contagem e flags', () => {
    const bytes = file([
      area(32000, 32000, 7, [
        tile(5, 6, [...flags(1), ...ground(410)], [item(1294), item(3031, count(4))]),
        tile(7, 6, []),
      ]),
    ]);
    expect(all(bytes)).toEqual([
      { x: 32005, y: 32006, z: 7, ground: 410, items: [{ id: 1294 }, { id: 3031, count: 4 }], flags: 1 },
      { x: 32007, y: 32006, z: 7, ground: null, items: [], flags: 0 },
    ]);
  });

  it('lê house tile com o houseId antes dos atributos', () => {
    const bytes = file([area(32000, 32000, 7, [houseTile(22, 0, 2958, [...flags(1), ...ground(4598)])])]);
    expect(all(bytes)).toEqual([
      { x: 32022, y: 32000, z: 7, ground: 4598, items: [], flags: 1, houseId: 2958 },
    ]);
  });

  it('desescapa FD dentro de dados — um id 0xFE ou 0xFF não confunde o nó', () => {
    // 65534 = 0xFFFE: os dois bytes são marcadores, e só o escape os torna dado.
    const bytes = file([area(32000, 32000, 7, [tile(1, 1, ground(0xfffe), [item(0xfdfd)])])]);
    expect(all(bytes)).toEqual([
      { x: 32001, y: 32001, z: 7, ground: 0xfffe, items: [{ id: 0xfdfd }], flags: 0 },
    ]);
  });

  it('só devolve o que está na região, e pula tile areas inteiros sem visitá-los', () => {
    const bytes = file([
      area(32000, 32000, 7, [tile(1, 1, ground(1)), tile(200, 200, ground(2))]),
      area(32256, 32000, 7, [tile(0, 0, ground(3))]),
      area(32000, 32000, 8, [tile(1, 1, ground(4))]),
    ]);
    const region: Region = { x: [32000, 32100], y: [32000, 32100], z: [7, 7] };
    expect(all(bytes, region).map((t) => t.ground)).toEqual([1]);
  });

  it('o mesmo tile em dois tile areas sai duas vezes — a política é do importador', () => {
    const bytes = file([
      area(32000, 32000, 7, [tile(1, 1, ground(1))]),
      area(32000, 32000, 7, [tile(1, 1, ground(2))]),
    ]);
    expect(all(bytes).map((t) => t.ground)).toEqual([1, 2]);
  });

  it('item dentro de container não entra na pilha do tile', () => {
    const bytes = file([area(32000, 32000, 7, [tile(1, 1, ground(1), [item(2854, [], [item(3031)])])])]);
    expect(all(bytes)[0]?.items).toEqual([{ id: 2854 }]);
  });

  it('atributo desconhecido em tile é fatal, com o offset', () => {
    const bytes = file([area(32000, 32000, 7, [tile(1, 1, [0x42, 1, 2, 3])])]);
    expect(() => all(bytes)).toThrow(/atributo desconhecido 0x42/);
  });

  it('atributo de tamanho desconhecido em map data é pulado, e a leitura segue', () => {
    // Já coberto pela fixture: `mapData` grava 0x17, que não está na tabela clássica.
    const bytes = file([area(32000, 32000, 7, [tile(1, 1, ground(9))])]);
    expect(all(bytes)).toHaveLength(1);
  });

  it('nó sem fechamento é erro, não laço infinito', () => {
    const broken = Uint8Array.from([...header(), 0xfe, 0x00, ...u32(4), ...u16(1), ...u16(1), ...u32(4), ...u32(4)]);
    expect(() => all(broken)).toThrow(OtbmError);
  });
});
