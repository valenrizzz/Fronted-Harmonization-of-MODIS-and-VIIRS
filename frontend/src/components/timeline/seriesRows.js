/**
 * Prepara la serie mensual de la API para el gráfico.
 *
 * - Meses SP / NRT: valor armonizado con su banda IC 95 %.
 * - Meses con `reliability_tier = low`: se muestra el conteo ORIGINAL de NASA
 *   FIRMS (`nasa_detections`), sin corrección, porque el factor de calibración
 *   en esos meses no es confiable. El armonizado queda solo como referencia.
 */
const DAY_MS = 864e5;
const MONTH_MS = 31 * DAY_MS;

export function buildRows(points = []) {
  const rows = points.map((p) => {
    const harmonized = p.events_harmonized_gapfilled ?? p.events_harmonized;
    const lo = p.gapfilled_ci_low ?? p.ci_low;
    const hi = p.gapfilled_ci_high ?? p.ci_high;
    const raw = p.reliability_tier === 'low' && p.nasa_detections != null;
    const nrt = p.layer !== 'SP';
    const v = raw ? p.nasa_detections : harmonized;
    return {
      ts: Date.parse(`${p.date}T00:00:00Z`),
      date: p.date,
      v,
      harmonized,
      nasa: p.nasa_detections ?? null,
      isRaw: raw,
      band: !raw && lo != null && hi != null ? [lo, hi] : null,
      sp: !raw && !nrt ? v : null,
      nrt: !raw && nrt ? v : null,
      raw: raw ? v : null,
      tier: p.reliability_tier,
      layer: p.layer,
      coverage: p.coverage_frac,
      observed: p.events_observed,
      daysDown: p.days_with_satellite_down ?? 0,
      status: p.status,
    };
  });
  // La línea provisoria arranca en el último punto definitivo para no dejar hueco
  const i = rows.findIndex((r) => r.nrt != null);
  if (i > 0 && rows[i - 1].sp != null) rows[i - 1].nrt = rows[i - 1].v;
  return rows;
}

/**
 * Tramos contiguos que cumplen `pred`, como {x1, x2} en el eje X.
 * Tramos separados por menos de `gapMonths` se fusionan (evita "flecos").
 */
export function spans(rows, pred, gapMonths = 0) {
  const out = [];
  let cur = null;
  rows.forEach((r, i) => {
    if (pred(r)) {
      if (!cur) cur = { x1: r.ts, first: r.date, n: 0 };
      cur.x2 = rows[i + 1]?.ts ?? r.ts + MONTH_MS;
      cur.last = r.date;
      cur.n += 1;
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  });
  if (cur) out.push(cur);
  if (!gapMonths) return out;
  const merged = [];
  for (const s of out) {
    const prev = merged[merged.length - 1];
    if (prev && s.x1 - prev.x2 <= gapMonths * MONTH_MS) {
      prev.x2 = s.x2;
      prev.last = s.last;
      prev.n += s.n;
    } else merged.push({ ...s });
  }
  return merged;
}

export const endOfMonth = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export const isoOf = (ts) => new Date(ts).toISOString().slice(0, 10);
export const tsOf = (iso) => Date.parse(`${iso}T00:00:00Z`);
export { DAY_MS };
