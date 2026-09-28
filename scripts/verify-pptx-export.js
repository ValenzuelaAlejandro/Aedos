const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const fixtureDir = path.join(root, 'tests', 'fixtures');
const outputDir = path.join(root, 'tmp', 'verify-pptx');
const hashes = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'HASHES.json'), 'utf8'));
const port = 3000;

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const response = await fetch(`http://localhost:${port}/`); if (response.status < 500) return; } catch {}
    await sleep(500);
  }
  throw new Error('server did not become ready on port 3000');
}
async function main() {
  for (const fixture of hashes) {
    const actual = sha256(path.join(fixtureDir, fixture.file));
    if (actual !== fixture.sha256) throw new Error(`fixture hash changed: ${fixture.file}`);
  }
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  let server;
  try {
    try { await waitForServer(); } catch {
      server = spawn(process.execPath, [path.join(root, 'src', 'backend', 'server.js')], { cwd: root, stdio: 'inherit', env: { ...process.env, LIMITS_FINALIZE_MAX: '100' } });
      await waitForServer();
    }
    for (const fixture of hashes) {
      const name = fixture.file.replace(/^pptx-/, '').replace(/\.html$/, '');
      const html = fs.readFileSync(path.join(fixtureDir, fixture.file), 'utf8');
      const response = await fetch(`http://localhost:${port}/finalize-pptx?debug=1`, {
        method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({ html, title: `verify ${name}` })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(`${fixture.file}: ${JSON.stringify(payload)}`);
      const file = await fetch(`http://localhost:${port}${payload.pptxUrl}`);
      fs.writeFileSync(path.join(outputDir, `${name}.pptx`), Buffer.from(await file.arrayBuffer()));
      console.log(`${name}: ${response.headers.get('x-export-warnings') || '{}'}`);
    }
  } finally {
    if (server) server.kill('SIGINT');
  }
  if (process.platform === 'win32') {
    const check = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'validate-pptx-package.ps1'), '-InputDir', outputDir], { cwd: root, stdio: 'inherit' });
    if (check.status !== 0) process.exit(check.status || 1);
  }
  if (process.platform === 'win32') {
    const ps = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'render-pptx-com.ps1'), '-InputDir', outputDir, '-OutputDir', path.join(outputDir, 'com')], { cwd: root, stdio: 'inherit' });
    if (ps.status !== 0) process.exit(ps.status || 1);
  } else {
    console.warn('PowerPoint COM render skipped: Windows/PowerPoint is required.');
  }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
