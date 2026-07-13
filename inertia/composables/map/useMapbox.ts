const DIRECTIONS_BASE = 'https://api.mapbox.com/directions/v5/mapbox/driving';
const GEOCODING_BASE  = 'https://api.mapbox.com/geocoding/v5/mapbox.places';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

export type Feature = {
    place_name: string;
    place_type: string[];
    center: [number, number];
}

/** Intersection d'une étape ; `toll_collection` n'existe qu'avec `steps=true`. */
type StepIntersection = {
    location: [number, number];
    toll_collection?: {type?: string; name?: string};
}

type RouteLeg = {
    steps?: {intersections?: StepIntersection[]}[];
}

/** Point de perception annoté par Mapbox le long d'un itinéraire. */
export type RouteTollCollection = {
    location: [number, number];
    /** `toll_booth` (gare/barrière) ou `toll_gantry` (portique flux libre). */
    kind: string | null;
    name: string | null;
}

export type DrivingRoute = {
    distance: number;
    duration: number;
    geometry: {coordinates: [number, number][], type: 'LineString'};
    legs?: RouteLeg[];
}

export type DrivingRouteResponse = {
    code: string;
    routes: DrivingRoute[];
    uuid: string;
    waypoints: {name: string, location: [number, number], distance: number}[];
}

/**
 * Collecte les annotations `toll_collection` des intersections du parcours.
 * La dernière intersection d'une étape est aussi la première de la
 * suivante : on déduplique par coordonnées.
 */
function extractTollCollections(route: DrivingRoute): RouteTollCollection[] {
    const seen = new Set<string>();
    const collections: RouteTollCollection[] = [];

    for (const leg of route.legs ?? []) {
        for (const step of leg.steps ?? []) {
            for (const intersection of step.intersections ?? []) {
                if (!intersection.toll_collection) continue;
                const key = intersection.location.join(',');
                if (seen.has(key)) continue;
                seen.add(key);
                collections.push({
                    location: intersection.location,
                    kind: intersection.toll_collection.type ?? null,
                    name: intersection.toll_collection.name ?? null,
                });
            }
        }
    }

    return collections;
}

export default {
    extractTollCollections,
    async getRoute(coordinates: Feature[], options = {}): Promise<DrivingRouteResponse> {
        const coords = coordinates.map(c => c.center.join(',')).join(';');
        const params = new URLSearchParams({
            access_token: MAPBOX_TOKEN,
            geometries:   'geojson',
            overview:     'full',
            steps:        'true',
            annotations:  'duration,distance',
            language:     'fr',
            ...options,
        });
        const res = await fetch(`${DIRECTIONS_BASE}/${coords}?${params}`);
        if (!res.ok) throw new Error(`Directions API error: ${res.status}`);
        return res.json();
    },
    async geocodeSuggestions(query: string): Promise<Feature[]> {
        if (!query || query.trim().length < 2) return [];
        const params = new URLSearchParams({
            access_token: MAPBOX_TOKEN,
            country:      'fr,es',
            types:        'address,place,poi',
            language:     'fr',
            limit:        '5',
        });
        const encoded = encodeURIComponent(query.trim());
        const res = await fetch(`${GEOCODING_BASE}/${encoded}.json?${params}`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.features || [];
    }
};
