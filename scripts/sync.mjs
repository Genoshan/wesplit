#!/usr/bin/env node

import { readFileSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function readFile(relativePath, maxLines = 25) {
  const path = join(ROOT, relativePath);
  if (!existsSync(path)) return { error: 'NOT FOUND' };
  try {
    const lines = readFileSync(path, 'utf-8').split('\n');
    const trimmed = lines.map(l => l.trim()).filter(l => l.length > 0).slice(0, maxLines);
    return { content: trimmed, error: null };
  } catch (e) {
    return { error: e.message };
  }
}

function gitCmd(cmd) {
  try { return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe' }).trim(); }
  catch { return null; }
}

// Data
const session = readFile('.localcode/SESSION.md', 25);
const bitacora = readFile('memory/BITACORA.md', 40);
const roadmap = readFile('ROADMAP.md', 50);

const lastCommit = gitCmd('git log -1 --format="%h %s"');
const branch = gitCmd('git branch --show-current') || '(ninguno)';

const projectFiles = [
  { name: 'index.html', path: 'index.html' },
  { name: 'app.js', path: 'app.js' },
  { name: 'style.css', path: 'style.css' },
  { name: 'server/index.js', path: 'server/index.js' },
  { name: 'server/database.js', path: 'server/database.js' },
  { name: 'server/auth.js', path: 'server/auth.js' },
];

// Print header
console.log('');
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  SYNC — Gastos Compartidos (WeSplit)                    ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log('');

// Project files
console.log('  📁 Archivos del proyecto');
for (const f of projectFiles) {
  const fullPath = join(ROOT, f.path);
  if (existsSync(fullPath)) {
    const stat = statSync(fullPath);
    const lines = readFileSync(fullPath, 'utf-8').split('\n').length;
    const kb = (stat.size / 1024).toFixed(0).padStart(3);
    console.log(`  ✅ ${f.name.padEnd(26)} ${lines} lin  ${kb} KB`);
  } else {
    console.log(`  ❌ ${f.name.padEnd(26)} NOT FOUND`);
  }
}
console.log('');

// Git info
console.log(`  📌 Rama: ${branch}`);
if (lastCommit) {
  const hash = lastCommit.substring(0, 7);
  const msg = lastCommit.substring(9);
  console.log(`  📌 Último commit: ${hash} ${msg}`);
}
console.log('');

// Session status
console.log('  📊 Estado (SESSION.md)');
console.log('  ' + '───'.repeat(28));
if (session.error) {
  console.log(`  ${session.error}`);
} else {
  for (const line of session.content) {
    if (line.includes('✅') || line.includes('⬜') || line.includes('**Current') || line.includes('**Estado') || line.includes('**Próximos') || line.includes('**Last')) {
      const clean = line.replace(/[-*]\s*/g, '');
      console.log(`  ${clean}`);
    } else if (line.match(/^\d+\.\s/)) {
      console.log(`    ${line}`);
    }
  }
}
console.log('');

// Bitacora
console.log('  📝 Última sesión (BITACORA.md)');
console.log('  ' + '───'.repeat(28));
if (bitacora.error) {
  console.log(`  ${bitacora.error}`);
} else {
  let lastTitle = '';
  let foundEntry = false;
  let depth = 0;
  for (const line of bitacora.content) {
    if (line.match(/^## \[\d{4}-\d{2}-\d{2}]/)) {
      if (foundEntry) break;
      lastTitle = line.replace(/^## /, '');
      foundEntry = true;
      depth = 0;
      continue;
    }
    
    if (foundEntry && !lastTitle) continue;
    
    if (foundEntry && lastTitle) {
      if (line.startsWith('###')) {
        if (depth <= 2) {
          console.log(`  ${line}`);
          depth++;
        }
      } else if (depth < 5 && (line.startsWith('- ') || line.startsWith('  -'))) {
        console.log(line);
      }
    }
  }
  if (!foundEntry) {
    console.log('  No hay entradas registradas');
  }
}
console.log('');

// Roadmap summary
console.log('  🗺️ Roadmap');
console.log('  ' + '───'.repeat(28));

let phaseCount = 0;
let inRoadmap = false;
for (const line of roadmap.content) {
  if (line.includes('🟢') || line.includes('🟡') || line.includes('🔵')) {
    if (phaseCount > 0 && line.includes('🟡')) break;
    inRoadmap = true;
  }
  if (inRoadmap && phaseCount < 12) {
    if (line.includes('✅ COMPLETA') || line.includes('[x]')) {
      console.log(`  ${line}`);
      phaseCount++;
    } else if (line.includes('[ ]') && line.includes('**')) {
      console.log(`  ${line}`);
      phaseCount++;
    }
  }
}
console.log('');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  ✅ Sync completo                                         ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log('');
