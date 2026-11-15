import { useState, useMemo, useCallback, useEffect } from 'react';
import { api } from '../data/api';
import { regionName } from '../data/constants';
import { buildRegionData } from '../data/transform';
import { buildCSV, downloadText } from '../data/csv';

const seriesCache = new Map(); // región → datos ya transformados

export function useFireData() {
  const [regions, setRegions] = useState([]);
  const [region, setRegion] = useState(null);
  const [data, setData] = useState(null);
  const [year, setYear] = useState(null);
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [reloadKey, setReloadKey] = useState(0);

  const regionInfo = useMemo(() => regions.find((r) => r.region === region) || null, [regions, region]);

  // 1) Regiones disponibles en el backend
  useEffect(() => {
    const ctl = new AbortController();
    setStatus('loading');
    api.regions({ signal: ctl.signal })
      .then((list) => {
        setRegions(list);
        setRegion((cur) => cur || list.find((r) => r.region === 'ARG')?.region || list[0]?.region || null);
        if (!list.length) throw new Error('El backend no tiene regiones cargadas');
      })
      .catch((e) => { if (e.name !== 'AbortError') { setError(e.message); setStatus('error'); } });
    return () => ctl.abort();
  }, [reloadKey]);

  // 2) Serie diaria completa de la región (una sola petición, ~9.500 días)
  useEffect(() => {
    if (!regionInfo) return;
    const ctl = new AbortController();
    const done = (d) => {
      setData(d);
      const last = d.years[d.years.length - 1];
      setYear((y) => (y && d.daily[y] ? y : last));
      setDateRange({ from: regionInfo.period.start.slice(0, 7), to: regionInfo.period.end.slice(0, 7) });
      setStatus('ready');
    };
    if (seriesCache.has(region)) { done(seriesCache.get(region)); return undefined; }
    setStatus('loading');
    api.timeseries(region, 'daily', {}, { signal: ctl.signal })
      .then((ts) => {
        const d = buildRegionData(ts.points);
        seriesCache.set(region, d);
        done(d);
      })
      .catch((e) => { if (e.name !== 'AbortError') { setError(e.message); setStatus('error'); } });
    return () => ctl.abort();
  }, [region, regionInfo]);

  // 3) KPIs del año seleccionado (total con IC, interanual, proporción SP/NRT)
  useEffect(() => {
    if (!region || !year) return;
    const ctl = new AbortController();
    setSummary(null);
    api.summary(region, { start: `${year}-01-01`, end: `${year}-12-31` }, { signal: ctl.signal })
      .then(setSummary)
      .catch(() => {});
    return () => ctl.abort();
  }, [region, year]);

  const label = region ? regionName(region) : '';

  const downloadCSV = useCallback((level = 'Día') => {
    if (!data) return;
    const csv = buildCSV(data, label, level, dateRange);
    const tag = `${dateRange.from || 'inicio'}_${dateRange.to || 'fin'}`;
    downloadText(csv, `focos_armonizados_${region}_${level}_${tag}.csv`);
  }, [data, label, region, dateRange]);

  const scrollToCalendar = useCallback(() => {
    document.getElementById('calendar-section')?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  return {
    status,
    error,
    retry: () => { setError(null); setReloadKey((k) => k + 1); },
    regions,
    region,
    setRegion,
    regionInfo,
    locationLabel: label,
    year,
    setYear,
    data,
    yearData: data && year ? data.daily[year] || null : null,
    summary,
    dateRange,
    setDateRange,
    downloadCSV,
    scrollToCalendar,
  };
}
