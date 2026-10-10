// Fabrique un exécutable autonome du jeu (serveur + client embarqués) avec la fonction
// « single executable application » de Node.js : MafiaWars.exe pour Windows, et un binaire
// pour Linux ou macOS si on le demande.
//
//   npm run build:exe                 → release/MafiaWars.exe (Windows x64)
//   npm run build:exe -- linux        → release/MafiaWars-linux (Linux x64)
//   npm run build:exe -- win linux    → les deux
//
// Le binaire Node de la plateforme visée (même version que celle qui lance ce script) est
// téléchargé une fois depuis nodejs.org et gardé dans .cache/node/.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'release');
const work = path.join(root, 'dist', 'exe');
const cache = path.join(root, '.cache', 'node');
const version = process.version; // ex. v22.22.0
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['win'];

const log = (...a) => console.log('[exe]', ...a);

// 1. client compilé
if (!process.env.SKIP_CLIENT) {
  log('compilation du client (vite build)…');
  execFileSync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: root, stdio: 'inherit' });
}
const clientDir = path.join(root, 'dist', 'client');
if (!fs.existsSync(path.join(clientDir, 'index.html'))) throw new Error('dist/client/index.html introuvable');

// 2. serveur en un seul fichier CommonJS (format exigé par Node pour un exécutable)
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(out, { recursive: true });
log('assemblage du serveur…');
await build({
  entryPoints: [path.join(root, 'src', 'server', 'main.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: path.join(work, 'server.cjs'),
  // modules natifs facultatifs de « ws » : absents, ws s'en passe
  external: ['bufferutil', 'utf-8-validate'],
  banner: { js: "const __mwImportMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  define: { 'import.meta.url': '__mwImportMetaUrl' },
  logLevel: 'warning',
  legalComments: 'none',
});

// 3. fichiers du client embarqués
const assets = {};
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else assets[`client/${path.relative(clientDir, p).split(path.sep).join('/')}`] = p;
  }
};
walk(clientDir);
log(`${Object.keys(assets).length} fichiers du client embarqués`);

const seaConfig = {
  main: path.join(work, 'server.cjs'),
  output: path.join(work, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  assets,
};
fs.writeFileSync(path.join(work, 'sea-config.json'), JSON.stringify(seaConfig, null, 1));
execFileSync(process.execPath, ['--experimental-sea-config', path.join(work, 'sea-config.json')], { cwd: root, stdio: 'inherit' });

// 4. binaire Node de la plateforme visée
async function download(url, dest) {
  log('téléchargement', url);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} : ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

async function nodeBinary(target) {
  if (target === 'win') {
    const dest = path.join(cache, version, 'win-x64', 'node.exe');
    if (!fs.existsSync(dest)) {
      await download(`https://nodejs.org/dist/${version}/win-x64/node.exe`, dest);
      // vérification de l'empreinte publiée par nodejs.org
      const sums = await (await fetch(`https://nodejs.org/dist/${version}/SHASUMS256.txt`)).text();
      const want = sums.split('\n').find((l) => l.endsWith('win-x64/node.exe'))?.split(/\s+/)[0];
      const got = createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
      if (!want || want !== got) {
        fs.rmSync(dest);
        throw new Error('empreinte SHA-256 de node.exe incorrecte');
      }
    }
    return dest;
  }
  if (target === 'linux' || target === 'mac') {
    if ((target === 'linux' && process.platform !== 'linux') || (target === 'mac' && process.platform !== 'darwin'))
      throw new Error(`le binaire ${target} doit être fabriqué sur ${target}`);
    return process.execPath;
  }
  throw new Error(`cible inconnue : ${target} (win, linux, mac)`);
}

const postject = path.join(root, 'node_modules', 'postject', 'dist', 'cli.js');
for (const target of targets) {
  const name = target === 'win' ? 'MafiaWars.exe' : target === 'mac' ? 'MafiaWars-mac' : 'MafiaWars-linux';
  const dest = path.join(out, name);
  fs.copyFileSync(await nodeBinary(target), dest);
  if (target === 'mac') execFileSync('codesign', ['--remove-signature', dest]);
  const args = [postject, dest, 'NODE_SEA_BLOB', seaConfig.output, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
  if (target === 'mac') args.push('--macho-segment-name', 'NODE_SEA');
  execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (target === 'mac') execFileSync('codesign', ['--sign', '-', dest]);
  if (target !== 'win') fs.chmodSync(dest, 0o755);
  log(`→ ${path.relative(root, dest)} (${(fs.statSync(dest).size / 1048576).toFixed(1)} Mo)`);
}
