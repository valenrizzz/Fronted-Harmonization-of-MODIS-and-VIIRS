export const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Nombres para mostrar de los códigos ISO3 que publica el backend
const REGION_NAMES = {
  ARG: 'Argentina',
  BRA: 'Brasil',
  CHL: 'Chile',
  BOL: 'Bolivia',
  PRY: 'Paraguay',
  URY: 'Uruguay',
  AUS: 'Australia',
  USA: 'Estados Unidos',
};

/** Orden fijo del selector de países del Cono Sur. */
export const COUNTRY_ORDER = ['ARG', 'BOL', 'CHL', 'PRY', 'URY'];

export const regionName = (code) => REGION_NAMES[code] || code;

export const TIER_LABEL = { high: 'alta', medium: 'media', low: 'baja' };
export const TIER_STYLE = {
  high: 'bg-emerald-400/15 text-emerald-300 ring-emerald-400/30',
  medium: 'bg-sky-400/15 text-sky-300 ring-sky-400/30',
  low: 'bg-violet-400/15 text-violet-300 ring-violet-400/30',
};

/**
 * Rampa de calor compartida por mapa, calendario y leyendas: ámbar → rojo intenso.
 * `t` es la intensidad normalizada (0–1); la opacidad crece con ella para que
 * sobre el fondo oscuro los focos fuertes "brillen" y los débiles se insinúen.
 */
export const FIRE_STOPS = [
  [0, '#FCD34D'],
  [0.3, '#F59E0B'],
  [0.55, '#F97316'],
  [0.8, '#EF4444'],
  [1, '#FF1F1F'],
];
export const FIRE_OPACITY = [0.3, 0.92];

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Color rgba de la rampa para un `t` en [0, 1] (usado fuera del mapa). */
export function fireColor(t, alpha) {
  const x = Math.max(0, Math.min(1, t));
  let i = 1;
  while (i < FIRE_STOPS.length - 1 && FIRE_STOPS[i][0] < x) i += 1;
  const [t0, c0] = FIRE_STOPS[i - 1];
  const [t1, c1] = FIRE_STOPS[i];
  const k = t1 === t0 ? 0 : (x - t0) / (t1 - t0);
  const a = hexToRgb(c0);
  const b = hexToRgb(c1);
  const rgb = a.map((v, j) => Math.round(v + (b[j] - v) * k));
  const op = alpha ?? FIRE_OPACITY[0] + (FIRE_OPACITY[1] - FIRE_OPACITY[0]) * x;
  return `rgba(${rgb.join(',')},${op.toFixed(3)})`;
}

export const FIRE_GRADIENT_CSS = `linear-gradient(90deg, ${FIRE_STOPS.map(([t]) => `${fireColor(t)} ${t * 100}%`).join(', ')})`;

export const fmtCount = (n) => {
  if (n == null || Number.isNaN(n)) return '–';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)} mil`;
  return Math.round(n).toLocaleString('es-AR');
};

export const fmtInt = (n) => (n == null || Number.isNaN(n) ? '–' : Math.round(n).toLocaleString('es-AR'));

export const fmtDate = (iso) => {
  if (!iso) return '–';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
};

export const fmtMonth = (iso) => {
  if (!iso) return '–';
  const [y, m] = iso.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};
