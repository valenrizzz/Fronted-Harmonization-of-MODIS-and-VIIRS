/**
 * Cliente de la API de actividad de incendios armonizada (backend/ FastAPI).
 *
 * - Desarrollo: '/api/v1' (Vite lo reenvía a http://127.0.0.1:8000, ver vite.config.js).
 * - Producción: VITE_API_BASE_URL, p. ej. https://fire-harmonized-api.vercel.app/api/v1
 */
const BASE = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function get(path, params = {}, { signal } = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ).toString();
  let res;
  try {
    res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ''}`, { signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('No se pudo conectar con la API de datos', 0);
  }
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try { msg = (await res.json())?.error?.message || msg; } catch { /* cuerpo no JSON */ }
    throw new ApiError(msg, res.status);
  }
  return res.json();
}

export const api = {
  regions: (opts) => get('/regions', {}, opts),
  timeseries: (region, granularity, { start, end, bbox } = {}, opts) =>
    get('/timeseries', { region, granularity, start, end, bbox }, opts),
  summary: (region, { start, end, bbox } = {}, opts) =>
    get('/summary', { region, start, end, bbox }, opts),
  cellsGeojson: (region, { start, end, bbox, zoom, limit } = {}, opts) =>
    get('/spatial/cells', { region, start, end, bbox, zoom, limit, format: 'geojson' }, opts),
};
