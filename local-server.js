const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8787;
const INTERVAL_MS = 30 * 60 * 1000;

const ROOT_DIR = __dirname;
const DOCS_DIR = path.join(ROOT_DIR, 'docs');
const ENV_FILE = path.join(ROOT_DIR, '.env');

let isChecking = false;
let lastRun = null;

loadEnv();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/run-now') {
    const result = await runCheck('manual');
    sendJson(res, result);
    return;
  }

  if (url.pathname === '/health') {
    sendJson(res, {
      ok: true,
      isChecking,
      lastRun
    });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Page de suivi : http://localhost:${PORT}`);
  console.log('Premier check lancé automatiquement...');
  runCheck('startup');

  setInterval(() => {
    runCheck('scheduled');
  }, INTERVAL_MS);
});

function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) {
    console.error('Fichier .env manquant.');
    console.error('Crée un fichier .env avec TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID.');
    return;
  }

  const content = fs.readFileSync(ENV_FILE, 'utf8');

  content.split(/\r?\n/).forEach(line => {
    const cleanLine = line.trim();

    if (!cleanLine || cleanLine.startsWith('#')) {
      return;
    }

    const index = cleanLine.indexOf('=');

    if (index === -1) {
      return;
    }

    const key = cleanLine.slice(0, index).trim();
    const value = cleanLine.slice(index + 1).trim().replace(/^["']|["']$/g, '');

    process.env[key] = value;
  });
}

function runCheck(source) {
  if (isChecking) {
    console.log('Check déjà en cours, demande ignorée.');
    return Promise.resolve({
      ok: false,
      message: 'Check déjà en cours.'
    });
  }

  isChecking = true;
  lastRun = new Date().toISOString();

  console.log(`\n=== Check ${source} - ${new Date().toLocaleString('fr-FR')} ===`);

  return new Promise(resolve => {
    const child = spawn(process.execPath, ['monitor.js'], {
      cwd: ROOT_DIR,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', data => {
      const text = data.toString();
      output += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', data => {
      const text = data.toString();
      errorOutput += text;
      process.stderr.write(text);
    });

    child.on('close', code => {
      isChecking = false;

      const result = {
        ok: code === 0,
        code,
        output,
        errorOutput,
        finishedAt: new Date().toISOString()
      };

      console.log(`=== Check terminé, code ${code} ===\n`);
      resolve(result);
    });
  });
}

function serveStatic(req, res) {
  const requestPath = decodeURIComponent(req.url.split('?')[0]);
  const safePath = requestPath === '/' ? '/index.html' : requestPath;

  const filePath = path.normalize(path.join(DOCS_DIR, safePath));

  if (!filePath.startsWith(DOCS_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();

  const contentType = {
    '.html': 'text/html; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8'
  }[ext] || 'text/plain; charset=utf-8';

  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store'
  });

  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, value) {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  res.end(JSON.stringify(value, null, 2));
}
