import type { BacktestResult, Summary } from "../api";

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function bps(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(0)} bps`;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value${tone ? ` ${tone}` : ""}`}>{value}</div>
    </div>
  );
}

function sideRow(label: string, s: Summary) {
  if (s.count === 0) {
    return (
      <tr>
        <td>{label}</td>
        <td colSpan={4} className="muted">
          no trades
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td>{label}</td>
      <td>{s.count}</td>
      <td>{pct(s.winRate)}</td>
      <td className={s.avgPnlBps >= 0 ? "pos" : "neg"}>{bps(s.avgPnlBps)}</td>
      <td className={s.totalReturnBps >= 0 ? "pos" : "neg"}>{bps(s.totalReturnBps)}</td>
    </tr>
  );
}

export function StatsPanel({ result }: { result: BacktestResult }) {
  const { stats, equity, trades } = result;
  const all = stats.all;
  const ret = equity.totalReturn;

  const exits = Object.entries(all.exitCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="stats-panel">
      <div className="stat-grid">
        <Stat label="Trades" value={String(all.count)} />
        <Stat label="Win rate" value={all.count ? pct(all.winRate) : "—"} />
        <Stat
          label="Total return"
          value={pct(ret)}
          tone={ret >= 0 ? "pos" : "neg"}
        />
        <Stat label="Max drawdown" value={pct(equity.maxDrawdown)} tone="neg" />
        <Stat
          label="Avg / trade"
          value={all.count ? bps(all.avgPnlBps) : "—"}
          tone={all.avgPnlBps >= 0 ? "pos" : "neg"}
        />
        <Stat label="Avg bars held" value={all.count ? all.avgBarsHeld.toFixed(1) : "—"} />
      </div>

      <table className="side-table">
        <thead>
          <tr>
            <th>Side</th>
            <th>n</th>
            <th>win</th>
            <th>avg</th>
            <th>total</th>
          </tr>
        </thead>
        <tbody>
          {sideRow("All", stats.all)}
          {sideRow("Long", stats.long)}
          {sideRow("Short", stats.short)}
        </tbody>
      </table>

      {exits.length > 0 && (
        <div className="exits">
          <span className="muted">exits:</span>{" "}
          {exits.map(([k, v]) => (
            <span key={k} className="exit-tag">
              {k}={v}
            </span>
          ))}
        </div>
      )}

      {trades.length === 0 && (
        <p className="muted">
          No trades fired for these params on this range — loosen the RSI thresholds or widen the
          window.
        </p>
      )}
    </div>
  );
}
