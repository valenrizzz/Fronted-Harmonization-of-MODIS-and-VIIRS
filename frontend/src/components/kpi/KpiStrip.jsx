import { Card } from './KpiParts';
import { useKpiItems } from './useKpiItems';

/** Las 4 métricas como tarjetas abiertas (vista de Estadísticas). */
export default function KpiStrip({ fd }) {
  const items = useKpiItems(fd);
  const { data, loading } = fd.summary;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {items.map((k, i) => (
        <Card key={k.id} icon={k.icon} label={k.label} accent={k.accent} loading={loading} empty={!data} delay={i * 0.05}>
          <div className="mt-1">{k.value('text-[26px]')}</div>
          {k.detail}
        </Card>
      ))}
    </div>
  );
}
