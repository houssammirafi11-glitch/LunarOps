import { CandidateSite, ComparisonResponse, LunarEvaluationResult } from "./types";
import { analyzeSiteVisibility } from "./astronomical";
import { generateNarrativeSummary } from "./narrative";

/**
 * Resolves the backend base URL.
 * Supports NEXT_PUBLIC_BACKEND_URL (e.g. AWS CloudFront / EC2 / ngrok),
 * defaulting to the local FastAPI backend at http://localhost:8000.
 */
export function getBackendBaseUrl(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_BACKEND_URL) {
    return process.env.NEXT_PUBLIC_BACKEND_URL.replace(/\/+$/, "");
  }
  return "http://localhost:8000";
}

/**
 * Evaluates a single lunar coordinate at a given timestamp using NASA JPL SPICE (spiceypy-de421).
 * Calls FastAPI backend: POST /api/lunar-evaluation.
 * Falls back to local calculations if network request fails.
 */
export async function evaluateLunarSite(
  latitude: number,
  longitude: number,
  timestamp?: string
): Promise<LunarEvaluationResult> {
  const baseUrl = getBackendBaseUrl();
  const isoTime = timestamp || new Date().toISOString();

  try {
    const res = await fetch(`${baseUrl}/api/lunar-evaluation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        latitude,
        longitude,
        timestamp: isoTime,
      }),
    });

    if (res.ok) {
      const data: LunarEvaluationResult = await res.json();
      return data;
    }
    console.warn(`[LunarOps API] Backend returned status ${res.status}, falling back.`);
  } catch (err) {
    console.warn(`[LunarOps API] Failed to reach backend at ${baseUrl}:`, err);
  }

  // Graceful fallback if backend is unreachable
  return {
    sunlight_percentage: 50.0,
    earth_los_percentage: 50.0,
    mission_viability_score: 50.0,
    recommendation_text: `[Offline Fallback] Evaluated coordinates (${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°). Connect to FastAPI backend for live JPL SPICE ephemeris.`,
    instant_sun_elevation_deg: 0.0,
    instant_earth_elevation_deg: 0.0,
    is_sun_visible_now: false,
    is_earth_visible_now: true,
    site_elevation_km: 1.0,
    evaluation_window_days: 30,
    engine: "offline-fallback",
    computed_at: new Date().toISOString(),
  };
}

/**
 * Computes side-by-side time-series landing site comparison.
 * Attempts to call FastAPI POST /api/compare, falling back to client-side TS if offline.
 */
export async function fetchComparison(
  siteA: CandidateSite,
  siteB: CandidateSite,
  startDateStr: string,
  endDateStr: string,
  stepHours: number
): Promise<ComparisonResponse> {
  const baseUrl = getBackendBaseUrl();
  const start = new Date(`${startDateStr}T00:00:00Z`);
  const end = new Date(`${endDateStr}T23:59:59Z`);

  try {
    const res = await fetch(`${baseUrl}/api/compare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        siteAId: siteA.id,
        siteBId: siteB.id,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        stepHours,
      }),
    });

    if (res.ok) {
      const data: ComparisonResponse = await res.json();
      return data;
    }
  } catch (err) {
    console.warn(`[LunarOps API] FastAPI compare unreachable, falling back to client engine:`, err);
  }

  // Client-side fallback
  const siteAResult = analyzeSiteVisibility(siteA, start, end, stepHours);
  const siteBResult = analyzeSiteVisibility(siteB, start, end, stepHours);
  const narrative = generateNarrativeSummary(siteAResult, siteBResult, startDateStr, endDateStr);

  return {
    siteA: siteAResult,
    siteB: siteBResult,
    dateRange: { start: start.toISOString(), end: end.toISOString(), stepHours },
    generatedAt: new Date().toISOString(),
    summaryNarrative: narrative,
    engine: "typescript-client",
  };
}
