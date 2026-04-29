'use client';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import Papa from 'papaparse';
import { createChart, ColorType } from 'lightweight-charts';
import { calculateADX } from './indicator';

function usePersistentState<T>(key: string, defaultValue: T) {
  const [value, setValue] = useState<T>(defaultValue);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // ignore malformed storage and keep defaults
    } finally {
      setHydrated(true);
    }
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore storage write failures
    }
  }, [hydrated, key, value]);

  return [value, setValue, hydrated] as const;
}

const CandlestickChart: React.FC<any> = ({ data = [], markers = [], lines, theme, pickMode, onPick, chartActionsRef, showRangeLines = true }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const indicatorContainerRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<any>(null);
  const indicatorInstanceRef = useRef<any>(null);
  const candlestickSeriesRef = useRef<any>(null);
  const adxSeriesRef = useRef<any>(null);

  const pickModeRef = useRef(pickMode);
  const onPickRef = useRef(onPick);

  useEffect(() => {
    pickModeRef.current = pickMode;
    onPickRef.current = onPick;
  });

  useEffect(() => {

    if (!chartContainerRef.current || !indicatorContainerRef.current) return;

    const isDark = theme === 'dark';
    const gridColor = isDark ? '#333333' : '#e5e7eb';
    const textColor = isDark ? '#9ca3af' : '#374151';

    const formatTick = (time: any, tickMarkType: any) => {
      const ts = typeof time === 'number' ? time : Number(time);
      if (!Number.isFinite(ts)) return '';
      const d = new Date(ts * 1000);
      if (tickMarkType === 0 || tickMarkType === 1) {
        // Show date blocks like "29 Apr"
        return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
      }
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    };

    const chartOptions = {
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      rightPriceScale: { visible: true, borderColor: gridColor },
      timeScale: {
        visible: true,
        borderColor: gridColor,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: formatTick,
      },
    };

    const chart = createChart(chartContainerRef.current, {
      ...chartOptions,
      width: chartContainerRef.current.clientWidth,
      height: 400,
    });
    chartInstanceRef.current = chart;
    if (chartActionsRef) {
      chartActionsRef.current = {
        goToStart: () => {
          if (data && data.length > 0) {
            chart.timeScale().setVisibleLogicalRange({ from: 0, to: Math.min(99, data.length - 1) });
          }
        },
        fitContent: () => chart.timeScale().fitContent(),
        goToEnd: () => chart.timeScale().scrollToRealTime(),
      };
    }

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#16a34a', downColor: '#dc2626', borderVisible: false, wickUpColor: '#16a34a', wickDownColor: '#dc2626',
    });
    candlestickSeriesRef.current = candlestickSeries;
    candlestickSeries.setData(data);

    if (markers && markers.length > 0) {
      const sortedMarkers = [...markers].sort((a, b) => Number(a.time) - Number(b.time));
      candlestickSeries.setMarkers(sortedMarkers);
    }

    const indicatorChart = createChart(indicatorContainerRef.current, {
      ...chartOptions,
      width: indicatorContainerRef.current.clientWidth,
      height: 200,
    });
    indicatorInstanceRef.current = indicatorChart;

    if (showRangeLines && lines?.rangeHigh && lines.rangeHigh.length > 0) {
      const rangeHighSeries = chart.addLineSeries({ color: '#60a5fa', lineWidth: 2, lineStyle: 2, title: 'Range High' });
      rangeHighSeries.setData(lines.rangeHigh);
      (rangeHighSeries as any).applyOptions({
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => null,
      });
    }
    if (showRangeLines && lines?.rangeLow && lines.rangeLow.length > 0) {
      const rangeLowSeries = chart.addLineSeries({ color: '#60a5fa', lineWidth: 2, lineStyle: 2, title: 'Range Low' });
      rangeLowSeries.setData(lines.rangeLow);
      (rangeLowSeries as any).applyOptions({
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => null,
      });
    }

    if (lines?.adx && lines.adx.length > 0) {
      const adxSeries = indicatorChart.addLineSeries({ color: '#8b5cf6', lineWidth: 1, title: 'ADX' });
      adxSeriesRef.current = adxSeries;
      adxSeries.setData(lines.adx);
    }
    
    if (lines?.diPlus && lines.diPlus.length > 0) {
      const diPlusSeries = indicatorChart.addLineSeries({ color: '#16a34a', lineWidth: 1, title: 'DI+' });
      diPlusSeries.setData(lines.diPlus);
    }

    if (lines?.diMinus && lines.diMinus.length > 0) {
      const diMinusSeries = indicatorChart.addLineSeries({ color: '#dc2626', lineWidth: 1, title: 'DI-' });
      diMinusSeries.setData(lines.diMinus);
    }

    let isSyncing = false;
    chart.timeScale().subscribeVisibleLogicalRangeChange(timeRange => {
      if (!isSyncing && timeRange) {
        isSyncing = true;
        indicatorChart.timeScale().setVisibleLogicalRange(timeRange);
        isSyncing = false;
      }
    });

    indicatorChart.timeScale().subscribeVisibleLogicalRangeChange(timeRange => {
      if (!isSyncing && timeRange) {
        isSyncing = true;
        chart.timeScale().setVisibleLogicalRange(timeRange);
        isSyncing = false;
      }
    });

    let isCrosshairSyncing = false;
    
    chart.subscribeCrosshairMove((param: any) => {
      if (!isCrosshairSyncing && param.time) {
        isCrosshairSyncing = true;
        const pt = lines?.adx?.find((d: any) => d.time === param.time);
        if (pt && adxSeriesRef.current) {
          indicatorChart.setCrosshairPosition(pt.value, param.time, adxSeriesRef.current);
        } else {
          indicatorChart.clearCrosshairPosition();
        }
        isCrosshairSyncing = false;
      } else if (!isCrosshairSyncing) {
        indicatorChart.clearCrosshairPosition();
      }
    });

    indicatorChart.subscribeCrosshairMove((param: any) => {
      if (!isCrosshairSyncing && param.time) {
        isCrosshairSyncing = true;
        const pt = data?.find((d: any) => d.time === param.time);
        if (pt && candlestickSeriesRef.current) {
          chart.setCrosshairPosition(pt.close, param.time, candlestickSeriesRef.current);
        } else {
          chart.clearCrosshairPosition();
        }
        isCrosshairSyncing = false;
      } else if (!isCrosshairSyncing) {
        chart.clearCrosshairPosition();
      }
    });

    // Click-to-pick
    chart.subscribeClick((param: any) => {
      if (!param.time || !pickModeRef.current || !onPickRef.current) return;
      const candle = data?.find((d: any) => d.time === param.time);
      const adxPt = lines?.adx?.find((d: any) => d.time === param.time);
      const diPlusPt = lines?.diPlus?.find((d: any) => d.time === param.time);
      const diMinusPt = lines?.diMinus?.find((d: any) => d.time === param.time);
      onPickRef.current({
        timestamp: param.time,
        Open: candle?.open ?? null,
        High: candle?.high ?? null,
        Low: candle?.low ?? null,
        Close: candle?.close ?? null,
        adx: adxPt?.value ?? null,
        diPlus: diPlusPt?.value ?? null,
        diMinus: diMinusPt?.value ?? null,
      });
    });

    indicatorChart.subscribeClick((param: any) => {
      if (!param.time || !pickModeRef.current || !onPickRef.current) return;
      const candle = data?.find((d: any) => d.time === param.time);
      const adxPt = lines?.adx?.find((d: any) => d.time === param.time);
      const diPlusPt = lines?.diPlus?.find((d: any) => d.time === param.time);
      const diMinusPt = lines?.diMinus?.find((d: any) => d.time === param.time);
      onPickRef.current({
        timestamp: param.time,
        Open: candle?.open ?? null,
        High: candle?.high ?? null,
        Low: candle?.low ?? null,
        Close: candle?.close ?? null,
        adx: adxPt?.value ?? null,
        diPlus: diPlusPt?.value ?? null,
        diMinus: diMinusPt?.value ?? null,
      });
    });

    const handleResize = () => {
      if (chartContainerRef.current) chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      if (indicatorContainerRef.current) indicatorChart.applyOptions({ width: indicatorContainerRef.current.clientWidth });
    };

    window.addEventListener('resize', handleResize);

    return () => { 
      window.removeEventListener('resize', handleResize);
      chart.remove(); 
      indicatorChart.remove();
    };
  }, [data, markers, lines, theme, showRangeLines]);

  return (
    <div className={`flex flex-col gap-0 border border-current ${pickMode ? 'cursor-crosshair' : ''}`}>
      <div ref={chartContainerRef} className="w-full h-[400px] border-b border-current" />
      <div ref={indicatorContainerRef} className="w-full h-[200px]" />
    </div>
  );
};

