export default function ColorLegend() {
  const stops = [
    '#FEF3C7', '#FDE68A', '#FCD34D', '#FBBF24', '#FB923C',
    '#F97316', '#EA580C', '#C2410C', '#9A3412', '#7C2D12',
  ];

  return (
    <div className="flex items-center justify-center gap-2 mt-4 text-xs text-stone-400">
      <span className="font-medium">Menos</span>
      <div className="flex gap-[1px]">
        {stops.map((c, i) => (
          <div
            key={i}
            className="w-5 h-3 first:rounded-l last:rounded-r"
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <span className="font-medium">Más</span>
    </div>
  );
}
