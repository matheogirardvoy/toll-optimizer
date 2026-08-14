import { LngLat, TollMatch, xsrfToken } from '~/composables/engine/useOptimizer';

/**
 * Enrichit des points de perception Mapbox avec le référentiel local :
 * pour chaque point, le péage BDD le plus proche ou null, dans l'ordre
 * de la requête.
 */
async function matchTolls(points: LngLat[]): Promise<(TollMatch | null)[]> {
    if (points.length === 0) return [];

    const token = xsrfToken();
    const response = await fetch('/api/tolls/match', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(token ? { 'X-XSRF-TOKEN': token } : {}),
        },
        body: JSON.stringify({ points }),
    });

    if (!response.ok) {
        throw new Error(`Appariement des péages impossible (HTTP ${response.status})`);
    }
    return ((await response.json()) as { matches: (TollMatch | null)[] }).matches;
}

export default {
    matchTolls,
};
