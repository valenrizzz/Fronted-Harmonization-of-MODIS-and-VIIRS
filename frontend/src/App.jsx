import { Loader2, AlertTriangle, RotateCw } from 'lucide-react';
import Navbar from './components/Navbar';
import WorldMapHero from './components/WorldMapHero';
import FireCalendarSection from './components/FireCalendarSection';
import HistoricalAnalyticsSection from './components/HistoricalAnalyticsSection';
import { useFireData } from './hooks/useFireData';

function StatusPanel({ status, error, retry }) {
  if (status === 'error') {
    return (
      <div className="max-w-xl mx-auto my-10 light-card p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-orange-500 mx-auto mb-2" />
        <p className="font-semibold text-stone-700">No se pudieron cargar los datos</p>
        <p className="text-sm text-stone-500 mt-1">{error}</p>
        <button onClick={retry} className="mt-4 inline-flex items-center gap-2 pill-btn pill-active">
          <RotateCw className="w-3.5 h-3.5" /> Reintentar
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-stone-500 text-sm">
      <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
      Cargando 26 años de actividad de fuego armonizada…
    </div>
  );
}

export default function App() {
  const fd = useFireData();
  const ready = fd.status === 'ready' && fd.data && fd.year;

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <Navbar
        locationLabel={fd.locationLabel}
        regionInfo={fd.regionInfo}
        dateRange={fd.dateRange}
        setDateRange={fd.setDateRange}
      />

      <WorldMapHero
        regions={fd.regions}
        region={fd.region}
        setRegion={fd.setRegion}
        regionInfo={fd.regionInfo}
        year={fd.year}
        scrollToCalendar={fd.scrollToCalendar}
      />

      {ready ? (
        <>
          <FireCalendarSection
            year={fd.year}
            setYear={fd.setYear}
            yearData={fd.yearData}
            data={fd.data}
            region={fd.locationLabel}
          />
          <HistoricalAnalyticsSection
            data={fd.data}
            region={fd.locationLabel}
            year={fd.year}
            summary={fd.summary}
            downloadCSV={fd.downloadCSV}
          />
        </>
      ) : (
        <StatusPanel status={fd.status} error={fd.error} retry={fd.retry} />
      )}

      <footer className="text-center text-[11px] text-stone-400 pb-6 px-4">
        Datos: NASA FIRMS (MODIS + VIIRS) armonizados en una constelación virtual única · fechas en día solar local
        {fd.regionInfo && ` · calibración ${fd.regionInfo.calibration_version}`}
      </footer>
    </div>
  );
}
