'use client';
import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, Time, SeriesMarker } from 'lightweight-charts';

export interface CandlestickData {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface LineData {
  time: Time;
  value: number;
}

export interface ChartLines {
  adx?: LineData[];
  diPlus?: LineData[];
  diMinus?: LineData[];
}

export interface CandlestickChartProps {
  data: CandlestickData[];
  markers?: SeriesMarker<Time>[];
  lines?: ChartLines;
}

const CandlestickChart: React.FC<CandlestickChartProps> = ({ data, markers, lines }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 1. Bulletproof Guard Clauses: Stop execution if container or data is missing
    if (!chartContainerRef.current) return;
    if (!data || !Array.isArray(data) || data.length === 0) return;

    // 2. Only initialize the chart once data is guaranteed to exist
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 400,
      layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#333' },
      grid: { vertLines: { color: '#eee' }, horzLines: { color: '#eee' } },
      leftPriceScale: { visible: true, borderColor: '#eee' },
      rightPriceScale: { visible: true, borderColor: '#eee' },
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    // 3. Set data safely (the guard clause above guarantees 'data' is a valid array)
    candlestickSeries.setData(data);

    // 4. Safely set markers
    if (markers && Array.isArray(markers) && markers.length > 0) {
      candlestickSeries.setMarkers(markers);
    }

    // 5. Safely set indicator lines
    if (lines?.adx && Array.isArray(lines.adx) && lines.adx.length > 0) {
      const adxSeries = chart.addLineSeries({ color: '#9c27b0', lineWidth: 2, priceScaleId: 'left', title: 'ADX' });
      adxSeries.setData(lines.adx);
    }
    
    if (lines?.diPlus && Array.isArray(lines.diPlus) && lines.diPlus.length > 0) {
      const diPlusSeries = chart.addLineSeries({ color: '#4caf50', lineWidth: 1, priceScaleId: 'left', title: 'DI+' });
      diPlusSeries.setData(lines.diPlus);
    }

    if (lines?.diMinus && Array.isArray(lines.diMinus) && lines.diMinus.length > 0) {
      const diMinusSeries = chart.addLineSeries({ color: '#f44336', lineWidth: 1, priceScaleId: 'left', title: 'DI-' });
      diMinusSeries.setData(lines.diMinus);
    }

    return () => {
      chart.remove();
    };
  }, [data, markers, lines]);

  return <div ref={chartContainerRef} className="w-full h-[400px] border rounded-lg shadow-sm" />;
};

export default CandlestickChart;