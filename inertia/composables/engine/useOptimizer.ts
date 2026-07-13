import { Feature } from '~/composables/map/useMapbox';

/** Coordonnée GeoJSON : [longitude, latitude]. */
export type LngLat = [number, number];

export type RouteGeometry = { type: 'LineString'; coordinates: LngLat[] };

/** Classes tarifaires françaises (1 = véhicule léger … 5 = moto). */
export type VehicleClass = 1 | 2 | 3 | 4 | 5;

export type MatchedTollPoint = {
    tollId: number;
    longitude: number;
    latitude: number;
    distanceMeters: number;
};

export type CrossedStation = {
    stationId: number;
    stationName: string;
    networkId: number | null;
    networkName: string | null;
    alongMeters: number;
    points: MatchedTollPoint[];
};

export type RouteTollSection = {
    networkId: number;
    networkName: string;
    pricingMode: 'open' | 'closed';
    entry: CrossedStation;
    /** null : franchissement d'une barrière en système ouvert (prix fixe). */
    exit: CrossedStation | null;
    priceCents: number | null;
};

export type RoutePricingIssue =
    | { type: 'station-without-network'; station: CrossedStation }
    | { type: 'unpaired-entry'; station: CrossedStation; networkName: string }
    | { type: 'missing-price'; networkName: string; entry: CrossedStation; exit: CrossedStation | null };

export type RoutePricing = {
    totalCents: number;
    complete: boolean;
    crossings: CrossedStation[];
    sections: RouteTollSection[];
    issues: RoutePricingIssue[];
};

export type RouteKind = 'fastest' | 'alternative' | 'no-toll' | 'hybrid';

export type EvaluatedRoute = {
    kind: RouteKind;
    durationSeconds: number;
    distanceMeters: number;
    geometry: RouteGeometry;
    pricing: RoutePricing;
    scoreMinutes: number;
    excludedStations: string[];
};

export type EvaluatedRouteSummary = {
    kind: RouteKind;
    durationSeconds: number;
    distanceMeters: number;
    totalCents: number;
    pricingComplete: boolean;
    issues: RoutePricingIssue[];
    scoreMinutes: number;
    excludedStations: string[];
};

/**
 * Rentabilité d'un tronçon payant de la route rapide : ce que son évitement
 * coûte en temps et rapporte en euros (route d'évitement re-tarifée).
 */
export type SectionDecision = {
    /** Clé stable du tronçon : `entryStationId:exitStationId` (ou `open`). */
    sectionKey: string;
    entryStationName: string;
    exitStationName: string | null;
    networkName: string;
    priceCents: number;
    extraDurationSeconds: number | null;
    savedCents: number | null;
    /** Prix payé par heure gagnée en gardant le péage (0 : l'éviter est gratuit). */
    ratioCentsPerHour: number | null;
    reliable: boolean;
    keptInBest: boolean;
};

export type OptimizeResult = {
    rhoCentsPerMinute: number;
    best: EvaluatedRoute;
    fastest: EvaluatedRoute;
    noToll: EvaluatedRoute | null;
    evaluated: EvaluatedRouteSummary[];
    decisions: SectionDecision[];
    warnings: string[];
};

export type OptimizeOptions = {
    vehicleClass: VehicleClass;
    /** Consentement : payer au plus `maxPriceCents`… */
    maxPriceCents: number;
    /** …pour gagner `minutesSaved` minutes. */
    minutesSaved: number;
};

/** Erreur métier renvoyée par l'endpoint, avec un message affichable. */
export class OptimizeError extends Error {}

/**
 * Jeton XSRF déposé en cookie par Adonis Shield : à renvoyer en en-tête sur
 * toute requête mutante hors formulaires Inertia.
 */
function xsrfToken(): string | null {
    const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}

async function optimize(start: Feature, end: Feature, options: OptimizeOptions): Promise<OptimizeResult> {
    const token = xsrfToken();
    const response = await fetch('/api/optimize', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(token ? { 'X-XSRF-TOKEN': token } : {}),
        },
        body: JSON.stringify({
            start: start.center,
            end: end.center,
            vehicleClass: options.vehicleClass,
            maxPriceCents: options.maxPriceCents,
            minutesSaved: options.minutesSaved,
        }),
    });

    if (!response.ok) {
        throw new OptimizeError(await extractErrorMessage(response));
    }
    return (await response.json()) as OptimizeResult;
}

async function extractErrorMessage(response: Response): Promise<string> {
    const fallback = `Optimisation impossible (HTTP ${response.status})`;
    try {
        // Deux formats possibles : { message } (contrôleur) ou
        // { errors: [{ message }] } (validation VineJS).
        const payload = (await response.json()) as {
            message?: string;
            errors?: { message?: string }[];
        };
        return payload.message ?? payload.errors?.[0]?.message ?? fallback;
    } catch {
        return fallback;
    }
}

export default {
    optimize,
};
