import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  LineSeries,
  type CandlestickData,
  type IChartApi,
  type LineData,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { Candle, Overlay, Trade } from "../api";

interface Props {
  candles: Candle[];
  overlays: Overlay[];
  trades: Trade[];
}

const sec = (ms: number): UTCTimestamp => (ms / 1000) as UTCTimestamp;

function buildMarkers(trades: Trade[]): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];
  for (const t of trades) {
    const long = t.side === "long";
    markers.push({
      time: sec(t.entryTime),
      position: long ? "belowBar" : "aboveBar",
      color: long ? "#22c55e" : "#ef4444",
      shape: long ? "arrowUp" : "arrowDown",
      text: long ? "L" : "S",
    });
    markers.push({
      time: sec(t.exitTime),
      position: long ? "aboveBar" : "belowBar",
      color: t.pnlBps >= 0 ? "#3b82f6" : "#a855f7",
      shape: "circle",
      text: `${t.pnlBps >= 0 ? "+" : ""}${(t.pnlBps / 100).toFixed(2)}%`,
    });
  }
  markers.sort((a, b) => (a.time as number) - (b.time as number));
  return markers;
}

export function PriceChart({ candles, overlays, trades }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: "#0d1117" },
        textColor: "#c9d1d9",
      },
      grid: {
        vertLines: { color: "#1c2128" },
        horzLines: { color: "#1c2128" },
      },
      rightPriceScale: { borderColor: "#30363d" },
      timeScale: { borderColor: "#30363d", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });
    const candleData: CandlestickData<Time>[] = candles.map((c) => ({
      time: sec(c.openTime),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    candleSeries.setData(candleData);

    for (const ov of overlays) {
      const line = chart.addSeries(LineSeries, {
        color: ov.color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      const data: LineData<Time>[] = ov.data.map((p) => ({ time: sec(p.time), value: p.value }));
      line.setData(data);
    }

    createSeriesMarkers(candleSeries, buildMarkers(trades));
    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, overlays, trades]);

  return <div ref={containerRef} className="chart price-chart" />;
}
