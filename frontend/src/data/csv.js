/** Exportación CSV de la serie armonizada (lo que el usuario está viendo). */
const r1 = (v) => (v == null ? '' : Math.round(v * 10) / 10);

function aggregate(days, keyOf) {
  const groups = new Map();
  for (const d of days) {
    const k = keyOf(d);
    const g = groups.get(k) || { h: 0, lo: 0, hi: 0, obs: 0, nasa: 0, noData: 0, layers: new Set() };
    if (d.status === 'no_data') g.noData += 1;
    else {
      g.h += d.harmonized || 0;
      g.lo += d.ciLow || 0;
      g.hi += d.ciHigh || 0;
      g.obs += d.observed || 0;
      g.nasa += d.nasa || 0;
    }
    g.layers.add(d.layer);
    groups.set(k, g);
  }
  return [...groups.entries()].map(([k, g]) => [
    k, r1(g.h), r1(g.lo), r1(g.hi), g.obs, g.layers.size > 1 ? 'MIXED' : [...g.layers][0], g.noData, g.nasa,
  ]);
}

const isoWeekKey = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = d.getUTCFullYear();
  const wk = Math.ceil(((d - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return `${y}-S${String(wk).padStart(2, '0')}`;
};

export function buildCSV(data, regionLabel, level, { start, end } = {}) {
  let days = Object.values(data.daily).flatMap((months) => Object.values(months).flat());
  if (start) days = days.filter((d) => d.date >= start);
  if (end) days = days.filter((d) => d.date <= end);

  let header;
  let rows;
  if (level === 'Día') {
    header = ['fecha', 'focos_armonizados', 'ic95_inf', 'ic95_sup', 'focos_observados', 'capa', 'confiabilidad', 'estado', 'detecciones_nasa'];
    rows = days.map((d) => [d.date, r1(d.harmonized), r1(d.ciLow), r1(d.ciHigh), d.observed ?? '', d.layer, d.tier ?? '', d.status, d.nasa ?? '']);
  } else {
    const keyOf = { Semana: (d) => isoWeekKey(d.date), Mes: (d) => d.date.slice(0, 7), Año: (d) => d.date.slice(0, 4) }[level];
    header = ['periodo', 'focos_armonizados', 'ic95_inf', 'ic95_sup', 'focos_observados', 'capa', 'dias_sin_dato', 'detecciones_nasa'];
    rows = aggregate(days, keyOf);
  }
  return [['region', ...header], ...rows.map((r) => [regionLabel, ...r])]
    .map((r) => r.join(','))
    .join('\n');
}

export function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
