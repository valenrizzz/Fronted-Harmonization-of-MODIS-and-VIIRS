import { useCallback } from 'react';
import { Flame } from 'lucide-react';
import { MONTH_NAMES } from '../data/mockFireService';

// ── Earth & Sunlit Ember color scale ────────────────────────────────────────
const SCALE = [
  '#F5F5F4',  // 0 — empty / stone-100
  '#FEF3C7',  // very low — cream
  '#FDE68A',  // low — light gold
  '#FCD34D',  // low-mid — amber
  '#FBBF24',  // mid — golden
  '#FB923C',  // mid-high — orange
  '#F97316',  // high — bright orange
  '#EA580C',  // hot — terracotta
  '#C2410C',  // very hot — dark terracotta
  '#9A3412',  // critical — crimson-brown
  '#7C2D12',  // extreme — darkest
];

function getColor(count, maxCount) {
  if (count === 0) return SCALE[0];
  const ratio = Math.min(count / maxCount, 1);
  const idx = Math.min(Math.floor(Math.pow(ratio, 0.55) * (SCALE.length - 1)) + 1, SCALE.length - 1);
  return SCALE[idx];
}

function textColor(count, maxCount) {
  if (count === 0) return 'transparent';
  const ratio = Math.min(count / maxCount, 1);
  return ratio > 0.4 ? '#FFFFFF' : '#1C1917';
}

export default function DayCell({ day, maxCount, p90, year, month, medianByMonth, setTooltip }) {
  const bg = getColor(day.count, maxCount);
  const fg = textColor(day.count, maxCount);
  const isHot = day.count >= p90 && day.count > 0;
  const daysInMo = new Date(year, month + 1, 0).getDate();
  const medianDailyApprox = (medianByMonth?.[month] || 1) / daysInMo;
  const pctOfMedian = medianDailyApprox > 0
    ? Math.round((day.count / medianDailyApprox) * 100)
    : 0;

  const handleMouse = useCallback((e) => {
    if (day.count === 0) { setTooltip(null); return; }
    setTooltip({
      x: e.clientX, y: e.clientY,
      date: `${day.day} ${MONTH_NAMES[month]} ${year}`,
      count: day.count, frp: day.frp,
      pctMedian: `${pctOfMedian}% de la mediana diaria`,
    });
  }, [day, month, year, pctOfMedian, setTooltip]);

  return (
    <div
      className={`aspect-square rounded-[4px] flex items-center justify-center relative cursor-default transition-all duration-75 ${
        day.count === 0 ? 'border border-stone-200/60' : ''
      } ${isHot ? 'ring-1.5 ring-red-500/50 shadow-sm shadow-red-300/30' : ''}`}
      style={{ backgroundColor: bg }}
      onMouseMove={handleMouse}
      onMouseLeave={() => setTooltip(null)}
    >
      {day.count > 0 && (
        <span className="text-[7px] font-semibold leading-none font-mono select-none" style={{ color: fg }}>
          {day.count >= 10000 ? `${Math.round(day.count / 1000)}k` : day.count >= 1000 ? `${(day.count / 1000).toFixed(1)}k` : day.count}
        </span>
      )}
      {isHot && (
        <Flame className="absolute -top-1 -right-1 w-2.5 h-2.5 text-red-500 drop-shadow-sm" fill="currentColor" />
      )}
    </div>
  );
}
