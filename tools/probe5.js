const fs = require('fs');
const s = fs.readFileSync('extract/app.js', 'utf8');
// Search backwards from CORAL COVE (839957) for the module seam
const target = 839957;
console.log(JSON.stringify(s.slice(836000, 840400)));
