export const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Nombres para mostrar de los códigos ISO3 que publica el backend
const REGION_NAMES = {
  ARG: 'Argentina',
  BRA: 'Brasil',
  CHL: 'Chile',
  BOL: 'Bolivia',
  PRY: 'Paraguay',
  URY: 'Uruguay',
  AUS: 'Australia',
  USA: 'Estados Unidos',
};

export const regionName = (code) => REGION_NAMES[code] || code;

export const TIER_LABEL = { high: 'alta', medium: 'media', low: 'baja' };

// Escala "Earth & Sunlit Ember" compartida por calendario, leyenda y mapa
export const EMBER_SCALE = [
  '#FEF3C7', '#FDE68A', '#FCD34D', '#FBBF24', '#FB923C',
  '#F97316', '#EA580C', '#C2410C', '#9A3412', '#7C2D12',
];

export function emberColor(value, max) {
  if (!value || value <= 0) return null;
  const ratio = Math.min(value / (max || 1), 1);
  const idx = Math.min(Math.floor(Math.pow(ratio, 0.55) * EMBER_SCALE.length), EMBER_SCALE.length - 1);
  return EMBER_SCALE[idx];
}

export const fmtCount = (n) => {
  if (n == null || Number.isNaN(n)) return '–';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} mil`;
  return Math.round(n).toLocaleString('es-AR');
};

export const fmtDate = (iso) => {
  if (!iso) return '–';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
};
