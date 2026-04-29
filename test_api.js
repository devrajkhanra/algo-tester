const fs = require('fs');

async function test() {
  const fileData = fs.readFileSync('test_data.csv');
  const blob = new Blob([fileData], { type: 'text/csv' });
  const formData = new FormData();
  formData.append('csv_file', blob, 'test_data.csv');
  formData.append('condition', 'row.diPlus > row.diMinus && row.adx > 25');

  try {
    const res = await fetch('http://localhost:3001/api/backtest', {
      method: 'POST',
      body: formData,
    });
    
    if (!res.ok) {
      console.error('API Error:', res.status, res.statusText);
      const text = await res.text();
      console.error(text);
      return;
    }
    
    const data = await res.json();
    console.log("Chart Data points:", data.chartData ? data.chartData.length : 0);
    console.log("Markers:", data.markers ? data.markers.length : 0);
    console.log("ADX line points:", data.lines && data.lines.adx ? data.lines.adx.length : 0);
    console.log("DI+ line points:", data.lines && data.lines.diPlus ? data.lines.diPlus.length : 0);
    console.log("DI- line points:", data.lines && data.lines.diMinus ? data.lines.diMinus.length : 0);
    
    if (data.lines && data.lines.adx && data.lines.adx.length > 0) {
      console.log("First ADX value:", data.lines.adx[0]);
    }
  } catch (err) {
    console.error('Fetch failed:', err);
  }
}

test();
