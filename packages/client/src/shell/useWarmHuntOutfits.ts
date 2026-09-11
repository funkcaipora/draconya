// Aquecer as folhas dos monstros das hunts enquanto o jogador ainda está na Cidade (FUN-112).
//
// O pacote decodifica folha sob demanda (FUN-18), e é o certo para milhares de folhas — mas a
// primeira entrada numa hunt mostrava o rato como um quadrado por seis a dez segundos, até as
// onze folhas do outfit dele passarem pelo Worker. O catálogo diz quais outfits cada hunt tem;
// aqui eles são pedidos assim que o pacote está pronto, em segundo plano, no tempo em que o
// jogador está lendo a lista de hunts e configurando o bot. Na segunda visita o cache
// persistente (FUN-19) já resolve; isto é a PRIMEIRA.

import { useEffect } from 'react';
import type { S2CProps } from '@draconya/protocol';
import type { AssetPack } from '../assets/pack.js';
import { useHudSlice } from '../state/useSlice.js';

type Catalogue = S2CProps<'catalogue'>;

/** Os outfits a aquecer: os de todas as hunts, sem repetir. Puro, para o teste. */
export function outfitsToWarm(catalogue: Catalogue | null): number[] {
  if (catalogue === null) return [];
  const outfits = new Set<number>();
  for (const hunt of catalogue.hunts) for (const outfit of hunt.outfitIds) outfits.add(outfit);
  return [...outfits];
}

/**
 * Aquece uma vez por (pacote, catálogo). Não espera nada: o resultado é só o cache cheio, e
 * uma folha que não abre cai no fallback como cairia sem aquecer.
 */
export function useWarmHuntOutfits(pack: AssetPack | null): void {
  const catalogue = useHudSlice((state) => state.catalogue);
  useEffect(() => {
    if (pack === null) return;
    for (const outfit of outfitsToWarm(catalogue)) void pack.warmOutfit(outfit);
  }, [pack, catalogue]);
}
