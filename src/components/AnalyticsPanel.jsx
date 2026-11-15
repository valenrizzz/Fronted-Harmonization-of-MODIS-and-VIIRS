import HistoricalComparison from './HistoricalComparison';
import TopYearsRanking from './TopYearsRanking';
import CsvExportCard from './CsvExportCard';
import MiniMapCard from './MiniMapCard';

export default function AnalyticsPanel({ data, region, year, downloadCSV, viewMode, setViewMode }) {
  return (
    <>
      <HistoricalComparison data={data} region={region} year={year} />
      <TopYearsRanking topYears={data.topYears} region={region} />
      <CsvExportCard downloadCSV={downloadCSV} />
      <MiniMapCard
        center={data.center}
        zoom={data.zoom}
        hotspots={data.hotspots}
        region={region}
        viewMode={viewMode}
        setViewMode={setViewMode}
      />
    </>
  );
}
