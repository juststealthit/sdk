/**
 * Formatting the way the site shows numbers: tiny prices with a subscript zero count, compact dollars, percents, basis points and
 * exact token amounts from base units. Pure functions, no locale surprises: output is the same on every machine.
 *
 * @module
 */

const SUBSCRIPT = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];
/** Typographic minus, so columns of numbers line up. Pass `{ minus: "-" }` to get the ASCII one. */
export const MINUS = "−";

export interface SignOptions {
  /** The negative sign. Default U+2212. */
  minus?: string;
  /** What a missing or non-finite number prints as. Default "—". */
  empty?: string;
}

const subscript = (n: number) =>
  String(n)
    .split("")
    .map((d) => SUBSCRIPT[Number(d)] ?? d)
    .join("");

const trimZeros = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);
const bad = (n: number | null | undefined): n is null | undefined => n == null || !Number.isFinite(n);

/** 1234 → "1.23K", 1_234_567 → "1.23M", 2.5e12 → "2.5T". Below 1,000 keeps up to `small` decimals. */
export function formatCompact(n: number | null | undefined, small = 2, opts: SignOptions = {}): string {
  if (bad(n)) return opts.empty ?? "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? (opts.minus ?? MINUS) : "";
  const units = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ] as const;
  for (let i = 0; i < units.length; i++) {
    const [value, suffix] = units[i]!;
    if (abs >= value) {
      const scaled = abs / value;
      const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
      const text = scaled.toFixed(digits);
      // 999,999 rounds to "1000K": that's 1M
      if (Number(text) >= 1000 && i > 0) return `${sign}1${units[i - 1]![1]}`;
      return `${sign}${trimZeros(text)}${suffix}`;
    }
  }
  const text = trimZeros(abs.toFixed(small));
  if (Number(text) >= 1000) return `${sign}1K`;
  return `${sign}${text}`;
}

/** Dollars: "$0.42", "$123", "$1.2K", "$4.56M", "<$0.01". */
export function formatUsd(n: number | null | undefined, opts: SignOptions = {}): string {
  if (bad(n)) return opts.empty ?? "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? (opts.minus ?? MINUS) : "";
  if (abs === 0) return "$0";
  if (abs < 0.01) return `${sign}<$0.01`;
  // a value that rounds up to the next band is written in that band: 9.996 → "$10.0", 999.6 → "$1K"
  if (abs < 9.995) return `${sign}$${abs.toFixed(2)}`;
  if (abs < 99.95) return `${sign}$${abs.toFixed(1)}`;
  if (abs < 999.5) return `${sign}$${abs.toFixed(0)}`;
  if (abs < 1000) return `${sign}$1K`;
  return `${sign}$${formatCompact(abs)}`;
}

/**
 * A price, with tiny ones written with a subscript count of zeros after the point:
 * 0.00000123 → "$0.0₅123". `prefix` defaults to "$"; pass "" for a price in SOL or ETH.
 */
export function formatPrice(p: number | null | undefined, prefix = "$", opts: SignOptions = {}): string {
  if (bad(p)) return opts.empty ?? "—";
  if (p === 0) return `${prefix}0`;
  const abs = Math.abs(p);
  const sign = p < 0 ? (opts.minus ?? MINUS) : "";
  if (abs >= 1000) return `${sign}${prefix}${formatCompact(abs)}`;
  if (abs >= 1) return `${sign}${prefix}${abs.toFixed(abs >= 100 ? 2 : 3)}`;
  if (abs >= 0.001) return `${sign}${prefix}${trimZeros(abs.toFixed(5))}`;
  let zeros = Math.floor(-Math.log10(abs) - 1e-12);
  let scaled = Math.round(abs * 10 ** (zeros + 1) * 1000);
  // 0.0000099999 rounds to 10000: one zero fewer, not "0.0₅1" (which reads ten times too small)
  if (scaled >= 10_000) {
    zeros -= 1;
    scaled = Math.round(scaled / 10);
  }
  if (zeros < 2) return `${sign}${prefix}${trimZeros(abs.toFixed(5))}`;
  const digits = String(scaled).slice(0, 4).replace(/0+$/, "");
  return `${sign}${prefix}0.0${subscript(zeros)}${digits || "0"}`;
}

