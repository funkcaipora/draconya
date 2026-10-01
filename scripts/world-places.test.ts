import { describe, expect, it } from 'vitest';
import { formatPlaces, parseHousesXml } from './world-places.js';

describe('parseHousesXml', () => {
  it('lê nome, id, entrada, cidade, tamanho e guildhall, e decodifica entidades', () => {
    const houses = parseHousesXml(`<?xml version="1.0"?><houses>
      <house name="Underwood 9" houseid="2630" entryx="32712" entryy="31665" entryz="7" rent="50000" townid="5" size="14" />
      <house name="Ab&apos;Dendriel Clanhall" houseid="2629" entryx="32714" entryy="31643" entryz="7" guildhall="true" townid="5" size="326" />
    </houses>`);
    expect(houses).toEqual([
      { id: 2629, name: "Ab'Dendriel Clanhall", entry: [32714, 31643, 7], townId: 5, size: 326, guildhall: true },
      { id: 2630, name: 'Underwood 9', entry: [32712, 31665, 7], townId: 5, size: 14, guildhall: false },
    ]);
  });
});

describe('formatPlaces', () => {
  it('uma linha por cidade, waypoint e casa, e volta como JSON', () => {
    const places = {
      format: 'draconya-places/1' as const,
      towns: [{ id: 8, name: 'Thais', temple: [32369, 32241, 7] as const }],
      waypoints: [],
      houses: [{ id: 1, name: 'Casa', entry: [1, 2, 7] as const, townId: 8, size: 10, guildhall: false }],
    };
    const text = formatPlaces(places);
    expect(JSON.parse(text)).toEqual(places);
    expect(text.split('\n').filter((line) => line.startsWith('  {'))).toHaveLength(2);
  });
});
