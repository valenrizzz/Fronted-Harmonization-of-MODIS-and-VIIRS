import { useEffect, useMemo, useState } from 'react';
import { useFD } from '../hooks/FireDataContext';
import Navbar from '../components/layout/Navbar';
import MapCanvas from '../components/map/MapCanvas';
import ControlPanel from '../components/controls/ControlPanel';
import KpiDropdowns from '../components/kpi/KpiDropdowns';

const mq = () => window.matchMedia('(min-width: 768px)');

function useIsDesktop() {
  const [v, setV] = useState(() => mq().matches);
  useEffect(() => {
    const m = mq();
    const on = () => setV(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return v;
}

/** Ruta "/": mapa a pantalla completa con panel de exploración y KPIs en vivo. */
export default function MapPage() {
  const fd = useFD();
  const desktop = useIsDesktop();
  const insets = useMemo(() => (desktop
    ? { top: 110, left: 360, right: 80, bottom: 24 }
    : { top: 120, left: 24, right: 64, bottom: 24 }), [desktop]);

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden">
      <Navbar />
      <main className="relative flex-1 min-h-0">
        <MapCanvas
          region={fd.region}
          regionInfo={fd.regionInfo}
          range={fd.range}
          insets={insets}
          onViewport={fd.setViewport}
          busy={fd.summary.loading}
        />
        <div className="absolute inset-0 z-30 p-3 md:p-4 flex flex-col md:flex-row md:items-start gap-3 pointer-events-none">
          <div className="pointer-events-auto flex min-h-0 max-h-[72%] md:max-h-full">
            <ControlPanel />
          </div>
          {fd.regionInfo && <div className="flex-1 min-w-0"><KpiDropdowns fd={fd} /></div>}
        </div>
      </main>
    </div>
  );
}
