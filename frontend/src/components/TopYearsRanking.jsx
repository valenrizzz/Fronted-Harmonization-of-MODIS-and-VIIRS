import { Trophy } from 'lucide-react';

function formatNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} mil`;
  return n.toLocaleString('es-AR');
}

const MEDALS = ['🥇', '🥈', '🥉', '4°', '5°'];
const BAR_COLORS = [
  'from-red-600 to-amber-500',
  'from-orange-500 to-amber-400',
  'from-amber-500 to-yellow-400',
  'from-yellow-500 to-yellow-300',
  'from-slate-500 to-slate-400',
];

export default function TopYearsRanking({ topYears, region }) {
  const maxTotal = topYears[0]?.total || 1;

  return (
    <div className="glass-card p-4">
      <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2 mb-3">
        <Trophy className="w-4 h-4 text-amber-400" />
        Años más activos en el área
      </h3>

      <div className="space-y-2">
        {topYears.map((item, i) => (
          <div key={item.year} className="flex items-center gap-2">
            <span className="text-sm w-6 text-center shrink-0">{MEDALS[i]}</span>
            <span className="text-xs font-mono text-slate-300 w-10 shrink-0">
              {item.year}
            </span>
            <div className="flex-1 h-5 bg-slate-800/60 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${BAR_COLORS[i]} transition-all duration-500 flex items-center justify-end pr-2`}
                style={{ width: `${(item.total / maxTotal) * 100}%` }}
              >
                <span className="text-[9px] font-bold text-white/90 whitespace-nowrap">
                  {formatNum(item.total)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
