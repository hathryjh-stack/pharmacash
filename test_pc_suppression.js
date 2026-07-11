// Test ciblé : appro Petite Caisse depuis Caisse Principale, puis suppression.
// Vérifie qu'aucune écriture orpheline ne subsiste et que les soldes reviennent à l'état initial.

let comptes = [
  { id: 'CP', nom: 'CAISSE PRINCIPALE', cat: 'caisse', soldeInit: 500000, solde: 500000 },
  { id: 'PC', nom: 'PETITE CAISSE',     cat: 'caisse', soldeInit: 140960, solde: 140960 }
];
let mvts = [], transferts = [], petiteCaisse = [];

const estComptePC = c => !!(c && c.nom && c.nom.toLowerCase().includes('petite'));
const comptePC = () => comptes.find(estComptePC) || null;

function soldeCompte(id) {
  const cpt = comptes.find(c => c.id === id);
  if (!cpt) return 0;
  let s = cpt.soldeInit ?? 0;
  for (const m of mvts) if (m.compte === id) s += (m.type === 'entrée' ? 1 : -1) * (m.montant || 0);
  if (estComptePC(cpt)) for (const p of petiteCaisse) s += (p.type === 'appro' ? 1 : -1) * (p.montant || 0);
  return s;
}
const synchroniserSolde = id => {
  const c = comptes.find(x => x.id === id);
  if (c) c.solde = soldeCompte(id);
};

// ── ÉTAT INITIAL ──
const CP0 = soldeCompte('CP'), PC0 = soldeCompte('PC');

// ── 1. APPRO de 50 000 : Caisse Principale → Petite Caisse ──
const ref = 'PC-20260711-103000-ABC';
mvts.push({ id: 'm1', compte: 'CP', type: 'sortie', montant: 50000, ref, date: '2026-07-11' });
synchroniserSolde('CP');
petiteCaisse.push({ id: 'p1', type: 'appro', montant: 50000, ref, caisseSource: 'CP', date: '2026-07-11' });
synchroniserSolde('PC');

const CP1 = soldeCompte('CP'), PC1 = soldeCompte('PC');

// ── 2. SUPPRESSION de l'appro (nouvelle logique) ──
const item = petiteCaisse.find(x => x.id === 'p1');
const liees = mvts.filter(x => x.ref === item.ref);
mvts = mvts.filter(x => !liees.some(l => l.id === x.id));
petiteCaisse = petiteCaisse.filter(x => x.id !== 'p1');
const touches = new Set([...liees.map(l => l.compte), item.caisseSource, comptePC().id].filter(Boolean));
touches.forEach(synchroniserSolde);

const CP2 = soldeCompte('CP'), PC2 = soldeCompte('PC');

// ── ASSERTIONS ──
const T = [
  ['Appro : CP débitée de 50 000',            CP1 === CP0 - 50000],
  ['Appro : PC créditée de 50 000',           PC1 === PC0 + 50000],
  ['Suppression : écriture liée retirée',     mvts.filter(m => m.ref === ref).length === 0],
  ['Suppression : CP revenue à l\'initial',   CP2 === CP0],
  ['Suppression : PC revenue à l\'initial',   PC2 === PC0],
  ['Solde stocké == solde recalculé (CP)',    comptes.find(c=>c.id==='CP').solde === soldeCompte('CP')],
  ['Solde stocké == solde recalculé (PC)',    comptes.find(c=>c.id==='PC').solde === soldeCompte('PC')]
];

console.log(`État initial : CP=${CP0}  PC=${PC0}`);
console.log(`Après appro  : CP=${CP1}  PC=${PC1}`);
console.log(`Après suppr. : CP=${CP2}  PC=${PC2}\n`);
let ko = 0;
for (const [nom, ok] of T) { console.log(`${ok ? '✅' : '❌'} ${nom}`); if (!ok) ko++; }
console.log(ko ? `\n🚫 ${ko} test(s) en échec` : '\n✅ 7/7 — aucune divergence de solde');
process.exit(ko ? 1 : 0);
