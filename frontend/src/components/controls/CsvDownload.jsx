import { useState } from 'react';
import { Download, Check } from 'lucide-react';
import { useFD } from '../../hooks/FireDataContext';
import { regionName } from '../../data/constants';
import { rangeYears } from '../../data/presets';

/**
 * Descarga CSV según el filtro del mapa: país y rango de años elegidos,
 * con un registro por día (sin selector de agregación).
 */
export default function CsvDownload({ compact = false }) {
  const fd = useFD();
  const [done, setDone] = useState(false);
  const ready = Boolean(fd.daily.data && fd.range);
  const [a, b] = fd.range ? rangeYears(fd.range) : [];
  const years = a === b ? `${a}` : `${a}–${b}`;

  const go = () => {
    fd.downloadCSV('Día');
    setDone(true);
    setTimeout(() => setDone(false), 1600);
  };

  return (
    <button
      onClick={go}
      disabled={!ready}
      title={ready ? `Datos diarios de ${regionName(fd.region)}, ${years}` : fd.region ? 'Cargando datos…' : 'Elegí un país primero'}
      className={`btn-secondary text-sm disabled:opacity-50 disabled:cursor-wait ${compact ? 'h-9 px-4 !ring-white/25' : 'w-full h-9'}`}
    >
      {done ? <Check className="w-4 h-4" /> : <Download className="w-4 h-4" />}
      {done ? 'Descargado' : `Descargar CSV${ready ? ` · ${years}` : ''}`}
    </button>
  );
}
