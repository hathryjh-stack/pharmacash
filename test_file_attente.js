// Test de la file d'attente hors-ligne : enfilage, déduplication,
// rejeu qui s'arrête proprement sur échec réseau et reprend ensuite.

// ── Simulation du localStorage et du réseau ──
const store={};
const LS={g:k=>store[k]??null,s:(k,v)=>{store[k]=v;}};
let reseauOK=false;           // le réseau commence COUPÉ
let ecrituresServeur=[];      // ce qui atteint réellement "Firestore"

async function _fbEcrire(op,col,id,data){
  if(!reseauOK)throw new Error('timeout');
  ecrituresServeur.push({op,col,id,data});
}

// ── Code identique à app.js ──
function _fileAttente(){ return LS.g('syncQueue')||[]; }
function _enfiler(op,col,id,data){
  const q=_fileAttente().filter(e=>!(e.col===col&&e.id===id));
  q.push({op,col,id,data:data??null,ts:Date.now()});
  LS.s('syncQueue',q);
}
let _rejeuEnCours=false;
async function rejouerFileAttente(){
  if(_rejeuEnCours)return;
  let q=_fileAttente(); if(!q.length)return;
  _rejeuEnCours=true;
  try{
    while(q.length){
      const e=q[0];
      try{ await _fbEcrire(e.op,e.col,e.id,e.data); }
      catch(err){ break; }
      q=q.slice(1); LS.s('syncQueue',q);
    }
  }finally{ _rejeuEnCours=false; }
}
async function fbSave(col,id,data){
  try{ await _fbEcrire('set',col,id,data); }
  catch(e){ _enfiler('set',col,id,data); }
}
async function fbDel(col,id){
  try{ await _fbEcrire('del',col,id); }
  catch(e){ _enfiler('del',col,id); }
}

// ── SCÉNARIO : coupure réseau à la pharmacie ──
(async()=>{
  // 1. Réseau coupé : 3 saisies + 1 correction + 1 suppression
  await fbSave('petiteCaisse','p1',{montant:5000,libelle:'transport'});
  await fbSave('recettes','r1',{montant:120000});
  await fbSave('petiteCaisse','p1',{montant:7000,libelle:'transport corrigé'}); // corrige p1
  await fbSave('mvts','m1',{montant:3000});
  await fbDel('mvts','m1');                                                     // puis le supprime

  const q1=_fileAttente();

  // 2. Tentative de rejeu SANS réseau : rien ne doit partir, rien ne doit se perdre
  await rejouerFileAttente();
  const q2=_fileAttente();
  const recuAvantRetourReseau=ecrituresServeur.length;   // photo AVANT reconnexion

  // 3. Le réseau revient : rejeu complet
  reseauOK=true;
  await rejouerFileAttente();
  const q3=_fileAttente();

  const p1Final=ecrituresServeur.find(e=>e.id==='p1');
  const m1Ops=ecrituresServeur.filter(e=>e.id==='m1');

  const T=[
    ['Hors-ligne : 3 entrées en file (pas 5 — dédupliquées)', q1.length===3],
    ['Correction p1 : seule la version 7000 est en file',      q1.find(e=>e.id==='p1')?.data.montant===7000],
    ['m1 : seule la suppression reste (dernier ordre gagnant)',q1.find(e=>e.id==='m1')?.op==='del'],
    ['Rejeu sans réseau : file intacte, zéro perte',           q2.length===3],
    ['Rejeu sans réseau : rien n\'a atteint le serveur',       recuAvantRetourReseau===0],
    ['Retour réseau : file entièrement vidée',                 q3.length===0],
    ['Serveur : p1 reçu avec le montant corrigé (7000)',       p1Final?.data.montant===7000],
    ['Serveur : m1 reçu comme suppression uniquement',         m1Ops.length===1&&m1Ops[0].op==='del'],
    ['Serveur : 3 opérations au total, aucun doublon',         ecrituresServeur.length===3]
  ];
  let ko=0;
  console.log('File après coupure :',JSON.stringify(q1.map(e=>e.op+':'+e.id)));
  console.log('Reçu par le serveur :',JSON.stringify(ecrituresServeur.map(e=>e.op+':'+e.id)),'\n');
  for(const[n,ok]of T){console.log(`${ok?'✅':'❌'} ${n}`);if(!ok)ko++;}
  console.log(ko?`\n🚫 ${ko} échec(s)`:`\n✅ ${T.length}/${T.length} — aucune écriture perdue, aucun doublon`);
  process.exit(ko?1:0);
})();
