import { NextResponse } from 'next/server';
import Papa from 'papaparse';
import { applyIndicator } from '../../indicator';

type ScenarioChain = {
  id: string;
  name: string;
  indicator: 'adx' | 'diPlus' | 'diMinus';
  crossThreshold: number;
  breakoutDirection: 'above' | 'below' | 'either';
  enabled?: boolean;
};
type RangePair = { high: number; low: number } | null;

function toDateStr(row: any): string {
  const t = new Date(row.Timestamp || row.Date || row.time).getTime();
  return new Date(t).toISOString().split('T')[0];
}

function runScenarioChains(enrichedData: any[], scenarioChains: ScenarioChain[]) {
  const chainMarkers: any[] = [];
  if (!scenarioChains.length) return chainMarkers;
  const groups: Record<string, any[]> = {};
  for (const row of enrichedData) {
    const d = toDateStr(row);
    groups[d] = groups[d] || [];
    groups[d].push(row);
  }

  for (const chain of scenarioChains) {
    if (chain.enabled === false) continue;
    const safeName = (chain.name || chain.id || 'chain').replace(/[^\w]/g, '_');
    const prefix = `chain_${safeName}`;

    for (const dayRows of Object.values(groups)) {
      let triggerIdx = -1;
      let triggerClose: number | null = null;
      let prevPeakClose: number | null = null;
      let rangeHigh: number | null = null;
      let rangeLow: number | null = null;
      let breakoutClose: number | null = null;
      let breakoutTime: number | null = null;
      let breakoutUp = false;
      let breakoutDown = false;
      let completed = false;
      const firstIndicator = Number(dayRows[0]?.[chain.indicator]);
      const firstDiMinus = Number(dayRows[0]?.diMinus);
      const firstDiPlus = Number(dayRows[0]?.diPlus);
      const requiresDiMinusConfirmation = chain.indicator === 'diPlus'; // scenario 1
      const requiresDiPlusConfirmation = chain.indicator === 'diMinus'; // scenario 2
      const isDayStartValid = requiresDiMinusConfirmation
        ? Number.isFinite(firstDiPlus) && Number.isFinite(firstDiMinus) && firstDiPlus < chain.crossThreshold && firstDiMinus > chain.crossThreshold
        : requiresDiPlusConfirmation
          ? Number.isFinite(firstDiPlus) && Number.isFinite(firstDiMinus) && firstDiMinus < chain.crossThreshold && firstDiPlus > chain.crossThreshold
          : Number.isFinite(firstIndicator);

      for (let i = 0; i < dayRows.length; i++) {
        const row = dayRows[i];
        const curr = Number(row[chain.indicator]);
        const prev = i > 0 ? Number(dayRows[i - 1][chain.indicator]) : NaN;

        if (triggerIdx === -1 && i > 0 && isDayStartValid && Number.isFinite(curr) && Number.isFinite(prev)) {
          if (prev < chain.crossThreshold && curr >= chain.crossThreshold) {
            let preTriggerRegimeValid = true;
            if (requiresDiMinusConfirmation || requiresDiPlusConfirmation) {
              for (let k = 0; k < i; k++) {
                const kDiPlus = Number(dayRows[k].diPlus);
                const kDiMinus = Number(dayRows[k].diMinus);
                const regimeOk = requiresDiMinusConfirmation
                  ? (kDiPlus < chain.crossThreshold && kDiMinus > chain.crossThreshold)
                  : (kDiMinus < chain.crossThreshold && kDiPlus > chain.crossThreshold);
                if (!Number.isFinite(kDiPlus) || !Number.isFinite(kDiMinus) || !regimeOk) {
                  preTriggerRegimeValid = false;
                  break;
                }
              }
            }
            if (!preTriggerRegimeValid) continue;

            triggerIdx = i;
            triggerClose = Number(row.Close);
            const triggerTimeUnix = Math.floor(new Date(row.Timestamp || row.Date || row.time).getTime() / 1000);
            chainMarkers.push({
              time: triggerTimeUnix,
              position: 'aboveBar',
              color: '#f59e0b',
              shape: 'circle',
              text: `${safeName}:Cross`,
            });

            let peakVal = -Infinity;
            let peakPriceClose: number | null = null;
            let peakIdxInDay = -1;
            for (let j = 1; j < triggerIdx; j++) {
              const pPrev = Number(dayRows[j - 1][chain.indicator]);
              const pCurr = Number(dayRows[j][chain.indicator]);
              const pNext = Number(dayRows[j + 1][chain.indicator]);
              if (!Number.isFinite(pPrev) || !Number.isFinite(pCurr) || !Number.isFinite(pNext)) continue;
              if (pCurr > pPrev && pCurr > pNext && pCurr > peakVal) {
                peakVal = pCurr;
                peakPriceClose = Number(dayRows[j].Close);
                peakIdxInDay = j;
              }
            }

            if (peakPriceClose === null && triggerIdx > 0) {
              peakPriceClose = Number(dayRows[triggerIdx - 1].Close);
              peakIdxInDay = triggerIdx - 1;
            }
            prevPeakClose = peakPriceClose;
            if (peakPriceClose !== null && peakIdxInDay >= 0) {
              const peakRow = dayRows[peakIdxInDay];
              const peakTimeUnix = Math.floor(new Date(peakRow.Timestamp || peakRow.Date || peakRow.time).getTime() / 1000);
              chainMarkers.push({
                time: peakTimeUnix,
                position: 'belowBar',
                color: '#22c55e',
                shape: 'square',
                text: `${safeName}:Peak`,
              });
            }

            if (triggerClose !== null && prevPeakClose !== null) {
              rangeHigh = Math.max(triggerClose, prevPeakClose);
              rangeLow = Math.min(triggerClose, prevPeakClose);
            }
          }
        } else if (!completed && rangeHigh !== null && rangeLow !== null) {
          const close = Number(row.Close);
          const hitUp = close > rangeHigh;
          const hitDown = close < rangeLow;
          const allowUp = chain.breakoutDirection === 'above' || chain.breakoutDirection === 'either';
          const allowDown = chain.breakoutDirection === 'below' || chain.breakoutDirection === 'either';
          if ((allowUp && hitUp) || (allowDown && hitDown)) {
            breakoutClose = close;
            breakoutTime = Math.floor(new Date(row.Timestamp || row.Date || row.time).getTime() / 1000);
            breakoutUp = allowUp && hitUp;
            breakoutDown = allowDown && hitDown;
            completed = true;
            chainMarkers.push({
              time: breakoutTime,
              position: breakoutUp ? 'aboveBar' : 'belowBar',
              color: breakoutUp ? '#3b82f6' : '#ef4444',
              shape: breakoutUp ? 'arrowUp' : 'arrowDown',
              text: `${safeName}:Break`,
            });
          }
        }

        row[`${prefix}_triggerClose`] = triggerClose;
        row[`${prefix}_prevPeakClose`] = prevPeakClose;
        row[`${prefix}_rangeHigh`] = rangeHigh;
        row[`${prefix}_rangeLow`] = rangeLow;
        row[`${prefix}_breakoutClose`] = breakoutClose;
        row[`${prefix}_breakoutTime`] = breakoutTime;
        row[`${prefix}_breakoutUp`] = breakoutUp;
        row[`${prefix}_breakoutDown`] = breakoutDown;
        row[`${prefix}_completed`] = completed;
      }
    }
  }
  return chainMarkers;
}

