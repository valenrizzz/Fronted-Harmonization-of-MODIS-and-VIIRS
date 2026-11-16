import { AnimatePresence, motion } from 'framer-motion';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AlertTriangle, RotateCw, Satellite } from 'lucide-react';
import { FireDataProvider, useFD } from './hooks/FireDataContext';
import Brand from './components/layout/Brand';
import MapPage from './pages/MapPage';
import CalendarStatsPage from './pages/CalendarStatsPage';

function Splash() {
  const fd = useFD();
  return (
    <AnimatePresence>
      {fd.status !== 'ready' && (
        <motion.div
          exit={{ opacity: 0, transition: { duration: 0.5 } }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-app"
        >
          <div className="flex flex-col items-center text-center px-6">
            <div className="relative w-28 h-28 mb-5 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full ring-1 ring-white/15" />
              <div className="absolute inset-0 animate-orbit">
                <Satellite className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 text-beam" />
              </div>
              <Brand />
            </div>
            {fd.status === 'error' ? (
              <>
                <AlertTriangle className="w-6 h-6 text-orange-500 mb-2" />
                <p className="font-semibold text-white">No se pudo conectar con la API de datos</p>
                <p className="text-sm text-slate-300 mt-1">{fd.error}</p>
                <button onClick={fd.retry} className="mt-4 pill-btn pill-active inline-flex items-center gap-2">
                  <RotateCw className="w-3.5 h-3.5" /> Reintentar
                </button>
              </>
            ) : (
              <>
                <p className="font-display text-lg text-white">Cargando 26 años de actividad de fuego armonizada</p>
                <p className="text-xs text-slate-400 mt-1">MODIS + VIIRS · NASA FIRMS</p>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Transición de entrada entre rutas. Sin animación de salida a propósito:
 * AnimatePresence en modo "wait" podía quedar trabado (URL nueva, página vieja).
 */
function AnimatedRoutes() {
  const location = useLocation();
  return (
    <motion.div
      key={location.pathname.toLowerCase()}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <Routes>
        <Route path="/" element={<MapPage />} />
        {/* react-router no distingue mayúsculas: /calender-statistics también funciona */}
        <Route path="/Calender-Statistics" element={<CalendarStatsPage />} />
        <Route path="/calendar-statistics" element={<Navigate to="/Calender-Statistics" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </motion.div>
  );
}

export default function App() {
  return (
    <FireDataProvider>
      <AnimatedRoutes />
      <Splash />
    </FireDataProvider>
  );
}
