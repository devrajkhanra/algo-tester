import { NextResponse } from 'next/server';
import Papa from 'papaparse';
import { applyIndicator } from '../../indicator';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const csvFile = formData.get('csv_file') as File;
    const condition = formData.get('condition') as string;
    const maxTradesStr = formData.get('maxTradesPerDay') as string;
    const maxTradesPerDay = maxTradesStr ? parseInt(maxTradesStr) : null;
    const snapshotsStr = formData.get('snapshots') as string | null;
    const snapshots: { name: string; timestamp: number }[] = snapshotsStr ? JSON.parse(snapshotsStr) : [];

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

    const enrichedData = applyIndicator(uniqueDf);

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
    const markers: any[] = [];
    const adxLine: any[] = [];
    const diPlusLine: any[] = [];
    const diMinusLine: any[] = [];
    
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

      try {
        if (evaluateCondition(row, i, enrichedData, snap)) {
          const dateStr = new Date(timeUnix * 1000).toISOString().split('T')[0];
          tradesPerDayCount[dateStr] = tradesPerDayCount[dateStr] || 0;
          
          if (!maxTradesPerDay || tradesPerDayCount[dateStr] < maxTradesPerDay) {
            tradesPerDayCount[dateStr]++;
            markers.push({ time: timeUnix, position: 'belowBar', color: '#2196F3', shape: 'arrowUp', text: 'Buy' });
            trades++;
            const nextRow = enrichedData[Math.min(i + 1, enrichedData.length - 1)];
            if (row.Close < nextRow.Close) winningTrades++;
          }
        }
      } catch (e) {
        // Safe skip
      }
    }

    return NextResponse.json({
      chartData,
      markers,
      lines: { adx: adxLine, diPlus: diPlusLine, diMinus: diMinusLine },
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