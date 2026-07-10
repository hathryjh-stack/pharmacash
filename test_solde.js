// Test isolé du module SOLDE — vérifie la logique de calcul

// Mock des données globales
let comptes = [
  { id: 'c5', nom: 'Caisse Principale', cat: 'caisse', soldeInit: 6396560, solde: 999 },
  { id: 'pc', nom: 'Petite Caisse', cat: 'caisse', soldeInit: 140960, solde: 999 },
  { id: 'om', nom: 'OM Centrale', cat: 'mobile_money', soldeInit: 0, solde: 999 },
];
let mvts = [
  { id:'m1', compte:'c5', type:'entrée', montant:100000, date:'2026-07-02', ts:2 },
  { id:'m2', compte:'c5', type:'sortie', montant:50000,  date:'2026-07-01', ts:1 },  // Saisi APRÈS mais daté AVANT
  { id:'m3', compte:'c5', type:'entrée', montant:20000,  date:'2026-07-03', ts:3 },
];
let petiteCaisse = [
  { id:'p1', type:'depense', montant:15000, date:'2026-07-01', ts:1 },
  { id:'p2', type:'depense', montant:2000,  date:'2026-07-02', ts:2 },
];
let transferts = [];

// Copie du module SOLDE (extrait pour test)
const SoldeModule = (function() {
  function mouvementsCompte(compteId, dateMax=null) {
    const result=[];
    for(const m of mvts){
      if(m.compte!==compteId)continue;
      if(dateMax&&m.date>dateMax)continue;
      result.push({date:m.date,ts:m.ts||0,sens:m.type==='entrée'?1:-1,montant:m.montant||0});
    }
    for(const t of transferts){
      if(dateMax&&t.date>dateMax)continue;
      if(t.compteSrc===compteId)result.push({date:t.date,ts:t.ts||0,sens:-1,montant:t.montant||0});
      if(t.compteDst===compteId)result.push({date:t.date,ts:t.ts||0,sens:1,montant:t.montant||0});
    }
    const cpt=comptes.find(c=>c.id===compteId);
    if(cpt&&cpt.nom.toLowerCase().includes('petite')){
      for(const p of petiteCaisse){
        if(dateMax&&p.date>dateMax)continue;
        result.push({date:p.date,ts:p.ts||0,sens:p.type==='appro'?1:-1,montant:p.montant||0});
      }
    }
    result.sort((a,b)=>(a.date||'').localeCompare(b.date||'')||(a.ts-b.ts));
    return result;
  }
  function soldeCompte(compteId,dateMax=null){
    const cpt=comptes.find(c=>c.id===compteId);
    if(!cpt)return 0;
    const init=cpt.soldeInit??0;
    return mouvementsCompte(compteId,dateMax).reduce((s,m)=>s+m.sens*m.montant,init);
  }
  function soldesChronologiques(compteId){
    const cpt=comptes.find(c=>c.id===compteId);
    const init=cpt?.soldeInit??0;
    const items=[];
    for(const m of mvts)if(m.compte===compteId)items.push({id:m.id,date:m.date,ts:m.ts||0,sens:m.type==='entrée'?1:-1,montant:m.montant||0});
    if(cpt?.nom?.toLowerCase().includes('petite'))for(const p of petiteCaisse)items.push({id:p.id,date:p.date,ts:p.ts||0,sens:p.type==='appro'?1:-1,montant:p.montant||0});
    items.sort((a,b)=>(a.date||'').localeCompare(b.date||'')||(a.ts-b.ts));
    const map={};let r=init;
    for(const it of items){r+=it.sens*it.montant;map[it.id]=r;}
    return map;
  }
  return {soldeCompte,soldesChronologiques,mouvementsCompte};
})();

// ── TESTS ──
let pass=0,fail=0;
function test(nom,actual,expected){
  if(actual===expected){pass++;console.log('✅',nom,'=',actual);}
  else{fail++;console.log('❌',nom,'— attendu',expected,'obtenu',actual);}
}

// Test 1 : Caisse Principale = 6396560 + 100000 - 50000 + 20000 = 6466560
test('Caisse Principale solde actuel', SoldeModule.soldeCompte('c5'), 6466560);

// Test 2 : Petite Caisse = 140960 - 15000 - 2000 = 123960
test('Petite Caisse solde actuel', SoldeModule.soldeCompte('pc'), 123960);

// Test 3 : Compte sans mouvement = soldeInit
test('OM Centrale solde actuel', SoldeModule.soldeCompte('om'), 0);

// Test 4 : Solde à une date passée (au 01/07) = 6396560 - 50000 = 6346560
test('Caisse Principale au 01/07', SoldeModule.soldeCompte('c5','2026-07-01'), 6346560);

// Test 5 : Solde chronologique respecte l'ordre des DATES pas de saisie
// m2 (01/07) doit venir avant m1 (02/07) même si saisi après
const chrono=SoldeModule.soldesChronologiques('c5');
test('Solde après m2 (01/07, saisi 2e)', chrono['m2'], 6346560);  // 6396560 - 50000
test('Solde après m1 (02/07)', chrono['m1'], 6446560);            // 6346560 + 100000
test('Solde après m3 (03/07)', chrono['m3'], 6466560);            // 6446560 + 20000

console.log('\n' + '='.repeat(40));
console.log(pass+' réussis, '+fail+' échoués');
process.exit(fail>0?1:0);
