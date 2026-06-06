export interface Candle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

export interface SeriesInfo {
  symbol: string;
  interval: string;
  count: number;
  firstOpenTime: number;
  lastOpenTime: number;
}

export type ParamType = "int" | "number" | "bool";

export interface ParamSpec {
  key: string;
  label: string;
  type: ParamType;
  default: number | boolean;
  min?: number;
  max?: number;
  step?: number;
}

export interface StrategyInfo {
  name: string;
  label: string;
  params: ParamSpec[];
}

export interface LinePoint {
  time: number;
  value: number;
}

export interface Overlay {
  id: string;
  label: string;
  color: string;
  data: LinePoint[];
}

export interface Trade {
  coin: string;
  side: "long" | "short";
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  barsHeld: number;
  exitReason: string;
  pnlBps: number;
  maeBps: number;
  mfeBps: number;
}

export interface EquityPoint {
  time: number;
  equity: number;
  drawdown: number;
}

export interface Summary {
  count: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnlBps: number;
  medianPnlBps: number;
  bestBps: number;
  worstBps: number;
  totalReturnBps: number;
  avgBarsHeld: number;
  exitCounts: Record<string, number>;
}

export interface BacktestResult {
  symbol: string;
  interval: string;
  strategy: string;
  candles: Candle[];
  overlays: Overlay[];
  trades: Trade[];
  equity: {
    points: EquityPoint[];
    finalEquity: number;
    totalReturn: number;
    maxDrawdown: number;
  };
  stats: {
    all: Summary;
    long: Summary;
    short: Summary;
  };
}

export interface BacktestRequest {
  symbol: string;
  interval: string;
  strategy: string;
  params: Record<string, number | boolean>;
  from?: number;
  to?: number;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const getSeries = (): Promise<SeriesInfo[]> => getJson("/api/series");

export const getStrategies = (): Promise<StrategyInfo[]> => getJson("/api/strategies");

export async function runBacktest(req: BacktestRequest): Promise<BacktestResult> {
  const res = await fetch("/api/backtest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as BacktestResult;
}
