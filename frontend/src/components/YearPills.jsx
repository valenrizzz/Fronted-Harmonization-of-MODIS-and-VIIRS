export default function YearPills({ year, setYear, years, partialYears = [] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {years.map((y) => (
        <button
          key={y}
          onClick={() => setYear(y)}
          title={partialYears.includes(y) ? 'Año con datos parciales' : undefined}
          className={`pill-btn ${year === y ? 'pill-active' : 'pill-inactive'}`}
        >
          {y}{partialYears.includes(y) ? '*' : ''}
        </button>
      ))}
    </div>
  );
}
