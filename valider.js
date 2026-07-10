#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// VALIDATION PRÉ-DÉPLOIEMENT — PharmaCash Pro
// À lancer AVANT chaque upload sur GitHub : node valider.js
// Bloque le déploiement si une erreur est détectée.
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const { execSync } = require('child_process');

const ROUGE = '\x1b[31m', VERT = '\x1b[32m', JAUNE = '\x1b[33m', RESET = '\x1b[0m';
let erreurs = 0, avertissements = 0;

function ok(msg)   { console.log(`${VERT}✅ ${msg}${RESET}`); }
function err(msg)  { console.log(`${ROUGE}❌ ${msg}${RESET}`); erreurs++; }
function warn(msg) { console.log(`${JAUNE}⚠️  ${msg}${RESET}`); avertissements++; }

console.log('═'.repeat(55));
console.log('  VALIDATION PHARMACASH — avant déploiement');
console.log('═'.repeat(55) + '\n');

// ── 1. app.js existe ──
if (!fs.existsSync('app.js')) {
  err('app.js introuvable dans le dossier courant');
  process.exit(1);
}

const code = fs.readFileSync('app.js', 'utf8');
const lignes = code.split('\n').length;
console.log(`📄 app.js : ${lignes} lignes\n`);

// ── 2. Syntaxe JavaScript valide ──
try {
  execSync('node --check app.js', { stdio: 'pipe' });
  ok('Syntaxe JavaScript valide');
} catch (e) {
  err('SYNTAXE INVALIDE — ne pas déployer !');
  console.log(e.stderr?.toString() || e.message);
}

// ── 3. Accolades équilibrées ──
let o = 0, c = 0;
for (const ch of code) { if (ch === '{') o++; if (ch === '}') c++; }
if (o === c) ok(`Accolades équilibrées (${o} paires)`);
else err(`Accolades DÉSÉQUILIBRÉES : ${o} ouvrantes, ${c} fermantes (diff ${o - c})`);

// ── 4. Parenthèses équilibrées ──
let po = 0, pc = 0;
for (const ch of code) { if (ch === '(') po++; if (ch === ')') pc++; }
if (po === pc) ok(`Parenthèses équilibrées (${po} paires)`);
else err(`Parenthèses DÉSÉQUILIBRÉES : ${po} vs ${pc}`);

// ── 5. Crochets équilibrés ──
let bo = 0, bc = 0;
for (const ch of code) { if (ch === '[') bo++; if (ch === ']') bc++; }
if (bo === bc) ok(`Crochets équilibrés (${bo} paires)`);
else err(`Crochets DÉSÉQUILIBRÉS : ${bo} vs ${bc}`);

// ── 6. Backticks pairs (template literals) ──
const backticks = (code.match(/`/g) || []).length;
if (backticks % 2 === 0) ok(`Backticks pairs (${backticks})`);
else err(`Backticks IMPAIRS (${backticks}) — template literal non fermé`);

// ── 7. Détection de code orphelin réel ──
// Vrai orphelin = window.xxx=xxx; suivi de "await" ou "document." ou "return"
// (du code qui devrait être DANS une fonction mais flotte dehors)
// On EXCLUT "let/const" (déclaration de module légitime) et "function/async"
const orphelins = code.match(/window\.\w+\s*=\s*\w+;\s*\n\s+(await|return|document\.getElementById\([^)]*\)\.value)/g);
if (orphelins) {
  err(`${orphelins.length} bloc(s) ORPHELIN(S) détecté(s) — code hors fonction !`);
  orphelins.slice(0, 3).forEach(o => console.log(`     ${o.replace(/\n/g, ' ').slice(0, 60)}...`));
} else {
  ok('Aucun code orphelin détecté');
}

// ── 8. Doublons de déclaration const/let dans même contexte (heuristique) ──
const decls = {};
const declMatches = code.matchAll(/\b(const|let)\s+(\w+)\s*=/g);
for (const m of declMatches) {
  const nom = m[2];
  decls[nom] = (decls[nom] || 0) + 1;
}
const suspects = Object.entries(decls).filter(([n, c]) => c > 5 && n.length <= 3);
if (suspects.length) {
  warn(`Variables courtes déclarées souvent (risque de redéclaration) : ${suspects.map(([n]) => n).join(', ')}`);
} else {
  ok('Pas de redéclaration suspecte de variables courtes');
}

// ── 9. Vérifier index.html si présent ──
if (fs.existsSync('index.html')) {
  const html = fs.readFileSync('index.html', 'utf8');
  const htmlLignes = html.split('\n').length;
  console.log(`\n📄 index.html : ${htmlLignes} lignes`);
  // Balises modal-ov avec display:none inline (bug connu)
  const modauxBloques = (html.match(/class="modal-ov"[^>]*style="display:none"/g) || []).length;
  if (modauxBloques) warn(`${modauxBloques} modal(aux) avec display:none inline (peut bloquer openM)`);
  else ok('Aucun modal bloqué par display:none inline');
  // div non fermés (heuristique simple)
  const divOpen = (html.match(/<div/g) || []).length;
  const divClose = (html.match(/<\/div>/g) || []).length;
  if (divOpen === divClose) ok(`Balises <div> équilibrées (${divOpen})`);
  else warn(`Balises <div> : ${divOpen} ouvertes, ${divClose} fermées`);
}

// ── Verdict final ──
console.log('\n' + '═'.repeat(55));
if (erreurs > 0) {
  console.log(`${ROUGE}🚫 ${erreurs} ERREUR(S) — NE PAS DÉPLOYER${RESET}`);
  console.log(`${ROUGE}   Corrige les erreurs avant d'uploader sur GitHub.${RESET}`);
  process.exit(1);
} else if (avertissements > 0) {
  console.log(`${JAUNE}✔️  Déploiement possible — ${avertissements} avertissement(s) à vérifier${RESET}`);
  process.exit(0);
} else {
  console.log(`${VERT}✅ TOUT EST BON — déploiement sûr !${RESET}`);
  process.exit(0);
}
