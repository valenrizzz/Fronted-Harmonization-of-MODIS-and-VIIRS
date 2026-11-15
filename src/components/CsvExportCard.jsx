import { useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';

const LEVELS = ['Día', 'Semana', 'Mes', 'Año', 'Total crudo'];

export default function CsvExportCard({ downloadCSV }) {
  const [level, setLevel] = useState('Día');

  return (
    <div className="glass-card p-4">
      <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2 mb-3">
        <FileSpreadsheet className="w-4 h-4 text-amber-400" />
        Exportación Granular de CSV
      </h3>

      <div className="flex flex-wrap gap-1 mb-3">
        {LEVELS.map((l) => (
          <button
            key={l}
            onClick={() => setLevel(l)}
            className={`pill-btn text-[10px] ${level === l ? 'pill-active' : 'pill-inactive'}`}
          >
            {l}
          </button>
        ))}
      </div>

      <button
        onClick={() => downloadCSV(level)}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-semibold text-sm transition-all duration-200 shadow-lg shadow-amber-600/20 active:scale-[0.98]"
      >
        <Download className="w-4 h-4" />
        Descargar CSV
      </button>
    </div>
  );
}
