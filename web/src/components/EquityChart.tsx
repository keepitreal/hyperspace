import {
  AreaSeries,
  createChart,
  type AreaData,
  type IChartApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { EquityPoint } from "../api";

interface Props {
  points: EquityPoint[];
}

const sec = (ms: number): UTCTimestamp => (ms / 1000) as UTCTimestamp;

export function EquityChart({ points }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;

    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: "#0d1117" }, textColor: "#c9d1d9" },
      grid: { vertLines: { color: "#1c2128" }, horzLines: { color: "#1c2128" } },
      rightPriceScale: { borderColor: "#30363d" },
      timeScale: { borderColor: "#30363d", timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    const series = chart.addSeries(AreaSeries, {
      lineColor: "#3b82f6",
      topColor: "rgba(59,130,246,0.4)",
      bottomColor: "rgba(59,130,246,0.02)",
      lineWidth: 2,
      priceFormat: { type: "custom", formatter: (v: number) => `${v.toFixed(3)}x` },
    });
    const data: AreaData<Time>[] = points.map((p) => ({ time: sec(p.time), value: p.equity }));
    series.setData(data);
    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [points]);

  if (points.length === 0) {
    return <div className="chart equity-chart empty">No closed trades — equity curve is empty.</div>;
  }
  return <div ref={containerRef} className="chart equity-chart" />;
}
