/**
 * Convierte la serie diaria de la API en las estructuras que usa la UI.
 * Las estadísticas históricas (medianas, percentiles, ranking) usan solo
 * meses/años completos; los años parciales (inicio y fin del registro) se
 * comparan contra la misma ventana de fechas de los años completos.
 */
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

const quantile = (sorted, q) => {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

export function buildRegionData(points) {
  const daily = {};
  const values = [];
  for (const p of points) {
    const [y, m, d] = p.date.split('-').map(Number);
    const noData = p.status === 'no_data';
    const h = noData ? null : p.events_harmonized ?? 0;
    ((daily[y] ??= {})[m - 1] ??= []).push({
      day: d,
      date: p.date,
      count: h == null ? 0 : Math.round(h),
      harmonized: h,
      observed: noData ? null : p.events_observed,
      ciLow: p.ci_low,
      ciHigh: p.ci_high,
      tier: p.reliability_tier,
      layer: p.layer,
      status: p.status,
    });
    if (h > 0) values.push(h);
  }
  values.sort((a, b) => a - b);

  const monthlyTotals = {};
  const completeMonths = {};
  const yearlyTotals = {};
  const completeYears = [];
  for (const [ys, months] of Object.entries(daily)) {
    const y = Number(ys);
    monthlyTotals[y] = {};
    completeMonths[y] = {};
    for (const [ms, days] of Object.entries(months)) {
      monthlyTotals[y][ms] = days.reduce((s, d) => s + (d.harmonized || 0), 0);
      completeMonths[y][ms] = days.length === daysInMonth(y, Number(ms));
    }
    yearlyTotals[y] = Object.values(monthlyTotals[y]).reduce((a, b) => a + b, 0);
    if (Object.values(completeMonths[y]).filter(Boolean).length === 12) completeYears.push(y);
  }

  const monthStats = Array.from({ length: 12 }, (_, m) => {
    const vals = Object.keys(monthlyTotals)
      .filter((y) => completeMonths[y][m])
      .map((y) => monthlyTotals[y][m])
      .sort((a, b) => a - b);
    return { p25: quantile(vals, 0.25), median: quantile(vals, 0.5), p75: quantile(vals, 0.75) };
  });

  const yearsSorted = completeYears.map((y) => yearlyTotals[y]).sort((a, b) => a - b);

  return {
    daily,
    years: Object.keys(daily).map(Number).sort((a, b) => a - b),
    percentiles: {
      p50: quantile(values, 0.5), p75: quantile(values, 0.75), p90: quantile(values, 0.9),
      p95: quantile(values, 0.95), max: values[values.length - 1] || 0,
    },
    monthlyTotals,
    completeMonths,
    yearlyTotals,
    completeYears,
    monthStats,
    medianByMonth: Object.fromEntries(monthStats.map((s, m) => [m, s.median])),
    medianYearly: quantile(yearsSorted, 0.5),
    topYears: completeYears
      .map((y) => ({ year: y, total: yearlyTotals[y] }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5),
  };
}

/** Total del año vs. mediana de los años completos en la misma ventana de fechas. */
export function compareYear(data, year) {
  const months = data.daily[year];
  if (!months) return null;
  const days = Object.values(months).flat();
  const first = days[0].date.slice(5);
  const last = days[days.length - 1].date.slice(5);
  const partial = !data.completeYears.includes(year);
  const windowTotal = (y) => Object.values(data.daily[y] || {}).flat()
    .filter((d) => d.date.slice(5) >= first && d.date.slice(5) <= last)
    .reduce((s, d) => s + (d.harmonized || 0), 0);
  const refs = data.completeYears.filter((y) => y !== year).map(windowTotal).sort((a, b) => a - b);
  const total = partial ? windowTotal(year) : data.yearlyTotals[year];
  const median = partial ? quantile(refs, 0.5) : data.medianYearly;
  return {
    total,
    median,
    pct: median > 0 ? Math.round(((total - median) / median) * 100) : null,
    partial,
    window: [first, last],
  };
}
