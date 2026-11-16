import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { MapPin, CalendarRange, CalendarDays, BarChart3, FileDown, Info, Search, ChevronUp } from 'lucide-react';
import { useFD } from '../../hooks/FireDataContext';
import { fmtDate, regionName } from '../../data/constants';
import CountrySearch from './CountrySearch';
import CsvDownload from './CsvDownload';
import YearRangeBar from './YearRangeBar';

function Section({ icon: Icon, title, children, className = 'shrink-0' }) {
  return (
    <section className={`px-4 py-2.5 border-t border-slate-100 ${className}`}>
      <div className="eyebrow flex items-center gap-1.5 mb-2 shrink-0">
        <Icon className="w-3 h-3 text-brand-500" />
        {title}
      </div>
      {children}
    </section>
  );
}

const EASE = [0.16, 1, 0.3, 1];

/** Panel plegado: una sola burbuja que vuelve a abrir el panel completo. */
function SearchBubble({ fd, onOpen }) {
  const { regionInfo, range } = fd;
  return (
    <motion.button
      key="bubble"
      initial={{ opacity: 0, scale: 0.9, x: -8 }}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      onClick={onOpen}
      aria-expanded={false}
      className="glass !rounded-full pointer-events-auto self-start flex items-center gap-2.5 pl-3.5 pr-4 h-11 text-sm font-semibold text-brand-900 hover:ring-2 hover:ring-brand-300 hover:shadow-brand transition-shadow"
    >
      <Search className="w-4 h-4 text-brand-600" />
      Buscar ubicación
      {regionInfo && range && (
        <span className="text-[11px] font-mono font-medium text-brand-600 bg-brand-50 ring-1 ring-brand-100 rounded-full px-2 py-0.5">
          {regionInfo.region} · {range.start.slice(0, 4)}–{range.end.slice(0, 4)}
        </span>
      )}
    </motion.button>
  );
}

/**
 * Panel del mapa: país → CSV → rango de años → accesos a Calendario y
 * Estadísticas. Es el único lugar donde se cambian país y fechas. Arranca
 * abierto y se puede plegar a una burbuja de búsqueda.
 */
export default function ControlPanel({ open, setOpen }) {
  const fd = useFD();
  const navigate = useNavigate();
  const { regionInfo, range } = fd;
  const go = (vista) => navigate(`/Calender-Statistics?vista=${vista}`);

  return (
    <AnimatePresence initial={false} mode="popLayout">
      {!open ? <SearchBubble fd={fd} onOpen={() => setOpen(true)} /> : (
    <motion.aside
      key="panel"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="glass pointer-events-auto w-full md:w-[320px] shrink-0 flex flex-col max-h-full min-h-0 overflow-hidden"
    >
      <button
        onClick={() => setOpen(false)}
        aria-expanded
        title="Plegar el panel"
        className="group shrink-0 flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-brand-900 hover:bg-brand-50/60 transition-colors"
      >
        <MapPin className="w-4 h-4 text-brand-600" />
        Explorar ubicación
        <ChevronUp className="w-4 h-4 ml-auto text-slate-400 group-hover:text-brand-600 transition-colors" />
      </button>

      {/* Si falta altura, solo se desplaza la lista de países: años y botones quedan visibles */}
      <Section icon={MapPin} title="País / Región" className="flex flex-col min-h-[132px] shrink">
        <CountrySearch regions={fd.regions} region={fd.region} setRegion={fd.setRegion} />
      </Section>

      <Section icon={FileDown} title={`Descargar CSV · ${regionName(fd.region)}`}>
        <CsvDownload />
      </Section>

      <Section icon={CalendarRange} title="Rango de años">
        {regionInfo && range ? (
          <YearRangeBar
            period={regionInfo.period}
            range={range}
            yearly={fd.daily.data?.yearlyTotals}
            setYearWindow={fd.setYearWindow}
            setCustomWindow={fd.setCustomWindow}
          />
        ) : (
          <div className="skeleton h-24" />
        )}
      </Section>

      <div className="shrink-0 px-4 pb-3.5 pt-1">
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => go('calendario')} disabled={!regionInfo} className="btn-primary group h-10 text-sm disabled:opacity-50">
            <CalendarDays className="w-4 h-4 transition-transform group-hover:scale-110" /> Calendario
          </button>
          <button onClick={() => go('estadisticas')} disabled={!regionInfo}
            className="btn-secondary group h-10 text-sm disabled:opacity-50">
            <BarChart3 className="w-4 h-4 transition-transform group-hover:scale-110" /> Estadísticas
          </button>
        </div>
        {regionInfo && (
          <p className="flex gap-1.5 text-[10.5px] text-slate-500 mt-2.5 leading-relaxed">
            <Info className="w-3.5 h-3.5 shrink-0 mt-px text-slate-400" />
            <span>
              Ventana activa, <b className="font-semibold text-brand-700">{regionName(fd.region)}</b>: definitivo (SP) hasta {fmtDate(regionInfo.sp_nrt.sp_cutoff)}, provisorio (NRT) hasta {fmtDate(regionInfo.sp_nrt.data_end)}
            </span>
          </p>
        )}
      </div>
    </motion.aside>
      )}
    </AnimatePresence>
  );
}
