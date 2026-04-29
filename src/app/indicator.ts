export interface CandleData {
  High: number;
  Low: number;
  Close: number;
  diPlus?: number;
  diMinus?: number;
  adx?: number | null;
}

export interface ADXResult {
  diPlus: number;
  diMinus: number;
  adx: number | null; 
}

export function calculateADX(data: CandleData[], length: number = 14): ADXResult[] {
  if (data.length === 0) return [];

  const trList: number[] = [];
  const plusDmList: number[] = [];
  const minusDmList: number[] = [];
  const dxList: number[] = [];
  const results: ADXResult[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      trList.push(0);
      plusDmList.push(0);
      minusDmList.push(0);
      continue;
    }

    const current = data[i];
    const prev = data[i - 1];

    const tr1 = current.High - current.Low;
    const tr2 = Math.abs(current.High - prev.Close);
    const tr3 = Math.abs(current.Low - prev.Close);
    trList.push(Math.max(tr1, tr2, tr3));

    const upMove = current.High - prev.High;
    const downMove = prev.Low - current.Low;

    let plusDm = 0;
    if (upMove > downMove && upMove > 0) {
      plusDm = upMove;
    }

    let minusDm = 0;
    if (downMove > upMove && downMove > 0) {
      minusDm = downMove;
    }

    plusDmList.push(plusDm);
    minusDmList.push(minusDm);
  }

  const smooth = (values: number[], len: number): number[] => {
    const smoothed = new Array(values.length).fill(0);
    smoothed[0] = values[0] || 0; 
    
    for (let i = 1; i < values.length; i++) {
      smoothed[i] = smoothed[i - 1] - (smoothed[i - 1] / len) + values[i];
    }
    return smoothed;
  };

  const smoothedTr = smooth(trList, length);
  const smoothedPlusDm = smooth(plusDmList, length);
  const smoothedMinusDm = smooth(minusDmList, length);

  for (let i = 0; i < data.length; i++) {
    let diPlus = 0;
    let diMinus = 0;
    let dx = 0;

    if (smoothedTr[i] !== 0) {
      diPlus = (smoothedPlusDm[i] / smoothedTr[i]) * 100;
      diMinus = (smoothedMinusDm[i] / smoothedTr[i]) * 100;
    }

    if (diPlus + diMinus !== 0) {
      dx = (Math.abs(diPlus - diMinus) / (diPlus + diMinus)) * 100;
    }
    
    dxList.push(dx);

    results.push({
      diPlus,
      diMinus,
      adx: null 
    });
  }

  for (let i = 0; i < data.length; i++) {
    if (i < length - 1) {
      results[i].adx = null; 
    } else {
      let sum = 0;
      for (let j = 0; j < length; j++) {
        sum += dxList[i - j];
      }
      results[i].adx = sum / length;
    }
  }

  return results;
}

export function applyIndicator(data: CandleData[]) {
  const adxResults = calculateADX(data, 14);
  
  for (let i = 0; i < data.length; i++) {
    data[i].diPlus = adxResults[i].diPlus;
    data[i].diMinus = adxResults[i].diMinus;
    data[i].adx = adxResults[i].adx;
  }
  
  return data;
}