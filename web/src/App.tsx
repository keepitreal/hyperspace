import { useCallback, useEffect, useState } from "react";
import {
  getSeries,
  getStrategies,
  runBacktest,
  type BacktestRequest,
  type BacktestResult,
  type SeriesInfo,
  type StrategyInfo,
} from "./api";
import { Controls } from "./components/Controls";
import { EquityChart } from "./components/EquityChart";
import { PriceChart } from "./components/PriceChart";
import { StatsPanel } from "./components/StatsPanel";

type ParamMap = Record<string, number | boolean>;

function defaultsFor(s: StrategyInfo | undefined): ParamMap {
  const out: ParamMap = {};
  s?.params.forEach((p) => {
    out[p.key] = p.default;
  });
  return out;
}

export function App() {
  const [series, setSeries] = useState<SeriesInfo[]>([]);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [symbol, setSymbol] = useState("");
  const [interval, setIntervalSel] = useState("");
  const [strategyName, setStrategyName] = useState("");
  const [params, setParams] = useState<ParamMap>({});
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const execute = useCallback(async (req: BacktestRequest) => {
    setLoading(true);
    setError(null);
    try {
      setResult(await runBacktest(req));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [ser, strat] = await Promise.all([getSeries(), getStrategies()]);
        setSeries(ser);
        setStrategies(strat);
        if (ser.length === 0) {
          setBootError("Cache is empty — run `pnpm backfill`, then restart `pnpm server`.");
          return;
        }
        const syms = [...new Set(ser.map((s) => s.symbol))];
        const sym = syms.includes("SPY") ? "SPY" : (syms[0] ?? "");
        const ivs = ser.filter((s) => s.symbol === sym).map((s) => s.interval);
        const iv = ivs.includes("1d") ? "1d" : (ivs[0] ?? "");
        const st = strat[0];
        const stName = st?.name ?? "";
        const ps = defaultsFor(st);
        setSymbol(sym);
        setIntervalSel(iv);
        setStrategyName(stName);
        setParams(ps);
        if (sym && iv && stName) {
          void execute({ symbol: sym, interval: iv, strategy: stName, params: ps });
        }
      } catch (e) {
        setBootError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [execute]);

  const onSymbol = (s: string) => {
    setSymbol(s);
    const ivs = series.filter((x) => x.symbol === s).map((x) => x.interval);
    if (!ivs.includes(interval)) setIntervalSel(ivs.includes("1d") ? "1d" : (ivs[0] ?? ""));
  };

  const onStrategy = (name: string) => {
    setStrategyName(name);
    setParams(defaultsFor(strategies.find((s) => s.name === name)));
  };

  const onParam = (key: string, value: number | boolean) =>
    setParams((prev) => ({ ...prev, [key]: value }));

  const onRun = () => {
    if (symbol && interval && strategyName) {
      void execute({ symbol, interval, strategy: strategyName, params });
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Hyperspace · Visual Backtester</h1>
        {result && (
          <span className="subtitle">
            {result.symbol} · {result.interval} · {result.strategy} · {result.candles.length} bars
          </span>
        )}
      </header>

      <Controls
        series={series}
        strategies={strategies}
        symbol={symbol}
        interval={interval}
        strategyName={strategyName}
        params={params}
        loading={loading}
        onSymbol={onSymbol}
        onInterval={setIntervalSel}
        onStrategy={onStrategy}
        onParam={onParam}
        onRun={onRun}
      />

      {bootError && <div className="banner error">{bootError}</div>}
      {error && <div className="banner error">Backtest failed: {error}</div>}

      <section className="panel">
        <h2>Price &amp; signals</h2>
        {result ? (
          <PriceChart candles={result.candles} overlays={result.overlays} trades={result.trades} />
        ) : (
          <div className="placeholder">{loading ? "Running…" : "Run a backtest to see the chart."}</div>
        )}
      </section>

      <div className="row">
        <section className="panel equity-panel">
          <h2>Equity curve</h2>
          {result ? <EquityChart points={result.equity.points} /> : <div className="placeholder" />}
        </section>
        <section className="panel stats-section">
          <h2>Stats</h2>
          {result ? <StatsPanel result={result} /> : <div className="placeholder" />}
        </section>
      </div>
    </div>
  );
}
