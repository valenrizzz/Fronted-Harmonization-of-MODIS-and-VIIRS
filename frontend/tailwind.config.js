/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#F7F8FC',
        // Fondo azul noche (mismo tono del logo) y cian del haz satelital
        night: {
          950: '#0A1229',
          900: '#0E1937',
          800: '#152349',
          700: '#1E2F5E',
        },
        beam: '#1FACC7',
        // Azul institucional ViSU: #050077 = brand-700
        brand: {
          50: '#EEEEFB',
          100: '#DCDCF7',
          200: '#B9B8EF',
          300: '#8B89E0',
          400: '#5A57CC',
          500: '#2B27B0',
          600: '#14109A',
          700: '#050077',
          800: '#04005E',
          900: '#030045',
          950: '#02002B',
        },
        // Tonos oscuros (texto/acentos puntuales)
        ink: {
          950: '#05070A',
          900: '#0A0D12',
          850: '#0E1218',
          800: '#131922',
          700: '#1B2330',
          600: '#283243',
        },
        fire: {
          50: '#FFF7E0',
          200: '#FCD34D',
          300: '#FBBF24',
          400: '#F59E0B',
          500: '#F97316',
          600: '#EF4444',
          700: '#FF1F1F',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Space Grotesk"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        panel: '0 12px 32px -12px rgba(15,23,42,0.18), 0 2px 6px -2px rgba(15,23,42,0.06)',
        ember: '0 6px 20px -6px rgba(249,115,22,0.55)',
        brand: '0 6px 20px -6px rgba(5,0,119,0.45)',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        progress: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(250%)' } },
        orbit: { '100%': { transform: 'rotate(360deg)' } },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
        progress: 'progress 1.2s ease-in-out infinite',
        orbit: 'orbit 3.2s linear infinite',
      },
    },
  },
  plugins: [],
};
