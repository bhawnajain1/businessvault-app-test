interface QtyProps {
  micros: number;
  decimals?: number;
  unit?: string;
  className?: string;
}

export function formatQty(micros: number, decimals: number = 3): string {
  const sign = micros < 0 ? '-' : '';
  const abs = Math.abs(micros);
  const whole = Math.floor(abs / 1_000_000);
  const frac = abs % 1_000_000;
  if (decimals <= 0) return `${sign}${whole.toLocaleString('en-IN')}`;
  const fracStr = frac.toString().padStart(6, '0').slice(0, decimals);
  return `${sign}${whole.toLocaleString('en-IN')}.${fracStr}`;
}

export default function Qty({ micros, decimals = 3, unit, className }: QtyProps) {
  const text = formatQty(micros, decimals);
  return (
    <span className={className}>
      {text}
      {unit ? <span className="text-slate-500 ml-1">{unit}</span> : null}
    </span>
  );
}
