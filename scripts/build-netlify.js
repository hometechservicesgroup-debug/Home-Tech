const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const apiUrl = (process.env.RENDER_API_URL || '').trim().replace(/\/$/, '');
if (!apiUrl) {
  console.error('Set RENDER_API_URL to the deployed Render backend URL before building.');
  process.exit(1);
}

let parsed;
try { parsed = new URL(apiUrl); } catch {
  console.error('RENDER_API_URL must be a valid https:// URL (http://localhost is allowed for local use).');
  process.exit(1);
}
if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
  console.error('Use an https:// Render URL. Only localhost may use http://.');
  process.exit(1);
}

const out = path.join(root, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

function copyHtml(source, target) {
  const input = fs.readFileSync(path.join(root, source), 'utf8');
  if (!input.includes('<meta name="api-base" content="">')) {
    throw new Error(`Expected API base marker is missing from ${source}`);
  }
  const output = input.replace('<meta name="api-base" content="">', `<meta name="api-base" content="${apiUrl}">`);
  fs.writeFileSync(path.join(out, target), output);
}

copyHtml('hometech-services.html', 'index.html');
copyHtml('backend/admin.html', 'admin.html');
copyHtml('backend/partner.html', 'partner.html');
console.log(`Netlify site built in dist for backend ${parsed.origin}`);
