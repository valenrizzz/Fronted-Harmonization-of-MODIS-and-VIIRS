/**
 * Ventanas temporales globales. Todas se recortan al período real de la región,
 * así la ventana nunca queda vacía ni excede los datos disponibles.
 */
export const VIIRS_START = '2012-01-20'; // primer día de VIIRS S-NPP en FIRMS

export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const clamp = (iso, { start, end }) => (iso < start ? start : iso > end ? end : iso);

/** Ventana {start, end, preset} para un preset, un año (`year:2019`) o un rango propio. */
export function resolveWindow(preset, period, custom) {
  if (preset === 'recent') {
    // Ventana inicial: los dos últimos años calendario (coincide con lo que muestra la barra de años)
    const y = Number(period.end.slice(0, 4));
    return { preset, start: clamp(`${y - 1}-01-01`, period), end: period.end };
  }
  if (preset === 'viirs') return { preset, start: clamp(VIIRS_START, period), end: period.end };
  if (preset.startsWith('year:')) {
    const y = preset.slice(5);
    return { preset, start: clamp(`${y}-01-01`, period), end: clamp(`${y}-12-31`, period) };
  }
  if (preset === 'custom' && custom) {
    const start = clamp(custom.start, period);
    const end = clamp(custom.end, period);
    return { preset, start: start <= end ? start : end, end: start <= end ? end : start };
  }
  return { preset: 'all', start: period.start, end: period.end };
}

/** Años [inicial, final] de una ventana. */
export const rangeYears = (r) => [Number(r.start.slice(0, 4)), Number(r.end.slice(0, 4))];
export const inRange = (y, r) => { const [a, b] = rangeYears(r); return y >= a && y <= b; };
