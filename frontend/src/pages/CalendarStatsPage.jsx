import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, BarChart3, LineChart, Flame, Lock } from 'lucide-react';
import { useFD } from '../hooks/FireDataContext';
import { fmtDate, regionName } from '../data/constants';
import { inRange, rangeYears } from '../data/presets';
import Navbar from '../components/layout/Navbar';
import CsvDownload from '../components/controls/CsvDownload';
import KpiStrip from '../components/kpi/KpiStrip';
import CalendarTab from '../components/timeline/CalendarTab';
import SeriesTab from '../components/timeline/SeriesTab';
import ComparisonTab from '../components/timeline/ComparisonTab';

const reveal = (i) => ({ initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.45, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] } });

function Panel({ icon: Icon, title, sub, children, i = 0 }) {
  return (
    <motion.section {...reveal(i)} className="card p-4 md:p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-brand-900"><Icon className="w-4 h-4 text-brand-500" />{title}</h2>
      {sub && <p className="text-xs text-slate-500 mt-0.5 mb-3">{sub}</p>}
      {children}
    </motion.section>
  );
}

/**
 * Ruta "/Calender-Statistics?vista=calendario|estadisticas". Solo lectura:
 * país y fechas se eligen en el mapa. El año del calendario/comparativa es local.
 */
export default function CalendarStatsPage() {
  const fd = useFD();
  // La vista se elige desde la barra principal (Calendario / Estadísticas)
  const [params] = useSearchParams();
  const view = params.get('vista') === 'estadisticas' ? 'estadisticas' : 'calendario';
  const [year, setYear] = useState(fd.year);

  // El año en foco siempre cae dentro del rango elegido en el mapa
  useEffect(() => {
    if (fd.range && (year == null || !inRange(year, fd.range))) setYear(rangeYears(fd.range)[1]);
  }, [fd.range, year]);
  // Estas vistas usan la región completa, no el recorte del mapa
  useEffect(() => { fd.setViewport(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, [view]);

  return (
    <div className="min-h-[100dvh]">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-5">
        <motion.header {...reveal(0)} className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link to="/" className="group inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors">
              <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" /> Volver al mapa
            </Link>
            <h1 className="font-display text-2xl md:text-3xl font-bold text-white mt-1">
              {view === 'calendario' ? 'Calendario' : 'Estadísticas'} · <span className="text-fire-300">{regionName(fd.region)}</span>
            </h1>
            {fd.range && (
              <p className="flex items-center gap-1.5 text-sm text-slate-300 mt-1" title="Para cambiar país o fechas, volvé al mapa">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                Ventana elegida en el mapa: <span className="font-mono text-white">{fmtDate(fd.range.start)} → {fmtDate(fd.range.end)}</span>
              </p>
            )}
          </div>
          <div className="flex items-end">
            <CsvDownload compact />
          </div>
        </motion.header>

        {/* Solo animación de entrada: una salida en modo "wait" podía trabar la navegación */}
        <motion.div key={view} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }} className="space-y-5">
            {view === 'calendario' ? (
              <Panel icon={Flame} title={`Calendario de actividad · ${year ?? ''}`} i={1}
                sub="Focos armonizados por día (región completa), solo para los años del rango elegido en el mapa.">
                <CalendarTab fd={fd} year={year} onYear={setYear} />
              </Panel>
            ) : (
              <>
                <KpiStrip fd={fd} />
                <Panel icon={LineChart} title="Serie temporal" i={1} sub="Actividad mensual del rango elegido, con intervalo de confianza del 95 %.">
                  <div className="h-[360px]"><SeriesTab fd={fd} /></div>
                </Panel>
                <Panel icon={BarChart3} title={`Comparativa histórica · ${year ?? ''}`} i={2}
                  sub="Año en foco frente a la mediana histórica, anomalía y años más activos dentro del rango. Clic en una barra para cambiar el año en foco.">
                  <div className="lg:h-[300px]"><ComparisonTab fd={fd} year={year} onYear={setYear} /></div>
                </Panel>
              </>
            )}
        </motion.div>

        <footer className="text-center text-[11px] text-slate-400/80 pb-4">
          ViSU · Datos: NASA FIRMS (MODIS + VIIRS) armonizados · fechas en día solar local
          {fd.regionInfo && ` · calibración ${fd.regionInfo.calibration_version}`}
        </footer>
      </main>
    </div>
  );
}