/** Reads a subscript price back: "0.0₅123" → 0.00000123. Plain numbers pass through. `NaN` if it isn't one. */
export function parseSubscriptPrice(s: string): number {
  const clean = s.replace(/[$,\s]/g, "").replace(MINUS, "-");
  const m = /^(-?)0\.0([₀-₉]+)(\d+)$/.exec(clean);
  if (!m) return Number(clean);
  const zeros = Number(
    m[2]!
      .split("")
      .map((c) => SUBSCRIPT.indexOf(c))
      .join(""),
  );
  return Number(`${m[1]}0.${"0".repeat(zeros)}${m[3]}`);
}

/** Percent change: "+12.3%", "−4.5%", "+1.2K%". */
export function formatPercent(n: number | null | undefined, opts: SignOptions & { sign?: boolean; digits?: number } = {}): string {
  if (bad(n)) return opts.empty ?? "—";
  const abs = Math.abs(n);
  const sign = n > 0 && opts.sign !== false ? "+" : n < 0 ? (opts.minus ?? MINUS) : "";
  const body = abs >= 10_000 ? formatCompact(abs) : abs >= 100 ? abs.toFixed(0) : abs.toFixed(opts.digits ?? 1);
  return `${sign}${body}%`;
}

/** Basis points: 125 → "1.25%", 50 → "0.5%", 87.5 → "0.875%". Up to three decimals. */
export function formatBps(bps: number): string {
  return `${trimZeros((bps / 100).toFixed(3))}%`;
}

/** Token quantities: "12.3M", "1.25K", "842", "0.0042". */
export function formatTokens(n: number | null | undefined, opts: SignOptions = {}): string {
  if (bad(n)) return opts.empty ?? "—";
  if (Math.abs(n) < 1 && n !== 0) return trimZeros(n.toFixed(4));
  return formatCompact(n, 0, opts);
}

/**
 * Base units to an exact decimal string, without floating point: `formatUnits(1_500_000n, 6)` → "1.5".
 * `maxDecimals` cuts (never rounds) the fraction.
 */
export function formatUnits(value: bigint | string | number, decimals: number, maxDecimals?: number): string {
  const v = BigInt(value);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = decimals > 0 ? (abs % base).toString().padStart(decimals, "0") : "";
  if (maxDecimals !== undefined) frac = frac.slice(0, Math.max(0, maxDecimals));
  frac = frac.replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** A decimal string to base units: `parseUnits("1.5", 6)` → 1_500_000n. Throws on more decimals than the token has. */
export function parseUnits(value: string | number, decimals: number): bigint {
  // a number like 1e-7 prints in exponent form; write it out in full first
  const s = (typeof value === "number" ? (Number.isFinite(value) ? value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 }) : String(value)) : String(value)).trim();
  if (!/^-?\d*(\.\d*)?$/.test(s) || s === "" || s === "." || s === "-") throw new RangeError(`"${s}" isn't a decimal number.`);
  const neg = s.startsWith("-");
  const [whole = "0", frac = ""] = (neg ? s.slice(1) : s).split(".");
  if (frac.length > decimals) throw new RangeError(`"${s}" has more than ${decimals} decimals.`);
  const units = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt((frac || "").padEnd(decimals, "0") || "0");
  return neg ? -units : units;
}

/** Lamports to SOL, exact. */
export const lamportsToSol = (lamports: bigint | string | number) => formatUnits(lamports, 9);
/** SOL to lamports, exact. */
export const solToLamports = (sol: string | number) => parseUnits(sol, 9);

/** A shortened address: "0x12…cdEF", "7xKX…gAsU". */
export function shortAddress(address: string | null | undefined, lead = 4, tail = 4): string {
  if (!address) return "—";
  const head = address.startsWith("0x") ? lead + 2 : lead;
  if (address.length <= head + tail) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

/** How long ago, tersely: "8s", "5m", "3h", "2d", "4mo". */
export function formatAge(fromMs: number, nowMs: number = Date.now()): string {
  const s = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 60) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}

/** A countdown: "2d 4h 12m", "4h 12m 05s", "12m 05s", "5s". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(sec)}s`;
  if (m > 0) return `${m}m ${pad(sec)}s`;
  return `${sec}s`;
}
