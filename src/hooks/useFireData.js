import { useState, useMemo, useCallback } from 'react';
import { getRegionData, generateCSV, REGION_KEYS, SATELLITE_SOURCES } from '../data/mockFireService';

export function useFireData() {
  const [region, setRegion] = useState('Global (Todo el Mundo)');
  const [province, setProvince] = useState('');
  const [city, setCity] = useState('');
  const [year, setYear] = useState(2025);
  const [satellites, setSatellites] = useState(SATELLITE_SOURCES);
  const [dateRange, setDateRange] = useState({ from: '2000-01', to: '2026-11' });

  const data = useMemo(() => getRegionData(region), [region]);

  const yearData = useMemo(() => {
    if (!data.daily[year]) return null;
    return data.daily[year];
  }, [data, year]);

  // Location breadcrumb string
  const locationLabel = useMemo(() => {
    const parts = [region];
    if (province) parts.push(province);
    if (city) parts.push(city);
    return parts.join(' · ');
  }, [region, province, city]);

  const handleRegionChange = useCallback((newRegion) => {
    setRegion(newRegion);
    setProvince('');
    setCity('');
  }, []);

  const toggleSatellite = useCallback((id) => {
    setSatellites((prev) =>
      prev.map((s) => (s.id === id ? { ...s, active: !s.active } : s)),
    );
  }, []);

  const downloadCSV = useCallback(
    (aggregation = 'Día') => {
      const csv = generateCSV(data.daily, region, aggregation);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fire_data_${region.replace(/\s/g, '_')}_${aggregation}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    [data, region],
  );

  const scrollToCalendar = useCallback(() => {
    document.getElementById('calendar-section')?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  return {
    region,
    setRegion: handleRegionChange,
    province,
    setProvince,
    city,
    setCity,
    locationLabel,
    year,
    setYear,
    satellites,
    toggleSatellite,
    dateRange,
    setDateRange,
    data,
    yearData,
    downloadCSV,
    scrollToCalendar,
    regionKeys: REGION_KEYS,
  };
}
