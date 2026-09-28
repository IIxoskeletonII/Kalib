// Money in the planner (§18.3): the symbol shown beside every price. Stored as an ISO 4217
// code so it survives a change of phone language, and rendered with the device's own
// formatting rules — a Rial has three decimals, a Yen none.

export interface Currency {
  code: string;
  symbol: string;
  name: string;
}

/** Offered first: the ones this household actually uses. */
export const QUICK_CURRENCIES = ['OMR', 'EUR', 'USD'] as const;

/** ISO 4217 codes in circulation, with the symbol a local would recognise. */
export const CURRENCIES: Currency[] = [
  { code: 'AED', symbol: 'د.إ', name: 'UAE dirham' },
  { code: 'ARS', symbol: '$', name: 'Argentine peso' },
  { code: 'AUD', symbol: 'A$', name: 'Australian dollar' },
  { code: 'BDT', symbol: '৳', name: 'Bangladeshi taka' },
  { code: 'BGN', symbol: 'лв', name: 'Bulgarian lev' },
  { code: 'BHD', symbol: '.د.ب', name: 'Bahraini dinar' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian real' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian dollar' },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss franc' },
  { code: 'CLP', symbol: '$', name: 'Chilean peso' },
  { code: 'CNY', symbol: '¥', name: 'Chinese yuan' },
  { code: 'COP', symbol: '$', name: 'Colombian peso' },
  { code: 'CZK', symbol: 'Kč', name: 'Czech koruna' },
  { code: 'DKK', symbol: 'kr', name: 'Danish krone' },
  { code: 'EGP', symbol: 'E£', name: 'Egyptian pound' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'Pound sterling' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong dollar' },
  { code: 'HRK', symbol: 'kn', name: 'Croatian kuna' },
  { code: 'HUF', symbol: 'Ft', name: 'Hungarian forint' },
  { code: 'IDR', symbol: 'Rp', name: 'Indonesian rupiah' },
  { code: 'ILS', symbol: '₪', name: 'Israeli shekel' },
  { code: 'INR', symbol: '₹', name: 'Indian rupee' },
  { code: 'ISK', symbol: 'kr', name: 'Icelandic króna' },
  { code: 'JOD', symbol: 'د.ا', name: 'Jordanian dinar' },
  { code: 'JPY', symbol: '¥', name: 'Japanese yen' },
  { code: 'KES', symbol: 'KSh', name: 'Kenyan shilling' },
  { code: 'KRW', symbol: '₩', name: 'South Korean won' },
  { code: 'KWD', symbol: 'د.ك', name: 'Kuwaiti dinar' },
  { code: 'LKR', symbol: 'Rs', name: 'Sri Lankan rupee' },
  { code: 'MAD', symbol: 'د.م.', name: 'Moroccan dirham' },
  { code: 'MXN', symbol: '$', name: 'Mexican peso' },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian ringgit' },
  { code: 'NGN', symbol: '₦', name: 'Nigerian naira' },
  { code: 'NOK', symbol: 'kr', name: 'Norwegian krone' },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand dollar' },
  { code: 'OMR', symbol: 'ر.ع.', name: 'Omani rial' },
  { code: 'PHP', symbol: '₱', name: 'Philippine peso' },
  { code: 'PKR', symbol: 'Rs', name: 'Pakistani rupee' },
  { code: 'PLN', symbol: 'zł', name: 'Polish złoty' },
  { code: 'QAR', symbol: 'ر.ق', name: 'Qatari riyal' },
  { code: 'RON', symbol: 'lei', name: 'Romanian leu' },
  { code: 'RSD', symbol: 'дин', name: 'Serbian dinar' },
  { code: 'RUB', symbol: '₽', name: 'Russian rouble' },
  { code: 'SAR', symbol: 'ر.س', name: 'Saudi riyal' },
  { code: 'SEK', symbol: 'kr', name: 'Swedish krona' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore dollar' },
  { code: 'THB', symbol: '฿', name: 'Thai baht' },
  { code: 'TRY', symbol: '₺', name: 'Turkish lira' },
  { code: 'TWD', symbol: 'NT$', name: 'New Taiwan dollar' },
  { code: 'UAH', symbol: '₴', name: 'Ukrainian hryvnia' },
  { code: 'USD', symbol: '$', name: 'US dollar' },
  { code: 'VND', symbol: '₫', name: 'Vietnamese dong' },
  { code: 'ZAR', symbol: 'R', name: 'South African rand' },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

/** Settings hold either a code ("OMR") or, from before this existed, a bare symbol ("€"). */
export function currencyOf(stored: string | undefined): Currency {
  if (!stored) return BY_CODE.get('EUR')!;
  const byCode = BY_CODE.get(stored.toUpperCase());
  if (byCode) return byCode;
  const bySymbol = CURRENCIES.find((c) => c.symbol === stored);
  return bySymbol ?? { code: stored.toUpperCase().slice(0, 3), symbol: stored, name: stored };
}

/** The symbol to put in front of a figure. */
export function currencySymbol(stored: string | undefined): string {
  return currencyOf(stored).symbol;
}

/**
 * Decimals the currency actually uses: three for Gulf dinars and rials, none for yen and won.
 * Showing a rial to two places is the same error as showing a weight to five.
 */
export function currencyDecimals(code: string): number {
  if (/^(BHD|IQD|JOD|KWD|LYD|OMR|TND)$/i.test(code)) return 3;
  if (/^(BIF|CLP|DJF|GNF|ISK|JPY|KMF|KRW|PYG|RWF|UGX|VND|VUV|XAF|XOF|XPF)$/i.test(code)) return 0;
  return 2;
}

/** "€12.30", "ر.ع.4.750", "¥1,240" — the symbol in front, the decimals the currency uses. */
export function formatMoney(amount: number, stored: string | undefined): string {
  const c = currencyOf(stored);
  const d = currencyDecimals(c.code);
  return `${c.symbol}${amount.toLocaleString(undefined, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })}`;
}

/** A guess from the phone's own locale, used the first time the planner asks. */
export function localeCurrency(locale: string = navigator.language): string {
  const region = locale.includes('-') ? locale.split('-')[1]!.toUpperCase() : '';
  const byRegion: Record<string, string> = {
    OM: 'OMR',
    AE: 'AED',
    SA: 'SAR',
    QA: 'QAR',
    KW: 'KWD',
    BH: 'BHD',
    US: 'USD',
    GB: 'GBP',
    CH: 'CHF',
    JP: 'JPY',
    IN: 'INR',
    AU: 'AUD',
    CA: 'CAD',
    NZ: 'NZD',
    ZA: 'ZAR',
  };
  return byRegion[region] ?? 'EUR';
}
