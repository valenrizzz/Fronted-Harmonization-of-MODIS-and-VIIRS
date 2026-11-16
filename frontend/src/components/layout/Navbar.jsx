import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Map, CalendarDays, BarChart3, MapPin } from 'lucide-react';
import { useFD } from '../../hooks/FireDataContext';
import Brand from './Brand';

const LINKS = [
  { id: 'mapa', to: '/', label: 'Mapa', icon: Map },
  { id: 'calendario', to: '/Calender-Statistics?vista=calendario', label: 'Calendario', icon: CalendarDays },
  { id: 'estadisticas', to: '/Calender-Statistics?vista=estadisticas', label: 'Estadísticas', icon: BarChart3 },
];

/** Vista activa a partir de la URL (la ruta de datos usa ?vista=). */
export function currentView({ pathname, search }) {
  if (pathname === '/') return 'mapa';
  return new URLSearchParams(search).get('vista') === 'estadisticas' ? 'estadisticas' : 'calendario';
}

export default function Navbar() {
  const fd = useFD();
  const location = useLocation();
  const view = currentView(location);

  return (
    <header className="sticky top-0 z-50 h-14 shrink-0 bg-night-900/90 backdrop-blur-md border-b border-white/10">
      {/* Filete institucional: azul ViSU → haz cian → fuego (colores del logo) */}
      <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-brand-500 via-beam to-fire-500" />
      <div className="h-full max-w-[1920px] mx-auto flex items-center gap-3 px-3 md:px-5">
        <Link to="/" aria-label="ViSU · inicio"><Brand /></Link>

        {fd.locationLabel && (
          <span className="hidden md:flex items-center gap-1.5 text-sm text-slate-300 border-l border-white/15 pl-3 ml-1">
            <MapPin className="w-3.5 h-3.5 text-beam" />
            <motion.span key={fd.region} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="font-medium text-white">
              {fd.locationLabel}
            </motion.span>
          </span>
        )}

        <nav className="ml-auto flex items-center gap-1 p-1 rounded-xl bg-white/5 ring-1 ring-white/10" aria-label="Secciones">
          {LINKS.map((l) => {
            const active = view === l.id;
            return (
              <Link key={l.id} to={l.to} aria-current={active ? 'page' : undefined}
                className={`relative flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-medium transition-colors ${active ? 'text-night-900' : 'text-slate-300 hover:text-white hover:bg-white/5'}`}>
                {active && (
                  <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-lg bg-white shadow-night ring-1 ring-white"
                    transition={{ type: 'spring', stiffness: 420, damping: 36 }} />
                )}
                <l.icon className={`relative w-3.5 h-3.5 ${active ? 'text-night-700' : ''}`} />
                <span className="relative hidden sm:inline">{l.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
