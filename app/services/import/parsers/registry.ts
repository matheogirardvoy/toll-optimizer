import type { PriceGridParser } from '../types.js'

/**
 * Chargeurs de parseurs par réseau. Chaque parseur reste isolé dans son
 * module : seul celui demandé est chargé.
 */
const loaders: Record<string, () => Promise<PriceGridParser>> = {
  area: async () => {
    const { default: AreaGridParser } = await import('./area_grid_parser.js')
    return new AreaGridParser()
  },
  aprr: async () => {
    const { default: AprrGridParser } = await import('./aprr_grid_parser.js')
    return new AprrGridParser()
  },
  sanef: async () => {
    const { default: SanefGridParser } = await import('./sanef_grid_parser.js')
    return new SanefGridParser()
  },
  asf: async () => {
    const { default: AsfGridParser } = await import('./asf_grid_parser.js')
    return new AsfGridParser()
  },
}

/** Slugs des réseaux dont la grille PDF sait être analysée. */
export const supportedNetworkSlugs: readonly string[] = Object.keys(loaders)

/**
 * Fabrique le parseur associé à un réseau.
 */
export async function createParser(networkSlug: string): Promise<PriceGridParser | null> {
  const loader = loaders[networkSlug]
  return loader ? loader() : null
}
