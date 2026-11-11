const fs = require('fs');
const s = fs.readFileSync('extract/app.js', 'utf8');
// Find all "var X=" declarations and their offsets around the game area
const marks = ['__THREE__', 'Loading', 'RequestAnimationFrame', 'requestAnimationFrame', 'Scene(', 'createElement("canvas")'];
for (const mk of marks) {
  let i = -1; const arr = [];
  while ((i = s.indexOf(mk, i + 1)) !== -1 && arr.length < 10) arr.push(i);
  console.log(mk.padEnd(28), arr.join(', '));
}
// Show the area around 830000 to find the seam
console.log('\n=== around 833000 ===');
console.log(s.slice(833000, 839800));
