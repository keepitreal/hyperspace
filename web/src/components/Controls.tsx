import type { SeriesInfo, StrategyInfo } from "../api";

interface Props {
  series: SeriesInfo[];
  strategies: StrategyInfo[];
  symbol: string;
  interval: string;
  strategyName: string;
  params: Record<string, number | boolean>;
  loading: boolean;
  onSymbol: (s: string) => void;
  onInterval: (s: string) => void;
  onStrategy: (s: string) => void;
  onParam: (key: string, value: number | boolean) => void;
  onRun: () => void;
}

const INTERVAL_ORDER = ["5m", "1h", "4h", "1d", "1w"];

function sortIntervals(intervals: string[]): string[] {
  return [...intervals].sort((a, b) => {
    const ia = INTERVAL_ORDER.indexOf(a);
    const ib = INTERVAL_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

export function Controls(props: Props) {
  const { series, strategies, symbol, interval, strategyName, params, loading } = props;

  const symbols = [...new Set(series.map((s) => s.symbol))].sort();
  const intervals = sortIntervals(series.filter((s) => s.symbol === symbol).map((s) => s.interval));
  const strategy = strategies.find((s) => s.name === strategyName);

  return (
    <div className="controls">
      <div className="control">
        <label>Symbol</label>
        <select value={symbol} onChange={(e) => props.onSymbol(e.target.value)}>
          {symbols.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="control">
        <label>Interval</label>
        <select value={interval} onChange={(e) => props.onInterval(e.target.value)}>
          {intervals.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </div>

      <div className="control">
        <label>Strategy</label>
        <select value={strategyName} onChange={(e) => props.onStrategy(e.target.value)}>
          {strategies.map((s) => (
            <option key={s.name} value={s.name}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {strategy?.params.map((p) => {
        if (p.type === "bool") {
          const checked = Boolean(params[p.key]);
          return (
            <div className="control checkbox" key={p.key}>
              <label>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => props.onParam(p.key, e.target.checked)}
                />
                {p.label}
              </label>
            </div>
          );
        }
        const value = Number(params[p.key] ?? p.default);
        return (
          <div className="control" key={p.key}>
            <label>{p.label}</label>
            <input
              type="number"
              value={value}
              min={p.min}
              max={p.max}
              step={p.step ?? (p.type === "int" ? 1 : 0.1)}
              onChange={(e) => props.onParam(p.key, Number(e.target.value))}
            />
          </div>
        );
      })}

      <button className="run" onClick={props.onRun} disabled={loading}>
        {loading ? "Running…" : "Run backtest"}
      </button>
    </div>
  );
}