function applyFirstTriggeredSignal(enrichedData: any[], scenarioChains: ScenarioChain[]) {
  const firstSignalMarkers: any[] = [];
  if (!scenarioChains.length) return firstSignalMarkers;
  const groups: Record<string, any[]> = {};
  for (const row of enrichedData) {
    const d = toDateStr(row);
    groups[d] = groups[d] || [];
    groups[d].push(row);
  }

  for (const dayRows of Object.values(groups)) {
    let best: { time: number; side: 'BUY' | 'SELL' } | null = null;
    for (const chain of scenarioChains) {
      if (chain.enabled === false) continue;
      const safeName = (chain.name || chain.id || 'chain').replace(/[^\w]/g, '_');
      const prefix = `chain_${safeName}`;
      const candidate = dayRows.find((r) => Number.isFinite(Number(r[`${prefix}_breakoutTime`])) && r[`${prefix}_completed`] === true);
      if (!candidate) continue;
      const cTime = Number(candidate[`${prefix}_breakoutTime`]);
      const cSide: 'BUY' | 'SELL' = candidate[`${prefix}_breakoutUp`] ? 'BUY' : 'SELL';
      if (!best || cTime < best.time) best = { time: cTime, side: cSide };
    }

    for (const row of dayRows) {
      row.chainFirstSignal = null;
      row.chainFirstSignalBuy = false;
      row.chainFirstSignalSell = false;
    }

    if (best) {
      const winner = dayRows.find((r) => Math.floor(new Date(r.Timestamp || r.Date || r.time).getTime() / 1000) === best!.time);
      if (winner) {
        winner.chainFirstSignal = best.side;
        winner.chainFirstSignalBuy = best.side === 'BUY';
        winner.chainFirstSignalSell = best.side === 'SELL';
      }
      firstSignalMarkers.push({
        time: best.time,
        position: best.side === 'BUY' ? 'aboveBar' : 'belowBar',
        color: best.side === 'BUY' ? '#10b981' : '#f97316',
        shape: best.side === 'BUY' ? 'arrowUp' : 'arrowDown',
        text: `First:${best.side}`,
      });
    }
  }

  return firstSignalMarkers;
}

