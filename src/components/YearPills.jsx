const YEARS = Array.from({ length: 27 }, (_, i) => 2000 + i);

export default function YearPills({ year, setYear }) {
  return (
    <div className="flex flex-wrap gap-1">
      {YEARS.map((y) => (
        <button
          key={y}
          onClick={() => setYear(y)}
          className={`pill-btn ${year === y ? 'pill-active' : 'pill-inactive'}`}
        >
          {y}
        </button>
      ))}
    </div>
  );
}
