const DIRECTIONS_BASE = 'https://api.mapbox.com/directions/v5/mapbox/driving';
const GEOCODING_BASE  = 'https://api.mapbox.com/geocoding/v5/mapbox.places';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

export type Feature = {
    place_name: string;
    place_type: string[];
    center: [number, number];
}

export type DrivingRoute = {
    distance: number;
    duration: number;
    geometry: {coordinates: [number, number][], type: 'LineString'};
}

export type DrivingRouteResponse = {
    code: string;
    routes: DrivingRoute[];
    uuid: string;
    waypoints: {name: string, location: [number, number], distance: number}[];
}

export default {
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
