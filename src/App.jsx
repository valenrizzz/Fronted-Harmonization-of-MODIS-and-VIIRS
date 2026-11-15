import Navbar from './components/Navbar';
import WorldMapHero from './components/WorldMapHero';
import FireCalendarSection from './components/FireCalendarSection';
import HistoricalAnalyticsSection from './components/HistoricalAnalyticsSection';
import { useFireData } from './hooks/useFireData';

export default function App() {
  const fd = useFireData();

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <Navbar
        locationLabel={fd.locationLabel}
        satellites={fd.satellites}
        toggleSatellite={fd.toggleSatellite}
        dateRange={fd.dateRange}
        setDateRange={fd.setDateRange}
      />

      <WorldMapHero
        region={fd.region}
        setRegion={fd.setRegion}
        regionKeys={fd.regionKeys}
        province={fd.province}
        setProvince={fd.setProvince}
        city={fd.city}
        setCity={fd.setCity}
        scrollToCalendar={fd.scrollToCalendar}
        hotspots={fd.data.hotspots}
      />

      <FireCalendarSection
        year={fd.year}
        setYear={fd.setYear}
        yearData={fd.yearData}
        data={fd.data}
        region={fd.region}
      />

      <HistoricalAnalyticsSection
        data={fd.data}
        region={fd.region}
        year={fd.year}
        downloadCSV={fd.downloadCSV}
      />
    </div>
  );
}
