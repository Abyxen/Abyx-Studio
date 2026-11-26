const fs = require('fs');
const path = require('path');

// Challenge F: Dataset Cleaning and Statistical Analysis
const csvPath = path.join(__dirname, '..', '..', 'scratch', 'sales_report_2026.csv');
const raw = fs.readFileSync(csvPath, 'utf8');
const lines = raw.trim().split('\n').slice(1);

let totalRev = 0;
let totalUnits = 0;

for (const line of lines) {
  const [month, rev, units] = line.split(',');
  totalRev += parseFloat(rev);
  totalUnits += parseInt(units, 10);
}

const stats = {
  monthsAnalyzed: lines.length,
  totalRevenue: totalRev,
  totalUnits: totalUnits,
  averageRevenuePerMonth: totalRev / lines.length,
  averagePriceOverall: totalRev / totalUnits
};

fs.writeFileSync(path.join(__dirname, 'analysis_results.json'), JSON.stringify(stats, null, 2));
console.log('Challenge F Analysis complete:', stats);
