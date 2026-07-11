// Test de la reconstruction chronologique du grand-livre.
// Piège couvert : mouvement daté du 03/07 mais SAISI après celui du 10/07 (ts plus grand).
// Le report à nouveau d'une période partielle doit l'inclure quand même.

let comptes = [{ id: 'c5', nom: 'CAISSE PRINCIPALE', cat: 'caisse', soldeInit: 1000000 }];
let transferts = [], petiteCaisse = [];
let mvts = [
  { id: 'm1', compte: 'c5', date: '2026-07-02', ts: 100, type: 'entrée', montant: 200000, libelle: 'Recette 02/07', ref: 'R1', saisie: 'Awa' },
  { id: 'm2', compte: 'c5', date: '2026-07-10', ts: 200, type: 'sortie', montant: 50000,  libelle: 'Achat 10/07',   ref: 'R2', saisie: 'Awa' },
  // ── saisie RÉTROACTIVE : datée du 03/07 mais entrée en dernier (ts=300) ──
  { id: 'm3', compte: 'c5', date: '2026-07-03', ts: 300, type: 'sortie', montant: 30000,  libelle: 'Oubli 03/07',   ref: 'R3', saisie: 'Koffi' },
  { id: 'm4', compte: 'c5', date: '2026-07-20', ts: 400, type: 'entrée', montant: 80000,  libelle: 'Recette 20/07', ref: 'R4', saisie: 'Awa' }
];

const estComptePC = c => !!(c && c.nom && c.nom.toLowerCase().includes('petite'));
function mouvementsCompte(id, dateMax = null) {
  const r = [];
  for (const m of mvts) {
    if (m.compte !== id) continue;
    if (dateMax && m.date > dateMax) continue;
    r.push({ id: m.id, date: m.date, ts: m.ts || 0, sens: m.type === 'entrée' ? 1 : -1, montant: m.montant || 0, libelle: m.libelle, ref: m.ref, saisie: m.saisie });
  }
  r.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.ts - b.ts));
  return r;
}
const soldeCompte = (id, dateMax = null) => {
  const c = comptes.find(x => x.id === id);
  return mouvementsCompte(id, dateMax).reduce((s, m) => s + m.sens * m.montant, c.soldeInit ?? 0);
};
const veille = d => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() - 1); return x.toISOString().slice(0, 10); };

function grandLivre(id, debut, fin) {
  const c = comptes.find(x => x.id === id);
  const ran = debut ? soldeCompte(id, veille(debut)) : (c.soldeInit ?? 0);
  const p = mouvementsCompte(id, fin).filter(m => !debut || m.date >= debut);
  let run = ran;
  const lignes = p.map(m => { run += m.sens * m.montant; return { date: m.date, lib: m.libelle, solde: run }; });
  return { ran, lignes, soldeFinal: run, soldeModule: soldeCompte(id, fin), nb: p.length };
}

// ── Période partielle : du 05/07 au 31/07 ──
const gl = grandLivre('c5', '2026-07-05', '2026-07-31');
// RAN au 04/07 = 1 000 000 + 200 000 (02/07) − 30 000 (03/07, saisi en retard) = 1 170 000
// Puis : −50 000 (10/07) → 1 120 000 ; +80 000 (20/07) → 1 200 000

console.log('=== GRAND-LIVRE — CAISSE PRINCIPALE — du 05/07 au 31/07 ===');
console.log(`Report à nouveau au 04/07 : ${gl.ran.toLocaleString('fr-FR')}`);
gl.lignes.forEach(l => console.log(`  ${l.date}  ${l.lib.padEnd(16)} → ${l.solde.toLocaleString('fr-FR')}`));
console.log(`Solde final : ${gl.soldeFinal.toLocaleString('fr-FR')}\n`);

// ── Grand-livre complet, depuis l'ouverture ──
const glTot = grandLivre('c5', '', '2026-07-31');

const T = [
  ['RAN inclut la saisie rétroactive du 03/07', gl.ran === 1170000],
  ['Période partielle : 2 mouvements seulement', gl.nb === 2],
  ['Solde final = solde du module',              gl.soldeFinal === gl.soldeModule],
  ['Solde final = 1 200 000',                    gl.soldeFinal === 1200000],
  ['Grand-livre complet : RAN = soldeInit',      glTot.ran === 1000000],
  ['Grand-livre complet : 4 mouvements',         glTot.nb === 4],
  ['Complet et partiel convergent au 31/07',     glTot.soldeFinal === gl.soldeFinal],
  ['Ordre chronologique, pas ordre de saisie',   glTot.lignes[1].date === '2026-07-03']
];
let ko = 0;
for (const [n, ok] of T) { console.log(`${ok ? '✅' : '❌'} ${n}`); if (!ok) ko++; }
console.log(ko ? `\n🚫 ${ko} échec(s)` : `\n✅ ${T.length}/${T.length} — reconstruction fiable`);
process.exit(ko ? 1 : 0);