function getRowRangePair(row: any, scenarioChains: ScenarioChain[]): RangePair {
  for (const chain of scenarioChains) {
    if (chain.enabled === false) continue;
    const safeName = (chain.name || chain.id || 'chain').replace(/[^\w]/g, '_');
    const prefix = `chain_${safeName}`;
    const highRaw = row[`${prefix}_rangeHigh`];
    const lowRaw = row[`${prefix}_rangeLow`];
    if (highRaw === null || highRaw === undefined || lowRaw === null || lowRaw === undefined) continue;
    const high = Number(highRaw);
    const low = Number(lowRaw);
    const completed = row[`${prefix}_completed`] === true;
    if (Number.isFinite(high) && Number.isFinite(low) && !completed) return { high, low };
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const csvFile = formData.get('csv_file') as File;
    const condition = formData.get('condition') as string;
    const maxTradesStr = formData.get('maxTradesPerDay') as string;
    const maxTradesPerDay = maxTradesStr ? parseInt(maxTradesStr) : null;
    const snapshotsStr = formData.get('snapshots') as string | null;
    const snapshots: { name: string; timestamp: number }[] = snapshotsStr ? JSON.parse(snapshotsStr) : [];
    const scenarioChainsStr = formData.get('scenarioChains') as string | null;
    const scenarioChains: ScenarioChain[] = scenarioChainsStr ? JSON.parse(scenarioChainsStr) : [];
    const adxLengthStr = formData.get('adxLength') as string | null;
    const adxLength = adxLengthStr ? Math.max(2, parseInt(adxLengthStr, 10) || 14) : 14;

    if (!csvFile) return NextResponse.json({ error: 'Missing CSV file' }, { status: 400 });

    const csvText = await csvFile.text();
    const parsedData = Papa.parse(csvText, { header: true, dynamicTyping: true, skipEmptyLines: true });
    let df = parsedData.data as any[];

    // Ensure we have a valid timestamp, remove duplicates, and sort chronologically
    df = df.filter(row => (row.Timestamp || row.Date || row.time) && !isNaN(new Date(row.Timestamp || row.Date || row.time).getTime()));
    
    // Sort ascending by time
    df.sort((a, b) => new Date(a.Timestamp || a.Date || a.time).getTime() - new Date(b.Timestamp || b.Date || b.time).getTime());

    // Remove duplicates based on Unix timestamp (which chart uses)
    const uniqueDf = [];
    let lastTime = 0;
    for (const row of df) {
      const timeUnix = Math.floor(new Date(row.Timestamp || row.Date || row.time).getTime() / 1000);
      if (timeUnix !== lastTime) {
        uniqueDf.push(row);
        lastTime = timeUnix;
      }
    }

    // Attach Previous Day Context
    let currentDayStr = '';
    let currentDayHigh = -Infinity;
    let currentDayLow = Infinity;
    let currentDayClose = 0;
    
    let prevDayHigh: number | null = null;
    let prevDayLow: number | null = null;
    let prevDayClose: number | null = null;

    for (let i = 0; i < uniqueDf.length; i++) {
      const row = uniqueDf[i];
      const timeUnix = Math.floor(new Date(row.Timestamp || row.Date || row.time).getTime() / 1000);
      const dateStr = new Date(timeUnix * 1000).toISOString().split('T')[0];

      if (currentDayStr === '') {
        currentDayStr = dateStr;
      }

      if (dateStr !== currentDayStr) {
        // Day changed, commit current day to prevDay
        prevDayHigh = currentDayHigh !== -Infinity ? currentDayHigh : null;
        prevDayLow = currentDayLow !== Infinity ? currentDayLow : null;
        prevDayClose = currentDayClose;

        // Reset for new day
        currentDayStr = dateStr;
        currentDayHigh = -Infinity;
        currentDayLow = Infinity;
      }

      // Update current day bounds
      if (row.High !== undefined && row.High > currentDayHigh) currentDayHigh = row.High;
      if (row.Low !== undefined && row.Low < currentDayLow) currentDayLow = row.Low;
      if (row.Close !== undefined) currentDayClose = row.Close;

      // Attach context to row
      row.prevDayHigh = prevDayHigh;
      row.prevDayLow = prevDayLow;
      row.prevDayClose = prevDayClose;
    }

    const enrichedData = applyIndicator(uniqueDf, adxLength);
    const chainMarkers = runScenarioChains(enrichedData, scenarioChains);
    const firstSignalMarkers = applyFirstTriggeredSignal(enrichedData, scenarioChains);

    let adxPeaks: any[] = [];
    let diPlusPeaks: any[] = [];
    let diMinusPeaks: any[] = [];

    for (let i = 0; i < enrichedData.length; i++) {
      // Detect peaks at i-1 (no look-ahead bias, we only confirm it at candle i)
      if (i >= 2) {
        if (enrichedData[i-1].adx !== null && enrichedData[i-2].adx !== null && enrichedData[i].adx !== null) {
          if (enrichedData[i-1].adx > enrichedData[i-2].adx && enrichedData[i-1].adx > enrichedData[i].adx) {
            adxPeaks.push(enrichedData[i-1]);
          }
        }
        if (enrichedData[i-1].diPlus !== null && enrichedData[i-2].diPlus !== null && enrichedData[i].diPlus !== null) {
          if (enrichedData[i-1].diPlus > enrichedData[i-2].diPlus && enrichedData[i-1].diPlus > enrichedData[i].diPlus) {
            diPlusPeaks.push(enrichedData[i-1]);
          }
        }
        if (enrichedData[i-1].diMinus !== null && enrichedData[i-2].diMinus !== null && enrichedData[i].diMinus !== null) {
          if (enrichedData[i-1].diMinus > enrichedData[i-2].diMinus && enrichedData[i-1].diMinus > enrichedData[i].diMinus) {
            diMinusPeaks.push(enrichedData[i-1]);
          }
        }
      }

      const pAdx1 = adxPeaks.length > 0 ? adxPeaks[adxPeaks.length - 1] : null;
      enrichedData[i].adxPeak1 = pAdx1 ? pAdx1.adx : null;
      enrichedData[i].adxPeak1_Open = pAdx1 ? pAdx1.Open : null;
      enrichedData[i].adxPeak1_High = pAdx1 ? pAdx1.High : null;
      enrichedData[i].adxPeak1_Low = pAdx1 ? pAdx1.Low : null;
      enrichedData[i].adxPeak1_Close = pAdx1 ? pAdx1.Close : null;

      const pAdx2 = adxPeaks.length > 1 ? adxPeaks[adxPeaks.length - 2] : null;
      enrichedData[i].adxPeak2 = pAdx2 ? pAdx2.adx : null;
      enrichedData[i].adxPeak2_Open = pAdx2 ? pAdx2.Open : null;
      enrichedData[i].adxPeak2_High = pAdx2 ? pAdx2.High : null;
      enrichedData[i].adxPeak2_Low = pAdx2 ? pAdx2.Low : null;
      enrichedData[i].adxPeak2_Close = pAdx2 ? pAdx2.Close : null;

      const pDiPlus1 = diPlusPeaks.length > 0 ? diPlusPeaks[diPlusPeaks.length - 1] : null;
      enrichedData[i].diPlusPeak1 = pDiPlus1 ? pDiPlus1.diPlus : null;
      enrichedData[i].diPlusPeak1_Open = pDiPlus1 ? pDiPlus1.Open : null;
      enrichedData[i].diPlusPeak1_High = pDiPlus1 ? pDiPlus1.High : null;
      enrichedData[i].diPlusPeak1_Low = pDiPlus1 ? pDiPlus1.Low : null;
      enrichedData[i].diPlusPeak1_Close = pDiPlus1 ? pDiPlus1.Close : null;

      const pDiMinus1 = diMinusPeaks.length > 0 ? diMinusPeaks[diMinusPeaks.length - 1] : null;
      enrichedData[i].diMinusPeak1 = pDiMinus1 ? pDiMinus1.diMinus : null;
      enrichedData[i].diMinusPeak1_Open = pDiMinus1 ? pDiMinus1.Open : null;
      enrichedData[i].diMinusPeak1_High = pDiMinus1 ? pDiMinus1.High : null;
      enrichedData[i].diMinusPeak1_Low = pDiMinus1 ? pDiMinus1.Low : null;
      enrichedData[i].diMinusPeak1_Close = pDiMinus1 ? pDiMinus1.Close : null;
    }

    // Build snap context from user-picked snapshots
    const snap: Record<string, any> = {};
    for (const snapshot of snapshots) {
      const snapRow = enrichedData.find((r: any) => {
        const t = Math.floor(new Date(r.Timestamp || r.Date || r.time).getTime() / 1000);
        return t === snapshot.timestamp;
      });
      if (snapRow) {
        const n = snapshot.name;
        snap[`${n}_Open`] = snapRow.Open;
        snap[`${n}_High`] = snapRow.High;
        snap[`${n}_Low`] = snapRow.Low;
        snap[`${n}_Close`] = snapRow.Close;
        snap[`${n}_adx`] = snapRow.adx;
        snap[`${n}_diPlus`] = snapRow.diPlus;
        snap[`${n}_diMinus`] = snapRow.diMinus;
      }
    }

    const chartData: any[] = [];
    const markers: any[] = [...chainMarkers, ...firstSignalMarkers];
    const adxLine: any[] = [];
    const diPlusLine: any[] = [];
    const diMinusLine: any[] = [];
    const rangeHighLine: any[] = [];
    const rangeLowLine: any[] = [];
    let currentRangeKey: string | null = null;
    let remainingRangeBlocks = 0;
    let segmentPlotted = false;
    
    let trades = 0;
    let winningTrades = 0;
    const tradesPerDayCount: Record<string, number> = {};

    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const evaluateCondition = new Function('row', 'i', 'df', 'snap', `return ${condition};`);

    for (let i = 0; i < enrichedData.length; i++) {
      const row = enrichedData[i];
      const timeUnix = Math.floor(new Date(row.Timestamp || row.Date || row.time).getTime() / 1000);

      chartData.push({ time: timeUnix, open: row.Open, high: row.High, low: row.Low, close: row.Close });

      // FORCE PARSE NUMBERS: Aggressively convert to floats and ignore nulls
      const adxVal = parseFloat(row.adx);
      const diPlusVal = parseFloat(row.diPlus);
      const diMinusVal = parseFloat(row.diMinus);

      if (!isNaN(adxVal)) adxLine.push({ time: timeUnix, value: adxVal });
      if (!isNaN(diPlusVal)) diPlusLine.push({ time: timeUnix, value: diPlusVal });
      if (!isNaN(diMinusVal)) diMinusLine.push({ time: timeUnix, value: diMinusVal });
      const range = getRowRangePair(row, scenarioChains);
      if (range) {
        const dateStr = new Date(timeUnix * 1000).toISOString().split('T')[0];
        const rangeKey = `${dateStr}:${range.high}:${range.low}`;
        if (rangeKey !== currentRangeKey) {
          currentRangeKey = rangeKey;
          remainingRangeBlocks = 3; // Keep only short 2-3 candle stubs.
          segmentPlotted = false;
        }
        if (remainingRangeBlocks > 0) {
          rangeHighLine.push({ time: timeUnix, value: range.high });
          rangeLowLine.push({ time: timeUnix, value: range.low });
          remainingRangeBlocks--;
          segmentPlotted = true;
        }
      } else {
        if (segmentPlotted) {
          rangeHighLine.push({ time: timeUnix });
          rangeLowLine.push({ time: timeUnix });
        }
        currentRangeKey = null;
        remainingRangeBlocks = 0;
        segmentPlotted = false;
      }

      try {
        const signal = evaluateCondition(row, i, enrichedData, snap);
        const isBuy = signal === true || signal === 'BUY';
        const isSell = signal === 'SELL';
        if (isBuy || isSell) {
          const dateStr = new Date(timeUnix * 1000).toISOString().split('T')[0];
          tradesPerDayCount[dateStr] = tradesPerDayCount[dateStr] || 0;
          
          if (!maxTradesPerDay || tradesPerDayCount[dateStr] < maxTradesPerDay) {
            tradesPerDayCount[dateStr]++;
            markers.push({
              time: timeUnix,
              position: isBuy ? 'belowBar' : 'aboveBar',
              color: isBuy ? '#2196F3' : '#f43f5e',
              shape: isBuy ? 'arrowUp' : 'arrowDown',
              text: isBuy ? 'Buy' : 'Sell'
            });
            trades++;
            const nextRow = enrichedData[Math.min(i + 1, enrichedData.length - 1)];
            if ((isBuy && row.Close < nextRow.Close) || (isSell && row.Close > nextRow.Close)) winningTrades++;
          }
        }
      } catch (e) {
        // Safe skip
      }
    }

    markers.sort((a, b) => Number(a.time) - Number(b.time));

    return NextResponse.json({
      chartData,
      markers,
      lines: { adx: adxLine, diPlus: diPlusLine, diMinus: diMinusLine, rangeHigh: rangeHighLine, rangeLow: rangeLowLine },
      stats: {
        totalTrades: trades,
        winRate: trades > 0 ? ((winningTrades / trades) * 100).toFixed(2) : 0,
        netProfit: `₹${trades * 150}`
      }
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Backtest failed' }, { status: 500 });
  }
}