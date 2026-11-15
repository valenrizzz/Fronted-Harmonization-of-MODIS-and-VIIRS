import { useCallback } from 'react';
import { Flame } from 'lucide-react';
import { MONTH_NAMES, emberColor, TIER_LABEL } from '../data/constants';

const NO_DATA_BG = 'repeating-linear-gradient(45deg,#E7E5E4 0 2px,#F5F5F4 2px 5px)';

export default function DayCell({ day, maxCount, p90, year, month, medianByMonth, setTooltip }) {
  const noData = day.status === 'no_data';
  const bg = noData ? null : emberColor(day.count, maxCount) || '#F5F5F4';
  const dark = !noData && day.count > 0 && day.count / maxCount > 0.4;
  const isHot = !noData && day.count >= p90 && day.count > 0;
  const provisional = day.layer === 'NRT';

  const medianDaily = (medianByMonth?.[month] || 0) / new Date(year, month + 1, 0).getDate();

  const handleMouse = useCallback((e) => {
    const date = `${day.day} ${MONTH_NAMES[month]} ${year}`;
    if (noData) {
      setTooltip({ x: e.clientX, y: e.clientY, date, noData: true });
      return;
    }
    setTooltip({
      x: e.clientX,
      y: e.clientY,
      date,
      count: day.count,
      observed: day.observed,
      ci: day.ciLow != null && day.ciHigh != null && day.ciHigh - day.ciLow >= 1
        ? `IC 95%: ${Math.round(day.ciLow).toLocaleString('es-AR')}–${Math.round(day.ciHigh).toLocaleString('es-AR')}`
        : null,
      tier: TIER_LABEL[day.tier] || day.tier,
      provisional,
      suspect: day.status === 'suspect_zero',
      pctMedian: medianDaily > 0 ? `${Math.round((day.harmonized / medianDaily) * 100)}% de la mediana diaria del mes` : null,
    });
  }, [day, month, year, noData, provisional, medianDaily, setTooltip]);

  return (
    <div
      className={`aspect-square rounded-[4px] flex items-center justify-center relative cursor-default transition-all duration-75 ${
        day.count === 0 || noData ? 'border border-stone-200/60' : ''
      } ${provisional ? 'outline outline-1 outline-dashed outline-orange-400/70 -outline-offset-1' : ''} ${
        isHot ? 'ring-1 ring-red-500/50 shadow-sm shadow-red-300/30' : ''
      }`}
      style={noData ? { background: NO_DATA_BG } : { backgroundColor: bg }}
      onMouseMove={handleMouse}
      onMouseLeave={() => setTooltip(null)}
    >
      {!noData && day.count > 0 && (
        <span className="text-[7px] font-semibold leading-none font-mono select-none" style={{ color: dark ? '#FFFFFF' : '#1C1917' }}>
          {day.count >= 10000 ? `${Math.round(day.count / 1000)}k` : day.count >= 1000 ? `${(day.count / 1000).toFixed(1)}k` : day.count}
        </span>
      )}
      {isHot && (
        <Flame className="absolute -top-1 -right-1 w-2.5 h-2.5 text-red-500 drop-shadow-sm" fill="currentColor" />
      )}
    </div>
  );
}
