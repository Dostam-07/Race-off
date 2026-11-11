const fs = require('fs');
const body = fs.readFileSync('extract/body.html', 'utf8');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Race-Off</title>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a1436">
<link rel="stylesheet" href="/src/styles/game.css">
</head>
<body>
${body}
<script type="module" src="/src/main.js"></script>
</body>
</html>
`;
fs.writeFileSync('index.html', html);
console.log('index.html written', html.length);
