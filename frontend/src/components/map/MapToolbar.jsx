import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Minus, Compass, Maximize, Layers, Box, Check } from 'lucide-react';
import { BASEMAPS } from './basemaps';

export default function MapToolbar({ top, map, bearing, onFit, is3D, setIs3D, basemap, setBasemap }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="absolute right-3 md:right-4 z-20 flex items-start gap-2" style={{ top }}>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, x: 12, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 12, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="glass p-2 w-[228px]"
          >
            <div className="eyebrow px-1.5 pb-1.5">Mapa base</div>
            {BASEMAPS.map((b) => (
              <button
                key={b.id}
                onClick={() => { setBasemap(b.id); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 p-1.5 rounded-lg text-left transition-colors ${
                  basemap === b.id ? 'bg-white/10 ring-1 ring-beam/40' : 'hover:bg-white/5'
                }`}
              >
                <img src={b.thumb} alt="" loading="lazy" className="w-10 h-10 rounded-md object-cover ring-1 ring-white/10 bg-white/10" />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-slate-100">{b.label}</span>
                  <span className="block text-[10px] text-slate-400 truncate">{b.desc}</span>
                </span>
                {basemap === b.id && <Check className="w-3.5 h-3.5 text-beam ml-auto shrink-0" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="glass p-1 flex flex-col gap-0.5">
        <button className="tool-btn" title="Acercar" aria-label="Acercar" onClick={() => map?.zoomIn()}><Plus className="w-4 h-4" /></button>
        <button className="tool-btn" title="Alejar" aria-label="Alejar" onClick={() => map?.zoomOut()}><Minus className="w-4 h-4" /></button>
        <button className="tool-btn" title="Orientar al norte" aria-label="Orientar al norte"
          onClick={() => map?.easeTo({ bearing: 0, pitch: is3D ? 55 : 0, duration: 600 })}>
          <Compass className="w-4 h-4 transition-transform" style={{ transform: `rotate(${-bearing - 45}deg)` }} />
        </button>
        <button className="tool-btn" title="Encuadrar región" aria-label="Encuadrar región" onClick={onFit}><Maximize className="w-4 h-4" /></button>
        <div className="h-px bg-white/10 my-0.5 mx-1.5" />
        <button
          className={`tool-btn ${is3D ? 'bg-white text-night-900 ring-1 ring-white hover:bg-white hover:text-night-900' : ''}`}
          title="Vista 3D (altura = actividad)"
          aria-pressed={is3D}
          onClick={() => setIs3D(!is3D)}
        >
          <Box className="w-4 h-4" />
        </button>
        <button
          className={`tool-btn ${open ? 'bg-white text-night-900 ring-1 ring-white hover:bg-white hover:text-night-900' : ''}`}
          title="Mapa base"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Layers className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
