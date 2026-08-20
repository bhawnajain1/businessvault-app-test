interface MoneyProps {
  paise: number;
  currency?: string;
  className?: string;
  showSign?: boolean;
}

export function formatMoney(paise: number, currency: string = 'INR'): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const rupeesStr = rupees.toLocaleString('en-IN');
  const symbol = currency === 'INR' ? '₹' : currency + ' ';
  return `${sign}${symbol}${rupeesStr}.${p.toString().padStart(2, '0')}`;
}

export default function Money({ paise, currency = 'INR', className, showSign }: MoneyProps) {
  const cls = className ?? (paise < 0 ? 'text-rose-600' : '');
  const text = formatMoney(paise, currency);
  const withSign = showSign && paise > 0 ? `+${text}` : text;
  return <span className={cls}>{withSign}</span>;
}
