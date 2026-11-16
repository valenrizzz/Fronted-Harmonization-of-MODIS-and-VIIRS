/** Marca ViSU: logo (satélite + foco) al lado del nombre, sobre fondo azul noche. */
export default function Brand() {
  return (
    <span className="flex items-center gap-2.5">
      <img
        src="/logo.jpeg"
        alt="Logo ViSU"
        width={40}
        height={38}
        className="w-10 h-10 shrink-0 rounded-xl object-cover ring-1 ring-white/15 shadow-[0_0_18px_-4px_rgba(31,172,199,0.55)]"
      />
      <span className="font-display text-[21px] font-bold tracking-tight text-white">
        Vi<span className="text-fire-300">SU</span>
      </span>
    </span>
  );
}