export default function Dashboard() {
  const [theme, setTheme, themeHydrated] = usePersistentState<'dark' | 'light'>('algoTester.theme', 'dark');
  const [csvFile, setCsvFile] = useState<File | null>(null);

  type Snapshot = {
    id: string;
    name: string;
    timestamp: number;
    Open: number | null; High: number | null; Low: number | null; Close: number | null;
    adx: number | null; diPlus: number | null; diMinus: number | null;
    dayType: 'absolute' | 'offset';
    dayOffset: number;
    indicator: string;
    condition: string;
    threshold: number | null;
  };
  type Rule = { id: string; left: string; operator: string; right: string; occurrence: 'any' | '1st' | '2nd' | '3rd'; };
  type ScenarioChain = {
    id: string;
    name: string;
    indicator: 'adx' | 'diPlus' | 'diMinus';
    crossThreshold: number;
    breakoutDirection: 'above' | 'below' | 'either';
    enabled: boolean;
  };

  const [snapshots, setSnapshots] = usePersistentState<Snapshot[]>('algoTester.snapshots', []);
  const [pickMode, setPickMode] = useState(false);
  const [pendingPick, setPendingPick] = useState<Omit<Snapshot,'id'|'name'> | null>(null);
  const [pendingName, setPendingName] = useState('');
  const [pickIndicator, setPickIndicator] = usePersistentState<'adx' | 'diPlus' | 'diMinus'>('algoTester.pickIndicator', 'adx');
  const [pickCondition, setPickCondition] = usePersistentState<string>('algoTester.pickCondition', 'Peak');
  const [pickThreshold, setPickThreshold] = usePersistentState<number>('algoTester.pickThreshold', 20);

  const [snapDayType, setSnapDayType] = usePersistentState<'absolute' | 'offset'>('algoTester.snapDayType', 'absolute');
  const [snapDayOffset, setSnapDayOffset] = usePersistentState<number>('algoTester.snapDayOffset', 0);

  const defaultRules: Rule[] = [
    { id: '1', left: 'row.diPlus', operator: '>', right: 'row.diMinus', occurrence: 'any' },
    { id: '2', left: 'row.adx', operator: '>', right: '25', occurrence: 'any' }
  ];
  const defaultChains: ScenarioChain[] = [
    { id: 'chain_1', name: 'diPlusCross20RangeBreak', indicator: 'diPlus', crossThreshold: 20, breakoutDirection: 'either', enabled: true }
  ];
  type StrategyProfile = {
    id: string;
    name: string;
    rules: Rule[];
    scenarioChains: ScenarioChain[];
    maxTradesPerDay: string;
    adxLength: number;
    showRangeLines: boolean;
  };
  const [rules, setRules] = usePersistentState<Rule[]>('algoTester.rules', defaultRules);
  const operators = ['>', '<', '>=', '<=', '==', '!='];

  const chartActionsRef = useRef<any>(null);
  const [maxTradesPerDay, setMaxTradesPerDay] = usePersistentState<string>('algoTester.maxTradesPerDay', '');
  const [adxLength, setAdxLength] = usePersistentState<number>('algoTester.adxLength', 14);
  const [showRangeLines, setShowRangeLines] = usePersistentState<boolean>('algoTester.showRangeLines', true);
  const [baseChartData, setBaseChartData] = usePersistentState<any[] | null>('algoTester.baseChartData', null);
  const [results, setResults] = usePersistentState<any | null>('algoTester.lastResults', null);
  const [loading, setLoading] = useState<boolean>(false);
  const [scenarioChains, setScenarioChains] = usePersistentState<ScenarioChain[]>('algoTester.scenarioChains', defaultChains);
  const [strategyProfiles, setStrategyProfiles] = usePersistentState<StrategyProfile[]>('algoTester.strategyProfiles', [
    { id: 'strategy_1', name: 'Strategy 1', rules: defaultRules, scenarioChains: defaultChains, maxTradesPerDay: '', adxLength: 14, showRangeLines: true }
  ]);
  const [activeStrategyId, setActiveStrategyId] = usePersistentState<string>('algoTester.activeStrategyId', 'strategy_1');
  const [strategyNameDraft, setStrategyNameDraft] = useState('');
  const sanitizeChainName = (name: string) => name.replace(/[^\w]/g, '_');

  useEffect(() => {
    const active = strategyProfiles.find(s => s.id === activeStrategyId);
    if (!active) return;
    setRules(active.rules || defaultRules);
    setScenarioChains(active.scenarioChains || defaultChains);
    setMaxTradesPerDay(active.maxTradesPerDay || '');
    setAdxLength(active.adxLength || 14);
    setShowRangeLines(active.showRangeLines !== false);
    setStrategyNameDraft(active.name || '');
  }, [activeStrategyId]);

  useEffect(() => {
    setStrategyProfiles(prev => prev.map(s => s.id === activeStrategyId ? {
      ...s,
      rules,
      scenarioChains,
      maxTradesPerDay,
      adxLength,
      showRangeLines,
    } : s));
  }, [rules, scenarioChains, maxTradesPerDay, adxLength, showRangeLines, activeStrategyId]);

  // Autocomplete suggestions for free-form inputs
  const suggestedVars = snapshots.flatMap(s => [
    `snap.${s.name}_Open`,`snap.${s.name}_High`,`snap.${s.name}_Low`,`snap.${s.name}_Close`,
    `snap.${s.name}_adx`,`snap.${s.name}_diPlus`,`snap.${s.name}_diMinus`,
  ]);
  const chainVars = scenarioChains.flatMap((chain) => {
    const base = `row.chain_${sanitizeChainName(chain.name)}`;
    return [
      `${base}_triggerClose`,
      `${base}_prevPeakClose`,
      `${base}_rangeHigh`,
      `${base}_rangeLow`,
      `${base}_breakoutClose`,
      `${base}_breakoutUp`,
      `${base}_breakoutDown`,
      `${base}_completed`,
    ];
  });
  const firstSignalVars = [
    'row.chainFirstSignal',
    'row.chainFirstSignalBuy',
    'row.chainFirstSignalSell',
  ];
  const allSuggestedVars = [...suggestedVars, ...chainVars, ...firstSignalVars];

  const getSimpleLabel = (s: Snapshot, prop: string) => {
    let ind = s.indicator === 'diPlus' ? 'DI+' : s.indicator === 'diMinus' ? 'DI-' : 'ADX';
    let cond = 'Peak';
    if (s.condition === 'Valley') cond = 'Valley';
    if (s.condition === 'CrossesAbove') cond = 'above';
    if (s.condition === 'CrossesBelow') cond = 'below';
    if (s.condition === 'PeakBeforeCross') cond = 'Peak before';
    if (s.condition === 'ValleyBeforeCross') cond = 'Valley before';
    if (s.condition === 'Value') cond = 'at';
    
    let thresh = s.threshold ? ` ${s.threshold}` : '';
    let day = s.dayType === 'offset' ? ` (${s.dayOffset === 0 ? 'Current' : `${s.dayOffset}d ago`})` : '';
    
    return `${ind} ${cond}${thresh}${day} [${prop}]`;
  };

  const handlePick = (data: any) => {

    setPendingPick(data);
    setPendingName('');
  };

  const confirmPick = () => {
    if (!pendingPick) return;
    const suffix = pendingName.trim().replace(/\s+/g, '_');
    let dayLabel = 'absolute';
    if (snapDayType === 'offset') {
      dayLabel = snapDayOffset === 0 ? 'currentDay' : `prevDay${snapDayOffset}`;
    }
    const hasThresh = pickCondition.includes('Cross') || pickCondition === 'Value';
    const threshStr = hasThresh ? `_at${pickThreshold}` : '';
    const baseName = `${pickIndicator}_${pickCondition}${threshStr}_${dayLabel}`;
    const finalName = suffix ? `${baseName}_${suffix}` : `${baseName}_${Date.now().toString().slice(-4)}`;
    setSnapshots(prev => [...prev, { 
      id: Date.now().toString(), 
      name: finalName, 
      ...pendingPick, 
      dayType: snapDayType, 
      dayOffset: snapDayOffset,
      indicator: pickIndicator,
      condition: pickCondition,
      threshold: hasThresh ? pickThreshold : null
    }]);
    setPendingPick(null);
    setPendingName('');
  };

  const onDropCsv = (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setCsvFile(acceptedFiles[0]);
      setResults(null); 
      Papa.parse(acceptedFiles[0], {
        header: true, dynamicTyping: true, skipEmptyLines: true,
        complete: (parsed: any) => {
          const formattedData = parsed.data.map((row: any) => ({
            time: Math.floor(new Date(row.Timestamp || row.Date || row.time).getTime() / 1000),
            open: row.Open, high: row.High, low: row.Low, close: row.Close
          })).filter((row: any) => !isNaN(row.time));
          formattedData.sort((a: any, b: any) => a.time - b.time);
          setBaseChartData(formattedData);
        }
      });
    }
  };
  const { getRootProps: getCsvProps, getInputProps: getCsvInput } = useDropzone({ onDrop: onDropCsv, accept: { 'text/csv': ['.csv'] } });

  const runBacktest = async () => {
    if (!csvFile) return;
    setLoading(true);
    const formData = new FormData();
    formData.append('csv_file', csvFile);
    // Free-form rules: left operator right
    const validRules = rules.filter(r => (r.left || '').trim() !== '' && (r.right || '').trim() !== '');
    const compiledCondition = validRules.length > 0
      ? validRules.map((r, idx) => {
          const baseExpr = `(${r.left || 'true'} ${r.operator} ${r.right || 'true'})`;
          if (r.occurrence === 'any') return baseExpr;
          const occIndex = r.occurrence === '1st' ? 0 : r.occurrence === '2nd' ? 1 : 2;
          const key = `_occ_${idx}`;
          return `(() => {
            const cond = ${baseExpr};
            if (!cond) return false;
            df.${key} = df.${key} || {};
            const dStr = new Date(row.Timestamp || row.Date || row.time).toISOString().split('T')[0];
            df.${key}[dStr] = df.${key}[dStr] || 0;
            if (df.${key}[dStr] === ${occIndex}) { df.${key}[dStr]++; return true; }
            df.${key}[dStr]++;
            return false;
          })()`;
        }).join(' && ')
      : 'false';
    formData.append('condition', compiledCondition);
    formData.append('snapshots', JSON.stringify(snapshots.map(s => ({ name: s.name, timestamp: s.timestamp }))));
    formData.append('scenarioChains', JSON.stringify(scenarioChains.filter(c => c.enabled)));
    formData.append('adxLength', String(adxLength));
    if (maxTradesPerDay) formData.append('maxTradesPerDay', maxTradesPerDay);
    try {
      const response = await axios.post('/api/backtest', formData);
      setResults(response.data);
    } catch (error) {
      console.error('Backtest failed', error);
    } finally {
      setLoading(false);
    }
  };

  const chartDataToDisplay = results ? results.chartData : (baseChartData || []);
  const persistedIndicatorLines = useMemo(() => {
    if (!baseChartData || baseChartData.length === 0) return null;
    const candles = baseChartData.map((r: any) => ({
      High: Number(r.high),
      Low: Number(r.low),
      Close: Number(r.close),
    }));
    const adx = calculateADX(candles, adxLength);
    return {
      adx: adx
        .map((v, i) => (v.adx === null || Number.isNaN(Number(v.adx)) ? null : { time: baseChartData[i].time, value: Number(v.adx) }))
        .filter((x: any) => x !== null),
      diPlus: adx
        .map((v, i) => (Number.isNaN(Number(v.diPlus)) ? null : { time: baseChartData[i].time, value: Number(v.diPlus) }))
        .filter((x: any) => x !== null),
      diMinus: adx
        .map((v, i) => (Number.isNaN(Number(v.diMinus)) ? null : { time: baseChartData[i].time, value: Number(v.diMinus) }))
        .filter((x: any) => x !== null),
    };
  }, [baseChartData, adxLength]);
  const linesToDisplay = results?.lines || persistedIndicatorLines;

  const isDark = theme === 'dark';
  const bgClass = isDark ? 'bg-[#0a0a0a]' : 'bg-[#f3f4f6]';
  const textClass = isDark ? 'text-gray-200' : 'text-gray-900';
  const panelBg = isDark ? 'bg-[#111111]' : 'bg-white';
  const borderClass = isDark ? 'border-[#333333]' : 'border-gray-300';
  const inputBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';

  if (!themeHydrated) return null;

  return (
    <div className={`min-h-screen ${bgClass} ${textClass} p-4 md:p-8 font-sans transition-colors duration-200`}>
      <div className="max-w-[1600px] mx-auto flex flex-col gap-6">
        
        {/* Header */}
        <header className={`flex items-center justify-between border-b ${borderClass} pb-4`}>
          <div>
            <h1 className="text-2xl font-bold uppercase tracking-wider">
              Algo Tester Pro
            </h1>
            <p className="text-xs text-gray-500 uppercase tracking-widest mt-1">Terminal Edition v1.0</p>
          </div>
          <div className="flex items-center gap-4">
            <select 
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'dark'|'light')}
              className={`text-xs font-semibold uppercase p-2 border rounded-none focus:outline-none ${panelBg} ${borderClass} cursor-pointer`}
            >
              <option value="dark">Dark Theme</option>
              <option value="light">Light Theme</option>
            </select>
            <div className="flex items-center gap-2 border-l pl-4 border-inherit">
              <div className="w-2 h-2 bg-green-500"></div>
              <span className="text-xs font-bold uppercase tracking-wider">Online</span>
            </div>
          </div>
        </header>

        {/* Main Layout Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* LEFT SIDEBAR: Strategy Builder */}
          <aside className="lg:col-span-3 flex flex-col gap-6">
            <div className={`${panelBg} border ${borderClass} p-5`}>
              <h2 className="text-sm font-bold uppercase tracking-widest mb-4 border-b border-inherit pb-2">
                Strategy Configuration
              </h2>
              
              <div className="space-y-5">
                <div {...getCsvProps()} className={`border border-dashed ${borderClass} p-4 text-center cursor-pointer ${inputBg} hover:bg-opacity-80 transition-colors`}>
                  <input {...getCsvInput()} />
                  <p className="text-xs font-bold uppercase tracking-wide">
                    {csvFile ? csvFile.name : "Select CSV File"}
                  </p>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest mb-2 text-gray-500">Strategy</label>
                  <div className={`p-2 border ${borderClass} ${inputBg} space-y-2`}>
                    <div className="flex items-center gap-2">
                      <select
                        value={activeStrategyId}
                        onChange={(e) => setActiveStrategyId(e.target.value)}
                        className={`flex-1 p-1 border ${borderClass} bg-transparent text-xs`}
                      >
                        {strategyProfiles.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => {
                          const id = `strategy_${Date.now()}`;
                          const name = `Strategy ${strategyProfiles.length + 1}`;
                          const next: StrategyProfile = { id, name, rules: [...defaultRules], scenarioChains: [...defaultChains], maxTradesPerDay: '', adxLength: 14, showRangeLines: true };
                          setStrategyProfiles(prev => [...prev, next]);
                          setActiveStrategyId(id);
                        }}
                        className={`px-2 py-1 text-[10px] border ${borderClass} hover:bg-gray-500 hover:text-white transition-colors`}
                      >
                        + New
                      </button>
                      <button
                        onClick={() => {
                          if (strategyProfiles.length <= 1) return;
                          const filtered = strategyProfiles.filter(s => s.id !== activeStrategyId);
                          setStrategyProfiles(filtered);
                          setActiveStrategyId(filtered[0].id);
                        }}
                        className="px-2 py-1 text-[10px] text-red-500 border border-transparent hover:border-red-500 hover:bg-red-500 hover:text-white transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        value={strategyNameDraft}
                        onChange={(e) => setStrategyNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          const nextName = strategyNameDraft.trim();
                          if (!nextName) return;
                          setStrategyProfiles(prev => prev.map(s => s.id === activeStrategyId ? { ...s, name: nextName } : s));
                        }}
                        className={`flex-1 p-1 border ${borderClass} bg-transparent text-xs font-mono focus:outline-none`}
                        placeholder="Rename current strategy"
                      />
                      <button
                        onClick={() => {
                          const nextName = strategyNameDraft.trim();
                          if (!nextName) return;
                          setStrategyProfiles(prev => prev.map(s => s.id === activeStrategyId ? { ...s, name: nextName } : s));
                        }}
                        className={`px-2 py-1 text-[10px] border ${borderClass} hover:bg-blue-600 hover:text-white transition-colors`}
                      >
                        Rename
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest mb-2 text-gray-500">Buy Conditions (AND)</label>
                  {/* Datalist for autocomplete */}
                  <datalist id="vars-list">
                    {allSuggestedVars.map(v => <option key={v} value={v} />)}
                  </datalist>
                  <div className="space-y-2">
                    {rules.map((rule, idx) => (
                      <div key={rule.id} className={`flex flex-col gap-1 p-2 border ${borderClass} ${inputBg}`}>
                        <div className="flex items-center gap-1">
                          <select
                            value={rule.left}
                            onChange={(e) => { const r = [...rules]; r[idx].left = e.target.value; setRules(r); }}
                            className={`flex-1 min-w-0 p-1 border ${borderClass} bg-[#1a1a1a] text-xs font-mono text-white focus:outline-none focus:border-blue-500`}
                          >
                            <option value="">Select Target</option>
                            {snapshots.map(s => (
                              <optgroup key={s.id} label={s.name}>
                                {['Open','High','Low','Close','adx','diPlus','diMinus'].map(prop => (
                                  <option key={`${s.id}_${prop}`} value={`snap.${s.name}_${prop}`}>
                                    {getSimpleLabel(s, prop)}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                            {scenarioChains.map((chain) => (
                              <optgroup key={chain.id} label={`chain.${chain.name}`}>
                                <option value={`row.chain_${sanitizeChainName(chain.name)}_triggerClose`}>Trigger candle close</option>
                                <option value={`row.chain_${sanitizeChainName(chain.name)}_prevPeakClose`}>Previous peak candle close</option>
                                <option value={`row.chain_${sanitizeChainName(chain.name)}_rangeHigh`}>Range high</option>
                                <option value={`row.chain_${sanitizeChainName(chain.name)}_rangeLow`}>Range low</option>
                                <option value={`row.chain_${sanitizeChainName(chain.name)}_breakoutClose`}>Breakout candle close</option>
                                <option value={`row.chain_${sanitizeChainName(chain.name)}_breakoutUp`}>Breakout above (bool)</option>
                                <option value={`row.chain_${sanitizeChainName(chain.name)}_breakoutDown`}>Breakout below (bool)</option>
                                <option value={`row.chain_${sanitizeChainName(chain.name)}_completed`}>Chain completed (bool)</option>
                              </optgroup>
                            ))}
                            <optgroup label="chain.firstTrigger">
                              <option value="row.chainFirstSignal">First signal side (BUY/SELL)</option>
                              <option value="row.chainFirstSignalBuy">First signal is BUY (bool)</option>
                              <option value="row.chainFirstSignalSell">First signal is SELL (bool)</option>
                            </optgroup>
                          </select>

                          <select
                            value={rule.operator}
                            onChange={(e) => { const r = [...rules]; r[idx].operator = e.target.value; setRules(r); }}
                            className={`p-1 border ${borderClass} bg-transparent text-xs font-bold text-blue-500 focus:outline-none shrink-0`}
                          >
                            {operators.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>

                          <input
                            list="vars-list"
                            value={rule.right}
                            onChange={(e) => { const r = [...rules]; r[idx].right = e.target.value; setRules(r); }}
                            className={`flex-1 min-w-0 p-1 border ${borderClass} bg-transparent text-xs font-mono focus:outline-none focus:border-blue-500`}
                            placeholder="Value or Var"
                          />
                        </div>

                        <div className="flex items-center justify-between mt-1 pt-1 border-t border-inherit">
                          <select
                            value={rule.occurrence}
                            onChange={(e: any) => { const r = [...rules]; r[idx].occurrence = e.target.value; setRules(r); }}
                            className={`p-1 border ${borderClass} bg-transparent text-[10px] font-bold text-amber-500 focus:outline-none`}
                          >
                            <option value="any">Any Occurrence</option>
                            <option value="1st">1st of Day</option>
                            <option value="2nd">2nd of Day</option>
                            <option value="3rd">3rd of Day</option>
                          </select>

                          <button
                            onClick={() => setRules(rules.filter(r => r.id !== rule.id))}
                            className="p-1 px-2 text-red-500 hover:text-white hover:bg-red-500 border border-transparent hover:border-red-500 transition-colors text-xs"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => setRules([...rules, { id: Date.now().toString(), left: 'row.Close', operator: '>', right: '0', occurrence: 'any' }])}
                    className={`mt-2 w-full p-2 text-[10px] font-bold uppercase tracking-widest border ${borderClass} hover:bg-gray-500 hover:text-white transition-colors`}
                  >+ Add Condition</button>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest mb-2 text-gray-500">Scenario Chains</label>
                  <div className={`p-2 border ${borderClass} ${inputBg} space-y-2`}>
                    {scenarioChains.map((chain, idx) => (
                      <div key={chain.id} className={`p-2 border ${borderClass} space-y-2`}>
                        <div className="flex items-center justify-between">
                          <input
                            value={chain.name}
                            onChange={(e) => {
                              const next = [...scenarioChains];
                              next[idx].name = e.target.value.replace(/\s+/g, '_');
                              setScenarioChains(next);
                            }}
                            className={`flex-1 p-1 border ${borderClass} bg-transparent text-xs font-mono focus:outline-none`}
                            placeholder="chain_name"
                          />
                          <label className="ml-2 text-[10px] flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={chain.enabled}
                              onChange={(e) => {
                                const next = [...scenarioChains];
                                next[idx].enabled = e.target.checked;
                                setScenarioChains(next);
                              }}
                            />
                            Enable
                          </label>
                          <button
                            onClick={() => setScenarioChains(prev => prev.filter(c => c.id !== chain.id))}
                            className="ml-2 px-2 py-1 text-[10px] text-red-500 border border-transparent hover:border-red-500 hover:bg-red-500 hover:text-white transition-colors"
                            title="Remove chain"
                          >
                            Remove
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                          <select
                            value={chain.indicator}
                            onChange={(e: any) => {
                              const next = [...scenarioChains];
                              next[idx].indicator = e.target.value;
                              setScenarioChains(next);
                            }}
                            className={`p-1 border ${borderClass} bg-transparent text-[10px]`}
                          >
                            <option value="adx">ADX</option>
                            <option value="diPlus">DI+</option>
                            <option value="diMinus">DI-</option>
                          </select>
                          <input
                            type="number"
                            value={chain.crossThreshold}
                            onChange={(e) => {
                              const next = [...scenarioChains];
                              next[idx].crossThreshold = parseFloat(e.target.value) || 0;
                              setScenarioChains(next);
                            }}
                            className={`p-1 border ${borderClass} bg-transparent text-[10px] font-mono`}
                            placeholder="Cross"
                          />
                          <select
                            value={chain.breakoutDirection}
                            onChange={(e: any) => {
                              const next = [...scenarioChains];
                              next[idx].breakoutDirection = e.target.value;
                              setScenarioChains(next);
                            }}
                            className={`p-1 border ${borderClass} bg-transparent text-[10px]`}
                          >
                            <option value="either">Break Either</option>
                            <option value="above">Break Above</option>
                            <option value="below">Break Below</option>
                          </select>
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={() => setScenarioChains(prev => [...prev, { id: Date.now().toString(), name: `chain_${prev.length + 1}`, indicator: 'diPlus', crossThreshold: 20, breakoutDirection: 'either', enabled: true }])}
                      className={`w-full p-1 text-[10px] font-bold uppercase tracking-widest border ${borderClass} hover:bg-gray-500 hover:text-white transition-colors`}
                    >
                      + Add Chain
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest mb-1 text-gray-500">Indicator Settings</label>
                  <div className={`p-2 border ${borderClass} ${inputBg} flex items-center justify-between`}>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">ADX Length</span>
                    <input
                      type="number"
                      min="2"
                      value={adxLength}
                      onChange={(e) => setAdxLength(Math.max(2, parseInt(e.target.value || '14', 10) || 14))}
                      className={`w-20 p-1 border ${borderClass} bg-transparent text-xs font-mono focus:outline-none`}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest mb-1 text-gray-500">Max Trades/Day</label>
                  <input 
                    type="number" 
                    min="1" 
                    value={maxTradesPerDay} 
                    onChange={(e) => setMaxTradesPerDay(e.target.value)} 
                    className={`w-full p-2 border ${borderClass} ${inputBg} text-xs font-mono focus:outline-none focus:border-blue-500`}
                    placeholder="Unlimited" 
                  />
                </div>
                <div className={`p-2 border ${borderClass} ${inputBg}`}>
                  <label className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={showRangeLines}
                      onChange={(e) => setShowRangeLines(e.target.checked)}
                    />
                    Show Parallel Lines
                  </label>
                </div>

                <button 
                  onClick={runBacktest} 
                  disabled={!csvFile || loading} 
                  className={`w-full py-3 text-xs font-bold uppercase tracking-widest border ${borderClass} transition-colors ${loading || !csvFile ? 'opacity-50 cursor-not-allowed bg-transparent text-gray-500' : isDark ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600' : 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600'}`}
                >
                  {loading ? "Executing..." : "Run Backtest"}
                </button>
              </div>
            </div>

            {/* Terminal Debug Console */}
            <div className={`${panelBg} border ${borderClass} p-4 flex flex-col h-40`}>
              <h2 className="text-[10px] font-bold uppercase tracking-widest mb-2 border-b border-inherit pb-1 text-gray-500">
                System Output
              </h2>
              <div className="text-[11px] font-mono flex-1 overflow-y-auto space-y-1">
                <p className="text-blue-500">&gt; Awaiting execution...</p>
                {results && (
                  <>
                    <p>&gt; Data points: {chartDataToDisplay.length}</p>
                    <p>&gt; ADX valid: {results?.lines?.adx?.length || 0}</p>
                    <p>&gt; Process complete.</p>
                  </>
                )}
              </div>
            </div>

            {/* Snapshots Panel */}
            {snapshots.length > 0 && (
              <div className={`${panelBg} border ${borderClass} p-4`}>
                <h2 className="text-[10px] font-bold uppercase tracking-widest mb-2 border-b border-inherit pb-1 text-gray-500">Snapshots</h2>
                <div className="space-y-2">
                  {snapshots.map(s => (
                    <div key={s.id} className={`border ${borderClass} p-2 text-[10px] font-mono`}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-bold text-blue-400 uppercase">{s.name}</span>
                        <button onClick={() => setSnapshots(snapshots.filter(x => x.id !== s.id))} className="text-red-500 hover:text-white hover:bg-red-500 px-1 border border-transparent hover:border-red-500 transition-colors">✕</button>
                      </div>
                      <div className="text-gray-400 space-y-0.5">
                        <div>O:{s.Open?.toFixed(2)} H:{s.High?.toFixed(2)} L:{s.Low?.toFixed(2)} C:{s.Close?.toFixed(2)}</div>
                        <div>ADX:{s.adx?.toFixed(2)} DI+:{s.diPlus?.toFixed(2)} DI-:{s.diMinus?.toFixed(2)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Name Prompt Modal */}
            {pendingPick && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70">
                <div className={`${panelBg} border ${borderClass} p-6 w-80`}>
                  <h2 className="text-sm font-bold uppercase tracking-widest mb-4">Name This Snapshot</h2>
                  <div className={`text-[10px] font-mono border ${borderClass} p-2 mb-3 text-gray-400`}>
                    <div>O:{pendingPick.Open?.toFixed(2)} H:{pendingPick.High?.toFixed(2)} L:{pendingPick.Low?.toFixed(2)} C:{pendingPick.Close?.toFixed(2)}</div>
                    <div>ADX:{pendingPick.adx?.toFixed(2)} DI+:{pendingPick.diPlus?.toFixed(2)} DI-:{pendingPick.diMinus?.toFixed(2)}</div>
                  </div>

                  <div className="mb-3">
                    <label className="block text-[10px] font-bold uppercase tracking-widest mb-1 text-gray-500">Target Line</label>
                    <select
                      value={pickIndicator}
                      onChange={(e: any) => setPickIndicator(e.target.value)}
                      className={`w-full p-1 border ${borderClass} bg-transparent text-xs font-bold text-blue-500 focus:outline-none`}
                    >
                      <option value="adx">ADX</option>
                      <option value="diPlus">DI+</option>
                      <option value="diMinus">DI-</option>
                    </select>
                  </div>

                  <div className="mb-3">
                    <label className="block text-[10px] font-bold uppercase tracking-widest mb-1 text-gray-500">Condition Type</label>
                    <select
                      value={pickCondition}
                      onChange={(e) => setPickCondition(e.target.value)}
                      className={`w-full p-1 border ${borderClass} bg-transparent text-xs focus:outline-none`}
                    >
                      <option value="Peak">Peak</option>
                      <option value="Valley">Valley</option>
                      <option value="CrossesAbove">Crosses Above from Below</option>
                      <option value="CrossesBelow">Crosses Below from Above</option>
                      <option value="PeakBeforeCross">Peak before Crossover</option>
                      <option value="ValleyBeforeCross">Valley before Crossover</option>
                      <option value="Value">Specific Value</option>
                    </select>
                  </div>

                  {(pickCondition.includes('Cross') || pickCondition === 'Value') && (
                    <div className="mb-3">
                      <label className="block text-[10px] font-bold uppercase tracking-widest mb-1 text-gray-500">Threshold Level</label>
                      <input
                        type="number"
                        value={pickThreshold}
                        onChange={(e) => setPickThreshold(parseFloat(e.target.value) || 0)}
                        className={`w-full p-1 border ${borderClass} bg-transparent text-xs font-mono focus:outline-none`}
                      />
                    </div>
                  )}

                  <div className="mb-3">
                    <label className="block text-[10px] font-bold uppercase tracking-widest mb-1 text-gray-500">Day Reference</label>
                    <select
                      value={snapDayType}
                      onChange={(e: any) => setSnapDayType(e.target.value)}
                      className={`w-full p-1 border ${borderClass} bg-transparent text-xs focus:outline-none`}
                    >
                      <option value="absolute">Specific/Absolute Time</option>
                      <option value="offset">Relative Day Offset</option>
                    </select>
                  </div>

                  {snapDayType === 'offset' && (
                    <div className="mb-3">
                      <label className="block text-[10px] font-bold uppercase tracking-widest mb-1 text-gray-500">How many days ago? (0 = Current)</label>
                      <input
                        type="number"
                        min="0"
                        value={snapDayOffset}
                        onChange={(e) => setSnapDayOffset(parseInt(e.target.value) || 0)}
                        className={`w-full p-1 border ${borderClass} bg-transparent text-xs font-mono focus:outline-none`}
                      />
                    </div>
                  )}

                  <div className="mb-3">
                    <label className="block text-[10px] font-bold uppercase tracking-widest mb-1 text-gray-500">Custom Suffix (Optional)</label>
                    <input
                      type="text"
                      value={pendingName}
                      onChange={e => setPendingName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') confirmPick(); if (e.key === 'Escape') setPendingPick(null); }}
                      className={`w-full p-2 border ${borderClass} ${inputBg} text-sm font-mono focus:outline-none focus:border-blue-500`}
                      placeholder="e.g. breakout, level"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button onClick={confirmPick} className="flex-1 py-2 bg-blue-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-blue-700 transition-colors">Confirm</button>
                    <button onClick={() => setPendingPick(null)} className={`flex-1 py-2 text-xs font-bold uppercase tracking-widest border ${borderClass} hover:bg-gray-500 hover:text-white transition-colors`}>Cancel</button>
                  </div>
                </div>
              </div>
            )}

          </aside>

          {/* RIGHT MAIN AREA: Charts and Stats */}
          <main className="lg:col-span-9 flex flex-col gap-6">
            
            {/* KPI Cards */}
            {results && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className={`${panelBg} border ${borderClass} p-4 flex flex-col`}>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Total Trades</span>
                  <span className="text-2xl font-mono mt-1">{results.stats.totalTrades}</span>
                </div>
                
                <div className={`${panelBg} border ${borderClass} p-4 flex flex-col`}>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Win Rate</span>
                  <span className="text-2xl font-mono mt-1 text-green-600">{results.stats.winRate}%</span>
                </div>
                
                <div className={`${panelBg} border ${borderClass} p-4 flex flex-col`}>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Net Profit</span>
                  <span className="text-2xl font-mono mt-1 text-blue-600">{results.stats.netProfit}</span>
                </div>
              </div>
            )}

            {/* Charts Container */}
            <div className={`${panelBg} border ${borderClass} p-4`}>
              <div className="flex items-center justify-between mb-4 border-b border-inherit pb-2">
                <h2 className="text-sm font-bold uppercase tracking-widest">Performance Chart</h2>
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                  <button
                    onClick={() => chartActionsRef.current?.goToStart()}
                    className={`px-3 py-1 border border-${borderClass} hover:bg-gray-500 hover:text-white transition-colors`}
                    title="Go to Start"
                  >
                    ◀◀ Start
                  </button>
                  <button
                    onClick={() => chartActionsRef.current?.fitContent()}
                    className={`px-3 py-1 border border-${borderClass} hover:bg-gray-500 hover:text-white transition-colors`}
                    title="Fit Content"
                  >
                    Fit All
                  </button>
                  <button
                    onClick={() => chartActionsRef.current?.goToEnd()}
                    className={`px-3 py-1 border border-${borderClass} hover:bg-gray-500 hover:text-white transition-colors`}
                    title="Go to End"
                  >
                    End ▶▶
                  </button>

                  <button
                    onClick={() => { setPickMode(!pickMode); setPendingPick(null); }}
                    className={`ml-2 px-3 py-1 border text-[10px] font-bold uppercase tracking-widest transition-colors ${
                      pickMode
                        ? 'bg-amber-500 border-amber-500 text-black'
                        : `border-${borderClass} hover:bg-amber-500 hover:border-amber-500 hover:text-black ${borderClass}`
                    }`}
                  >
                    {pickMode ? '● Picking…' : '⊕ Pick Mode'}
                  </button>
                  <div className="flex items-center gap-1.5 ml-2"><div className="w-2 h-2 bg-[#8b5cf6]"></div><span>ADX</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-[#16a34a]"></div><span>DI+</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-[#dc2626]"></div><span>DI-</span></div>
                </div>
              </div>
              <div className={borderClass}>
                <CandlestickChart data={chartDataToDisplay} markers={results?.markers} lines={linesToDisplay} theme={theme} pickMode={pickMode} onPick={handlePick} chartActionsRef={chartActionsRef} showRangeLines={showRangeLines} />
              </div>
            </div>
          </main>

        </div>
      </div>
    </div>
  );
}