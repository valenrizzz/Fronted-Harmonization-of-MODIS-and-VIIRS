/**
 * mockFireService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates realistic harmonized fire-activity data (2000–2026) for multiple
 * regions.  Each region has its own seasonality curve, baseline intensity,
 * inter-annual variability, and known "historic peak" years.
 *
 * The public API mirrors the shape a FastAPI backend would return so that
 * swapping `fetch('/api/...')` in later is a one-line change.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── helpers ──────────────────────────────────────────────────────────────────
const seed = (s) => {
  let h = s;
  return () => {
    h = (h * 16807 + 0) % 2147483647;
    return (h - 1) / 2147483646;
  };
};

const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const dayOfYear = (y, m, d) => {
  let n = 0;
  for (let i = 0; i < m; i++) n += daysInMonth(y, i);
  return n + d;
};

// ── Region profiles ─────────────────────────────────────────────────────────
const REGIONS = {
  'Global (Todo el Mundo)': {
    baseDaily: 1200,
    seasonality: (doy) => {
      // Two peaks: boreal summer (Jul-Aug) + austral spring (Sep-Nov)
      const p1 = Math.exp(-((doy - 200) ** 2) / 3000);   // ~Jul
      const p2 = Math.exp(-((doy - 270) ** 2) / 4000);   // ~Sep-Oct
      return 0.45 + 0.55 * Math.max(p1, p2);
    },
    peakYears: { 2003: 1.25, 2005: 1.18, 2010: 1.22, 2015: 1.15, 2019: 1.35, 2020: 1.30, 2024: 1.28 },
    center: [10, 0],
    zoom: 2,
    hotspots: [[0, -60], [38, -120], [-15, -55], [-25, 135], [55, 90], [10, 100]],
  },
  'Argentina': {
    baseDaily: 180,
    seasonality: (doy) => {
      // Peak Aug-Oct (dry winter/spring), low Jan-Apr
      const peak = Math.exp(-((doy - 260) ** 2) / 2500);
      const secondary = Math.exp(-((doy - 220) ** 2) / 3500);
      return 0.15 + 0.85 * Math.max(peak, secondary * 0.6);
    },
    peakYears: { 2008: 1.45, 2020: 1.60, 2022: 1.50, 2024: 1.42, 2025: 1.35 },
    center: [-34, -64],
    zoom: 4,
    hotspots: [[-27, -60], [-31, -62], [-24, -63], [-35, -59], [-22, -60]],
  },
  'Brasil - Amazonia Sur': {
    baseDaily: 420,
    seasonality: (doy) => {
      // Severe dry season Jul-Oct
      const peak = Math.exp(-((doy - 250) ** 2) / 2000);
      return 0.08 + 0.92 * peak;
    },
    peakYears: { 2004: 1.30, 2005: 1.25, 2007: 1.28, 2010: 1.45, 2019: 1.55, 2020: 1.50, 2024: 1.40 },
    center: [-8, -55],
    zoom: 5,
    hotspots: [[-9, -56], [-12, -52], [-7, -50], [-10, -58], [-5, -54]],
  },
  'Chile': {
    baseDaily: 65,
    seasonality: (doy) => {
      // Jan-Mar peak (austral summer), rest very low
      const summer = Math.exp(-((doy - 40) ** 2) / 1500);
      return 0.05 + 0.95 * summer;
    },
    peakYears: { 2017: 2.10, 2023: 1.95, 2024: 1.70, 2025: 1.55 },
    center: [-35, -71],
    zoom: 5,
    hotspots: [[-36, -72], [-33, -71], [-38, -73], [-30, -71], [-35, -71]],
  },
  'California - EE.UU.': {
    baseDaily: 95,
    seasonality: (doy) => {
      // Fire season Jul-Nov, Santa Ana winds Oct-Nov
      const main = Math.exp(-((doy - 250) ** 2) / 3000);
      const santaAna = Math.exp(-((doy - 290) ** 2) / 800);
      return 0.05 + 0.7 * main + 0.25 * santaAna;
    },
    peakYears: { 2003: 1.40, 2007: 1.35, 2017: 1.55, 2018: 1.60, 2020: 1.75, 2021: 1.40, 2025: 1.30 },
    center: [37, -120],
    zoom: 6,
    hotspots: [[34, -118], [38, -121], [40, -122], [36, -119], [33, -117]],
  },
  'Australia': {
    baseDaily: 280,
    seasonality: (doy) => {
      // Peak Nov-Feb (austral summer), severe Dec-Jan
      const s1 = Math.exp(-((doy - 15) ** 2) / 1200);     // Jan
      const s2 = Math.exp(-((doy - 345) ** 2) / 1200);    // Dec
      const mid = Math.exp(-((doy - 250) ** 2) / 5000);   // Sep (NT)
      return 0.10 + 0.75 * Math.max(s1, s2) + 0.15 * mid;
    },
    peakYears: { 2002: 1.20, 2006: 1.25, 2009: 1.40, 2013: 1.30, 2019: 1.85, 2020: 1.70, 2024: 1.35 },
    center: [-28, 134],
    zoom: 4,
    hotspots: [[-33, 150], [-37, 145], [-25, 133], [-20, 145], [-30, 120]],
  },
};

// ── Data generator ──────────────────────────────────────────────────────────
function generateDailyData(regionKey) {
  const profile = REGIONS[regionKey];
  if (!profile) throw new Error(`Unknown region: ${regionKey}`);

  const rng = seed(
    regionKey.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 137,
  );

  const data = {}; // { [year]: { [month0]: [ {day, count, frp, isHot} ... ] } }
  const startYear = 2000;
  const endYear = 2026;

  for (let y = startYear; y <= endYear; y++) {
    data[y] = {};
    const yearMul = profile.peakYears[y] || (0.85 + rng() * 0.30);

    // For 2026, only generate up to November 15
    const maxMonth = y === 2026 ? 10 : 11; // 0-indexed, 10 = November

    for (let m = 0; m <= maxMonth; m++) {
      const days = daysInMonth(y, m);
      const maxDay = (y === 2026 && m === 10) ? 15 : days;
      data[y][m] = [];

      for (let d = 1; d <= maxDay; d++) {
        const doy = dayOfYear(y, m, d);
        const seasonal = profile.seasonality(doy);
        const noise = 0.5 + rng() * 1.0;
        // Weekly dip on weekends is not a real thing for fire but adds texture
        const dayOfWeek = new Date(y, m, d).getDay();
        const weekendFactor = (dayOfWeek === 0 || dayOfWeek === 6) ? 0.92 : 1.0;
        
        let count = Math.round(
          profile.baseDaily * seasonal * yearMul * noise * weekendFactor,
        );

        // Ensure minimum 0
        count = Math.max(0, count);

        // In very low season, force more zeros
        if (seasonal < 0.20 && rng() < 0.35) count = 0;
        if (seasonal < 0.10 && rng() < 0.55) count = 0;

        const frp = count > 0
          ? Math.round((15 + rng() * 85 + (count > profile.baseDaily * 0.8 ? rng() * 60 : 0)) * 10) / 10
          : 0;

        data[y][m].push({
          day: d,
          count,
          frp,
        });
      }
    }
  }

  return data;
}

// ── Percentile computation ──────────────────────────────────────────────────
function computePercentiles(dailyData) {
  // Collect all nonzero daily counts
  const allCounts = [];
  Object.values(dailyData).forEach((year) =>
    Object.values(year).forEach((month) =>
      month.forEach((d) => { if (d.count > 0) allCounts.push(d.count); }),
    ),
  );
  allCounts.sort((a, b) => a - b);

  const pct = (p) => {
    const idx = Math.floor(p * allCounts.length);
    return allCounts[Math.min(idx, allCounts.length - 1)] || 0;
  };

  return {
    p50: pct(0.5),
    p75: pct(0.75),
    p90: pct(0.90),
    p95: pct(0.95),
    max: allCounts[allCounts.length - 1] || 0,
  };
}

// ── Monthly aggregations ────────────────────────────────────────────────────
function computeMonthlyTotals(dailyData) {
  const result = {};
  for (const [y, months] of Object.entries(dailyData)) {
    result[y] = {};
    for (const [m, days] of Object.entries(months)) {
      result[y][m] = days.reduce((s, d) => s + d.count, 0);
    }
  }
  return result;
}

// ── Yearly aggregations ─────────────────────────────────────────────────────
function computeYearlyTotals(dailyData) {
  const result = {};
  for (const [y, months] of Object.entries(dailyData)) {
    result[y] = Object.values(months)
      .flat()
      .reduce((s, d) => s + d.count, 0);
  }
  return result;
}

// ── Median by month (across years) ──────────────────────────────────────────
function computeMedianByMonth(monthlyTotals) {
  const byMonth = {};
  for (let m = 0; m < 12; m++) byMonth[m] = [];
  for (const [, months] of Object.entries(monthlyTotals)) {
    for (const [m, total] of Object.entries(months)) {
      byMonth[m].push(total);
    }
  }
  const result = {};
  for (let m = 0; m < 12; m++) {
    const sorted = [...byMonth[m]].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    result[m] = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return result;
}

// ── Historical median total (per year) ──────────────────────────────────────
function computeMedianYearly(yearlyTotals) {
  const values = Object.values(yearlyTotals).sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : Math.round((values[mid - 1] + values[mid]) / 2);
}

// ── Top years ───────────────────────────────────────────────────────────────
function topYears(yearlyTotals, n = 5) {
  return Object.entries(yearlyTotals)
    .map(([y, total]) => ({ year: Number(y), total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, n);
}

// ── CSV generator ───────────────────────────────────────────────────────────
const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function generateCSV(dailyData, region, aggregation = 'Día') {
  const rows = [['Región', 'Fecha', 'Focos', 'FRP_Promedio']];

  if (aggregation === 'Día') {
    for (const [y, months] of Object.entries(dailyData)) {
      for (const [m, days] of Object.entries(months)) {
        for (const d of days) {
          const date = `${y}-${String(Number(m) + 1).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
          rows.push([region, date, d.count, d.frp]);
        }
      }
    }
  } else if (aggregation === 'Mes') {
    for (const [y, months] of Object.entries(dailyData)) {
      for (const [m, days] of Object.entries(months)) {
        const total = days.reduce((s, d) => s + d.count, 0);
        const avgFrp = days.filter(d => d.count > 0).length > 0
          ? Math.round(days.reduce((s, d) => s + d.frp, 0) / days.filter(d => d.count > 0).length * 10) / 10
          : 0;
        rows.push([region, `${y}-${String(Number(m) + 1).padStart(2, '0')}`, total, avgFrp]);
      }
    }
  } else if (aggregation === 'Semana') {
    // Group by ISO week approximation
    for (const [y, months] of Object.entries(dailyData)) {
      const weekMap = {};
      for (const [m, days] of Object.entries(months)) {
        for (const d of days) {
          const dt = new Date(Number(y), Number(m), d.day);
          const weekNum = Math.ceil(dayOfYear(Number(y), Number(m), d.day) / 7);
          const key = `${y}-S${String(weekNum).padStart(2, '0')}`;
          if (!weekMap[key]) weekMap[key] = { count: 0, frpSum: 0, frpN: 0 };
          weekMap[key].count += d.count;
          if (d.count > 0) { weekMap[key].frpSum += d.frp; weekMap[key].frpN++; }
        }
      }
      for (const [wk, v] of Object.entries(weekMap)) {
        rows.push([region, wk, v.count, v.frpN > 0 ? Math.round(v.frpSum / v.frpN * 10) / 10 : 0]);
      }
    }
  } else if (aggregation === 'Año') {
    const yt = computeYearlyTotals(dailyData);
    for (const [y, total] of Object.entries(yt)) {
      rows.push([region, y, total, '']);
    }
  } else {
    // Total crudo — everything on one row per day, no aggregation
    return generateCSV(dailyData, region, 'Día');
  }

  return rows.map((r) => r.join(',')).join('\n');
}

// ── Cache ───────────────────────────────────────────────────────────────────
const _cache = {};

function getRegionData(regionKey) {
  if (_cache[regionKey]) return _cache[regionKey];

  const daily = generateDailyData(regionKey);
  const percentiles = computePercentiles(daily);
  const monthlyTotals = computeMonthlyTotals(daily);
  const yearlyTotals = computeYearlyTotals(daily);
  const medianByMonth = computeMedianByMonth(monthlyTotals);
  const medianYearly = computeMedianYearly(yearlyTotals);
  const top = topYears(yearlyTotals);
  const profile = REGIONS[regionKey];

  const result = {
    regionKey,
    daily,
    percentiles,
    monthlyTotals,
    yearlyTotals,
    medianByMonth,
    medianYearly,
    topYears: top,
    center: profile.center,
    zoom: profile.zoom,
    hotspots: profile.hotspots,
  };

  _cache[regionKey] = result;
  return result;
}

// ── Public API ──────────────────────────────────────────────────────────────
export {
  REGIONS,
  MONTH_NAMES,
  getRegionData,
  generateCSV,
  computePercentiles,
  computeMonthlyTotals,
  computeYearlyTotals,
  computeMedianByMonth,
  computeMedianYearly,
  topYears,
};

export const REGION_KEYS = Object.keys(REGIONS);

export const SATELLITE_SOURCES = [
  { id: 'harmonized', label: 'Satélite Virtual Global (Armonizado)', active: true },
  { id: 'modis', label: 'MODIS', active: false },
  { id: 'viirs-snpp', label: 'VIIRS S-NPP', active: false },
  { id: 'noaa-20', label: 'NOAA-20', active: false },
  { id: 'noaa-21', label: 'NOAA-21', active: false },
];
