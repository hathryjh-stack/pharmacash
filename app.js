// ═══════════════════════════════════════════════════════
// PHARMACASH PRO v4.1 — app.js
// Pharmacie Saint Raphaël de M'Bengué
// Firebase Firestore + LocalStorage fallback
// Corrections v4.1 :
//   1. Total versement temps réel (oninput+onchange)
//   2. Parseur SMS montant : 178.300 → 178300
//   3. Parseur SMS PDV : détection phonétique+accents
//   4. Anti-doublons recettes/versements
//   5. Bouton Refresh sur chaque page
//   6. Rapports & Relevés refonte complète (3 types)
//   7. Type recette "À crédit" (Principale uniquement)
//   8. Module Petite caisse
//   9. Suivi cash par caissière + rapports
// ═══════════════════════════════════════════════════════

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, doc, getDocs,
         setDoc, deleteDoc, onSnapshot, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── CONFIGURATION — REMPLACE CES VALEURS ──────────────
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAe4zk5FKWEAAa1V3jKMYEga4kj4LtNmN4",
  authDomain:        "pharmacash-pro-fef79.firebaseapp.com",
  projectId:         "pharmacash-pro-fef79",
  storageBucket:     "pharmacash-pro-fef79.firebasestorage.app",
  messagingSenderId: "837693602631",
  appId:             "1:837693602631:web:57a2f9e863e9b425ac2a62"
};
const DROPBOX_TOKEN = "REMPLACE_PAR_TON_TOKEN";
const DROPBOX_FOLDER   = "/PharmaCash/sauvegardes";
const AUTO_BACKUP_HOUR = 23;
const PHARMACIE_NOM    = "Pharmacie Saint Raphaël de M'Bengué";
const DEVISE           = "FCFA";

// ── FIREBASE INIT ──────────────────────────────────────
let db, useFirebase = false;
try {
  if (!FIREBASE_CONFIG.apiKey.startsWith('COLLE')) {
    const app = initializeApp(FIREBASE_CONFIG);
    db = getFirestore(app);
    useFirebase = true;
  }
} catch(e) { console.warn('Firebase non configuré', e); }

// ── LOCAL STORAGE ──────────────────────────────────────
const LS = {
  g(k){ try{ return JSON.parse(localStorage.getItem('pc_'+k)||'null'); }catch{ return null; } },
  s(k,v){ localStorage.setItem('pc_'+k, JSON.stringify(v)); }
};

// ── DEFAULTS ───────────────────────────────────────────
const DEF_USERS = [
  { id:'u1', nom:'Administrateur', login:'admin', pass:'admin123',
    role:'admin', pdv:'', tel:'', lastLogin:null, actif:true }
];
const DEF_PDV = [
  { id:'pdv1', nom:'Pharmacie Centrale', type:'principale', addr:'', resp:'',
    freq:'quotidien', heure:'', jours:[], jourMois:'', compteDefaut:'', notes:'', tel:'' },
  { id:'pdv2', nom:'Dépôt Cité Nord', type:'depot', addr:'', resp:'',
    freq:'hebdomadaire', heure:'17:00', jours:[5], jourMois:'', compteDefaut:'', notes:'', tel:'' },
  { id:'pdv3', nom:'Dépôt Marché', type:'depot', addr:'', resp:'',
    freq:'hebdomadaire', heure:'17:00', jours:[5], jourMois:'', compteDefaut:'', notes:'', tel:'' }
];
const DEF_COMPTES = [
  { id:'c1', nom:'Orange Money — Centrale', cat:'mobile_money', op:'OM', opLibre:'',
    num:'', contact:'', soldeInit:0, solde:0, color:'#ff6b00', notes:'', actif:true },
  { id:'c2', nom:'MTN MoMo — Centrale', cat:'mobile_money', op:'MTN', opLibre:'',
    num:'', contact:'', soldeInit:0, solde:0, color:'#f5a623', notes:'', actif:true },
  { id:'c3', nom:'Wave — Centrale', cat:'mobile_money', op:'WAVE', opLibre:'',
    num:'', contact:'', soldeInit:0, solde:0, color:'#22d3ee', notes:'', actif:true },
  { id:'c4', nom:'BICICI — Compte principal', cat:'banque', op:'BICICI', opLibre:'',
    num:'', contact:'', soldeInit:0, solde:0, color:'#4d8af0', notes:'', actif:true },
  { id:'c5', nom:'Caisse espèces', cat:'caisse', op:'CASH', opLibre:'',
    num:'', contact:'', soldeInit:0, solde:0, color:'#00d68f', notes:'', actif:true }
];

// ── STATE ──────────────────────────────────────────────
let users      = LS.g('users')      || DEF_USERS;
let pdvs       = LS.g('pdvs')       || DEF_PDV;
let comptes    = LS.g('comptes')    || DEF_COMPTES;
let recettes   = LS.g('recettes')   || [];
let versements = LS.g('versements') || [];
let mvts       = LS.g('mvts')       || [];
let clotures   = LS.g('clotures')   || [];
let transferts = LS.g('transferts') || []; // NEW v4 — transferts MM→Banque
let petiteCaisse = LS.g('petiteCaisse') || []; // NEW v4.1 — petite caisse
let rapportsNouveaux = LS.g('rapportsNouveaux') || []; // v4.2 — Reports à Nouveaux (RAN)
let caissieresDB = LS.g('caissieresDB') || []; // v4.3 — Caissières (base de données)
let vacationsDB = LS.g('vacationsDB') || []; // v4.3 — Plages horaires (vacations)
let currentUser = null;
let backupTimer = null;

// ══════════════════════════════════════════════════════
// FIREBASE HELPERS
// ══════════════════════════════════════════════════════
async function fbLoad(col){
  if(!useFirebase) return null;
  try{ const s=await getDocs(collection(db,col)); return s.docs.map(d=>({id:d.id,...d.data()})); }
  catch(e){ console.warn('fbLoad',col,e); return null; }
}
async function fbSave(col,id,data){
  if(!useFirebase) return;
  const clean=JSON.parse(JSON.stringify(data));
  try{ await setDoc(doc(db,col,id),{...clean,_ts:serverTimestamp()}); }
  catch(e){ console.warn('fbSave',e); }
}
async function fbDel(col,id){
  if(!useFirebase) return;
  try{ await deleteDoc(doc(db,col,id)); }catch(e){}
}
async function loadAll(){
  sync('syncing','Chargement…');
  const [fu,fp,fc,fr,fv,fm,fcl,ft,fpc,fran]=await Promise.all([
    fbLoad('users'),fbLoad('pdvs'),fbLoad('comptes'),fbLoad('recettes'),
    fbLoad('versements'),fbLoad('mvts'),fbLoad('clotures'),fbLoad('transferts'),
    fbLoad('petiteCaisse'),fbLoad('rapportsNouveaux'),fbLoad('caissieresDB'),fbLoad('vacationsDB')
  ]);
  if(fu)users=fu; if(fp)pdvs=fp; if(fc)comptes=fc; if(fr)recettes=fr;
  if(fv)versements=fv; if(fm)mvts=fm; if(fcl)clotures=fcl; if(ft)transferts=ft;
  if(fpc)petiteCaisse=fpc; if(fran)rapportsNouveaux=fran;
  const fcaiss=await fbLoad('caissieresDB'); if(fcaiss)caissieresDB=fcaiss;
  const fvac=await fbLoad('vacationsDB'); if(fvac)vacationsDB=fvac;
  saveLocal(); sync('ok','🔴 Temps réel');
}
function subscribeAll(){
  if(!useFirebase) return;
  const sub=(col,setter,render)=>onSnapshot(collection(db,col),s=>{
    setter(s.docs.map(d=>({id:d.id,...d.data()}))); saveLocal(); render&&render();
  });
  sub('recettes',  v=>{recettes=v;},  ()=>{ refreshPg('recettes'); renderDashboard(); });
  sub('versements',v=>{versements=v;},()=>{ refreshPg('versements'); renderDashboard(); });
  sub('clotures',  v=>{clotures=v;},  ()=>{ refreshPg('caisse'); });
  sub('mvts',      v=>{mvts=v;},      ()=>{ refreshPg('banques'); });
  sub('comptes',   v=>{comptes=v;},   ()=>{ renderDashboard(); refreshPg('banques'); });
  sub('transferts',v=>{transferts=v;},()=>{ refreshPg('banques'); renderDashboard(); });
}
function refreshPg(name){
  const el=document.getElementById('pg-'+name);
  if(el&&el.classList.contains('active')){
    ({recettes:renderRecettes,versements:renderVersements,caisse:renderCaisse,banques:renderBanques})[name]?.();
  }
}
function saveLocal(){
  LS.s('users',users);LS.s('pdvs',pdvs);LS.s('comptes',comptes);
  LS.s('recettes',recettes);LS.s('versements',versements);LS.s('mvts',mvts);
  LS.s('clotures',clotures);LS.s('transferts',transferts);LS.s('petiteCaisse',petiteCaisse);
  LS.s('rapportsNouveaux',rapportsNouveaux);
  LS.s('caissieresDB',caissieresDB);
  LS.s('vacationsDB',vacationsDB);
}
async function saveItem(col,item){ saveLocal(); if(useFirebase){sync('syncing','Sync…');await fbSave(col,item.id,item);sync('ok','🔴 Temps réel');} }
async function delItem(col,id){ saveLocal(); if(useFirebase){await fbDel(col,id);} }

// ══════════════════════════════════════════════════════
// BACKUP
// ══════════════════════════════════════════════════════
function buildBlob(){
  const data={users,pdvs,comptes,recettes,versements,mvts,clotures,transferts,
    exportedAt:new Date().toISOString(),version:'4.0',pharmacie:PHARMACIE_NOM};
  return new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
}
function backupPC(){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(buildBlob());
  a.download=`pharmacash_${today()}.json`; a.click(); URL.revokeObjectURL(a.href);
  const ts=new Date().toLocaleString('fr-FR'); LS.s('lastBackupPC',ts);
  updateBackupUI(); toast('Sauvegarde PC ✓');
}
async function backupDropbox(){
  if(!DROPBOX_TOKEN||DROPBOX_TOKEN.startsWith('COLLE')){toast('Token Dropbox non configuré','err');return;}
  try{
    sync('syncing','Dropbox…');
    const ts=new Date().toTimeString().slice(0,5).replace(':','h');
    const path=`${DROPBOX_FOLDER}/pharmacash_${today()}_${ts}.json`;
    const resp=await fetch('https://content.dropboxapi.com/2/files/upload',{
      method:'POST',
      headers:{'Authorization':`Bearer ${DROPBOX_TOKEN}`,
        'Dropbox-API-Arg':JSON.stringify({path,mode:'overwrite',autorename:false}),
        'Content-Type':'application/octet-stream'},
      body:buildBlob()
    });
    if(!resp.ok)throw new Error(await resp.text());
    const dts=new Date().toLocaleString('fr-FR'); LS.s('lastBackupDB',dts);
    sync('ok','🔴 Temps réel'); updateBackupUI(); toast('Sauvegarde Dropbox ✓');
  }catch(e){sync('error','Erreur');toast('Dropbox: '+e.message,'err');}
}
async function backupNow(){ backupPC(); await backupDropbox(); }
function updateBackupUI(){
  const lbPC=LS.g('lastBackupPC')||'—',lbDB=LS.g('lastBackupDB')||'—';
  el('lastBackupLabel',lbPC!=='—'?lbPC:lbDB!=='—'?lbDB:'Jamais');
  el('lastBackupPC',lbPC); el('lastBackupDB',lbDB);
  const nb=document.getElementById('nextBackup');
  if(nb){const d=new Date();d.setHours(AUTO_BACKUP_HOUR,0,0,0);if(d<new Date())d.setDate(d.getDate()+1);nb.textContent=d.toLocaleString('fr-FR');}
}
function scheduleAutoBackup(){
  if(backupTimer)clearTimeout(backupTimer);
  const now=new Date(),next=new Date();
  next.setHours(AUTO_BACKUP_HOUR,0,0,0);
  if(next<=now)next.setDate(next.getDate()+1);
  backupTimer=setTimeout(async()=>{await backupNow();scheduleAutoBackup();},next-now);
}
function importerDonnees(e){
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=async ev=>{
    try{
      const data=JSON.parse(ev.target.result);
      if(!confirm(`Importer sauvegarde du ${data.exportedAt?new Date(data.exportedAt).toLocaleString('fr-FR'):'?'}\n⚠️ Remplace toutes les données.`))return;
      if(data.users)users=data.users;if(data.pdvs)pdvs=data.pdvs;
      if(data.comptes)comptes=data.comptes;if(data.recettes)recettes=data.recettes;
      if(data.versements)versements=data.versements;if(data.mvts)mvts=data.mvts;
      if(data.clotures)clotures=data.clotures;if(data.transferts)transferts=data.transferts;
      saveLocal();
      if(useFirebase){
        sync('syncing','Upload…');
        const all=[...users.map(x=>['users',x]),...pdvs.map(x=>['pdvs',x]),...comptes.map(x=>['comptes',x]),
          ...recettes.map(x=>['recettes',x]),...versements.map(x=>['versements',x]),
          ...mvts.map(x=>['mvts',x]),...clotures.map(x=>['clotures',x]),...(transferts||[]).map(x=>['transferts',x])];
        for(const[col,x]of all)await fbSave(col,x.id,x);
        sync('ok','🔴 Temps réel');
      }
      populateSelects();renderDashboard();toast('Données importées ✓');closeM('mBackup');
    }catch(err){toast('Erreur fichier JSON','err');}
  };
  reader.readAsText(file);e.target.value='';
}

// ══════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════
const fmt=n=>new Intl.NumberFormat('fr-FR').format(Math.round(n||0));
const rowNum=i=>`<td style="color:var(--text3);font-size:.68rem;font-weight:600;min-width:24px;text-align:right;padding-right:8px;user-select:none">${i+1}</td>`;
const today=()=>new Date().toISOString().split('T')[0];
const nowTm=()=>new Date().toTimeString().slice(0,5);
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,5);
const fmtD=d=>{if(!d)return'—';const[y,m,j]=d.split('-');return`${j}/${m}/${y}`;};
const initials=n=>n.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
const nv=id=>parseFloat(document.getElementById(id)?.value)||0;
const el=(id,txt)=>{const e=document.getElementById(id);if(e)e.textContent=txt;};
function sync(state,label){
  const dot=document.getElementById('syncDot'),lbl=document.getElementById('syncLabel');
  if(dot)dot.className='sync-dot'+(state==='syncing'?' syncing':state==='error'?' error':'');
  if(lbl)lbl.textContent=label;
}
function toast(msg,type='ok'){
  const t=document.getElementById('toast');
  t.textContent=msg;t.className='toast show '+type;
  setTimeout(()=>{t.className='toast';},2800);
}
function closeM(id){document.getElementById(id)?.classList.remove('open');}
function openM(id){document.getElementById(id)?.classList.add('open');updateBackupUI();}
document.addEventListener('click',e=>{if(e.target.classList.contains('modal-ov'))e.target.classList.remove('open');});
function resetFilter(...ids){ids.forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});}
function weekBounds(d){
  const dt=new Date(d),day=dt.getDay()||7,mon=new Date(dt);
  mon.setDate(dt.getDate()-day+1);
  const sun=new Date(mon);sun.setDate(mon.getDate()+6);
  return{start:mon.toISOString().split('T')[0],end:sun.toISOString().split('T')[0]};
}
const MM_LABEL={OM:'🟠 Orange Money',MTN:'🟡 MTN MoMo',WAVE:'🔵 Wave',MOOV:'🟢 Moov Money',CASH:'💵 Cash',CHEQUE:'📝 Chèque',VIREMENT:'🏦 Virement',ESPECES_PDV:'💵 Espèces (caisse PDV)',BANQUE_PDV:'🏦 Virement banque locale PDV'};
const OP_ICONS={OM:'🟠',MTN:'🟡',WAVE:'🔵',MOOV:'🟢',BICICI:'🏦',SGBCI:'🏦',ECOBANK:'🏦',UBA:'🏦',BNI:'🏦',NSIA:'🏦',SIB:'🏦',CORIS:'🏦',BOA:'🏦',CASH:'💵',AUTRE:'💳'};
const FREQ_LABEL={quotidien:'Quotidien',bihebdomadaire:'2×/semaine',hebdomadaire:'Hebdo',bimensuel:'Bimensuel',mensuel:'Mensuel'};
const JOURS_NOM=['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
const mmBadge=v=>`<span style="font-weight:600">${MM_LABEL[v]||v}</span>`;
const statutBadge=s=>{const m={'confirmé':'bg','reçu':'bc','en attente':'ba'};return`<span class="badge ${m[s]||'ba'}">${s}</span>`;};
const pdvBadge=id=>{const p=pdvs.find(x=>x.id===id);return p?`<span class="${p.type==='principale'?'tag-principale':'tag-depot'}">${p.nom}</span>`:id;};

// ── DISPONIBILITÉ v4 ───────────────────────────────────
// Banque = disponible, MM = en transit, Caisse = disponible
function isBanque(c){ return c.cat==='banque'||c.cat==='caisse'; }
function isMM(c){ return c.cat==='mobile_money'; }
function totalDispo(){ return comptes.filter(c=>isBanque(c)&&c.actif!==false).reduce((s,c)=>s+(c.solde||0),0); }
function totalTransit(){ return comptes.filter(c=>isMM(c)&&c.actif!==false).reduce((s,c)=>s+(c.solde||0),0); }
function dispoBadge(c){
  if(isBanque(c))return`<span class="badge bg">✓ Disponible</span>`;
  return`<span class="badge ba">⏳ En transit</span>`;
}

// ══════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════
async function doLogin(){
  const login=document.getElementById('loginUser').value.trim();
  const pass=document.getElementById('loginPass').value;
  const u=users.find(x=>x.login===login&&x.pass===pass&&x.actif!==false);
  if(!u){document.getElementById('loginErr').style.display='block';return;}
  document.getElementById('loginErr').style.display='none';
  u.lastLogin=new Date().toISOString();
  await saveItem('users',u);
  currentUser=u; startApp();
}
window.doLogin=doLogin;
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&document.getElementById('loginScreen').style.display!=='none')doLogin();
});
function doLogout(){
  currentUser=null;
  document.getElementById('loginScreen').style.display='flex';
  document.getElementById('appShell').style.display='none';
}
window.doLogout=doLogout;
function startApp(){
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('appShell').style.display='block';
  document.getElementById('appShell').classList.toggle('is-admin',currentUser.role==='admin');
  document.getElementById('hdrDate').textContent=new Date().toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'long',year:'numeric'});
  document.getElementById('uAvatar').textContent=initials(currentUser.nom);
  el('uName',currentUser.nom); el('uRole',currentUser.role);
  ['mRSaisie','mVSaisie','mMSaisie','mcSuperviseur'].forEach(id=>{
    const e=document.getElementById(id);if(e)e.value=currentUser.nom;
  });
  document.getElementById('caisseDate').value=today();
  populateSelects(); updateBackupUI(); scheduleAutoBackup(); subscribeAll();
  goTo('dashboard');
}

// ══════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════
const PAGES=['dashboard','recettes','versements','caisse','banques','rapport','releves','caisseprinc','petitecaisse','caissiere','ran','admin','utilisateurs'];
function goTo(name){
  PAGES.forEach(p=>document.getElementById('pg-'+p)?.classList.remove('active'));
  document.getElementById('pg-'+name)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n=>{
    const t=n.textContent.trim().toLowerCase();
    n.classList.toggle('active',
      (name==='dashboard'&&t.includes('tableau'))||(name==='recettes'&&t.includes('recette'))||
      (name==='versements'&&t.includes('versement'))||(name==='caisse'&&t.includes('clôture'))||
      (name==='banques'&&t.includes('banques'))||(name==='rapport'&&t.includes('rapport'))||
      (name==='releves'&&t.includes('relevé'))||(name==='petitecaisse'&&t.includes('petite'))||
      (name==='caisseprinc'&&t.includes('principale'))||
      (name==='caissiere'&&t.includes('caissière'))||(name==='ran'&&t.includes('nouveaux'))||(name==='admin'&&t.includes('config'))||
      (name==='utilisateurs'&&t.includes('utilis')));
  });
  const mm=['dashboard','recettes','versements','caisse','banques'];
  document.querySelectorAll('.mnav-item').forEach((n,i)=>n.classList.toggle('active',mm[i]===name));
  ({dashboard:renderDashboard,recettes:renderRecettes,versements:renderVersements,
    caisse:renderCaisse,banques:renderBanques,rapport:renderRapport,
    releves:renderReleves,petitecaisse:renderPetiteCaisse,caisseprinc:renderCaisseP,
    caissiere:renderSuiviCaissiere,ran:renderRAN,admin:renderAdmin,utilisateurs:renderUsers})[name]?.();
}
window.goTo=goTo;

// ══════════════════════════════════════════════════════
// SELECTS
// ══════════════════════════════════════════════════════
function populateSelects(){
  const pdvO=pdvs.map(p=>`<option value="${p.id}">${p.nom}</option>`).join('');
  const cptO=comptes.filter(c=>c.actif!==false).map(c=>`<option value="${c.id}">${c.nom}</option>`).join('');
  const mmO=comptes.filter(c=>isMM(c)&&c.actif!==false).map(c=>`<option value="${c.id}">${c.nom}</option>`).join('');
  const bqO=comptes.filter(c=>isBanque(c)&&c.actif!==false).map(c=>`<option value="${c.id}">${c.nom}</option>`).join('');
  ['mRPDV','mVPDV','smsPDV'].forEach(id=>{const e=document.getElementById(id);if(e)e.innerHTML=pdvO;});
  ['fRPDV','fVPDV'].forEach(id=>{const e=document.getElementById(id);if(e)e.innerHTML='<option value="">Tous PDV</option>'+pdvO;});
  const mup=document.getElementById('mUPDV');if(mup)mup.innerHTML='<option value="">Tous</option>'+pdvO;
  const mpc=document.getElementById('mPDVCompte');if(mpc)mpc.innerHTML='<option value="">— Aucun —</option>'+cptO;
  ['mVCompte','mMCompte'].forEach(id=>{const e=document.getElementById(id);if(e)e.innerHTML=cptO;});
  const fmc=document.getElementById('fMCompte');if(fmc)fmc.innerHTML='<option value="">Tous comptes</option>'+cptO;
  const frc=document.getElementById('fRCanal');
  if(frc)frc.innerHTML='<option value="">Tous canaux</option>'+Object.entries(MM_LABEL).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
  // Transfert MM→Banque
  const tSrc=document.getElementById('tSrcCompte');if(tSrc)tSrc.innerHTML=mmO;
  const tDst=document.getElementById('tDstCompte');if(tDst)tDst.innerHTML=bqO;
  // Versements multiples PDV
  const vPDV2=document.getElementById('mVPDV2');if(vPDV2)vPDV2.innerHTML=pdvO;
  // RAN — filtre PDV
  const ranPDV=document.getElementById('ranPDVFil');
  if(ranPDV)ranPDV.innerHTML='<option value="">Tous les PDV / Centrale</option>'+pdvO;
  // RAN — sélecteur mois (défaut = mois courant)
  const ranPer=document.getElementById('ranPeriode');
  if(ranPer&&!ranPer.value)ranPer.value=today().slice(0,7);
  // Vacations — peupler le select clôture
  populateVacationSelect();
}

// ══════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════
function renderDashboard(){
  const t=today();
  const todayR=recettes.filter(r=>r.date===t);
  const totalJ=todayR.reduce((s,r)=>s+(r.montant||0),0);
  const totalM=recettes.filter(r=>r.date?.slice(0,7)===t.slice(0,7)).reduce((s,r)=>s+(r.montant||0),0);
  const enAtt=versements.filter(v=>v.statut==='en attente').reduce((s,v)=>s+(v.montant||0),0);
  const dispo=totalDispo(), transit=totalTransit();
  const totConf=versements.filter(v=>v.statut==='confirmé'&&v.date?.slice(0,7)===t.slice(0,7)).reduce((s,v)=>s+(v.montant||0),0);
  el('dbSub',`Mis à jour ${new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}`);
  document.getElementById('dbStats').innerHTML=`
    <div class="stat-card green"><div class="stat-lbl">Recettes aujourd'hui</div><div class="stat-val green">${fmt(totalJ)}</div><div class="stat-sub">${DEVISE} — ${todayR.length} op.</div></div>
    <div class="stat-card blue"><div class="stat-lbl">Recettes ce mois</div><div class="stat-val blue">${fmt(totalM)}</div><div class="stat-sub">${DEVISE}</div></div>
    <div class="stat-card amber"><div class="stat-lbl">Versements en attente</div><div class="stat-val amber">${fmt(enAtt)}</div><div class="stat-sub">${DEVISE}</div></div>
    <div class="stat-card purple"><div class="stat-lbl">Confirmés ce mois</div><div class="stat-val purple">${fmt(totConf)}</div><div class="stat-sub">${DEVISE}</div></div>
    <div class="stat-card green"><div class="stat-lbl">✓ Disponible (Banques)</div><div class="stat-val green">${fmt(dispo)}</div><div class="stat-sub">${DEVISE} — comptes bancaires</div></div>
    <div class="stat-card amber"><div class="stat-lbl">⏳ En transit (MM)</div><div class="stat-val amber">${fmt(transit)}</div><div class="stat-sub">${DEVISE} — mobile money</div></div>`;
  document.getElementById('dbComptes').innerHTML=comptes.filter(c=>c.actif!==false).map(c=>{
    const col=c.color||'var(--green)',op=c.op==='AUTRE'&&c.opLibre?c.opLibre:c.op;
    return`<div class="compte-card" style="border-left:3px solid ${col};cursor:pointer" onclick="goTo('banques');setTimeout(()=>ouvrirMouvementsCompte('${c.id}'),100)" title="Voir mouvements de ${c.nom}">
      <div class="cc-icon">${OP_ICONS[c.op]||'💳'}</div>
      <div class="cc-name">${c.nom}${c.tetePont?` <span style="font-size:.6rem;background:var(--cyan-dim);color:var(--cyan);padding:1px 4px;border-radius:3px">TP</span>`:''}</div>
      <div class="cc-solde" style="color:${(c.solde||0)>=0?col:'var(--red)'};">${fmt(c.solde)} <span style="font-size:.7rem;font-weight:400;color:var(--text2)">${DEVISE}</span></div>
      <div style="margin-top:4px">${dispoBadge(c)}</div>
      <div class="cc-type">${c.cat==='mobile_money'?'Mobile Money':c.cat==='banque'?'Banque':'Caisse'} · ${op}</div>
      <div style="font-size:.62rem;color:var(--cyan);margin-top:4px">📋 Voir mouvements</div>
    </div>`;
  }).join('');
  const rTb=document.getElementById('dbRecTbody');
  rTb.innerHTML=todayR.length?todayR.map(r=>`<tr style="cursor:pointer" onclick="ouvrirRecettesPDV('${r.pdv}','${r.canal}')" title="Voir recettes ${pdvs.find(p=>p.id===r.pdv)?.nom||r.pdv}">
    <td>${pdvBadge(r.pdv)}</td><td>${mmBadge(r.canal)}</td><td class="amt pos">${fmt(r.montant)}</td>
  </tr>`).join('')
    :'<tr><td colspan="3" style="color:var(--text3);text-align:center;padding:14px">Aucune recette</td></tr>';
  const vTb=document.getElementById('dbVerTbody');
  const lastV=[...versements].sort((a,b)=>(b.ts||0)-(a.ts||0)).slice(0,6);
  vTb.innerHTML=lastV.length?lastV.map(v=>`<tr style="cursor:pointer" onclick="ouvrirVersementsPDV('${v.pdv}','${v.type||v.canal}')" title="Voir versements ${pdvs.find(p=>p.id===v.pdv)?.nom||v.pdv}">
    <td>${pdvBadge(v.pdv)}</td><td>${mmBadge(v.type||v.canal)}</td><td class="amt pos">${fmt(v.montant)}</td><td>${statutBadge(v.statut)}</td>
  </tr>`).join('')
    :'<tr><td colspan="4" style="color:var(--text3);text-align:center;padding:14px">Aucun versement</td></tr>';
}
window.renderDashboard=renderDashboard;

// ══════════════════════════════════════════════════════
// IMPORT SOLDES DÉMARRAGE (v4.1) — COMPTES + MM_PDV
// ══════════════════════════════════════════════════════
async function importSoldesExcel(file){
  if(!window.XLSX){toast('Chargement librairie Excel…','info');return;}
  const data=await file.arrayBuffer();
  const wb=window.XLSX.read(data,{type:'array'});
  let updatedComptes=0,updatedPDV=0,errors=[];

  // ── FEUILLE COMPTES ──────────────────────────────────
  const ws1=wb.Sheets['COMPTES'];
  if(ws1){
    const rows=window.XLSX.utils.sheet_to_json(ws1,{header:1,defval:''});
    let dataStart=-1;
    for(let i=0;i<rows.length;i++){if(String(rows[i][0]).trim()==='ID_COMPTE'){dataStart=i+2;break;}}
    if(dataStart>=0){
      for(let i=dataStart;i<rows.length;i++){
        const row=rows[i];
        const id=String(row[0]||'').trim();
        const nomFichier=String(row[1]||'').trim().toLowerCase();
        const soldeInit=parseFloat(row[5])||0;
        const solde=parseFloat(row[6])||0;
        if(!id.startsWith('CPT_'))continue;
        const c=comptes.find(x=>{
          const n=x.nom.toLowerCase().trim();
          // Matching par ID prioritaire
          if(id==='CPT_CAISSE')   return x.cat==='caisse'&&!n.includes('petite');
          if(id==='CPT_PETCAIS')  return n.includes('petite');
          if(id==='CPT_BICICI')   return n.includes('bicici');
          if(id==='CPT_FINLIV')   return n.includes('finafrica')&&n.includes('livret');
          if(id==='CPT_FINDEP')   return n.includes('finafrica')&&(n.includes('depot')||n.includes('dépôt'));
          if(id==='CPT_BNI')      return x.op==='BNI'||n==='bni';
          if(id==='CPT_OBANK')    return n.includes('orange bank')||x.op==='ORANGE BANK';
          if(id==='CPT_BOA')      return x.op==='BOA'||n==='boa';
          if(id==='CPT_BDTRES')   return n.includes('bdtresor')||x.op==='BDTRESOR';
          if(id==='CPT_OM_CENT')  return x.cat==='mobile_money'&&x.op==='OM'&&(n.includes('centra')||n.includes('centrale'));
          if(id==='CPT_MTN_CENT') return x.cat==='mobile_money'&&x.op==='MTN'&&n.includes('centra');
          if(id==='CPT_WAVE_CENT')return x.cat==='mobile_money'&&x.op==='WAVE'&&n.includes('centra');
          // Fallback nom
          return n===nomFichier;
        });
        if(!c){errors.push(`Compte : ${row[1]} (${id})`);continue;}
        c.solde=solde;c.soldeInit=soldeInit;
        await saveItem('comptes',c);updatedComptes++;
      }
    }
  }

  // ── FEUILLE MM_PDV ───────────────────────────────────
  const ws2=wb.Sheets['MM_PDV'];
  if(ws2){
    const rows=window.XLSX.utils.sheet_to_json(ws2,{header:1,defval:''});
    for(let i=3;i<rows.length;i++){
      const row=rows[i];
      const nomPDV=String(row[0]||'').trim();
      if(!nomPDV||nomPDV==='TOTAL'||nomPDV.startsWith('Ces soldes'))continue;
      const p=pdvs.find(x=>{
        const n=x.nom.toLowerCase().trim();
        const f=nomPDV.toLowerCase().trim();
        return n===f ||
          // Alias pharmacie principale
          (f==='pharmacie principale'&&(x.type==='principale'||n.includes('pharmacie')||n.includes('principale')||n.includes('central'))) ||
          // Correspondance partielle dépôts
          (f.startsWith('depot de ')&&n===f) ||
          (f.startsWith('depot de ')&&n.includes(f.replace('depot de ',''))) ||
          n.includes(f)||f.includes(n);
      });
      if(!p){errors.push(`PDV : ${nomPDV}`);continue;}
      if(String(row[2]||'').trim())p.numOM=String(row[2]).trim();
      if(parseFloat(row[3]))p.soldeOM=Math.round(parseFloat(row[3]));
      if(String(row[4]||'').trim())p.numMTN=String(row[4]).trim();
      if(parseFloat(row[5]))p.soldeMTN=Math.round(parseFloat(row[5]));
      if(String(row[6]||'').trim())p.numWave=String(row[6]).trim();
      if(parseFloat(row[7]))p.soldeWave=Math.round(parseFloat(row[7]));
      if(String(row[8]||'').trim())p.numMoov=String(row[8]).trim();
      if(parseFloat(row[9]))p.soldeMoov=Math.round(parseFloat(row[9]));
      await saveItem('pdvs',p);updatedPDV++;
    }
  }

  let msg=`✅ Import terminé — ${updatedComptes} compte(s), ${updatedPDV} PDV mis à jour`;
  if(errors.length)msg+=`\n⚠️ Non trouvés : ${errors.join(' | ')}`;
  toast(msg);if(errors.length)alert(msg);
  renderDashboard();renderBanques();populateSelects();
}
window.importSoldesExcel=importSoldesExcel;

function openImportSoldes(){
  const input=document.createElement('input');
  input.type='file';input.accept='.xlsx';
  input.onchange=e=>{
    const f=e.target.files[0];if(!f)return;
    if(!window.XLSX){
      const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload=()=>importSoldesExcel(f);document.head.appendChild(s);
    } else importSoldesExcel(f);
  };
  input.click();
}
window.openImportSoldes=openImportSoldes;
// Utilisable depuis toutes les pages
// ══════════════════════════════════════════════════════
function exportUniversel(titre, colonnes, lignes, opts={}){
  const {format='print', periode='', filtres=''}=opts;
  const now=new Date().toLocaleString('fr-FR');
  const totaux=opts.totaux||[];

  if(format==='excel'){
    const rows=[[PHARMACIE_NOM],[titre],[periode?`Période : ${periode}`:''][filtres?`Filtres : ${filtres}`:''],[`Généré le : ${now}`],[],colonnes,...lignes];
    if(totaux.length)rows.push([]);rows.push(...totaux);
    const csv=rows.filter(r=>r!==undefined&&r!=='').map(r=>(Array.isArray(r)?r:[r]).map(cell=>{const s=String(cell??'').replace(/"/g,'""');return s.includes(';')||s.includes('"')?`"${s}"`:s;}).join(';')).join('\n');
    const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);
    a.download=`${titre.replace(/\s+/g,'_')}_${today()}.csv`;a.click();URL.revokeObjectURL(a.href);
    toast('Export Excel (.csv) téléchargé ✓');
    return;
  }

  // HTML commun pour print et Word
  const tableHTML=`
  <table>
    <thead><tr>${colonnes.map(c=>`<th>${c}</th>`).join('')}</tr></thead>
    <tbody>
      ${lignes.map((row,i)=>`<tr style="background:${i%2?'#fafafa':'#fff'}">${row.map(cell=>`<td>${cell??'—'}</td>`).join('')}</tr>`).join('')}
      ${totaux.map(row=>`<tr style="background:#e8f5f0;font-weight:700">${row.map(cell=>`<td>${cell??''}</td>`).join('')}</tr>`).join('')}
    </tbody>
  </table>`;

  const htmlDoc=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${titre}</title>
  <style>
    @page{size:A4 landscape;margin:10mm}
    body{font-family:Arial,sans-serif;font-size:9pt;color:#111}
    .header{display:flex;justify-content:space-between;border-bottom:2px solid #00C47A;padding-bottom:8px;margin-bottom:12px}
    .pharma{font-size:12pt;font-weight:800;color:#00C47A}
    .titre{font-size:10pt;font-weight:700}
    .meta{font-size:7pt;color:#999}
    table{width:100%;border-collapse:collapse;font-size:8.5pt}
    th{background:#f0f0f0;padding:5px 7px;text-align:left;border:1px solid #ddd;font-size:8pt}
    td{padding:4px 7px;border:1px solid #eee}
    .footer{margin-top:12px;font-size:7pt;color:#aaa;text-align:center}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body>
  <div class="header">
    <div><div class="pharma">${PHARMACIE_NOM}</div><div class="titre">${titre}</div>
    ${periode?`<div class="meta">${periode}</div>`:''}
    ${filtres?`<div class="meta">Filtres : ${filtres}</div>`:''}
    </div>
    <div style="text-align:right"><div class="meta">Généré le ${now}</div><div class="meta">${lignes.length} ligne(s)</div></div>
  </div>
  ${tableHTML}
  <div class="footer">PharmaCash Pro — Document confidentiel</div>
  ${format==='print'?`<script>window.onload=()=>window.print()<\/script>`:''}
  </body></html>`;

  if(format==='word'){
    const blob=new Blob([htmlDoc],{type:'application/msword;charset=utf-8'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);
    a.download=`${titre.replace(/\s+/g,'_')}_${today()}.doc`;a.click();URL.revokeObjectURL(a.href);
    toast('Export Word (.doc) téléchargé ✓');
    return;
  }
  // print ou pdf
  const w=window.open('','_blank');
  w.document.write(htmlDoc);w.document.close();
  if(format==='pdf')toast('Dans la fenêtre → "Enregistrer en PDF"');
}
window.exportUniversel=exportUniversel;

// Bouton d'export réutilisable (retourne le HTML du bouton)
function btnExport(fnName){
  return`<div style="display:flex;gap:4px">
    <button class="btn btn-ghost btn-xs" onclick="${fnName}('print')" title="Imprimer">🖨️</button>
    <button class="btn btn-ghost btn-xs" onclick="${fnName}('excel')" title="Export Excel">📊</button>
    <button class="btn btn-ghost btn-xs" onclick="${fnName}('word')" title="Export Word">📝</button>
    <button class="btn btn-ghost btn-xs" onclick="${fnName}('pdf')" title="Télécharger PDF">📄</button>
  </div>`;
}

// ── EXPORT RECETTES ───────────────────────────────────
function exportRecettes(format){
  let data=[...recettes].sort((a,b)=>b.date?.localeCompare(a.date||'')||0);
  const dF=document.getElementById('fRDate').value,pF=document.getElementById('fRPDV').value,cF=document.getElementById('fRCanal').value;
  if(currentUser.role!=='admin'&&currentUser.pdv)data=data.filter(r=>r.pdv===currentUser.pdv);
  if(dF)data=data.filter(r=>r.date===dF);if(pF)data=data.filter(r=>r.pdv===pF);if(cF)data=data.filter(r=>r.canal===cF);
  const total=data.reduce((s,r)=>s+(r.montant||0),0);
  const filtres=[dF?`Date: ${fmtD(dF)}`:'',pF?`PDV: ${pdvs.find(p=>p.id===pF)?.nom||pF}`:'',cF?`Canal: ${MM_LABEL[cF]||cF}`:''].filter(Boolean).join(' | ');
  exportUniversel('Recettes journalières',
    ['Date','PDV','Canal','Type','Montant (FCFA)','Référence','Saisi par'],
    data.map(r=>[fmtD(r.date),pdvs.find(p=>p.id===r.pdv)?.nom||r.pdv,MM_LABEL[r.canal]||r.canal,r.type,fmt(r.montant),r.ref||'—',r.saisie||'—']),
    {format,filtres,totaux:[['TOTAL','','','',fmt(total)+' FCFA','','']]});
}
window.exportRecettes=exportRecettes;

// ── EXPORT VERSEMENTS ─────────────────────────────────
function exportVersements(format){
  let data=[...versements].sort((a,b)=>b.date?.localeCompare(a.date||'')||0);
  const dF=document.getElementById('fVDate').value,pF=document.getElementById('fVPDV').value,tF=document.getElementById('fVType').value,sF=document.getElementById('fVStatut').value;
  if(dF)data=data.filter(v=>v.date===dF);if(pF)data=data.filter(v=>v.pdv===pF);if(tF)data=data.filter(v=>v.type===tF);if(sF)data=data.filter(v=>v.statut===sF);
  const total=data.reduce((s,v)=>s+(v.montant||0),0);
  const filtres=[dF?`Date: ${fmtD(dF)}`:'',pF?`PDV: ${pdvs.find(p=>p.id===pF)?.nom||pF}`:'',tF?`Type: ${tF}`:'',sF?`Statut: ${sF}`:''].filter(Boolean).join(' | ');
  exportUniversel('Versements',
    ['Date','PDV','Fréq.','Type','Compte dest.','Référence','Montant (FCFA)','Statut','Saisi par'],
    data.map(v=>[fmtD(v.date),pdvs.find(p=>p.id===v.pdv)?.nom||v.pdv,v.freq||'—',MM_LABEL[v.type]||v.type,comptes.find(c=>c.id===v.compte)?.nom||'—',v.ref||'—',fmt(v.montant),v.statut,v.saisie||'—']),
    {format,filtres,totaux:[['TOTAL','','','','','',fmt(total)+' FCFA','','']]});
}
window.exportVersements=exportVersements;

// ── EXPORT PETITE CAISSE ──────────────────────────────
function exportPetiteCaisse(format){
  const data=[...petiteCaisse].sort((a,b)=>b.date?.localeCompare(a.date||'')||0);
  const cptPC=comptes.find(c=>c.nom.toLowerCase().includes('petite'));
  const soldeInit=cptPC?.soldeInit||0;
  const mvtsPC=petiteCaisse.reduce((s,m)=>s+(m.type==='appro'?m.montant:-(m.montant||0)),0);
  const solde=soldeInit+mvtsPC;
  exportUniversel('Petite Caisse',
    ['Date & Heure','Type','Libellé','Catégorie','Référence','Montant (FCFA)','Solde après','Saisi par'],
    data.map(m=>[`${fmtD(m.date)} ${m.heure||''}`,m.type==='appro'?'Approvisionnement':'Dépense',m.libelle||'—',m.categorie||'—',m.ref||'—',(m.type==='appro'?'+':'-')+fmt(m.montant),fmt(m.soldeApres||0),m.saisie||'—']),
    {format,totaux:[['','','','','','SOLDE ACTUEL',fmt(solde)+' FCFA','']]}); 
}
window.exportPetiteCaisse=exportPetiteCaisse;

// ── EXPORT CAISSE ─────────────────────────────────────
function exportCaisse(format){
  const date=document.getElementById('caisseDate')?.value||today();
  const data=clotures.filter(c=>c.date===date).sort((a,b)=>a.vacation?.localeCompare(b.vacation||'')||0);
  const totM=data.reduce((s,c)=>s+(c.totalMachine||0),0);
  const totV=data.reduce((s,c)=>s+(c.totalVerse||0),0);
  const totE=data.reduce((s,c)=>s+(c.ecart||0),0);
  exportUniversel(`Clôture de caisse — ${fmtD(date)}`,
    ['Vacation','Caissière','Machine','Cash versé','MM versé','Total versé','Écart','Statut','Validé par'],
    data.map(c=>[c.vacation,c.caissiere,fmt(c.totalMachine),fmt(c.cashVerse),fmt((c.omVerse||0)+(c.mtnVerse||0)+(c.waveVerse||0)+(c.moovVerse||0)),fmt(c.totalVerse),(c.ecart>0?'+':c.ecart<0?'−':'')+fmt(Math.abs(c.ecart||0)),c.statut,c.valide_par||'—']),
    {format,totaux:[['TOTAL','',fmt(totM),'','',fmt(totV),(totE>0?'+':totE<0?'−':'')+fmt(Math.abs(totE)),'','']]}); 
}
window.exportCaisse=exportCaisse;

// ── EXPORT MOUVEMENTS BANCAIRES ───────────────────────
function exportMvts(format){
  const dF=document.getElementById('fMDate').value,cF=document.getElementById('fMCompte').value,tF=document.getElementById('fMType').value;
  let data=[...mvts,...transferts.map(t=>({...t,libelle:`Transfert MM→Banque`,_trf:true}))].sort((a,b)=>b.date?.localeCompare(a.date||'')||0);
  if(dF)data=data.filter(m=>m.date===dF);if(cF)data=data.filter(m=>m.compte===cF||m.compteSrc===cF||m.compteDst===cF);if(tF)data=data.filter(m=>m.type===tF);
  const filtres=[dF?`Date: ${fmtD(dF)}`:'',cF?`Compte: ${comptes.find(c=>c.id===cF)?.nom||cF}`:'',tF?`Type: ${tF}`:''].filter(Boolean).join(' | ');
  exportUniversel('Mouvements financiers',
    ['Date','Compte','Type','Libellé','Référence','Montant (FCFA)','Solde après','Saisi par'],
    data.map(m=>[fmtD(m.date),comptes.find(c=>c.id===(m.compte||m.compteSrc))?.nom||'—',m.type,m.libelle||'—',m.ref||'—',(m.type==='entrée'?'+':'-')+fmt(m.montant),fmt(m.soldeApres||0),m.saisie||'—']),
    {format,filtres});
}
window.exportMvts=exportMvts;

// ── EXPORT SUIVI CAISSIÈRES ───────────────────────────
function exportSuiviCaissiere(format){
  const periode=document.getElementById('scPeriode')?.value||'mois';
  const t=today();let debut,fin;
  if(periode==='jour'){debut=t;fin=t;}
  else if(periode==='semaine'){const b=weekBounds(t);debut=b.start;fin=b.end;}
  else if(periode==='mois'){debut=t.slice(0,7)+'-01';fin=t;}
  else{debut=document.getElementById('scDebut')?.value||t;fin=document.getElementById('scFin')?.value||t;}
  const dayC=clotures.filter(c=>c.date>=debut&&c.date<=fin);
  const byCaissiere={};
  dayC.forEach(c=>{
    if(!byCaissiere[c.caissiere])byCaissiere[c.caissiere]={nom:c.caissiere,totalMachine:0,cashVerse:0,mmVerse:0,totalVerse:0,ecart:0,nb:0};
    const b=byCaissiere[c.caissiere];
    b.totalMachine+=(c.totalMachine||0);b.cashVerse+=(c.cashVerse||0);
    b.mmVerse+=(c.omVerse||0)+(c.mtnVerse||0)+(c.waveVerse||0)+(c.moovVerse||0);
    b.totalVerse+=(c.totalVerse||0);b.ecart+=(c.ecart||0);b.nb++;
  });
  const data=Object.values(byCaissiere);
  exportUniversel(`Suivi caissières — ${fmtD(debut)} au ${fmtD(fin)}`,
    ['Caissière','Machine','Cash versé','MM versé','Total versé','Écart','Vacations'],
    data.map(c=>[(c.nom),(fmt(c.totalMachine)),(fmt(c.cashVerse)),(fmt(c.mmVerse)),(fmt(c.totalVerse)),((c.ecart>0?'+':c.ecart<0?'−':'')+fmt(Math.abs(c.ecart))),(c.nb+' vacation(s)')]),
    {format,periode:`${fmtD(debut)} au ${fmtD(fin)}`});
}
window.exportSuiviCaissiere=exportSuiviCaissiere;

// ══════════════════════════════════════════════════════
// RECETTES
// ══════════════════════════════════════════════════════
// ── Gestion des vues Recettes ─────────────────────────
let _recettesVue = 'globale';
function setRecettesVue(vue) {
  _recettesVue = vue;
  ['globale','depots','psrm'].forEach(v => {
    const btn = document.getElementById('rRec'+v.charAt(0).toUpperCase()+v.slice(1));
    if (!btn) return;
    btn.style.background = v === vue ? 'var(--green)' : '';
    btn.style.color = v === vue ? '#fff' : '';
    btn.className = v === vue ? 'btn btn-sm' : 'btn btn-ghost btn-sm';
  });
  renderRecettes();
}
window.setRecettesVue = setRecettesVue;

function renderRecettes(){
  let data=[...recettes].sort((a,b)=>b.date?.localeCompare(a.date||'')||0);
  const dF=document.getElementById('fRDate').value,pF=document.getElementById('fRPDV').value,cF=document.getElementById('fRCanal').value;
  if(currentUser.role!=='admin'&&currentUser.pdv)data=data.filter(r=>r.pdv===currentUser.pdv);
  // Filtre par vue (Global / Dépôts / PSRM)
  const pdvP=pdvs.find(p=>p.type==='principale');
  if(_recettesVue==='psrm'&&pdvP) data=data.filter(r=>r.pdv===pdvP.id);
  else if(_recettesVue==='depots'&&pdvP) data=data.filter(r=>r.pdv!==pdvP.id);
  if(dF)data=data.filter(r=>r.date===dF);if(pF)data=data.filter(r=>r.pdv===pF);if(cF)data=data.filter(r=>r.canal===cF);
  // Afficher le total de la vue
  const total=data.reduce((s,r)=>s+(r.montant||0),0);
  const vueLabel=_recettesVue==='psrm'?'🏛️ Pharmacie Principale':_recettesVue==='depots'?'🏪 Dépôts':'🌐 Global';
  const subEl=document.querySelector('#pg-recettes .pg-sub');
  if(subEl)subEl.textContent=`${vueLabel} — ${data.length} recette(s) — Total : ${fmt(total)} ${DEVISE}`;
  const tbody=document.getElementById('recTbody');
  if(!data.length){tbody.innerHTML='<tr><td colspan="8"><div class="empty-state"><div class="ei">📋</div>Aucune recette</div></td></tr>';return;}
  tbody.innerHTML=data.map((r,i)=>`<tr>
    ${rowNum(i)}
    <td>${fmtD(r.date)}</td><td>${pdvBadge(r.pdv)}</td><td>${mmBadge(r.canal)}</td>
    <td><span class="badge bb">${r.type}</span></td>
    <td class="amt pos">${fmt(r.montant)}</td>
    <td style="color:var(--text2);font-size:.75rem">${r.ref||'—'}</td>
    <td style="color:var(--text2);font-size:.75rem">${r.saisie||'—'}</td>
    <td style="display:flex;gap:4px;justify-content:flex-end">
      ${currentUser.role==='admin'?`<button class="btn btn-ghost btn-xs" onclick="editRecette('${r.id}')" title="Corriger">✏️</button>`:'' }
      ${currentUser.role==='admin'?`<button class="btn btn-red btn-xs" onclick="delRecette('${r.id}')" title="Supprimer">✕</button>`:''}
    </td>
  </tr>`).join('');
}
window.renderRecettes=renderRecettes;
function openRecetteModal(){
  document.getElementById('mRDate').value=today();document.getElementById('mRHeure').value=nowTm();
  ['mRMontant','mRRef','mRNotes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('mRSaisie').value=currentUser.nom;
  if(currentUser.pdv)document.getElementById('mRPDV').value=currentUser.pdv;
  openM('mRecette');
}
window.openRecetteModal=openRecetteModal;
let _recSaving=false;
async function saveRecette(){
  if(_recSaving){toast('Enregistrement en cours…','info');return;}
  _recSaving=true;
  try{
    const date=document.getElementById('mRDate').value,pdv=document.getElementById('mRPDV').value,
      canal=document.getElementById('mRCanal').value,montant=parseFloat(document.getElementById('mRMontant').value);
    if(!date||!pdv||!canal||!montant){toast('Champs obligatoires manquants','err');return;}
    // Anti-doublons général : même PDV + même date + même canal + montant similaire (±1%)
    const doublon=recettes.find(r=>r.pdv===pdv&&r.date===date&&r.canal===canal&&Math.abs((r.montant||0)-montant)<=montant*0.01);
    if(doublon&&!confirm(`⚠️ Doublon détecté !\nUne recette identique existe déjà :\n${fmtD(doublon.date)} — ${pdvs.find(p=>p.id===pdv)?.nom||pdv} — ${MM_LABEL[canal]||canal} — ${fmt(doublon.montant)} ${DEVISE}\n\nConfirmer quand même ?`)){_recSaving=false;return;}
    const item={id:uid(),date,heure:document.getElementById('mRHeure').value,pdv,
      type:document.getElementById('mRType').value,canal,montant,
      ref:document.getElementById('mRRef').value,saisie:document.getElementById('mRSaisie').value,
      notes:document.getElementById('mRNotes').value,ts:Date.now()};
    recettes.push(item);await saveItem('recettes',item);
    closeM('mRecette');toast('Recette enregistrée ✓');renderRecettes();renderDashboard();
  } finally { _recSaving=false; }
}
window.saveRecette=saveRecette;
async function delRecette(id){
  if(!confirm('Supprimer ?'))return;
  recettes=recettes.filter(r=>r.id!==id);await delItem('recettes',id);renderRecettes();toast('Supprimé','info');
}
window.delRecette=delRecette;

// ── Edition recette (admin) ───────────────────────────
function editRecette(id){
  const r=recettes.find(x=>x.id===id);
  if(!r)return;
  // Vérifier que la clôture du mois n'est pas encore faite
  // (on permet la correction jusqu'à fin du mois en cours)
  const moisRec=r.date?.slice(0,7);
  const moisCourant=today().slice(0,7);
  if(moisRec<moisCourant){
    if(!confirm(`⚠️ Cette recette date du mois de ${moisRec}.\nLe mois est clôturé — modifier quand même ?`))return;
  }
  // Pré-remplir le modal avec les valeurs existantes
  document.getElementById('mRDate').value=r.date||today();
  document.getElementById('mRHeure').value=r.heure||nowTm();
  document.getElementById('mRMontant').value=r.montant||'';
  document.getElementById('mRRef').value=r.ref||'';
  document.getElementById('mRNotes').value=r.notes||'';
  document.getElementById('mRSaisie').value=r.saisie||currentUser.nom;
  document.getElementById('mRPDV').value=r.pdv||'';
  document.getElementById('mRCanal').value=r.canal||'CASH';
  document.getElementById('mRType').value=r.type||'vente comptoir';
  // Changer le titre du modal et le bouton
  const title=document.querySelector('#mRecette .modal-title');
  if(title)title.textContent='✏️ Corriger la recette';
  const btn=document.querySelector('#mRecette .btn-green');
  if(btn){btn.textContent='Enregistrer la correction';btn.onclick=()=>saveRecetteEdit(id);}
  openM('mRecette');
}
window.editRecette=editRecette;

async function saveRecetteEdit(id){
  if(_recSaving){toast('Enregistrement en cours…','info');return;}
  _recSaving=true;
  try{
    const r=recettes.find(x=>x.id===id);
    if(!r){toast('Recette introuvable','err');return;}
    const date=document.getElementById('mRDate').value;
    const pdv=document.getElementById('mRPDV').value;
    const canal=document.getElementById('mRCanal').value;
    const montant=parseFloat(document.getElementById('mRMontant').value);
    if(!date||!pdv||!canal||!montant){toast('Champs obligatoires manquants','err');return;}
    // Historique de correction
    r._corrections=r._corrections||[];
    r._corrections.push({
      par:currentUser.nom,
      le:new Date().toISOString(),
      avant:{date:r.date,pdv:r.pdv,canal:r.canal,montant:r.montant,type:r.type}
    });
    // Appliquer les corrections
    r.date=date;
    r.heure=document.getElementById('mRHeure').value;
    r.pdv=pdv;
    r.canal=canal;
    r.montant=montant;
    r.type=document.getElementById('mRType').value;
    r.ref=document.getElementById('mRRef').value;
    r.notes=document.getElementById('mRNotes').value;
    r.corrigePar=currentUser.nom;
    r.corrigeLe=new Date().toISOString();
    await saveItem('recettes',r);
    saveLocal();
    // Remettre le modal en mode création pour la prochaine ouverture
    const title=document.querySelector('#mRecette .modal-title');
    if(title)title.textContent='+ Nouvelle recette';
    const btn=document.querySelector('#mRecette .btn-green');
    if(btn){btn.textContent='Enregistrer';btn.onclick=saveRecette;}
    closeM('mRecette');
    toast(`✅ Recette corrigée — ${fmtD(date)} · ${fmt(montant)} ${DEVISE}`);
    renderRecettes();renderDashboard();
  } finally { _recSaving=false; }
}
window.saveRecetteEdit=saveRecetteEdit;

// ── SMS/WhatsApp parser (tous PDV) ────────────────────
function openSMSModal(){
  document.getElementById('smsTxt').value='';
  document.getElementById('smsResult').style.display='none';
  document.getElementById('btnSaveSMS').style.display='none';
  document.getElementById('smsDate').value=today();
  document.getElementById('smsMontant').value='';
  document.getElementById('smsRef') && (document.getElementById('smsRef').value='');
  document.getElementById('smsPDV').innerHTML=pdvs.map(p=>`<option value="${p.id}">${p.nom}</option>`).join('');
  document.getElementById('smsCanal').value='CASH';
  openM('mSMS');
}
window.openSMSModal=openSMSModal;
function _detectPDV(txt){
  const normalize=s=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,' ').trim();
  const loNorm=normalize(txt);
  let detPDV=pdvs[0]?.id;
  let bestScore=0;
  pdvs.forEach(p=>{
    const words=normalize(p.nom).split(' ').filter(w=>w.length>2);
    let score=0;
    words.forEach(w=>{
      if(loNorm.includes(w)){
        score+=w.length*2; // correspondance exacte
      } else {
        // Tolérance 1 faute de frappe (ex: "nafoum" vs "nafoun")
        const wLen=w.length;
        for(let i=0;i<=loNorm.length-wLen;i++){
          const chunk=loNorm.slice(i,i+wLen);
          let diff=0;
          for(let j=0;j<wLen;j++) if(chunk[j]!==w[j]) diff++;
          if(diff<=1&&wLen>=4){score+=w.length;break;}
        }
      }
    });
    if(score>bestScore){bestScore=score;detPDV=p.id;}
  });
  return detPDV;
}
window._detectPDV=_detectPDV;
function parseSMS(){
  const txt=document.getElementById('smsTxt').value;
  if(!txt.trim()){toast('Colle un SMS ou message WhatsApp','err');return;}
  // Normaliser les séparateurs de milliers avant extraction du montant
  const txtNorm=txt
    .replace(/(\d)\s(\d{3})(?!\d)/g,'$1$2')   // "149 800" -> "149800"
    .replace(/(\d),(\d{3})(?!\d)/g,'$1$2')      // "149,800" -> "149800"
    .replace(/(\d)\.(\d{3})(?!\d)/g,'$1$2');   // "149.800" -> "149800"
  // Exclure les années (2000-2099) et nombres < 500
  const nums=(txtNorm.match(/\d+/g)||[]).map(n=>parseInt(n))
    .filter(n=>n>=500&&n<999999999&&!(n>=2000&&n<=2099));
  const montant=nums.length?Math.max(...nums):0;
  const dm=txt.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.]?(\d{2,4})?/);
  if(dm){const[,j,m,y]=dm;const yr=y?(y.length===2?'20'+y:y):new Date().getFullYear();
    document.getElementById('smsDate').value=`${yr}-${m.padStart(2,'0')}-${j.padStart(2,'0')}`;}
  document.getElementById('smsPDV').value=_detectPDV(txt);
  let detCanal='CASH';
  if(/orange/i.test(txt))detCanal='OM';else if(/mtn/i.test(txt))detCanal='MTN';
  else if(/wave/i.test(txt))detCanal='WAVE';else if(/moov/i.test(txt))detCanal='MOOV';
  document.getElementById('smsCanal').value=detCanal;
  document.getElementById('smsMontant').value=montant||'';
  document.getElementById('smsResult').style.display='block';
  document.getElementById('btnSaveSMS').style.display='inline-block';
  const nomPDV=pdvs.find(p=>p.id===document.getElementById('smsPDV').value)?.nom||'?';
  toast(`Extrait — ${nomPDV} · ${fmt(montant)} ${DEVISE} — Vérifie avant d'enregistrer`);
}
window.parseSMS=parseSMS;
async function saveSMSRecette(){
  const pdv=document.getElementById('smsPDV').value,date=document.getElementById('smsDate').value,
    montant=parseFloat(document.getElementById('smsMontant').value),canal=document.getElementById('smsCanal').value;
  if(!date||!pdv||!montant){toast('Données incomplètes','err');return;}
  // Anti-doublons général
  const doublon=recettes.find(r=>r.pdv===pdv&&r.date===date&&r.canal===canal&&Math.abs((r.montant||0)-montant)<=montant*0.01);
  if(doublon&&!confirm(`⚠️ Doublon détecté !\nRecette identique déjà saisie :\n${fmtD(doublon.date)} — ${pdvs.find(p=>p.id===pdv)?.nom||pdv} — ${MM_LABEL[canal]||canal} — ${fmt(doublon.montant)} ${DEVISE}\n\nConfirmer quand même ?`))return;
  const item={id:uid(),date,heure:nowTm(),pdv,type:'vente comptoir',canal,montant,
    ref:'Via SMS/WhatsApp',saisie:currentUser.nom,
    notes:document.getElementById('smsTxt').value.slice(0,200),ts:Date.now()};
  recettes.push(item);await saveItem('recettes',item);
  closeM('mSMS');toast('Recette importée ✓');renderRecettes();renderDashboard();
}
window.saveSMSRecette=saveSMSRecette;

// ══════════════════════════════════════════════════════
// VERSEMENTS — multiples par dépôt (v4)
// ══════════════════════════════════════════════════════
function renderVersements(){
  let data=[...versements].sort((a,b)=>b.date?.localeCompare(a.date||'')||0);
  const dF=document.getElementById('fVDate').value,pF=document.getElementById('fVPDV').value,
    tF=document.getElementById('fVType').value,sF=document.getElementById('fVStatut').value;
  if(currentUser.role!=='admin'&&currentUser.pdv)data=data.filter(v=>v.pdv===currentUser.pdv);
  if(dF)data=data.filter(v=>v.date===dF);if(pF)data=data.filter(v=>v.pdv===pF);
  if(tF)data=data.filter(v=>v.type===tF);if(sF)data=data.filter(v=>v.statut===sF);
  const tbody=document.getElementById('verTbody');
  if(!data.length){tbody.innerHTML='<tr><td colspan="10"><div class="empty-state"><div class="ei">💸</div>Aucun versement</div></td></tr>';return;}
  tbody.innerHTML=data.map((v,i)=>{
    const cpt=comptes.find(c=>c.id===v.compte);
    return`<tr>
      ${rowNum(i)}
      <td>${fmtD(v.date)}</td><td>${pdvBadge(v.pdv)}</td>
      <td><span class="wk">${v.freq||'quotidien'}</span></td>
      <td>${mmBadge(v.type)}</td>
      <td style="font-size:.78rem;color:var(--text2)">${cpt?cpt.nom:'—'}</td>
      <td style="font-size:.75rem;color:var(--text2)">${v.ref||'—'}</td>
      <td class="amt pos">${fmt(v.montant)}</td>
      <td style="font-size:.75rem">
        ${(v.fraisOp||v.fraisTimbre)?`
          <span style="color:var(--amber)">−${fmt((v.fraisOp||0)+(v.fraisTimbre||0))}</span>
          <div style="font-size:.65rem;color:var(--text3)">${v.fraisOp?`Op: ${fmt(v.fraisOp)} `:''} ${v.fraisTimbre?`Tmb: ${fmt(v.fraisTimbre)}`:''}</div>
          <span style="color:var(--green);font-weight:700">Net: ${fmt(v.montant-(v.fraisOp||0)-(v.fraisTimbre||0))}</span>
        `:'<span style="color:var(--text3)">—</span>'}
      </td>
      <td>${statutBadge(v.statut)}</td>
      <td style="font-size:.75rem;color:var(--text2)">${v.saisie||'—'}</td>
      <td style="display:flex;gap:4px">
        ${v.statut==='en attente'?`<button class="btn btn-ghost btn-xs" onclick="confirmerV('${v.id}')" title="Valider">✓</button>`:''}
        ${currentUser.role==='admin'?`<button class="btn btn-ghost btn-xs" onclick="editVersement('${v.id}')" title="Corriger">✏️</button>`:''}
        ${currentUser.role==='admin'?`<button class="btn btn-red btn-xs" onclick="delVers('${v.id}')" title="Supprimer">✕</button>`:''}
      </td>
    </tr>`;
  }).join('');
}
window.renderVersements=renderVersements;

// ── SMS/WhatsApp parser pour VERSEMENTS ──────────────
function openSMSVersModal(){
  document.getElementById('smsTxtVers').value='';
  document.getElementById('smsVersResult').style.display='none';
  document.getElementById('btnSaveSMSVers').style.display='none';
  document.getElementById('smsDateVers').value=today();
  document.getElementById('smsMontantVers').value='';
  document.getElementById('smsRefVers').value='';
  document.getElementById('smsCanalVers').value='OM';
  document.getElementById('smsFreqVers').value='quotidien';
  document.getElementById('smsStatutVers').value='en attente';
  document.getElementById('smsPDVVers').innerHTML=pdvs.map(p=>`<option value="${p.id}">${p.nom}</option>`).join('');
  document.getElementById('smsCptVers').innerHTML=comptes.filter(c=>c.actif!==false).map(c=>`<option value="${c.id}">${c.nom}</option>`).join('');
  openM('mSMSVers');
}
window.openSMSVersModal=openSMSVersModal;

function parseSMSVers(){
  const txt=document.getElementById('smsTxtVers').value;
  if(!txt.trim()){toast('Colle un SMS ou message WhatsApp','err');return;}
  // Montant : reconnaît 149,800 ou 149.800 ou 149 800 comme 149800
  const txtNorm=txt
    .replace(/(\d)\s(\d{3})(?!\d)/g,'$1$2')
    .replace(/(\d),(\d{3})(?!\d)/g,'$1$2')
    .replace(/(\d)\.(\d{3})(?!\d)/g,'$1$2');
  const nums=(txtNorm.match(/\d+/g)||[]).map(n=>parseInt(n))
    .filter(n=>n>=500&&n<999999999&&!(n>=2000&&n<=2099));
  const montant=nums.length?Math.max(...nums):0;
  // Date
  const dm=txt.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.]?(\d{2,4})?/);
  if(dm){const[,j,m,y]=dm;const yr=y?(y.length===2?'20'+y:y):new Date().getFullYear();
    document.getElementById('smsDateVers').value=`${yr}-${m.padStart(2,'0')}-${j.padStart(2,'0')}`;}
  // PDV : détection phonétique pondérée
  document.getElementById('smsPDVVers').value=_detectPDV(txt);
  // Type versement
  let detCanal='OM';
  if(/orange|om/i.test(txt))detCanal='OM';
  else if(/mtn/i.test(txt))detCanal='MTN';
  else if(/wave/i.test(txt))detCanal='WAVE';
  else if(/moov/i.test(txt))detCanal='MOOV';
  else if(/cash|espece/i.test(txt))detCanal='CASH';
  else if(/cheque/i.test(txt))detCanal='CHEQUE';
  else if(/virement/i.test(txt))detCanal='VIREMENT';
  document.getElementById('smsCanalVers').value=detCanal;
  // Compte destination — cherche le compte MM correspondant
  const cptMatch=comptes.find(c=>c.actif!==false&&c.op===detCanal);
  if(cptMatch)document.getElementById('smsCptVers').value=cptMatch.id;
  // Référence — cherche un pattern de référence
  const refMatch=txt.match(/ref[:\s#]*([A-Z0-9]{4,})/i)||txt.match(/\b([A-Z]{2,}\d{3,})\b/);
  if(refMatch)document.getElementById('smsRefVers').value=refMatch[1];
  document.getElementById('smsMontantVers').value=montant||'';
  document.getElementById('smsVersResult').style.display='block';
  document.getElementById('btnSaveSMSVers').style.display='inline-block';
  toast('Données extraites — vérifie et confirme');
}
window.parseSMSVers=parseSMSVers;

async function saveSMSVersement(){
  const pdv=document.getElementById('smsPDVVers').value;
  const date=document.getElementById('smsDateVers').value;
  const montant=parseFloat(document.getElementById('smsMontantVers').value);
  const type=document.getElementById('smsCanalVers').value;
  const compte=document.getElementById('smsCptVers').value;
  const ref=document.getElementById('smsRefVers').value;
  const freq=document.getElementById('smsFreqVers').value;
  const statut=document.getElementById('smsStatutVers').value;
  if(!date||!pdv||!montant){toast('Données incomplètes','err');return;}
  // Anti-doublons général
  const doublon=versements.find(v=>v.pdv===pdv&&v.date===date&&Math.abs((v.montant||0)-montant)<=montant*0.01);
  if(doublon&&!confirm(`⚠️ Doublon détecté !\nVersement identique déjà saisi :\n${fmtD(doublon.date)} — ${pdvs.find(p=>p.id===pdv)?.nom||pdv} — ${fmt(doublon.montant)} ${DEVISE} — ${doublon.statut}\n\nConfirmer quand même ?`))return;
  const item={id:uid(),date,pdv,freq,type,compte,ref,montant,statut,
    saisie:currentUser.nom,notes:'Via SMS/WhatsApp\n'+document.getElementById('smsTxtVers').value.slice(0,200),ts:Date.now()};
  versements.push(item);
  if(statut==='confirmé')await crediterCompte(compte,montant,pdv,ref,date);
  await saveItem('versements',item);
  closeM('mSMSVers');toast('Versement importé ✓');renderVersements();renderDashboard();
}
window.saveSMSVersement=saveSMSVersement;
let lignesVersement=[];
function openVersModal(){
  lignesVersement=[];
  document.getElementById('mVDate2').value=today();
  document.getElementById('mVSaisie2').value=currentUser.nom;
  document.getElementById('mVStatut2').value='en attente';
  if(currentUser.pdv)document.getElementById('mVPDV2').value=currentUser.pdv;
  renderLignesVersement();
  addLigneVersement();
  openM('mVers2');
}
window.openVersModal=openVersModal;

function updateLigneMontant(i,val){
  lignesVersement[i].montant=parseFloat(val)||0;
  updateTotalVers();
  _updateNetDisplay(i);
}
function updateLigneRef(i,val){ lignesVersement[i].ref=val; }
function updateLigneType(i,val){ lignesVersement[i].type=val; }
function updateLigneCompte(i,val){ lignesVersement[i].compte=val; }
window.updateLigneMontant=updateLigneMontant;
window.updateLigneRef=updateLigneRef;
window.updateLigneType=updateLigneType;
window.updateLigneCompte=updateLigneCompte;

function renderLignesVersement(){
  const container=document.getElementById('lignesVersContainer');
  if(!container)return;
  const pdvId=document.getElementById('mVPDV2')?.value;
  const pdvCurrent=pdvs.find(p=>p.id===pdvId);
  container.innerHTML=lignesVersement.map((l,i)=>{
    const isEspPDV=l.type==='ESPECES_PDV';
    const isBqPDV=l.type==='BANQUE_PDV';
    const infoPDV=isEspPDV&&pdvCurrent?.caisseLocaleNom
      ?`<div style="font-size:.72rem;color:var(--amber);margin-top:4px">📍 Caisse locale : <b>${pdvCurrent.caisseLocaleNom}</b>${pdvCurrent.caisseLocaleSolde?` — Solde : ${fmt(pdvCurrent.caisseLocaleSolde)} FCFA`:''}</div>`
      :isBqPDV&&pdvCurrent?.banqueLocaleNom
      ?`<div style="font-size:.72rem;color:var(--cyan);margin-top:4px">🏦 Banque locale : <b>${pdvCurrent.banqueLocaleNom}</b>${pdvCurrent.banqueLocaleNum?` — ${pdvCurrent.banqueLocaleNum}`:''}</div>`:'';
    return`
    <div style="background:var(--surface2);border-radius:8px;padding:12px;margin-bottom:8px;position:relative">
      <div style="font-size:.72rem;color:var(--text3);margin-bottom:8px">Versement ${i+1}</div>
      <div class="fg2">
        <div class="fg"><label>Type *</label>
          <select onchange="updateLigneType(${i},this.value);renderLignesVersement()">
            ${Object.entries(MM_LABEL).map(([k,v])=>`<option value="${k}"${l.type===k?' selected':''}>${v}</option>`).join('')}
          </select>
          ${infoPDV}
        </div>
        <div class="fg"><label>${isEspPDV?'Vers caisse centrale':isBqPDV?'Vers banque centrale':'Vers compte'} *</label>
          <select onchange="updateLigneCompte(${i},this.value)">
            ${(isEspPDV
              ?comptes.filter(c=>c.cat==='caisse'&&c.actif!==false)
              :isBqPDV
              ?comptes.filter(c=>c.cat==='banque'&&c.actif!==false)
              :comptes.filter(c=>c.actif!==false)
            ).map(c=>`<option value="${c.id}"${l.compte===c.id?' selected':''}>${c.nom}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="fg2">
        <div class="fg"><label>Montant brut versé (${DEVISE}) *</label>
          <input type="number" value="${l.montant||''}" placeholder="0" min="0"
            oninput="updateLigneMontant(${i},this.value)"
            onchange="updateLigneMontant(${i},this.value)">
        </div>
        <div class="fg"><label>Référence</label>
          <input type="text" value="${l.ref||''}" placeholder="${isEspPDV?'N° reçu espèces…':isBqPDV?'N° virement / bordereau…':'N° reçu, réf MM…'}"
            oninput="updateLigneRef(${i},this.value)">
        </div>
      </div>
      <div class="fg2">
        <div class="fg"><label>Frais opérateur (${DEVISE})</label>
          <input type="number" value="${l.fraisOp||''}" placeholder="0" min="0"
            oninput="updateLigneFraisOp(${i},this.value)"
            style="border-color:var(--amber)">
        </div>
        <div class="fg"><label>Frais timbre (${DEVISE})</label>
          <input type="number" value="${l.fraisTimbre||''}" placeholder="0" min="0"
            oninput="updateLigneFraisTimbre(${i},this.value)"
            style="border-color:var(--amber)">
        </div>
      </div>
      <div style="background:var(--surface3);border-radius:6px;padding:8px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:.75rem;color:var(--text2)">💰 Montant net crédité au compte</span>
        <span id="netDisplay_${i}" style="font-weight:800;font-size:1rem;color:${((l.montant||0)-(l.fraisOp||0)-(l.fraisTimbre||0))>=0?'var(--green)':'var(--red)'}">
          ${fmt((l.montant||0)-(l.fraisOp||0)-(l.fraisTimbre||0))} ${DEVISE}
        </span>
      </div>
      ${lignesVersement.length>1?`<button onclick="removeLigneVersement(${i})" style="position:absolute;top:8px;right:8px;background:var(--red-dim);color:var(--red);border:none;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:.75rem">✕</button>`:''}
    </div>`;
  }).join('');
  updateTotalVers();
}
function updateLigneFraisOp(i,val){
  lignesVersement[i].fraisOp=parseFloat(val)||0;
  // Mettre à jour uniquement l'affichage du net sans re-rendre tout le DOM
  _updateNetDisplay(i);
}
window.updateLigneFraisOp=updateLigneFraisOp;
function updateLigneFraisTimbre(i,val){
  lignesVersement[i].fraisTimbre=parseFloat(val)||0;
  _updateNetDisplay(i);
}
window.updateLigneFraisTimbre=updateLigneFraisTimbre;

// Mise à jour du montant net sans re-rendre le DOM (préserve le focus)
function _updateNetDisplay(i){
  const l=lignesVersement[i];
  const net=Math.max(0,(l.montant||0)-(l.fraisOp||0)-(l.fraisTimbre||0));
  const netEl=document.getElementById(`netDisplay_${i}`);
  if(netEl){
    netEl.textContent=fmt(net)+' '+DEVISE;
    netEl.style.color=net>=0?'var(--green)':'var(--red)';
  }
  // Mettre à jour le total
  const total=lignesVersement.reduce((s,l)=>s+(l.montant||0),0);
  const totalEl=document.getElementById('versTotal');
  if(totalEl)totalEl.textContent=fmt(total)+' '+DEVISE;
}
window._updateNetDisplay=_updateNetDisplay;
function addLigneVersement(){
  lignesVersement.push({type:'OM',compte:comptes[0]?.id||'',montant:0,fraisOp:0,fraisTimbre:0,ref:''});
  renderLignesVersement();
}
window.addLigneVersement=addLigneVersement;
function removeLigneVersement(i){
  lignesVersement.splice(i,1);renderLignesVersement();
}
window.removeLigneVersement=removeLigneVersement;
function updateTotalVers(){
  const total=lignesVersement.reduce((s,l)=>s+(l.montant||0),0);
  el('totalVersLabel',fmt(total)+' '+DEVISE);
}
window.updateTotalVers=updateTotalVers;

let _versSaving=false;
async function saveVersements(){
  if(_versSaving){toast('Enregistrement en cours…','info');return;}
  _versSaving=true;
  try{
    const date=document.getElementById('mVDate2').value;
    const pdv=document.getElementById('mVPDV2').value;
    const statut=document.getElementById('mVStatut2').value;
    const saisie=document.getElementById('mVSaisie2').value;
    const freq=document.getElementById('mVFreq2')?.value||'quotidien';
    if(!date||!pdv){toast('Date et PDV obligatoires','err');return;}
    const valides=lignesVersement.filter(l=>l.montant>0&&l.compte);
    if(!valides.length){toast('Ajoute au moins un versement avec un montant','err');return;}
    const totalNouv=valides.reduce((s,l)=>s+l.montant,0);
    // Anti-doublons général : même PDV + même date + montant similaire (±1%)
    const doublon=versements.find(v=>v.pdv===pdv&&v.date===date&&Math.abs((v.montant||0)-totalNouv)<=totalNouv*0.01);
    if(doublon&&!confirm(`⚠️ Doublon détecté !\nUn versement identique existe déjà :\n${fmtD(doublon.date)} — ${pdvs.find(p=>p.id===pdv)?.nom||pdv} — ${fmt(doublon.montant)} ${DEVISE} — Statut: ${doublon.statut}\n\nConfirmer quand même ?`)){_versSaving=false;return;}
    for(const l of valides){
      const fraisOp=l.fraisOp||0;
      const fraisTimbre=l.fraisTimbre||0;
      const montantNet=Math.max(0,l.montant-fraisOp-fraisTimbre);
      const item={id:uid(),date,pdv,freq,type:l.type,compte:l.compte,ref:l.ref||'',
        montant:l.montant,montantNet,fraisOp,fraisTimbre,
        statut,saisie,notes:'',ts:Date.now()};
      versements.push(item);
      if(statut==='confirmé')await crediterCompte(l.compte,l.montant,pdv,l.ref,date,l.type,fraisOp,fraisTimbre);
      await saveItem('versements',item);
    }
    closeM('mVers2');toast(`${valides.length} versement(s) enregistré(s) ✓`);
    renderVersements();renderDashboard();
  } finally { _versSaving=false; }
}
window.saveVersements=saveVersements;

function onVPDVChange(){
  const p=pdvs.find(x=>x.id===document.getElementById('mVPDV2')?.value);
  if(p&&document.getElementById('mVFreq2'))document.getElementById('mVFreq2').value=p.freq||'quotidien';
}
window.onVPDVChange=onVPDVChange;

const FRAIS_MM_PCT=0.01; // 1% frais opérateur mobile money

async function crediterCompte(compteId,montant,pdvId,ref,date,typeVers='',fraisOpManuel=null,fraisTimbreManuel=null){
  const c=comptes.find(x=>x.id===compteId);if(!c)return;
  const isMM=['OM','MTN','WAVE','MOOV'].includes(typeVers);
  // Priorité aux frais saisis manuellement — sinon calcul auto 1% pour MM
  const fraisOp = fraisOpManuel!=null ? fraisOpManuel : (isMM?Math.round(montant*FRAIS_MM_PCT):0);
  const fraisTimbre = fraisTimbreManuel!=null ? fraisTimbreManuel : 0;
  const totalFrais = fraisOp + fraisTimbre;
  const montantNet = Math.max(0, montant - totalFrais);
  // Crédite le montant net
  c.solde=(c.solde||0)+montantNet;await saveItem('comptes',c);
  const pdvNom=pdvs.find(p=>p.id===pdvId)?.nom||pdvId;
  const labelFrais=totalFrais>0?` (net — frais op.: ${fmt(fraisOp)}, timbre: ${fmt(fraisTimbre)})`:'';
  const m={id:uid(),date,compte:compteId,type:'entrée',rubrique:'Versement PDV',
    libelle:`Versement ${pdvNom}${labelFrais}`,
    ref,montant:montantNet,montantBrut:montant,fraisOp,fraisTimbre,soldeApres:c.solde,saisie:currentUser.nom,ts:Date.now()};
  mvts.push(m);await saveItem('mvts',m);
  // Enregistre frais opérateur comme sortie si > 0
  if(fraisOp>0){
    c.solde=c.solde-fraisOp;await saveItem('comptes',c);
    const mFraisOp={id:uid(),date,compte:compteId,type:'sortie',rubrique:'Frais opérateur MM',
      libelle:`Frais opérateur ${typeVers} — ${pdvNom}`,
      ref,montant:fraisOp,soldeApres:c.solde,saisie:currentUser.nom,ts:Date.now()};
    mvts.push(mFraisOp);await saveItem('mvts',mFraisOp);
  }
  // Enregistre frais timbre comme sortie si > 0
  if(fraisTimbre>0){
    c.solde=c.solde-fraisTimbre;await saveItem('comptes',c);
    const mTimbre={id:uid(),date,compte:compteId,type:'sortie',rubrique:'Taxe timbre',
      libelle:`Frais timbre fiscal — ${pdvNom}`,
      ref,montant:fraisTimbre,soldeApres:c.solde,saisie:currentUser.nom,ts:Date.now()};
    mvts.push(mTimbre);await saveItem('mvts',mTimbre);
  }
}
async function confirmerV(id){
  const v=versements.find(x=>x.id===id);if(!v||v.statut==='confirmé')return;
  v.statut='confirmé';
  await crediterCompte(v.compte,v.montant,v.pdv,v.ref,v.date,v.type,v.fraisOp||null,v.fraisTimbre||null);
  await saveItem('versements',v);renderVersements();toast('Confirmé ✓');renderDashboard();
}
window.confirmerV=confirmerV;
async function delVers(id){
  if(!confirm('Supprimer ?'))return;
  versements=versements.filter(v=>v.id!==id);await delItem('versements',id);renderVersements();toast('Supprimé','info');
}
window.delVers=delVers;

// ── Edition versement (admin) ─────────────────────────
function editVersement(id){
  const v=versements.find(x=>x.id===id);
  if(!v)return;
  if(v.statut==='confirmé'){
    if(!confirm(`⚠️ Ce versement est déjà CONFIRMÉ — il a crédité un compte.\\nLe modifier peut créer un écart comptable.\\nContinuer quand même ?`))return;
  }
  const moisVers=v.date?.slice(0,7);
  const moisCourant=today().slice(0,7);
  if(moisVers<moisCourant){
    if(!confirm(`⚠️ Ce versement date du mois de ${moisVers} (clôturé).\\nModifier quand même ?`))return;
  }
  // Ouvrir le modal versement pré-rempli
  document.getElementById('mVDate').value=v.date||today();
  document.getElementById('mVPDV').value=v.pdv||'';
  document.getElementById('mVType').value=v.type||'OM';
  document.getElementById('mVMontant').value=v.montant||'';
  document.getElementById('mVRef').value=v.ref||'';
  document.getElementById('mVFreq').value=v.freq||'quotidien';
  document.getElementById('mVStatut').value=v.statut||'en attente';
  if(document.getElementById('mVNotes'))document.getElementById('mVNotes').value=v.notes||'';
  // Compte destinataire
  const cptSel=document.getElementById('mVCompte');
  if(cptSel)cptSel.value=v.compte||'';
  // Modifier titre et bouton
  const title=document.querySelector('#mVersement .modal-title');
  if(title)title.textContent='✏️ Corriger le versement';
  const btn=document.querySelector('#mVersement .btn-green');
  if(btn){btn.textContent='Enregistrer la correction';btn.onclick=()=>saveVersementEdit(id);}
  openM('mVersement');
}
window.editVersement=editVersement;

async function saveVersementEdit(id){
  const v=versements.find(x=>x.id===id);
  if(!v){toast('Versement introuvable','err');return;}
  // Historique
  v._corrections=v._corrections||[];
  v._corrections.push({par:currentUser.nom,le:new Date().toISOString(),
    avant:{date:v.date,pdv:v.pdv,type:v.type,montant:v.montant,statut:v.statut}});
  // Nouvelles valeurs
  v.date=document.getElementById('mVDate').value;
  v.pdv=document.getElementById('mVPDV').value;
  v.type=document.getElementById('mVType').value;
  v.montant=parseFloat(document.getElementById('mVMontant').value)||v.montant;
  v.ref=document.getElementById('mVRef').value;
  v.freq=document.getElementById('mVFreq').value;
  v.statut=document.getElementById('mVStatut').value;
  if(document.getElementById('mVNotes'))v.notes=document.getElementById('mVNotes').value;
  if(document.getElementById('mVCompte')?.value)v.compte=document.getElementById('mVCompte').value;
  v.corrigePar=currentUser.nom;
  v.corrigeLe=new Date().toISOString();
  await saveItem('versements',v);
  saveLocal();
  // Remettre modal en mode création
  const title=document.querySelector('#mVersement .modal-title');
  if(title)title.textContent='+ Nouveau versement';
  const btn=document.querySelector('#mVersement .btn-green');
  if(btn){btn.textContent='Enregistrer';btn.onclick=saveVersement;}
  closeM('mVersement');
  toast(`✅ Versement corrigé — ${fmtD(v.date)} · ${fmt(v.montant)} ${DEVISE}`);
  renderVersements();renderDashboard();
}
window.saveVersementEdit=saveVersementEdit;
function populateCaissiereSelect(){
  const el=document.getElementById('mcCaissiere');if(!el)return;
  // Source : caissieresDB en priorité, sinon users en fallback
  const liste = caissieresDB.filter(c=>c.actif!==false).length > 0
    ? caissieresDB.filter(c=>c.actif!==false)
    : users.filter(u=>u.actif!==false).map(u=>({id:u.id,nom:u.nom,pdv:'',tel:''}));
  el.innerHTML = liste.map(c=>`<option value="${c.nom}">${c.nom}${c.pdv?` — ${pdvs.find(p=>p.id===c.pdv)?.nom||''}`:''}</option>`).join('')
    + '<option value="__custom__">✏️ Autre / Nouveau…</option>';
  el.onchange=function(){
    if(this.value==='__custom__'){
      const n=prompt('Nom de la caissière :');
      if(n){const o=document.createElement('option');o.value=n;o.textContent=n;o.selected=true;this.insertBefore(o,this.lastElementChild);this.value=n;}
      else this.value=liste[0]?.nom||'';
    }
  };
}
function calcCaisse(){
  const mc=nv('mcMachineCash'),mm=nv('mcMachineOM')+nv('mcMachineMTN')+nv('mcMachineWAVE')+nv('mcMachineMOOV'),tm=mc+mm;
  const cv=nv('mcCashVerser'),mmv=nv('mcOMVerser')+nv('mcMTNVerser')+nv('mcWAVEVerser')+nv('mcMOOVVerser'),tv=cv+mmv,ec=tv-tm;
  el('rcTotalMachine',fmt(tm)+' '+DEVISE);el('rcTotalVerse',fmt(tv)+' '+DEVISE);
  const ecEl=document.getElementById('rcEcart'),ecMsg=document.getElementById('rcEcartMsg');
  if(ecEl){ecEl.textContent=(ec>0?'+ ':ec<0?'− ':'')+fmt(Math.abs(ec))+' '+DEVISE;ecEl.style.color=ec===0?'var(--green)':ec<0?'var(--red)':'var(--amber)';}
  if(ecMsg)ecMsg.textContent=ec===0?'✓ Caisse équilibrée':ec<0?'⚠ Manquant — versé < machine':'⚡ Excédent — versé > machine';
}
window.calcCaisse=calcCaisse;
function openCaisseModal(id){
  populateCaissiereSelect();
  populateVacationSelect();
  const dateRef=document.getElementById('caisseDate')?.value||today();
  document.getElementById('mcDate').value=dateRef;
  document.getElementById('mcDateTravail').value=dateRef; // par défaut = même jour
  document.getElementById('mcSuperviseur').value=currentUser.nom;
  ['mcMachineCash','mcMachineOM','mcMachineMTN','mcMachineWAVE','mcMachineMOOV',
   'mcCashVerser','mcOMVerser','mcMTNVerser','mcWAVEVerser','mcMOOVVerser','mcRefCash','mcNotes']
    .forEach(i=>{const e=document.getElementById(i);if(e)e.value='';});
  if(id){
    const c=clotures.find(x=>x.id===id);
    if(c){
      document.getElementById('mcDate').value=c.date;
      document.getElementById('mcDateTravail').value=c.dateTravail||c.date;
      document.getElementById('mcVacation').value=c.vacation;
      document.getElementById('mcCaissiere').value=c.caissiere;
      ['mcMachineCash','mcMachineOM','mcMachineMTN','mcMachineWAVE','mcMachineMOOV',
       'mcCashVerser','mcOMVerser','mcMTNVerser','mcWAVEVerser','mcMOOVVerser'].forEach(fi=>{
        const key=fi.replace('mc','').charAt(0).toLowerCase()+fi.replace('mc','').slice(1);
        const el2=document.getElementById(fi);if(el2)el2.value=c[key.replace('Machine','machine').replace('Verser','Verse').replace('machineC','machineCash').replace('OM','OM').replace('MTN','MTN')] ||c[fi.slice(2).charAt(0).toLowerCase()+fi.slice(3)]||'';
      });
      document.getElementById('mcMachineCash').value=c.machineCash||'';
      document.getElementById('mcMachineOM').value=c.machineOM||'';
      document.getElementById('mcMachineMTN').value=c.machineMTN||'';
      document.getElementById('mcMachineWAVE').value=c.machineWAVE||'';
      document.getElementById('mcMachineMOOV').value=c.machineMOOV||'';
      document.getElementById('mcCashVerser').value=c.cashVerse||'';
      document.getElementById('mcOMVerser').value=c.omVerse||'';
      document.getElementById('mcMTNVerser').value=c.mtnVerse||'';
      document.getElementById('mcWAVEVerser').value=c.waveVerse||'';
      document.getElementById('mcMOOVVerser').value=c.moovVerse||'';
      document.getElementById('mcRefCash').value=c.refCash||'';
      document.getElementById('mcNotes').value=c.notes||'';
      document.getElementById('mCaisse')._editId=id;
    }
  } else { document.getElementById('mCaisse')._editId=null; }
  calcCaisse();
  // ── Pré-remplir les comptes destinataires ──────────────
  const pdvP=pdvs.find(p=>p.type==='principale');
  const caisseOpts=comptes.filter(c=>c.cat==='caisse'&&c.actif!==false)
    .map(c=>`<option value="${c.id}">${c.nom}</option>`).join('');
  const mmOpts=(op)=>comptes.filter(c=>c.actif!==false)
    .map(c=>{
      const label=c.tetePont?`${c.nom} ⭐ Centrale`:c.nom;
      return`<option value="${c.id}">${label}</option>`;
    }).join('');
  // Cash
  const cptCash=document.getElementById('mcCptCash');
  if(cptCash){
    cptCash.innerHTML=caisseOpts;
    const defCash=pdvP?.caisseDirecte
      ||comptes.find(c=>c.cat==='caisse'&&!c.nom.toLowerCase().includes('petite')&&c.actif!==false)?.id;
    if(defCash)cptCash.value=defCash;
  }
  // OM, MTN, Wave, Moov
  for(const op of ['OM','MTN','WAVE','MOOV']){
    const sel=document.getElementById(`mcCpt${op}`);
    if(!sel)continue;
    sel.innerHTML=mmOpts(op);
    // Priorité 1 : compte par défaut PDV si opérateur correspond
    const cptDef=pdvP?.compteDefaut?comptes.find(c=>c.id===pdvP.compteDefaut&&c.op===op&&c.actif!==false):null;
    // Priorité 2 : compte dont le nom contient un mot-clé du PDV (non tête de pont)
    const nomPDV=(pdvP?.nom||'').toLowerCase();
    const motsCles=nomPDV.split(/\s+/).filter(m=>m.length>3);
    const cptNomPDV=comptes.find(c=>c.op===op&&c.actif!==false&&!c.tetePont&&motsCles.some(mot=>c.nom.toLowerCase().includes(mot)));
    // Priorité 3 : n'importe quel compte MM non tête de pont
    const local=comptes.find(c=>c.op===op&&c.actif!==false&&!c.tetePont);
    // Priorité 4 : tête de pont en dernier recours
    const centrale=comptes.find(c=>c.op===op&&c.actif!==false&&c.tetePont);
    const best=(cptDef?.id)||(cptNomPDV?.id)||(local?.id)||(centrale?.id)||'';
    if(best)sel.value=best;
    // Alerte visuelle si on tombe sur une tête de pont
    const cptChoisi=comptes.find(c=>c.id===best);
    if(cptChoisi?.tetePont){
      sel.style.border='1px solid var(--amber)';
      sel.title=`⚠ Tête de pont sélectionnée — créez un compte "${op} — ${pdvP?.nom||'PDV'}" pour éviter cela`;
    } else {
      sel.style.border='';sel.title='';
    }
  }
  openM('mCaisse');
}
window.openCaisseModal=openCaisseModal;
async function saveCloture(){
  const date=document.getElementById('mcDate').value,
    dateTravail=document.getElementById('mcDateTravail')?.value||date,
    vacation=document.getElementById('mcVacation').value,caissiere=document.getElementById('mcCaissiere').value;
  if(!date||!vacation||!caissiere){toast('Date, vacation et caissière obligatoires','err');return;}
  const machineCash=nv('mcMachineCash'),machineOM=nv('mcMachineOM'),machineMTN=nv('mcMachineMTN'),
    machineWAVE=nv('mcMachineWAVE'),machineMOOV=nv('mcMachineMOOV'),
    totalMachine=machineCash+machineOM+machineMTN+machineWAVE+machineMOOV;
  const cashVerse=nv('mcCashVerser'),omVerse=nv('mcOMVerser'),mtnVerse=nv('mcMTNVerser'),
    waveVerse=nv('mcWAVEVerser'),moovVerse=nv('mcMOOVVerser'),
    totalVerse=cashVerse+omVerse+mtnVerse+waveVerse+moovVerse,ecart=totalVerse-totalMachine;
  const editId=document.getElementById('mCaisse')._editId;
  const clot={id:editId||uid(),date,dateTravail,vacation,caissiere,superviseur:document.getElementById('mcSuperviseur').value,
    machineCash,machineOM,machineMTN,machineWAVE,machineMOOV,totalMachine,
    cashVerse,omVerse,mtnVerse,waveVerse,moovVerse,totalVerse,ecart,
    refCash:document.getElementById('mcRefCash').value,notes:document.getElementById('mcNotes').value,
    statut:'ouvert',valide_par:null,valide_ts:null,ts:Date.now()};
  if(editId){const idx=clotures.findIndex(x=>x.id===editId);if(idx>-1)clotures[idx]={...clotures[idx],...clot};}
  else clotures.push(clot);
  if(!editId){
    const pdvP=pdvs.find(p=>p.type==='principale');
    if(pdvP){
      for(const[type,montant]of[['CASH',cashVerse],['OM',omVerse],['MTN',mtnVerse],['WAVE',waveVerse],['MOOV',moovVerse]]){
        if(!montant)continue;

        // ── Logique de sélection du compte destinataire ──────────────
        // Priorité 1 : compte par défaut configuré sur le PDV
        // Priorité 2 : compte MM du PDV correspondant à l'opérateur (NON tête de pont)
        // Priorité 3 : compte MM tête de pont (Centrale) en dernier recours
        let compteId = '';

        if(type==='CASH'){
          // Sélecteur manuel du modal → sinon compte caisse non-petite-caisse du PDV
          compteId = document.getElementById('mcCptCash')?.value
            || pdvP.caisseDirecte
            || comptes.find(c=>c.cat==='caisse'&&!c.nom.toLowerCase().includes('petite')&&c.actif!==false)?.id
            || comptes[0]?.id||'';
        } else {
          // Priorité 1 : sélecteur manuel dans le modal clôture
          const selVal = document.getElementById(`mcCpt${type}`)?.value;
          if(selVal){
            compteId = selVal;
          } else {
            // Priorité 2 : compte par défaut du PDV si opérateur correspond
            const cptDefaut = pdvP.compteDefaut
              ? comptes.find(c=>c.id===pdvP.compteDefaut&&c.op===type&&c.actif!==false)
              : null;
            // Priorité 3 : compte MM lié au PDV par son nom (ex: "OM — PSRM", "Wave — Pharmacie Principale")
            const nomPDV = pdvP.nom.toLowerCase();
            const motsCles = nomPDV.split(/\s+/).filter(m=>m.length>3);
            const cptNomPDV = comptes.find(c=>
              c.op===type && c.actif!==false && !c.tetePont &&
              motsCles.some(mot=>c.nom.toLowerCase().includes(mot))
            );
            // Priorité 4 : n'importe quel compte MM NON tête de pont
            const cptLocal = comptes.find(c=>c.op===type&&c.actif!==false&&!c.tetePont);
            // Priorité 5 : tête de pont en dernier recours absolu
            const cptTP = comptes.find(c=>c.op===type&&c.actif!==false&&c.tetePont);
            compteId = (cptDefaut?.id)||(cptNomPDV?.id)||(cptLocal?.id)||(cptTP?.id)||comptes[0]?.id||'';
          }
        }

        const v={id:uid(),date,pdv:pdvP.id,freq:'quotidien',type,
          compte:compteId,
          ref:clot.refCash||`Clôture ${caissiere} — ${vacation}`,
          montant,statut:'en attente',saisie:currentUser.nom,notes:`Clôture: ${caissiere}/${vacation}`,ts:Date.now()};
        versements.push(v);await saveItem('versements',v);
      }
    }
  }
  await saveItem('clotures',clot);closeM('mCaisse');toast(editId?'Clôture modifiée ✓':'Clôture enregistrée ✓');renderCaisse();
}
window.saveCloture=saveCloture;
// ── Créer automatiquement une recette depuis une clôture PSRM ──
async function creerRecetteDepuisClot(clot) {
  // Vérifier que c'est bien la pharmacie principale
  const pdvP = pdvs.find(p => p.type === 'principale');
  if (!pdvP) return;

  // Éviter les doublons — vérifier si une recette de clôture existe déjà pour cette clôture
  const dejaExiste = recettes.find(r => r._clotureId === clot.id);
  if (dejaExiste) return;

  const totalMachine = clot.totalMachine || 0;
  if (!totalMachine) return; // pas de recette si machine = 0

  // Date = journée travaillée si disponible, sinon date de clôture
  const dateRecette = clot.dateTravail || clot.date;

  const recette = {
    id: uid(),
    date: dateRecette,
    pdv: pdvP.id,
    canal: 'CASH', // canal principal — la recette globale est en CASH (machine)
    type: 'vente comptoir',
    montant: totalMachine,
    ref: `CLT-${clot.id.slice(-6).toUpperCase()}`,
    notes: `Généré automatiquement depuis clôture ${clot.vacation} — ${clot.caissiere}`,
    saisie: currentUser?.nom || 'SYSTEM',
    _clotureId: clot.id, // lien vers la clôture source
    _auto: true,
    ts: Date.now()
  };
  recettes.push(recette);
  await saveItem('recettes', recette);
  saveLocal();
  return recette;
}

// ── Synchroniser recettes PSRM depuis toutes les clôtures passées ──
async function syncRecettesPSRM() {
  const pdvP = pdvs.find(p => p.type === 'principale');
  if (!pdvP) { toast('PDV Pharmacie Principale introuvable', 'err'); return; }
  const clotValides = clotures.filter(c => c.statut === 'validé' && (c.totalMachine || 0) > 0);
  let nbCrees = 0, nbExistants = 0;
  for (const clot of clotValides) {
    const dejaExiste = recettes.find(r => r._clotureId === clot.id);
    if (dejaExiste) { nbExistants++; continue; }
    const dateRecette = clot.dateTravail || clot.date;
    const recette = {
      id: uid(), date: dateRecette, pdv: pdvP.id, canal: 'CASH',
      type: 'vente comptoir', montant: clot.totalMachine,
      ref: `CLT-${clot.id.slice(-6).toUpperCase()}`,
      notes: `Sync auto — clôture ${clot.vacation} — ${clot.caissiere}`,
      saisie: currentUser?.nom || 'SYSTEM',
      _clotureId: clot.id, _auto: true, ts: Date.now()
    };
    recettes.push(recette);
    await saveItem('recettes', recette);
    nbCrees++;
  }
  saveLocal();
  toast(`✅ ${nbCrees} recette(s) créée(s) depuis les clôtures, ${nbExistants} déjà existante(s)`);
  renderRecettes(); renderDashboard();
}
window.syncRecettesPSRM = syncRecettesPSRM;

async function validerClot(id){
  const c=clotures.find(x=>x.id===id);if(!c)return;
  c.statut='validé';c.valide_par=currentUser.nom;c.valide_ts=Date.now();
  await saveItem('clotures',c);
  // Créer automatiquement la recette PSRM
  const rec = await creerRecetteDepuisClot(c);
  renderCaisse();
  toast(`Validée ✓${rec?' — Recette '+fmt(rec.montant)+' FCFA ajoutée automatiquement':''}`);
}
window.validerClot=validerClot;

async function validerToutesClot(){
  const date=document.getElementById('caisseDate').value||today();
  let nbRec=0;
  for(const c of clotures.filter(x=>x.date===date&&x.statut==='ouvert')){
    c.statut='validé';c.valide_par=currentUser.nom;c.valide_ts=Date.now();
    await saveItem('clotures',c);
    const rec = await creerRecetteDepuisClot(c);
    if(rec) nbRec++;
  }
  renderCaisse();
  toast(`Toutes validées ✓${nbRec?' — '+nbRec+' recette(s) ajoutée(s) automatiquement':''}`);
}
window.validerToutesClot=validerToutesClot;

// ── Déverrouillage clôture (admin) ───────────────────
async function deverrouillerClot(id){
  const c=clotures.find(x=>x.id===id);if(!c)return;
  if(!confirm(`Déverrouiller la clôture de "${c.caissiere}" (${c.vacation}) du ${fmtD(c.date)} ?\n\nCela permettra de corriger la date.`))return;
  c.statut='ouvert';
  c.deverrouille_par=currentUser.nom;
  c.deverrouille_ts=Date.now();
  await saveItem('clotures',c);
  renderCaisse();
  toast(`Clôture déverrouillée — tu peux maintenant corriger la date`,'info');
}
window.deverrouillerClot=deverrouillerClot;

// ── Correction date d'une clôture (admin) ────────────
async function corrigerDateClot(id){
  const c=clotures.find(x=>x.id===id);if(!c)return;
  const nouvDate=prompt(`Corriger la date de la clôture "${c.caissiere} — ${c.vacation}"\n\nDate actuelle : ${fmtD(c.date)}\nNouvelle date (format AAAA-MM-JJ) :`,c.date);
  if(!nouvDate||nouvDate===c.date)return;
  // Valider le format
  if(!/^\d{4}-\d{2}-\d{2}$/.test(nouvDate)){toast('Format invalide — utilise AAAA-MM-JJ','err');return;}
  // Historique
  c._correctionsDates=c._correctionsDates||[];
  c._correctionsDates.push({avant:c.date,apres:nouvDate,par:currentUser.nom,le:new Date().toISOString()});
  c.date=nouvDate;
  c.dateCorrigee=true;
  c.dateCorrigeePar=currentUser.nom;
  c.dateCorrigeeLe=new Date().toISOString();
  await saveItem('clotures',c);
  // Corriger aussi les versements liés à cette clôture
  const versLies=versements.filter(v=>v.notes&&v.notes.includes(c.caissiere)&&v.notes.includes(c.vacation));
  for(const v of versLies){
    v._dateOrig=v._dateOrig||v.date;
    v.date=nouvDate;
    await saveItem('versements',v);
  }
  saveLocal();
  toast(`✅ Date corrigée → ${fmtD(nouvDate)}${versLies.length?` + ${versLies.length} versement(s) mis à jour`:''}`)  ;
  renderCaisse();
}
window.corrigerDateClot=corrigerDateClot;
async function delClot(id){
  if(!confirm('Supprimer ?'))return;
  clotures=clotures.filter(c=>c.id!==id);await delItem('clotures',id);renderCaisse();toast('Supprimé','info');
}
window.delClot=delClot;
function caisseNavDay(dir){
  const el=document.getElementById('caisseDate');
  const d=new Date(el.value||today());d.setDate(d.getDate()+dir);
  el.value=d.toISOString().split('T')[0];renderCaisse();
}
window.caisseNavDay=caisseNavDay;
function renderCaisse(){
  const date=document.getElementById('caisseDate')?.value||today();
  const dayC=clotures.filter(c=>c.date===date).sort((a,b)=>a.vacation.localeCompare(b.vacation));
  const totM=dayC.reduce((s,c)=>s+(c.totalMachine||0),0),totV=dayC.reduce((s,c)=>s+(c.totalVerse||0),0),
    totE=dayC.reduce((s,c)=>s+(c.ecart||0),0),cO=dayC.filter(c=>c.statut==='ouvert').length,cV=dayC.filter(c=>c.statut==='validé').length;
  const eCol=totE===0?'var(--green)':totE<0?'var(--red)':'var(--amber)';
  document.getElementById('caisseSummary').innerHTML=`
    <div class="sc-item"><div class="sc-lbl">Date</div><div class="sc-val">${fmtD(date)}</div></div>
    <div class="sc-item"><div class="sc-lbl">Caissières</div><div class="sc-val">${dayC.length}</div></div>
    <div class="sc-item"><div class="sc-lbl">Machine</div><div class="sc-val" style="color:var(--blue)">${fmt(totM)} ${DEVISE}</div></div>
    <div class="sc-item"><div class="sc-lbl">Versé</div><div class="sc-val" style="color:var(--green)">${fmt(totV)} ${DEVISE}</div></div>
    <div class="sc-item"><div class="sc-lbl">Écart</div><div class="sc-val" style="color:${eCol}">${totE>0?'+':totE<0?'−':''}${fmt(Math.abs(totE))} ${DEVISE}</div></div>
    <div class="sc-item"><div class="sc-lbl">Statut</div><div style="display:flex;gap:6px;margin-top:4px"><span class="clot-status clot-open">${cO} en cours</span><span class="clot-status clot-closed">${cV} validé(s)</span></div></div>`;
  const grid=document.getElementById('caisseGrid');
  if(!dayC.length){
    grid.innerHTML=`<div style="grid-column:1/-1"><div class="empty-state"><div class="ei">🗂️</div>Aucune clôture pour ${fmtD(date)}<br><br><button class="btn btn-green btn-sm" onclick="openCaisseModal()">+ Saisir</button></div></div>`;
    document.getElementById('caisseTbody').innerHTML='<tr><td colspan="10" style="text-align:center;color:var(--text3);padding:16px">Aucune clôture</td></tr>';return;
  }
  grid.innerHTML=dayC.map(c=>{
    const ep=c.ecart===0?'ecart-ok':c.ecart<0?'ecart-neg':'ecart-pos';
    const et=c.ecart===0?'✓ Équilibrée':c.ecart<0?`− ${fmt(Math.abs(c.ecart))} manquant`:`+ ${fmt(c.ecart)} excédent`;
    return`<div class="caisse-card"><div class="cc-head"><div><div class="cc-caissiere">👤 ${c.caissiere}</div><div class="cc-vacation">${c.vacation}</div>${c.dateTravail&&c.dateTravail!==c.date?`<div style="font-size:.65rem;color:var(--cyan);margin-top:2px">📅 Journée : ${fmtD(c.dateTravail)} · Clôturé : ${fmtD(c.date)}</div>`:`<div style="font-size:.65rem;color:var(--text3);margin-top:2px">📅 ${fmtD(c.date)}</div>`}</div><div><span class="ecart-pill ${ep}">${et}</span><br><span class="clot-status ${c.statut==='validé'?'clot-closed':'clot-open'}" style="margin-top:4px;display:inline-block">${c.statut}</span></div></div>
    <div class="cc-row"><span class="cc-row-lbl">Machine</span><span class="cc-row-val" style="color:var(--blue)">${fmt(c.totalMachine)}</span></div>
    <div class="cc-row"><span class="cc-row-lbl">Cash versé</span><span class="cc-row-val">${fmt(c.cashVerse)}</span></div>
    <div class="cc-row"><span class="cc-row-lbl">MM versé</span><span class="cc-row-val">${fmt((c.omVerse||0)+(c.mtnVerse||0)+(c.waveVerse||0)+(c.moovVerse||0))}</span></div>
    <div class="cc-total-row"><span>Total versé</span><span style="color:var(--green)">${fmt(c.totalVerse)}</span></div>
    <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
      ${currentUser.role==='admin'&&c.statut==='ouvert'?`<button class="btn btn-ghost btn-xs" onclick="validerClot('${c.id}')">✓ Valider</button>`:''}
      ${currentUser.role==='admin'&&c.statut==='validé'?`<button class="btn btn-ghost btn-xs" onclick="deverrouillerClot('${c.id}')" title="Déverrouiller" style="color:var(--amber)">🔓</button>`:''}
      ${currentUser.role==='admin'&&c.statut==='ouvert'?`<button class="btn btn-ghost btn-xs" onclick="corrigerDateClot('${c.id}')" title="Corriger la date" style="color:var(--cyan)">📅</button>`:''}
      <button class="btn btn-ghost btn-xs" onclick="openCaisseModal('${c.id}')">✏️</button>
      ${currentUser.role==='admin'?`<button class="btn btn-red btn-xs" onclick="delClot('${c.id}')">✕</button>`:''}
    </div></div>`;
  }).join('');
  document.getElementById('caisseTbody').innerHTML=dayC.map((c,i)=>{
    const ec=c.ecart||0,ecC=ec===0?'amt pos':ec<0?'amt neg':'amt neu';
    return`<tr><td style="color:var(--text3);font-size:.68rem;font-weight:600;text-align:right;padding-right:8px">${i+1}</td>
    <td style="font-size:.8rem;font-weight:700;color:${c.dateTravail&&c.dateTravail!==c.date?'var(--cyan)':'var(--text2)'}">${fmtD(c.dateTravail||c.date)}</td>
    <td style="font-size:.75rem;color:var(--text3)">${c.dateTravail&&c.dateTravail!==c.date?fmtD(c.date):'—'}</td>
    <td><span class="wk">${c.vacation}</span></td><td><b>${c.caissiere}</b></td>
    <td class="amt" style="color:var(--blue)">${fmt(c.totalMachine)}</td>
    <td class="amt ${c.cashVerse>0?'pos':''}">${fmt(c.cashVerse)}</td>
    <td class="amt pos">${fmt((c.omVerse||0)+(c.mtnVerse||0)+(c.waveVerse||0)+(c.moovVerse||0))}</td>
    <td class="amt pos">${fmt(c.totalVerse)}</td>
    <td class="${ecC}">${ec>0?'+':ec<0?'−':''}${fmt(Math.abs(ec))}</td>
    <td><span class="clot-status ${c.statut==='validé'?'clot-closed':'clot-open'}">${c.statut}</span></td>
    <td style="font-size:.75rem;color:var(--text2)">${c.valide_par||'—'}</td>
    <td style="display:flex;gap:4px">
      ${currentUser.role==='admin'&&c.statut==='ouvert'?`<button class="btn btn-ghost btn-xs" onclick="validerClot('${c.id}')">✓</button>`:''}
      ${currentUser.role==='admin'&&c.statut==='validé'?`<button class="btn btn-ghost btn-xs" onclick="deverrouillerClot('${c.id}')" style="color:var(--amber)" title="Déverrouiller">🔓</button>`:''}
      ${currentUser.role==='admin'&&c.statut==='ouvert'?`<button class="btn btn-ghost btn-xs" onclick="corrigerDateClot('${c.id}')" style="color:var(--cyan)" title="Corriger date">📅</button>`:''}
      <button class="btn btn-ghost btn-xs" onclick="openCaisseModal('${c.id}')">✏️</button>
      ${currentUser.role==='admin'?`<button class="btn btn-red btn-xs" onclick="delClot('${c.id}')">✕</button>`:''}
    </td></tr>`;
  }).join('');
}
window.renderCaisse=renderCaisse;

// ══════════════════════════════════════════════════════
// BANQUES & MM + TRANSFERT MM→BANQUE (v4)
// ══════════════════════════════════════════════════════
function renderBanques(){
  document.getElementById('bqComptes').innerHTML=comptes.filter(c=>c.actif!==false).map(c=>{
    const col=c.color||'var(--green)',op=c.op==='AUTRE'&&c.opLibre?c.opLibre:c.op;
    const banqueRatt=c.tetePont&&c.banqueRattachee?comptes.find(b=>b.id===c.banqueRattachee):null;
    return`<div class="compte-card" style="border-left:3px solid ${col};cursor:pointer" onclick="ouvrirMouvementsCompte('${c.id}')" title="Voir les mouvements">
      <div class="cc-icon">${OP_ICONS[c.op]||'💳'}</div>
      <div class="cc-name">${c.nom}${c.tetePont?` <span style="font-size:.6rem;background:var(--cyan-dim);color:var(--cyan);padding:1px 5px;border-radius:4px">TÊTE DE PONT</span>`:''}</div>
      <div class="cc-solde" style="color:${(c.solde||0)>=0?col:'var(--red)'};">${fmt(c.solde)}</div>
      <div style="margin-top:4px">${dispoBadge(c)}</div>
      <div class="cc-type">${c.cat==='mobile_money'?'Mobile Money':c.cat==='banque'?'Banque':'Caisse'} · ${op}</div>
      ${c.num?`<div style="font-size:.68rem;color:var(--text3);margin-top:2px;font-family:monospace">${c.num}</div>`:''}
      ${c.tetePont&&banqueRatt?`
        <div style="margin-top:8px;border-top:1px solid var(--border);padding-top:6px">
          <div style="font-size:.65rem;color:var(--text3);margin-bottom:4px">→ ${banqueRatt.nom}</div>
          <button class="btn btn-green btn-xs" onclick="event.stopPropagation();ouvrirTransfertRapide('${c.id}')" style="width:100%">
            ⚡ Transférer vers ${banqueRatt.nom}
          </button>
        </div>`:''}
      <div style="font-size:.65rem;color:var(--cyan);margin-top:6px">📋 Voir mouvements</div>
    </div>`;
  }).join('');
  document.getElementById('fMCompte').innerHTML='<option value="">Tous comptes</option>'+comptes.map(c=>`<option value="${c.id}">${c.nom}</option>`).join('');
  renderMvts();
}
window.renderBanques=renderBanques;

function ouvrirTransfertRapide(compteMMId){
  const cMM=comptes.find(c=>c.id===compteMMId);
  if(!cMM||!cMM.banqueRattachee){toast('Aucune banque rattachée à ce compte','err');return;}
  const cBQ=comptes.find(c=>c.id===cMM.banqueRattachee);
  if(!cBQ){toast('Banque rattachée introuvable','err');return;}
  // Pré-remplit le modal transfert existant
  document.getElementById('tDate').value=today();
  document.getElementById('tSrcCompte').value=compteMMId;
  document.getElementById('tDstCompte').value=cMM.banqueRattachee;
  document.getElementById('tMontant').value=Math.max(0,cMM.solde||0);
  document.getElementById('tRef').value='';
  document.getElementById('tNotes').value=`Transfert tête de pont ${cMM.nom} → ${cBQ.nom}`;
  document.getElementById('tSaisie').value=currentUser.nom;
  openM('mTransfert');
  toast(`⚡ Transfert rapide : ${cMM.nom} → ${cBQ.nom} — Montant modifiable`);
}
window.ouvrirTransfertRapide=ouvrirTransfertRapide;

function ouvrirMouvementsCompte(compteId){
  // Filtre les mouvements sur ce compte et fait défiler vers le journal
  const fmc=document.getElementById('fMCompte');
  if(fmc)fmc.value=compteId;
  renderMvts();
  // Scroll vers le journal des mouvements
  const mvtSection=document.getElementById('mvtTbody');
  if(mvtSection)mvtSection.closest('.card')?.scrollIntoView({behavior:'smooth',block:'start'});
  // Met en surbrillance le filtre actif
  toast(`Mouvements filtrés — ${comptes.find(c=>c.id===compteId)?.nom||compteId}`);
}
window.ouvrirMouvementsCompte=ouvrirMouvementsCompte;
function renderMvts(){
  // Résumé mois courant pour le compte filtré
  const mois=today().slice(0,7);
  const cF=document.getElementById('fMCompte')?.value;
  const cptSel=cF?comptes.find(c=>c.id===cF):null;
  const mvtsMois=mvts.filter(m=>(cF?m.compte===cF:true)&&m.date?.slice(0,7)===mois);
  const entreesMois=mvtsMois.filter(m=>m.type==='entrée').reduce((s,m)=>s+(m.montant||0),0);
  const sortiesMois=mvtsMois.filter(m=>m.type==='sortie').reduce((s,m)=>s+(m.montant||0),0);
  const soldeAct=cptSel?(cptSel.solde||0):(comptes.filter(c=>c.actif!==false).reduce((s,c)=>s+(c.solde||0),0));
  renderSoldeHeader('mvtsResumeHeader',{
    soldeActuel:soldeAct, compteId:cptSel?.id||null,
    entrées:entreesMois, sorties:sortiesMois,
    label:cptSel?cptSel.nom:'Tous comptes', couleur:'var(--blue)'
  });
  // Fusion mouvements + transferts
  const allMvts=[
    ...mvts.map(m=>({...m,_src:'mvt'})),
    ...transferts.map(t=>({...t,_src:'transfert'}))
  ].sort((a,b)=>b.date?.localeCompare(a.date||'')||0);
  let data=allMvts;
  const dF=document.getElementById('fMDate').value,tF=document.getElementById('fMType').value;
  const rF=document.getElementById('fMRubrique')?.value;
  const sF=document.getElementById('fMSearch')?.value?.toLowerCase();

  // Peupler rubriques dynamiquement
  const rubSel=document.getElementById('fMRubrique');
  if(rubSel){
    const rubriques=[...new Set(allMvts.map(m=>m.rubrique).filter(Boolean))].sort();
    const valActuelle=rubSel.value;
    rubSel.innerHTML='<option value="">Toutes rubriques</option>'+rubriques.map(r=>`<option value="${r}">${r}</option>`).join('');
    if(valActuelle)rubSel.value=valActuelle;
  }

  if(dF)data=data.filter(m=>m.date===dF);
  if(cF)data=data.filter(m=>m.compte===cF||m.compteSrc===cF||m.compteDst===cF);
  if(tF)data=data.filter(m=>m.type===tF);
  if(rF)data=data.filter(m=>m.rubrique===rF);
  if(sF)data=data.filter(m=>(m.libelle||'').toLowerCase().includes(sF)||(m.ref||'').toLowerCase().includes(sF));
  const tbody=document.getElementById('mvtTbody');
  if(!data.length){tbody.innerHTML='<tr><td colspan="9"><div class="empty-state"><div class="ei">🏦</div>Aucun mouvement</div></td></tr>';return;}
  tbody.innerHTML=data.map((m,i)=>{
    const cpt=comptes.find(c=>c.id===(m.compte||m.compteSrc));
    const cptDst=m.compteDst?comptes.find(c=>c.id===m.compteDst):null;
    const libelle=m._src==='transfert'?`🔄 Transfert MM→Banque${cptDst?' → '+cptDst.nom:''}`:m.libelle||'—';
    return`<tr>
      ${rowNum(i)}
      <td>${fmtD(m.date)}</td>
      <td style="font-size:.78rem">${cpt?cpt.nom:m.compte||'—'}</td>
      <td><span class="badge ${m.type==='entrée'?'bg':m.type==='sortie'?'br':'bc'}">${m.type}</span></td>
      <td style="font-size:.78rem;color:var(--text2)">${libelle}</td>
      <td style="font-size:.75rem;color:var(--text2)">${m.ref||'—'}</td>
      <td class="amt ${m.type==='entrée'?'pos':'neg'}">${m.type==='sortie'?'−':'+'}${fmt(m.montant)}</td>
      <td class="amt">${fmt(m.soldeApres||0)}</td>
      <td style="font-size:.75rem;color:var(--text2)">${m.saisie||'—'}</td>
      <td>${currentUser.role==='admin'?`<button class="btn btn-red btn-xs" onclick="delMvt('${m.id}','${m._src}')">✕</button>`:''}</td>
    </tr>`;
  }).join('');
  // Sous-total si filtres actifs
  const hasFilter=dF||cF||tF||rF||sF;
  if(hasFilter){
    const totE=data.filter(m=>m.type==='entrée').reduce((s,m)=>s+(m.montant||0),0);
    const totS=data.filter(m=>m.type==='sortie').reduce((s,m)=>s+(m.montant||0),0);
    document.getElementById('mvtTbody').innerHTML+=`
      <tr style="background:var(--surface2);font-weight:700;font-size:.78rem">
        <td colspan="5" style="text-align:right;padding:6px 10px;color:var(--text2)">${data.length} opération(s)</td>
        <td class="amt pos">+${fmt(totE)}</td>
        <td class="amt neg">−${fmt(totS)}</td>
        <td class="amt ${totE-totS>=0?'pos':'neg'}">${totE-totS>=0?'+':''}${fmt(totE-totS)}</td>
        <td colspan="2"></td>
      </tr>`;
  }
}
window.renderMvts=renderMvts;
// Rubriques comptables — stockées en LocalStorage, modifiables
let rubriques = LS.g('rubriques') || [
  'Salaires & charges','Loyer','Électricité / Eau','Fournitures bureau',
  'Achat médicaments','Transport','Entretien & réparations',
  'Frais bancaires','Remboursement emprunt','Approvisionnement banque',
  'Avance personnel','Règlement fournisseur','Frais médicaux','Autre'
];
function saveRubriques(){LS.s('rubriques',rubriques);}

function getRubriquesOptions(){
  return rubriques.map(r=>`<option value="${r}">${r}</option>`).join('')+
    '<option value="__new__">✏️ Nouvelle rubrique…</option>';
}
function onMvtRubriqueChange(){
  const sel=document.getElementById('mMRubrique');
  if(sel.value==='__new__'){
    const n=prompt('Nom de la nouvelle rubrique :');
    if(n&&n.trim()){
      rubriques.splice(rubriques.length-1,0,n.trim());
      saveRubriques();
      sel.innerHTML=getRubriquesOptions();
      sel.value=n.trim();
    } else sel.value=rubriques[0];
  }
}
window.onMvtRubriqueChange=onMvtRubriqueChange;

function openMvtModal(){
  document.getElementById('mMDate').value=today();
  document.getElementById('mMRubrique').innerHTML=getRubriquesOptions();
  ['mMMontant','mMRef','mMNotes','mMBenefNom','mMBenefCNI','mMBenefTel','mMResponsable'].forEach(id=>{
    const e=document.getElementById(id);if(e)e.value='';
  });
  document.getElementById('mMBenefType').value='Particulier';
  document.getElementById('mMType').value='sortie';
  document.getElementById('mMSaisie').value=currentUser.nom;
  openM('mMvt');
}
window.openMvtModal=openMvtModal;
async function saveMvt(){
  const date=document.getElementById('mMDate').value,compteId=document.getElementById('mMCompte').value,
    type=document.getElementById('mMType').value,montant=parseFloat(document.getElementById('mMMontant').value);
  if(!date||!compteId||!montant){toast('Champs manquants','err');return;}
  const rubrique=document.getElementById('mMRubrique')?.value||'';
  const doublonMvt=mvts.find(m=>m.compte===compteId&&m.date===date&&m.type===type&&Math.abs((m.montant||0)-montant)<=montant*0.01);
  if(doublonMvt&&!confirm(`⚠️ Doublon détecté !\nMouvement identique déjà enregistré :\n${fmtD(doublonMvt.date)} — ${comptes.find(c=>c.id===compteId)?.nom||compteId} — ${type} — ${fmt(doublonMvt.montant)} ${DEVISE}\n\nConfirmer quand même ?`))return;
  const c=comptes.find(x=>x.id===compteId);
  if(c){if(type==='entrée')c.solde=(c.solde||0)+montant;else if(type==='sortie')c.solde=(c.solde||0)-montant;await saveItem('comptes',c);}
  const benef_nom=document.getElementById('mMBenefNom')?.value.trim()||'';
  const benef_type=document.getElementById('mMBenefType')?.value||'Particulier';
  const benef_cni=document.getElementById('mMBenefCNI')?.value.trim()||'';
  const benef_tel=document.getElementById('mMBenefTel')?.value.trim()||'';
  const responsable=document.getElementById('mMResponsable')?.value.trim()||currentUser.nom;
  const libelle=document.getElementById('mMNotes').value||rubrique;
  const item={id:uid(),date,compte:compteId,type,rubrique,libelle,
    ref:document.getElementById('mMRef').value,montant,soldeApres:c?.solde||0,
    benef_nom,benef_type,benef_cni,benef_tel,responsable,
    saisie:document.getElementById('mMSaisie').value,ts:Date.now()};
  mvts.push(item);await saveItem('mvts',item);
  closeM('mMvt');toast('Mouvement enregistré ✓');renderBanques();renderDashboard();
  if(type==='sortie'){
    if(confirm('Imprimer le reçu de caisse ?')){
      genererRecuCaisse({
        date,heure:nowTm(),
        libelle:libelle||'Sortie de caisse',
        categorie:rubrique||c?.nom||'',
        modePaiement:c?.cat==='mobile_money'?'Mobile Money':c?.cat==='banque'?'Virement/Chèque':'Espèces',
        ref:item.ref,montant,typeRecu:'Sortie de caisse',
        caisse:c?.nom||'Grande caisse',
        responsable,benef_nom,benef_type,benef_cni,benef_tel
      });
    }
  }
}
window.saveMvt=saveMvt;
async function delMvt(id,src){
  if(!confirm('Supprimer ?'))return;
  if(src==='transfert'){transferts=transferts.filter(t=>t.id!==id);await delItem('transferts',id);}
  else{mvts=mvts.filter(m=>m.id!==id);await delItem('mvts',id);}
  renderMvts();toast('Supprimé','info');
}
window.delMvt=delMvt;

// ── TRANSFERT MM → BANQUE (v4) ────────────────────────
function openTransfertModal(){
  document.getElementById('tDate').value=today();
  document.getElementById('tMontant').value='';
  document.getElementById('tRef').value='';
  document.getElementById('tNotes').value='';
  document.getElementById('tSaisie').value=currentUser.nom;
  openM('mTransfert');
}
window.openTransfertModal=openTransfertModal;
async function saveTransfert(){
  const date=document.getElementById('tDate').value;
  const srcId=document.getElementById('tSrcCompte').value;
  const dstId=document.getElementById('tDstCompte').value;
  const montant=parseFloat(document.getElementById('tMontant').value);
  const ref=document.getElementById('tRef').value;
  const notes=document.getElementById('tNotes').value;
  const saisie=document.getElementById('tSaisie').value;
  if(!date||!srcId||!dstId||!montant){toast('Tous les champs sont obligatoires','err');return;}
  if(srcId===dstId){toast('Source et destination identiques','err');return;}
  const src=comptes.find(x=>x.id===srcId),dst=comptes.find(x=>x.id===dstId);
  if(!src||!dst){toast('Compte introuvable','err');return;}
  if((src.solde||0)<montant){
    toast(`❌ Solde insuffisant — ${src.nom} : ${fmt(src.solde||0)} ${DEVISE} disponible, ${fmt(montant)} ${DEVISE} demandé`,'err');
    return;
  }
  // Débite MM
  src.solde=(src.solde||0)-montant;await saveItem('comptes',src);
  // Crédite Banque
  dst.solde=(dst.solde||0)+montant;await saveItem('comptes',dst);
  // Enregistre le transfert
  const item={id:uid(),date,compteSrc:srcId,compteDst:dstId,compte:srcId,
    type:'sortie',montant,ref,notes,saisie,soldeApres:src.solde,ts:Date.now()};
  transferts.push(item);await saveItem('transferts',item);
  // Mouvement entrée côté banque
  const mBq={id:uid(),date,compte:dstId,type:'entrée',
    libelle:`Transfert depuis ${src.nom}`,ref,montant,soldeApres:dst.solde,saisie,ts:Date.now()};
  mvts.push(mBq);await saveItem('mvts',mBq);
  closeM('mTransfert');
  toast(`Transfert de ${fmt(montant)} ${DEVISE} : ${src.nom} → ${dst.nom} ✓`);
  renderBanques();renderDashboard();
}
window.saveTransfert=saveTransfert;

// ══════════════════════════════════════════════════════
// REÇU DE CAISSE — Petite caisse & Grande caisse (v4.1)
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// REÇU DE CAISSE — Format A5, aperçu modale, PDF (v4.1)
// ══════════════════════════════════════════════════════
function genererRecuCaisse(data){
  const numRecu='RC-'+Date.now().toString(36).toUpperCase();
  const htmlRecu=`
  <div id="recuA5" style="width:148mm;min-height:210mm;font-family:Arial,sans-serif;font-size:10pt;color:#111;padding:12mm;box-sizing:border-box;background:#fff">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #00C47A;padding-bottom:8px;margin-bottom:10px">
      <div>
        <div style="font-size:1rem;font-weight:800;color:#00C47A">${PHARMACIE_NOM}</div>
        <div style="font-size:.72rem;color:#666">Reçu de caisse</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:.85rem;font-weight:700">REÇU DE CAISSE</div>
        <div style="font-size:.7rem;color:#666">N° ${numRecu}</div>
        <div style="font-size:.7rem;color:#666">Date : ${fmtD(data.date)} ${data.heure||''}</div>
        <div style="font-size:.7rem;color:#666">Type : ${data.typeRecu||'Dépense'}</div>
      </div>
    </div>
    <div style="background:#f0faf5;border:2px solid #00C47A;border-radius:6px;padding:8px;text-align:center;margin-bottom:10px">
      <div style="font-size:.65rem;color:#666;text-transform:uppercase">Montant</div>
      <div style="font-size:1.4rem;font-weight:800;color:#00C47A">${fmt(data.montant)} ${DEVISE}</div>
      <div style="font-size:.72rem;color:#444;font-style:italic">${nombreEnLettres(data.montant)} francs CFA</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:.75rem;margin-bottom:8px">
      <tr><td style="padding:3px 6px;color:#666;width:35%">Libellé</td><td style="padding:3px 6px;font-weight:600">${data.libelle||'—'}</td></tr>
      <tr style="background:#f9f9f9"><td style="padding:3px 6px;color:#666">Catégorie</td><td style="padding:3px 6px">${data.categorie||'—'}</td></tr>
      <tr><td style="padding:3px 6px;color:#666">Mode paiement</td><td style="padding:3px 6px">${data.modePaiement||'Espèces'}</td></tr>
      <tr style="background:#f9f9f9"><td style="padding:3px 6px;color:#666">Référence</td><td style="padding:3px 6px">${data.ref||'—'}</td></tr>
      <tr><td style="padding:3px 6px;color:#666">Caisse</td><td style="padding:3px 6px">${data.caisse||'Petite caisse'}</td></tr>
      <tr style="background:#f9f9f9"><td style="padding:3px 6px;color:#666">Responsable</td><td style="padding:3px 6px;font-weight:600">${data.responsable||'—'}</td></tr>
    </table>
    <div style="border:1px solid #eee;border-radius:6px;padding:6px 8px;margin-bottom:10px">
      <div style="font-size:.65rem;color:#666;text-transform:uppercase;font-weight:700;margin-bottom:4px">Bénéficiaire</div>
      <table style="width:100%;border-collapse:collapse;font-size:.75rem">
        <tr><td style="padding:2px 4px;color:#666;width:35%">Nom / Société</td><td style="padding:2px 4px;font-weight:600">${data.benef_nom||'—'}</td></tr>
        <tr><td style="padding:2px 4px;color:#666">Type</td><td style="padding:2px 4px">${data.benef_type||'Particulier'}</td></tr>
        <tr><td style="padding:2px 4px;color:#666">CNI / Identifiant</td><td style="padding:2px 4px">${data.benef_cni||'—'}</td></tr>
        <tr><td style="padding:2px 4px;color:#666">Téléphone</td><td style="padding:2px 4px">${data.benef_tel||'—'}</td></tr>
      </table>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:14px">
      <div style="border-top:1px solid #ccc;padding-top:6px;text-align:center">
        <div style="font-size:.62rem;color:#666;text-transform:uppercase">Responsable caisse</div>
        <div style="height:35px"></div>
        <div style="font-size:.65rem;color:#444;border-top:1px dotted #ccc;padding-top:3px">${data.responsable||'___________'}</div>
      </div>
      <div style="border-top:1px solid #ccc;padding-top:6px;text-align:center">
        <div style="font-size:.62rem;color:#666;text-transform:uppercase">Bénéficiaire</div>
        <div style="height:35px"></div>
        <div style="font-size:.65rem;color:#444;border-top:1px dotted #ccc;padding-top:3px">${data.benef_nom||'___________'}</div>
      </div>
      <div style="border-top:1px solid #ccc;padding-top:6px;text-align:center">
        <div style="font-size:.62rem;color:#666;text-transform:uppercase">Pharmacien Titulaire</div>
        <div style="height:35px"></div>
        <div style="font-size:.65rem;color:#444;border-top:1px dotted #ccc;padding-top:3px">Dr HATHRY J. Hubert</div>
      </div>
    </div>
    <div style="margin-top:10px;font-size:.6rem;color:#999;text-align:center;border-top:1px solid #eee;padding-top:6px">
      PharmaCash Pro — ${new Date().toLocaleString('fr-FR')} — N° ${numRecu}
    </div>
  </div>`;

  // Affiche dans une modale d'aperçu
  let modal=document.getElementById('mRecuCaisse');
  if(!modal){
    modal=document.createElement('div');
    modal.id='mRecuCaisse';
    modal.className='modal-ov';
    document.body.appendChild(modal);
  }
  modal.innerHTML=`<div class="modal" style="max-width:600px;max-height:90vh;overflow-y:auto">
    <div class="modal-hdr">
      <div class="modal-title">🧾 Aperçu du reçu</div>
      <button class="close-x" onclick="document.getElementById('mRecuCaisse').classList.remove('open')">✕</button>
    </div>
    <div class="modal-body" style="background:#e5e5e5;padding:20px;display:flex;justify-content:center">
      ${htmlRecu}
    </div>
    <div class="modal-ftr" style="gap:8px">
      <button class="btn btn-ghost" onclick="document.getElementById('mRecuCaisse').classList.remove('open')">Fermer</button>
      <button class="btn btn-blue" onclick="imprimerRecuCaisse()">🖨️ Imprimer</button>
      <button class="btn btn-green" onclick="telechargerRecuPDF()">⬇️ Télécharger PDF</button>
    </div>
  </div>`;
  modal.classList.add('open');
  window._recuHTML=htmlRecu;
  window._recuNum=numRecu;
}
window.genererRecuCaisse=genererRecuCaisse;

function imprimerRecuCaisse(){
  const w=window.open('','_blank','width=800,height=900');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Reçu</title>
  <style>
    @page{size:A4 portrait;margin:5mm}
    body{margin:0;padding:0;background:#fff}
    .recu-wrapper{display:flex;flex-direction:column;height:297mm;gap:0}
    .recu-copy{height:148mm;overflow:hidden;padding:5mm;box-sizing:border-box;border-bottom:1px dashed #aaa}
    .recu-copy:last-child{border-bottom:none}
    .cut-line{text-align:center;font-size:8pt;color:#999;letter-spacing:3px;margin:0;line-height:0}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body>
  <div class="recu-wrapper">
    <div class="recu-copy">${window._recuHTML.replace(/min-height:210mm/,'min-height:auto')}</div>
    <div style="text-align:center;font-size:7pt;color:#bbb;padding:1mm 0">✂ ─────────────────────────────────────── COUPER ICI ───────────────────────────────────────── ✂</div>
    <div class="recu-copy">${window._recuHTML.replace(/min-height:210mm/,'min-height:auto')}</div>
  </div>
  <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),1000)}<\/script>
  </body></html>`);
  w.document.close();
}
window.imprimerRecuCaisse=imprimerRecuCaisse;

async function telechargerRecuPDF(){
  const w=window.open('','_blank','width=800,height=900');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Recu_${window._recuNum}</title>
  <style>
    @page{size:A4 portrait;margin:5mm}
    body{margin:0;padding:0;background:#fff}
    .recu-wrapper{display:flex;flex-direction:column;height:297mm;gap:0}
    .recu-copy{height:148mm;overflow:hidden;padding:5mm;box-sizing:border-box;border-bottom:1px dashed #aaa}
    .recu-copy:last-child{border-bottom:none}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body>
  <div class="recu-wrapper">
    <div class="recu-copy">${window._recuHTML.replace(/min-height:210mm/,'min-height:auto')}</div>
    <div style="text-align:center;font-size:7pt;color:#bbb;padding:1mm 0">✂ ─────────────────────────────────────── COUPER ICI ───────────────────────────────────────── ✂</div>
    <div class="recu-copy">${window._recuHTML.replace(/min-height:210mm/,'min-height:auto')}</div>
  </div>
  <script>window.onload=()=>window.print()<\/script>
  </body></html>`);
  w.document.close();
  toast('Dans la fenêtre d\'impression → choisir "Enregistrer en PDF"');
}
window.telechargerRecuPDF=telechargerRecuPDF;

// Conversion montant en lettres (FCFA)
function nombreEnLettres(n){
  const u=['','un','deux','trois','quatre','cinq','six','sept','huit','neuf','dix','onze','douze','treize','quatorze','quinze','seize','dix-sept','dix-huit','dix-neuf'];
  const d=['','','vingt','trente','quarante','cinquante','soixante','soixante','quatre-vingt','quatre-vingt'];
  function conv(n){
    if(n===0)return'';if(n<20)return u[n];
    const di=Math.floor(n/10),un=n%10;
    if(di===7||di===9)return d[di]+(un===0?'':'-'+(un===1&&di===7?'et-':'')+ u[10+un]);
    if(di===8)return'quatre-vingt'+(un===0?'s':'-'+u[un]);
    return d[di]+(un===0?'':(un===1?'-et-un':'-'+u[un]));
  }
  n=Math.round(n||0);
  if(n===0)return'zéro';
  let r='';
  if(n>=1000000){r+=conv(Math.floor(n/1000000))+(Math.floor(n/1000000)>1?' millions ':' million ');n%=1000000;}
  if(n>=1000){const m=Math.floor(n/1000);r+=(m===1?'mille':conv(m)+' mille')+' ';n%=1000;}
  if(n>=100){const c=Math.floor(n/100);r+=(c===1?'cent':conv(c)+' cent')+' ';n%=100;}
  if(n>0)r+=conv(n);
  return r.trim();
}
window.nombreEnLettres=nombreEnLettres;

// ══════════════════════════════════════════════════════
// CAISSE PRINCIPALE (v4.1)
// ══════════════════════════════════════════════════════
function getCaisseP(){
  return comptes.find(c=>c.cat==='caisse'&&!c.nom.toLowerCase().includes('petite'));
}
function renderCaisseP(){
  const cp=getCaisseP();
  const solde=cp?.solde||0;
  const cpSolde=document.getElementById('cpSolde');
  if(cpSolde){cpSolde.textContent=fmt(solde)+' '+DEVISE;cpSolde.style.color=solde>=0?'var(--green)':'var(--red)';}
  const tbody=document.getElementById('cpTbody');
  if(!tbody)return;
  const mois=today().slice(0,7);
  const allData=mvts.filter(m=>m.compte===cp?.id).sort((a,b)=>b.date?.localeCompare(a.date||'')||0);

  // Peupler le select rubriques dynamiquement
  const rubSel=document.getElementById('fCPRubrique');
  if(rubSel){
    const rubriques=[...new Set(allData.map(m=>m.rubrique).filter(Boolean))].sort();
    const valActuelle=rubSel.value;
    rubSel.innerHTML='<option value="">Toutes rubriques</option>'+rubriques.map(r=>`<option value="${r}">${r}</option>`).join('');
    if(valActuelle)rubSel.value=valActuelle;
  }

  // Appliquer les filtres
  const dF=document.getElementById('fCPDate')?.value;
  const tF=document.getElementById('fCPType')?.value;
  const rF=document.getElementById('fCPRubrique')?.value;
  const sF=document.getElementById('fCPSearch')?.value?.toLowerCase();
  let data=allData;
  if(dF)data=data.filter(m=>m.date===dF);
  if(tF)data=data.filter(m=>m.type===tF);
  if(rF)data=data.filter(m=>m.rubrique===rF);
  if(sF)data=data.filter(m=>(m.libelle||'').toLowerCase().includes(sF)||(m.beneficiaire||'').toLowerCase().includes(sF));

  // Résumé mois courant
  const dataMois=allData.filter(m=>m.date?.slice(0,7)===mois);
  const entrees=dataMois.filter(m=>m.type==='entrée').reduce((s,m)=>s+(m.montant||0),0);
  const sorties=dataMois.filter(m=>m.type==='sortie').reduce((s,m)=>s+(m.montant||0),0);
  renderSoldeHeader('cpResumeHeader',{
    soldeActuel:solde, compteId:cp?.id,
    entrées:entrees, sorties:sorties,
    label:'Caisse Principale', couleur:'var(--green)'
  });

  // Sous-total filtré
  const totalFiltre=data.reduce((s,m)=>s+(m.type==='entrée'?m.montant:-(m.montant||0)),0);
  const nbFiltre=data.length;
  if(!data.length){
    tbody.innerHTML=`<tr><td colspan="11"><div class="empty-state"><div class="ei">🏛️</div>${allData.length?'Aucun résultat pour ces filtres':'Aucun mouvement caisse principale'}</div></td></tr>`;
    return;
  }
  // Ligne de sous-total si filtres actifs
  const hasFilter=dF||tF||rF||sF;
  const sousTotalHtml=hasFilter?`
    <tr style="background:var(--surface2);font-weight:700;font-size:.78rem">
      <td colspan="7" style="text-align:right;padding:6px 10px;color:var(--text2)">${nbFiltre} opération(s) filtrée(s)</td>
      <td class="amt ${totalFiltre>=0?'pos':'neg'}" style="padding:6px 8px">${totalFiltre>=0?'+':''}${fmt(Math.abs(totalFiltre))}</td>
      <td colspan="3"></td>
    </tr>`:'';
  // Recalcul des soldes cumulatifs dans l'ordre chronologique
  // On part du soldeInit et on applique les mvts du plus ancien au plus récent
  const dataChronologique = [...allData].sort((a,b)=>a.date?.localeCompare(b.date||'')||0);
  let soldeCourant = cp?.soldeInit || 0;
  const soldesRecalcules = {};
  for (const m of dataChronologique) {
    if(m.type==='entrée') soldeCourant += (m.montant||0);
    else if(m.type==='sortie') soldeCourant -= (m.montant||0);
    soldesRecalcules[m.id] = soldeCourant;
  }

  tbody.innerHTML=data.map((m,i)=>`<tr>
    ${rowNum(i)}
    <td>${fmtD(m.date)}</td>
    <td><span class="badge ${m.type==='entrée'?'bg':'br'}">${m.type==='entrée'?'↑ Entrée':'↓ Sortie'}</span></td>
    <td style="font-size:.78rem;color:var(--text2)">${m.rubrique||'—'}</td>
    <td style="font-size:.82rem">${m.libelle||'—'}</td>
    <td style="font-size:.78rem">${m.benef_nom||'—'}</td>
    <td style="font-size:.72rem;font-family:monospace;color:var(--text3)">${m.ref||'—'}</td>
    <td class="amt ${m.type==='entrée'?'pos':'neg'}">${m.type==='entrée'?'+':'-'}${fmt(m.montant)}</td>
    <td class="amt ${(soldesRecalcules[m.id]||0)>=0?'':'neg'}">${fmt(soldesRecalcules[m.id]||0)}</td>
    <td style="font-size:.75rem;color:var(--text2)">${m.saisie||'—'}</td>
    <td><button class="btn btn-red btn-xs" onclick="delCPMvt('${m.id}')">✕</button></td>
  </tr>`).join('') + sousTotalHtml;
}
window.renderCaisseP=renderCaisseP;

function openCPModal(type){
  const cp=getCaisseP();
  if(!cp){toast('Caisse Principale introuvable','err');return;}
  document.getElementById('mMDate').value=today();
  document.getElementById('mMCompte').value=cp.id;
  document.getElementById('mMType').value=type==='entree'?'entrée':'sortie';
  document.getElementById('mMRubrique').innerHTML=getRubriquesOptions();
  ['mMMontant','mMRef','mMNotes','mMBenefNom','mMBenefCNI','mMBenefTel','mMResponsable'].forEach(id=>{
    const e=document.getElementById(id);if(e)e.value='';
  });
  document.getElementById('mMBenefType').value='Particulier';
  document.getElementById('mMSaisie').value=currentUser.nom;
  openM('mMvt');
}
window.openCPModal=openCPModal;

async function delCPMvt(id){
  if(!confirm('Supprimer ce mouvement ?'))return;
  const m=mvts.find(x=>x.id===id);if(!m)return;
  const c=comptes.find(x=>x.id===m.compte);
  if(c){
    c.solde=(c.solde||0)+(m.type==='entrée'?-m.montant:m.montant);
    await saveItem('comptes',c);
  }
  mvts=mvts.filter(x=>x.id!==id);
  await delItem('mvts',id);
  renderCaisseP();renderDashboard();
  toast('Mouvement supprimé ✓');
}
window.delCPMvt=delCPMvt;

function exportCaisseP(format){
  const cp=getCaisseP();
  const data=mvts.filter(m=>m.compte===cp?.id).sort((a,b)=>b.date?.localeCompare(a.date||'')||0);
  exportUniversel('Caisse Principale — Mouvements',
    ['Date','Type','Rubrique','Libellé','Bénéficiaire','Référence','Montant (FCFA)','Solde après','Saisi par'],
    data.map(m=>[fmtD(m.date),m.type==='entrée'?'Entrée':'Sortie',m.rubrique||'—',m.libelle||'—',m.benef_nom||'—',m.ref||'—',(m.type==='entrée'?'+':'-')+fmt(m.montant),fmt(m.soldeApres||0),m.saisie||'—']),
    {format});
}
window.exportCaisseP=exportCaisseP;
// ══════════════════════════════════════════════════════
function ouvrirCloturePetiteCaisse(){
  const totAppro=petiteCaisse.filter(m=>m.type==='appro').reduce((s,m)=>s+(m.montant||0),0);
  const totDepense=petiteCaisse.filter(m=>m.type==='depense').reduce((s,m)=>s+(m.montant||0),0);
  const soldeTheo=totAppro-totDepense;
  document.getElementById('pcClotDate').value=today();
  document.getElementById('pcClotPeriode').value='';
  document.getElementById('pcClotSoldePhysique').value='';
  document.getElementById('pcClotNotes').value='';
  document.getElementById('pcClotResponsable').value='';
  document.getElementById('pcClotComptable').value='';
  document.getElementById('pcClotSaisi').value=currentUser.nom;
  document.getElementById('pcClotTotAppro').textContent=fmt(totAppro)+' '+DEVISE;
  document.getElementById('pcClotTotDepense').textContent=fmt(totDepense)+' '+DEVISE;
  document.getElementById('pcClotSoldeTheo').textContent=fmt(soldeTheo)+' '+DEVISE;
  document.getElementById('pcClotSoldeTheo').style.color=soldeTheo>=0?'var(--cyan)':'var(--red)';
  document.getElementById('pcClotEcart').textContent='—';
  document.getElementById('pcClotEcartMsg').textContent='';
  openM('mCloturePetiteCaisse');
}
window.ouvrirCloturePetiteCaisse=ouvrirCloturePetiteCaisse;

function calcEcartPC(){
  const physique=parseFloat(document.getElementById('pcClotSoldePhysique').value)||0;
  const totAppro=petiteCaisse.filter(m=>m.type==='appro').reduce((s,m)=>s+(m.montant||0),0);
  const totDepense=petiteCaisse.filter(m=>m.type==='depense').reduce((s,m)=>s+(m.montant||0),0);
  const theo=totAppro-totDepense;
  const ecart=physique-theo;
  const ecartEl=document.getElementById('pcClotEcart');
  const ecartMsg=document.getElementById('pcClotEcartMsg');
  ecartEl.textContent=(ecart>0?'+ ':ecart<0?'− ':'')+fmt(Math.abs(ecart))+' '+DEVISE;
  ecartEl.style.color=ecart===0?'var(--green)':ecart<0?'var(--red)':'var(--amber)';
  ecartMsg.textContent=ecart===0?'✓ Caisse équilibrée':ecart<0?'⚠ Manquant — physique < théorique':'⚡ Excédent — physique > théorique';
}
window.calcEcartPC=calcEcartPC;

async function saveCloturePetiteCaisse(){
  const date=document.getElementById('pcClotDate').value;
  const physique=parseFloat(document.getElementById('pcClotSoldePhysique').value);
  if(!date||isNaN(physique)){toast('Date et solde physique obligatoires','err');return;}
  const totAppro=petiteCaisse.filter(m=>m.type==='appro').reduce((s,m)=>s+(m.montant||0),0);
  const totDepense=petiteCaisse.filter(m=>m.type==='depense').reduce((s,m)=>s+(m.montant||0),0);
  const theo=totAppro-totDepense;
  const ecart=physique-theo;
  const clot={id:uid(),date,
    periode:document.getElementById('pcClotPeriode').value,
    totAppro,totDepense,soldeTheorique:theo,
    soldePhysique:physique,ecart,
    notes:document.getElementById('pcClotNotes').value,
    responsable:document.getElementById('pcClotResponsable').value,
    comptable:document.getElementById('pcClotComptable').value,
    saisie:currentUser.nom,ts:Date.now()};
  await saveItem('cloturePetiteCaisse',clot);
  closeM('mCloturePetiteCaisse');
  toast(`Clôture petite caisse enregistrée ✓ — Écart : ${ecart===0?'Néant':fmt(Math.abs(ecart))+' '+DEVISE}`);
  setTimeout(()=>{if(confirm('Imprimer le rapport de clôture ?'))imprimerCloturePetiteCaisse(clot);},300);
}
window.saveCloturePetiteCaisse=saveCloturePetiteCaisse;

function imprimerCloturePetiteCaisse(data){
  const date=data?.date||document.getElementById('pcClotDate').value;
  const periode=data?.periode||document.getElementById('pcClotPeriode').value||'';
  const physique=data?.soldePhysique!=null?data.soldePhysique:(parseFloat(document.getElementById('pcClotSoldePhysique').value)||0);
  const totAppro=data?.totAppro??petiteCaisse.filter(m=>m.type==='appro').reduce((s,m)=>s+(m.montant||0),0);
  const totDepense=data?.totDepense??petiteCaisse.filter(m=>m.type==='depense').reduce((s,m)=>s+(m.montant||0),0);
  const theo=data?.soldeTheorique??(totAppro-totDepense);
  const ecart=data?.ecart??(physique-theo);
  const responsable=data?.responsable||document.getElementById('pcClotResponsable')?.value||'';
  const comptable=data?.comptable||document.getElementById('pcClotComptable')?.value||'';
  const notes=data?.notes||document.getElementById('pcClotNotes')?.value||'';
  const mouvements=[...petiteCaisse].sort((a,b)=>a.date?.localeCompare(b.date||'')||0);
  const ecartCol=ecart===0?'#00C47A':ecart<0?'#f05050':'#f5a623';
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Clôture Petite Caisse</title>
  <style>@page{size:A4;margin:12mm}body{font-family:Arial,sans-serif;font-size:10pt;color:#111}
  h2{color:#00C47A;margin:0 0 4px}.header{display:flex;justify-content:space-between;border-bottom:2px solid #00C47A;padding-bottom:10px;margin-bottom:14px}
  .kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
  .kpi-box{border:1px solid #eee;border-radius:6px;padding:8px;text-align:center}
  .kpi-label{font-size:7pt;color:#999;text-transform:uppercase}.kpi-val{font-size:13pt;font-weight:800}
  table{width:100%;border-collapse:collapse;font-size:8.5pt;margin-bottom:12px}
  th{background:#f5f5f5;padding:5px 6px;text-align:left;border:1px solid #ddd}td{padding:4px 6px;border:1px solid #eee}
  .sigs{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:28px}
  .sig{border-top:1px solid #ccc;padding-top:6px;text-align:center;font-size:8pt;color:#666}
  .ecart-box{background:${ecartCol}22;border:2px solid ${ecartCol};border-radius:8px;padding:10px;text-align:center;margin:10px 0}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style>
  </head><body>
  <div class="header"><div><h2>${PHARMACIE_NOM}</h2><div style="font-size:9pt;color:#666">CLÔTURE PETITE CAISSE${periode?' — '+periode:''}</div></div>
  <div style="text-align:right;font-size:8pt;color:#666">Date clôture : ${fmtD(date)}<br>Imprimé le ${new Date().toLocaleString('fr-FR')}</div></div>
  <div class="kpi">
    <div class="kpi-box"><div class="kpi-label">Total appros</div><div class="kpi-val" style="color:#00C47A">${fmt(totAppro)}</div><div style="font-size:7pt;color:#999">FCFA</div></div>
    <div class="kpi-box"><div class="kpi-label">Total dépenses</div><div class="kpi-val" style="color:#f05050">${fmt(totDepense)}</div><div style="font-size:7pt;color:#999">FCFA</div></div>
    <div class="kpi-box"><div class="kpi-label">Solde théorique</div><div class="kpi-val" style="color:#22d3ee">${fmt(theo)}</div><div style="font-size:7pt;color:#999">FCFA</div></div>
    <div class="kpi-box"><div class="kpi-label">Solde physique</div><div class="kpi-val" style="color:#4d8af0">${fmt(physique)}</div><div style="font-size:7pt;color:#999">FCFA</div></div>
  </div>
  <div class="ecart-box">
    <div style="font-size:8pt;color:${ecartCol};text-transform:uppercase;font-weight:700">Écart constaté</div>
    <div style="font-size:16pt;font-weight:800;color:${ecartCol}">${ecart===0?'NÉANT':(ecart>0?'+ ':ecart<0?'− ':'')+fmt(Math.abs(ecart))+' FCFA'}</div>
    <div style="font-size:9pt;color:${ecartCol}">${ecart===0?'✓ Caisse équilibrée':ecart<0?'⚠ Manquant':'⚡ Excédent'}</div>
  </div>
  ${notes?`<div style="margin-bottom:10px;padding:8px;background:#f9f9f9;border-radius:6px;font-size:9pt"><b>Observations :</b> ${notes}</div>`:''}
  <div style="font-weight:700;font-size:9pt;text-transform:uppercase;color:#555;margin-bottom:6px">Détail des mouvements (${mouvements.length})</div>
  <table><thead><tr><th>Date</th><th>Type</th><th>Libellé</th><th>Catégorie</th><th>Référence</th><th>Montant</th><th>Solde après</th></tr></thead>
  <tbody>${mouvements.map((m,i)=>`<tr style="background:${i%2?'#fafafa':'#fff'}">
    <td>${fmtD(m.date)} ${m.heure||''}</td>
    <td style="color:${m.type==='appro'?'#00C47A':'#f05050'};font-weight:700">${m.type==='appro'?'Appro':'Dépense'}</td>
    <td>${m.libelle||'—'}</td><td>${m.categorie||'—'}</td>
    <td style="font-family:monospace;font-size:7.5pt">${m.ref||'—'}</td>
    <td style="color:${m.type==='appro'?'#00C47A':'#f05050'};font-weight:700">${m.type==='appro'?'+':'-'}${fmt(m.montant)}</td>
    <td style="font-weight:600">${fmt(m.soldeApres||0)}</td>
  </tr>`).join('')}
  <tr style="background:#e8f5f0;font-weight:700"><td colspan="5">SOLDE FINAL THÉORIQUE</td><td colspan="2" style="color:#22d3ee">${fmt(theo)} FCFA</td></tr>
  </tbody></table>
  <div class="sigs">
    <div class="sig"><div style="height:40px"></div><div style="border-top:1px dotted #ccc;padding-top:4px">${responsable||'_______________'}</div><div style="font-size:7pt;color:#aaa">Responsable caisse</div></div>
    <div class="sig"><div style="height:40px"></div><div style="border-top:1px dotted #ccc;padding-top:4px">${comptable||'_______________'}</div><div style="font-size:7pt;color:#aaa">Comptable</div></div>
  </div>
  <div style="margin-top:14px;font-size:7pt;color:#aaa;text-align:center">PharmaCash Pro — Clôture petite caisse — ${new Date().toLocaleString('fr-FR')}</div>
  <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}
window.imprimerCloturePetiteCaisse=imprimerCloturePetiteCaisse;

function onPeriodeChange(){
  const p=document.getElementById('rPeriode').value;
  document.getElementById('rCustomDates').style.display=p==='custom'?'flex':'none';
  renderRapport();
}
window.onPeriodeChange=onPeriodeChange;
// ── Gestion des vues rapport ─────────────────────────
let _rapportVue = 'globale'; // 'globale' | 'depots' | 'psrm'
function setRapportVue(vue) {
  _rapportVue = vue;
  // Mettre à jour les boutons
  ['globale','depots','psrm'].forEach(v => {
    const btn = document.getElementById('rVue'+v.charAt(0).toUpperCase()+v.slice(1));
    if (!btn) return;
    btn.style.background = v === vue ? 'var(--green)' : '';
    btn.style.color = v === vue ? '#fff' : '';
    btn.className = v === vue ? 'btn btn-sm' : 'btn btn-ghost btn-sm';
  });
  renderRapport();
}
window.setRapportVue = setRapportVue;

function renderRapport(){
  const t=today(),p=document.getElementById('rPeriode').value;
  let debut,fin;
  if(p==='jour'){debut=t;fin=t;}else if(p==='semaine'){const b=weekBounds(t);debut=b.start;fin=b.end;}
  else if(p==='mois'){debut=t.slice(0,7)+'-01';fin=t;}
  else{debut=document.getElementById('rDebut').value||t;fin=document.getElementById('rFin').value||t;}

  // Filtrer selon la vue sélectionnée
  const pdvP = pdvs.find(p=>p.type==='principale');
  const pdvDepots = pdvs.filter(p=>p.type!=='principale').map(p=>p.id);

  let recF = recettes.filter(r=>r.date>=debut&&r.date<=fin);
  let verF = versements.filter(v=>v.date>=debut&&v.date<=fin);

  // Vue PSRM : recettes auto depuis clôtures + versements PSRM
  // Vue Dépôts : recettes et versements des dépôts uniquement
  if(_rapportVue==='psrm' && pdvP){
    recF = recF.filter(r=>r.pdv===pdvP.id);
    verF = verF.filter(v=>v.pdv===pdvP.id);
  } else if(_rapportVue==='depots'){
    recF = recF.filter(r=>pdvDepots.includes(r.pdv));
    verF = verF.filter(v=>pdvDepots.includes(v.pdv));
  }
  // Vue globale = tout (pas de filtre)

  // Label de la vue
  const vueLabel = _rapportVue==='psrm'?'🏛️ Pharmacie Principale':
                   _rapportVue==='depots'?'🏪 Dépôts uniquement':'🌐 Vue globale (Pharmacie + Dépôts)';

  const totR=recF.reduce((s,r)=>s+(r.montant||0),0),totV=verF.reduce((s,v)=>s+(v.montant||0),0),
    totC=verF.filter(v=>v.statut==='confirmé').reduce((s,v)=>s+(v.montant||0),0),
    totA=verF.filter(v=>v.statut==='en attente').reduce((s,v)=>s+(v.montant||0),0),ecart=totR-totC;
  const byPDV={};pdvs.forEach(p=>{byPDV[p.id]={nom:p.nom,type:p.type,rec:0,ver:0,verC:0}});
  recF.forEach(r=>{if(byPDV[r.pdv])byPDV[r.pdv].rec+=r.montant||0});
  verF.forEach(v=>{if(byPDV[v.pdv]){byPDV[v.pdv].ver+=v.montant||0;if(v.statut==='confirmé')byPDV[v.pdv].verC+=v.montant||0}});
  const byCanal={};recF.forEach(r=>{if(!byCanal[r.canal])byCanal[r.canal]=0;byCanal[r.canal]+=r.montant||0});
  const byCpt={};verF.filter(v=>v.statut==='confirmé').forEach(v=>{if(!byCpt[v.compte])byCpt[v.compte]=0;byCpt[v.compte]+=v.montant||0});

  // Clôtures PSRM pour la vue PSRM
  const clotF = _rapportVue==='psrm'
    ? clotures.filter(c=>c.date>=debut&&c.date<=fin&&c.statut==='validé')
    : [];
  const totMachine = clotF.reduce((s,c)=>s+(c.totalMachine||0),0);

  document.getElementById('rapportContent').innerHTML=`
    <div style="font-size:.75rem;color:var(--cyan);font-weight:700;margin-bottom:10px">${vueLabel}</div>
    <div class="stats-grid">
      <div class="stat-card green"><div class="stat-lbl">Recettes CA</div><div class="stat-val green">${fmt(totR)}</div><div class="stat-sub">${DEVISE}</div></div>
      ${_rapportVue==='psrm'?`<div class="stat-card blue"><div class="stat-lbl">Total Machine</div><div class="stat-val blue">${fmt(totMachine)}</div><div class="stat-sub">${DEVISE} — ${clotF.length} clôture(s)</div></div>`:''}
      <div class="stat-card blue"><div class="stat-lbl">Versements</div><div class="stat-val blue">${fmt(totV)}</div><div class="stat-sub">${DEVISE}</div></div>
      <div class="stat-card purple"><div class="stat-lbl">Confirmés</div><div class="stat-val purple">${fmt(totC)}</div><div class="stat-sub">${DEVISE}</div></div>
      <div class="stat-card amber"><div class="stat-lbl">En attente</div><div class="stat-val amber">${fmt(totA)}</div><div class="stat-sub">${DEVISE}</div></div>
      <div class="stat-card ${ecart>=0?'green':'red'}"><div class="stat-lbl">Écart CA/Versé</div><div class="stat-val ${ecart>=0?'green':'red'}">${ecart>=0?'+':''}${fmt(ecart)}</div><div class="stat-sub">${DEVISE}</div></div>
    </div>
      <div class="stat-card ${ecart>0?'amber':ecart===0?'green':'red'}"><div class="stat-lbl">Écart</div><div class="stat-val ${ecart>0?'amber':ecart===0?'green':'red'}">${fmt(ecart)}</div><div class="stat-sub">${DEVISE}</div></div>
      <div class="stat-card green"><div class="stat-lbl">✓ Disponible banques</div><div class="stat-val green">${fmt(totalDispo())}</div><div class="stat-sub">${DEVISE}</div></div>
      <div class="stat-card amber"><div class="stat-lbl">⏳ En transit MM</div><div class="stat-val amber">${fmt(totalTransit())}</div><div class="stat-sub">${DEVISE}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div class="card"><div class="card-title" style="margin-bottom:12px">Recettes par canal</div>
        ${Object.entries(byCanal).sort((a,b)=>b[1]-a[1]).map(([k,v])=>{const pct=totR>0?Math.round(v/totR*100):0;return`<div style="margin-bottom:10px;cursor:pointer;padding:6px 8px;border-radius:6px;transition:background .15s" onclick="ouvrirDetailCanalRapport('${k}','${debut}','${fin}')" title="Voir recettes ${k}" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>${mmBadge(k)}</span><span class="amt pos">${fmt(v)}</span></div><div class="prog-bar"><div class="prog-fill" style="width:${pct}%;background:var(--green)"></div></div><div style="font-size:.68rem;color:var(--text3)">${pct}% — cliquer pour le détail</div></div>`}).join('')||'<div style="color:var(--text3)">Aucune donnée</div>'}
      </div>
      <div class="card"><div class="card-title" style="margin-bottom:12px">Versements par compte</div>
        ${Object.entries(byCpt).sort((a,b)=>b[1]-a[1]).map(([id,v])=>{const cpt=comptes.find(c=>c.id===id);const pct=totC>0?Math.round(v/totC*100):0;return`<div style="margin-bottom:10px;cursor:pointer;padding:6px 8px;border-radius:6px;transition:background .15s" onclick="ouvrirDetailRapportCompte('${id}','${debut}','${fin}')" title="Voir versements ${cpt?cpt.nom:id}" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:.78rem;color:var(--text2)">${cpt?cpt.nom:id}</span><span class="amt pos">${fmt(v)}</span></div><div class="prog-bar"><div class="prog-fill" style="width:${pct}%;background:var(--blue)"></div></div><div style="font-size:.68rem;color:var(--text3)">${pct}% — cliquer pour le détail</div></div>`}).join('')||'<div style="color:var(--text3)">Aucun versement confirmé</div>'}
      </div>
    </div>
    <div class="card" style="margin-top:14px"><div class="card-title" style="margin-bottom:4px">Performance par point de vente</div>
      <div style="font-size:.72rem;color:var(--text3);margin-bottom:10px">🖱 Cliquez sur une ligne pour voir le détail des opérations</div>
      <div class="tbl-wrap"><table><thead><tr><th>PDV</th><th>Type</th><th>Recettes</th><th>Versé</th><th>Confirmé</th><th>Taux</th></tr></thead>
      <tbody>${Object.entries(byPDV).map(([pdvId,p])=>{const taux=p.rec>0?Math.round(p.verC/p.rec*100):0;const col=taux>=80?'var(--green)':taux>=50?'var(--amber)':'var(--red)';return`<tr style="cursor:pointer" onclick="ouvrirDetailRapportPDV('${pdvId}','${debut}','${fin}')" title="Voir le détail de ${p.nom}">
        <td><b>${p.nom}</b></td>
        <td><span class="badge ${p.type==='principale'?'bg':'bb'}">${p.type}</span></td>
        <td class="amt pos">${fmt(p.rec)}</td>
        <td class="amt">${fmt(p.ver)}</td>
        <td class="amt pos">${fmt(p.verC)}</td>
        <td><span style="color:${col};font-weight:700">${taux}%</span><div class="prog-bar"><div class="prog-fill" style="width:${taux}%;background:${col}"></div></div></td>
      </tr>`}).join('')}</tbody></table></div>
    </div>
    <div class="card" style="margin-top:14px"><div class="card-title" style="margin-bottom:4px">Versements par compte destinataire</div>
      <div style="font-size:.72rem;color:var(--text3);margin-bottom:10px">🖱 Cliquez sur un compte pour voir ses versements</div>
      ${Object.entries(byCpt).sort((a,b)=>b[1]-a[1]).map(([id,v])=>{const cpt=comptes.find(c=>c.id===id);const pct=totC>0?Math.round(v/totC*100):0;return`<div style="margin-bottom:10px;cursor:pointer;padding:6px 8px;border-radius:6px;transition:background .15s" onclick="ouvrirDetailRapportCompte('${id}','${debut}','${fin}')" title="Voir versements vers ${cpt?cpt.nom:id}" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:.78rem;color:var(--text2)">${cpt?cpt.nom:id}</span><span class="amt pos">${fmt(v)}</span></div>
        <div class="prog-bar"><div class="prog-fill" style="width:${pct}%;background:var(--blue)"></div></div>
        <div style="font-size:.68rem;color:var(--text3)">${pct}%</div>
      </div>`}).join('')||'<div style="color:var(--text3)">Aucun versement confirmé</div>'}
    </div>`;
}
// ══════════════════════════════════════════════════════
// BARRE SOLDE UNIVERSEL — Ouverture / Entrées / Sorties / Solde actuel
// ══════════════════════════════════════════════════════
function renderSoldeHeader(containerId, opts = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const moisCourant = today().slice(0, 7);
  const debutMoisStr = moisCourant + '-01';

  const {
    soldeActuel = 0,
    compteId = null,        // pour chercher le RAN
    entrées = 0,
    sorties = 0,
    label = '',
    couleur = 'var(--green)',
  } = opts;

  // Chercher le RAN du mois courant pour ce compte
  const ran = compteId
    ? rapportsNouveaux.find(r => r.compteId === compteId && r.periode === moisCourant)
    : null;
  const soldeOuv = ran ? ran.soldeOuverture : null;
  const ecart = soldeOuv !== null ? soldeActuel - soldeOuv : null;

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px">
      <div class="stat-card" style="border-left:3px solid var(--text3)">
        <div class="stat-lbl">📅 Solde ouverture (${moisCourant})</div>
        <div class="stat-val" style="color:${soldeOuv!==null?(soldeOuv>=0?'var(--green)':'var(--red)'):'var(--text3)'}">
          ${soldeOuv !== null ? fmt(soldeOuv) : '—'}
        </div>
        <div style="font-size:.65rem;color:var(--text3)">${soldeOuv !== null ? 'RAN capturé ✓' : 'RAN non capturé'} ${DEVISE}</div>
      </div>
      <div class="stat-card" style="border-left:3px solid var(--green)">
        <div class="stat-lbl">↑ Entrées du mois</div>
        <div class="stat-val" style="color:var(--green)">${fmt(entrées)}</div>
        <div style="font-size:.65rem;color:var(--text3)">${DEVISE}</div>
      </div>
      <div class="stat-card" style="border-left:3px solid var(--red)">
        <div class="stat-lbl">↓ Sorties du mois</div>
        <div class="stat-val" style="color:var(--red)">${fmt(sorties)}</div>
        <div style="font-size:.65rem;color:var(--text3)">${DEVISE}</div>
      </div>
      <div class="stat-card" style="border-left:3px solid ${couleur}">
        <div class="stat-lbl">💰 Solde actuel</div>
        <div class="stat-val" style="color:${soldeActuel>=0?couleur:'var(--red)'}; font-size:1.1rem">${fmt(soldeActuel)}</div>
        <div style="font-size:.65rem;color:var(--text3)">${DEVISE}${label?' — '+label:''}</div>
      </div>
      ${ecart !== null ? `
      <div class="stat-card" style="border-left:3px solid ${ecart>=0?'var(--green)':'var(--red)'}">
        <div class="stat-lbl">📊 Variation depuis ouverture</div>
        <div class="stat-val" style="color:${ecart>=0?'var(--green)':'var(--red)'}">
          ${ecart>0?'+':''}${fmt(ecart)}
        </div>
        <div style="font-size:.65rem;color:var(--text3)">${DEVISE}</div>
      </div>` : ''}
    </div>`;
}
window.renderSoldeHeader = renderSoldeHeader;
// ══════════════════════════════════════════════════════

// Plages par défaut si aucune n'est configurée
const VACATIONS_DEFAUT = [
  { id:'v1', libelle:'Matin',          heureDebut:'07h', heureFin:'14h', actif:true },
  { id:'v2', libelle:'Après-midi',     heureDebut:'14h', heureFin:'21h', actif:true },
  { id:'v3', libelle:'Nuit',           heureDebut:'21h', heureFin:'07h', actif:true },
  { id:'v4', libelle:'Journée complète', heureDebut:'07h', heureFin:'21h', actif:true },
];

function getVacations() {
  const actives = vacationsDB.filter(v => v.actif !== false);
  return actives.length ? actives : VACATIONS_DEFAUT;
}

function vacationLabel(v) {
  if (!v.heureDebut && !v.heureFin) return v.libelle;
  return `${v.libelle} (${v.heureDebut}–${v.heureFin})`;
}

function populateVacationSelect() {
  const el = document.getElementById('mcVacation');
  if (!el) return;
  const vacs = getVacations();
  el.innerHTML = vacs.map(v => `<option value="${vacationLabel(v)}">${vacationLabel(v)}</option>`).join('');
}
window.populateVacationSelect = populateVacationSelect;

function renderAdminVacations() {
  const tbody = document.getElementById('vacationsTbody');
  if (!tbody) return;
  const vacs = getVacations();
  if (!vacationsDB.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:14px;color:var(--text3)">
      Plages par défaut actives — cliquez "+ Ajouter" pour personnaliser
    </td></tr>` + VACATIONS_DEFAUT.map((v,i) => `<tr style="opacity:.6">
      <td style="color:var(--text3);text-align:right;font-size:.68rem">${i+1}</td>
      <td><b>${v.libelle}</b></td>
      <td style="color:var(--cyan)">${v.heureDebut}</td>
      <td style="color:var(--cyan)">${v.heureFin}</td>
      <td><span class="badge bg">✅ Défaut</span></td>
    </tr>`).join('');
    return;
  }
  tbody.innerHTML = vacs.map((v,i) => `<tr>
    <td style="color:var(--text3);text-align:right;font-size:.68rem">${i+1}</td>
    <td><b>${v.libelle}</b></td>
    <td style="color:var(--cyan);font-weight:700">${v.heureDebut||'—'}</td>
    <td style="color:var(--cyan);font-weight:700">${v.heureFin||'—'}</td>
    <td style="display:flex;gap:4px">
      <button class="btn btn-ghost btn-xs" onclick="ouvrirModalVacation('${v.id}')">✏️</button>
      <button class="btn btn-red btn-xs" onclick="delVacation('${v.id}')">✕</button>
    </td>
  </tr>`).join('');
}
window.renderAdminVacations = renderAdminVacations;

function ouvrirModalVacation(id) {
  const v = id ? vacationsDB.find(x => x.id === id) : null;
  document.getElementById('mVacLibelle').value = v?.libelle || '';
  document.getElementById('mVacDebut').value = v?.heureDebut || '';
  document.getElementById('mVacFin').value = v?.heureFin || '';
  document.getElementById('mVacStatut').value = v?.actif === false ? 'inactif' : 'actif';
  document.getElementById('mVacation')._editId = id || null;
  openM('mVacation');
}
window.ouvrirModalVacation = ouvrirModalVacation;

async function saveVacation() {
  const libelle = document.getElementById('mVacLibelle').value.trim();
  if (!libelle) { toast('Le libellé est obligatoire', 'err'); return; }
  const editId = document.getElementById('mVacation')._editId;
  const vac = {
    id: editId || uid(),
    libelle,
    heureDebut: document.getElementById('mVacDebut').value.trim(),
    heureFin: document.getElementById('mVacFin').value.trim(),
    actif: document.getElementById('mVacStatut').value === 'actif',
    ts: Date.now()
  };
  // Si c'est la première saisie, initialiser avec les défauts d'abord
  if (!vacationsDB.length) {
    for (const d of VACATIONS_DEFAUT) {
      vacationsDB.push(d);
      await saveItem('vacationsDB', d);
    }
  }
  if (editId) {
    const idx = vacationsDB.findIndex(x => x.id === editId);
    if (idx > -1) vacationsDB[idx] = vac;
  } else {
    vacationsDB.push(vac);
  }
  await saveItem('vacationsDB', vac);
  saveLocal();
  closeM('mVacation');
  toast(`✅ Vacation "${vacationLabel(vac)}" enregistrée`);
  renderAdminVacations();
  populateVacationSelect();
}
window.saveVacation = saveVacation;

async function delVacation(id) {
  if (!confirm('Supprimer cette plage horaire ?')) return;
  vacationsDB = vacationsDB.filter(x => x.id !== id);
  await delItem('vacationsDB', id);
  saveLocal();
  renderAdminVacations();
  populateVacationSelect();
  toast('Supprimée', 'info');
}
window.delVacation = delVacation;
// ══════════════════════════════════════════════════════
function renderAdminCaissieres(){
  const tbody=document.getElementById('caissieresdbTbody');
  if(!tbody)return;
  if(!caissieresDB.length){
    tbody.innerHTML='<tr><td colspan="7"><div class="empty-state"><div class="ei">👤</div>Aucune caissière enregistrée<br><button class="btn btn-green btn-sm" style="margin-top:10px" onclick="ouvrirModalCaissiere()">+ Ajouter la première</button></div></td></tr>';
    return;
  }
  tbody.innerHTML=caissieresDB.map((c,i)=>{
    const pdvNom=pdvs.find(p=>p.id===c.pdv)?.nom||'Tous PDV';
    const statutBadge=c.actif===false
      ?'<span class="badge br">❌ Inactif</span>'
      :'<span class="badge bg">✅ Actif</span>';
    return`<tr>
      <td style="color:var(--text3);font-size:.68rem;text-align:right">${i+1}</td>
      <td><b>${c.nom}</b></td>
      <td style="font-size:.8rem">${pdvNom}</td>
      <td style="font-size:.8rem;color:var(--text2)">${c.tel||'—'}</td>
      <td style="font-size:.75rem;color:var(--text3)">${c.notes||'—'}</td>
      <td>${statutBadge}</td>
      <td style="display:flex;gap:4px">
        <button class="btn btn-ghost btn-xs" onclick="ouvrirModalCaissiere('${c.id}')">✏️</button>
        <button class="btn btn-red btn-xs" onclick="delCaissiere('${c.id}')">✕</button>
      </td>
    </tr>`;
  }).join('');
}
window.renderAdminCaissieres=renderAdminCaissieres;

function ouvrirModalCaissiere(id){
  // Peupler le select PDV
  const selPDV=document.getElementById('mCaissPDV');
  if(selPDV) selPDV.innerHTML='<option value="">— Tous PDV —</option>'+pdvs.map(p=>`<option value="${p.id}">${p.nom}</option>`).join('');
  const c=id?caissieresDB.find(x=>x.id===id):null;
  document.getElementById('mCaissNom').value=c?.nom||'';
  document.getElementById('mCaissPDV').value=c?.pdv||'';
  document.getElementById('mCaissTel').value=c?.tel||'';
  document.getElementById('mCaissNotes').value=c?.notes||'';
  document.getElementById('mCaissStatut').value=c?.actif===false?'inactif':'actif';
  document.getElementById('mCaissiere')._editId=id||null;
  openM('mCaissiere');
}
window.ouvrirModalCaissiere=ouvrirModalCaissiere;

async function saveCaissiere(){
  const nom=document.getElementById('mCaissNom').value.trim();
  if(!nom){toast('Le nom est obligatoire','err');return;}
  const editId=document.getElementById('mCaissiere')._editId;
  const caiss={
    id:editId||uid(),
    nom,
    pdv:document.getElementById('mCaissPDV').value||'',
    tel:document.getElementById('mCaissTel').value.trim(),
    notes:document.getElementById('mCaissNotes').value.trim(),
    actif:document.getElementById('mCaissStatut').value==='actif',
    ts:Date.now()
  };
  if(editId){
    const idx=caissieresDB.findIndex(c=>c.id===editId);
    if(idx>-1)caissieresDB[idx]=caiss;
  } else {
    // Vérifier doublon
    if(caissieresDB.find(c=>c.nom.toLowerCase()===nom.toLowerCase())){
      if(!confirm(`Une caissière nommée "${nom}" existe déjà. Ajouter quand même ?`))return;
    }
    caissieresDB.push(caiss);
  }
  await saveItem('caissieresDB',caiss);
  saveLocal();
  closeM('mCaissiere');
  toast(`✅ Caissière "${nom}" enregistrée`);
  renderAdminCaissieres();
  // Mettre à jour le select dans le modal clôture si ouvert
  populateCaissiereSelect();
}
window.saveCaissiere=saveCaissiere;

async function delCaissiere(id){
  const c=caissieresDB.find(x=>x.id===id);
  if(!c)return;
  // Vérifier si elle a des clôtures
  const nbClot=clotures.filter(cl=>cl.caissiere===c.nom).length;
  if(nbClot>0){
    if(!confirm(`"${c.nom}" a ${nbClot} clôture(s) enregistrée(s).\nSuppression définitive ou marquer comme inactive ?\n\nOK = Supprimer | Annuler = Marquer inactive`)){
      // Marquer inactive
      c.actif=false;
      await saveItem('caissieresDB',c);
      saveLocal();
      renderAdminCaissieres();
      toast(`"${c.nom}" marquée inactive`,'info');
      return;
    }
  } else {
    if(!confirm(`Supprimer "${c.nom}" ?`))return;
  }
  caissieresDB=caissieresDB.filter(x=>x.id!==id);
  await delItem('caissieresDB',id);
  saveLocal();
  renderAdminCaissieres();
  toast('Supprimée','info');
}
window.delCaissiere=delCaissiere;

// ── Import automatique depuis les clôtures existantes ─
async function importerCaissieresDepsExistantes(){
  // Récupère tous les noms uniques de caissières déjà dans les clôtures
  const nomsExistants=new Set(caissieresDB.map(c=>c.nom.toLowerCase()));
  const nomsClot=[...new Set(clotures.map(c=>c.caissiere).filter(Boolean))];
  const aImporter=nomsClot.filter(n=>!nomsExistants.has(n.toLowerCase()));
  if(!aImporter.length){toast('Toutes les caissières sont déjà dans la base','info');return;}
  for(const nom of aImporter){
    const caiss={id:uid(),nom,pdv:'',tel:'',notes:'Importée automatiquement',actif:true,ts:Date.now()};
    caissieresDB.push(caiss);
    await saveItem('caissieresDB',caiss);
  }
  saveLocal();
  renderAdminCaissieres();
  toast(`✅ ${aImporter.length} caissière(s) importée(s) depuis les clôtures`);
}
window.importerCaissieresDepsExistantes=importerCaissieresDepsExistantes;

// ── Détail opérations depuis Rapport (modal) ──────────
function ouvrirDetailCanalRapport(canal, debut, fin) {
  debut = today().slice(0,7) + '-01';
  fin = today();
  const recF = recettes.filter(r => r.canal === canal && r.date >= debut && r.date <= fin);
  const totR = recF.reduce((s,r) => s+(r.montant||0), 0);
  const recHtml = recF.length
    ? recF.sort((a,b)=>b.date.localeCompare(a.date)).map((r,i) => `
      <tr>
        <td style="color:var(--text3);font-size:.68rem;text-align:right">${i+1}</td>
        <td>${fmtD(r.date)}</td>
        <td>${pdvBadge(r.pdv)}</td>
        <td><span class="badge bb" style="font-size:.65rem">${r.type||'—'}</span></td>
        <td class="amt pos">${fmt(r.montant)}</td>
        <td style="font-size:.72rem;color:var(--text3)">${r.ref||'—'}</td>
        <td style="font-size:.72rem;color:var(--text3)">${r.saisie||'—'}</td>
      </tr>`).join('')
    : '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:14px">Aucune recette</td></tr>';

  const html = `
    <div style="display:flex;gap:10px;margin-bottom:14px">
      <div class="stat-card green" style="flex:1"><div class="stat-lbl">Total ${canal}</div><div class="stat-val green">${fmt(totR)}</div><div class="stat-sub">${recF.length} recette(s) · ${DEVISE}</div></div>
    </div>
    <div class="tbl-wrap">
      <table><thead><tr><th>#</th><th>Date</th><th>PDV</th><th>Type</th><th>Montant</th><th>Réf.</th><th>Saisi par</th></tr></thead>
      <tbody>${recHtml}</tbody>
      <tr style="background:var(--surface2);font-weight:700"><td colspan="4" style="text-align:right;padding:6px">TOTAL</td><td class="amt pos">${fmt(totR)}</td><td colspan="2"></td></tr>
      </table>
    </div>`;
  afficherModalDetail(`🧾 Recettes ${mmBadge(canal)} — ${fmtD(debut)} au ${fmtD(fin)}`, html);
}
window.ouvrirDetailCanalRapport = ouvrirDetailCanalRapport;

function ouvrirDetailRapportPDV(pdvId, debut, fin) {
  const debutMoisCourant = today().slice(0,7) + '-01';
  const finAujourdhui = today();
  debut = debutMoisCourant;
  fin = finAujourdhui;
  const pdv = pdvs.find(p => p.id === pdvId);
  const nomPDV = pdv?.nom || pdvId;
  const recF = recettes.filter(r => r.pdv === pdvId && r.date >= debut && r.date <= fin);
  const verF = versements.filter(v => v.pdv === pdvId && v.date >= debut && v.date <= fin);
  const totR = recF.reduce((s,r) => s+(r.montant||0), 0);
  const totV = verF.reduce((s,v) => s+(v.montant||0), 0);
  const totC = verF.filter(v=>v.statut==='confirmé').reduce((s,v) => s+(v.montant||0), 0);

  const recHtml = recF.length
    ? recF.sort((a,b)=>b.date.localeCompare(a.date)).map((r,i) => `
      <tr>
        <td style="color:var(--text3);font-size:.68rem;text-align:right">${i+1}</td>
        <td>${fmtD(r.date)}</td>
        <td>${mmBadge(r.canal)}</td>
        <td><span class="badge bb" style="font-size:.65rem">${r.type||'—'}</span></td>
        <td class="amt pos">${fmt(r.montant)}</td>
        <td style="font-size:.72rem;color:var(--text3)">${r.ref||'—'}</td>
        <td style="font-size:.72rem;color:var(--text3)">${r.saisie||'—'}</td>
      </tr>`).join('')
    : '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:14px">Aucune recette</td></tr>';

  const verHtml = verF.length
    ? verF.sort((a,b)=>b.date.localeCompare(a.date)).map((v,i) => `
      <tr>
        <td style="color:var(--text3);font-size:.68rem;text-align:right">${i+1}</td>
        <td>${fmtD(v.date)}</td>
        <td>${mmBadge(v.type)}</td>
        <td class="amt pos">${fmt(v.montant)}</td>
        <td>${(v.fraisOp||v.fraisTimbre)?`<span style="color:var(--amber);font-size:.75rem">−${fmt((v.fraisOp||0)+(v.fraisTimbre||0))}</span>`:'—'}</td>
        <td>${statutBadge(v.statut)}</td>
        <td style="font-size:.72rem;color:var(--text3)">${comptes.find(c=>c.id===v.compte)?.nom||'—'}</td>
        <td style="font-size:.72rem;color:var(--text3)">${v.ref||'—'}</td>
      </tr>`).join('')
    : '<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:14px">Aucun versement</td></tr>';

  const html = `
    <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <div class="stat-card green" style="flex:1;min-width:120px"><div class="stat-lbl">Recettes</div><div class="stat-val green">${fmt(totR)}</div></div>
      <div class="stat-card blue" style="flex:1;min-width:120px"><div class="stat-lbl">Versé total</div><div class="stat-val blue">${fmt(totV)}</div></div>
      <div class="stat-card purple" style="flex:1;min-width:120px"><div class="stat-lbl">Confirmé</div><div class="stat-val purple">${fmt(totC)}</div></div>
      <div class="stat-card ${totR>0?'amber':'red'}" style="flex:1;min-width:120px"><div class="stat-lbl">Taux versement</div><div class="stat-val amber">${totR>0?Math.round(totC/totR*100):0}%</div></div>
    </div>
    <div style="font-weight:700;color:var(--cyan);margin-bottom:6px;font-size:.85rem">📋 Recettes (${recF.length})</div>
    <div class="tbl-wrap" style="margin-bottom:14px">
      <table><thead><tr><th>#</th><th>Date</th><th>Canal</th><th>Type</th><th>Montant</th><th>Réf.</th><th>Saisi par</th></tr></thead>
      <tbody>${recHtml}</tbody>
      <tr style="background:var(--surface2);font-weight:700"><td colspan="4" style="text-align:right;padding:6px">TOTAL</td><td class="amt pos">${fmt(totR)}</td><td colspan="2"></td></tr>
      </table>
    </div>
    <div style="font-weight:700;color:var(--blue);margin-bottom:6px;font-size:.85rem">💸 Versements (${verF.length})</div>
    <div class="tbl-wrap">
      <table><thead><tr><th>#</th><th>Date</th><th>Type</th><th>Brut</th><th>Frais</th><th>Statut</th><th>Compte</th><th>Réf.</th></tr></thead>
      <tbody>${verHtml}</tbody>
      <tr style="background:var(--surface2);font-weight:700"><td colspan="3" style="text-align:right;padding:6px">TOTAL</td><td class="amt pos">${fmt(totV)}</td><td></td><td class="amt pos">${fmt(totC)} confirmé</td><td colspan="2"></td></tr>
      </table>
    </div>`;

  // Afficher dans un modal générique
  afficherModalDetail(`📊 Détail — ${nomPDV} — ${fmtD(debut)} au ${fmtD(fin)}`, html);
}
window.ouvrirDetailRapportPDV = ouvrirDetailRapportPDV;

function ouvrirDetailRapportCompte(compteId, debut, fin) {
  // Toujours depuis le 1er du mois en cours
  debut = today().slice(0,7) + '-01';
  fin = today();
  const cpt = comptes.find(c => c.id === compteId);
  const nomCpt = cpt?.nom || compteId;
  const verF = versements.filter(v => v.compte === compteId && v.statut === 'confirmé' && v.date >= debut && v.date <= fin);
  const totV = verF.reduce((s,v) => s+(v.montant||0), 0);

  const verHtml = verF.length
    ? verF.sort((a,b)=>b.date.localeCompare(a.date)).map((v,i) => {
        const nomPDV = pdvs.find(p=>p.id===v.pdv)?.nom || v.pdv;
        return `<tr>
          <td style="color:var(--text3);font-size:.68rem;text-align:right">${i+1}</td>
          <td>${fmtD(v.date)}</td>
          <td>${pdvBadge(v.pdv)}</td>
          <td>${mmBadge(v.type)}</td>
          <td class="amt pos">${fmt(v.montant)}</td>
          <td>${(v.fraisOp||v.fraisTimbre)?`<span style="color:var(--amber);font-size:.75rem">−${fmt((v.fraisOp||0)+(v.fraisTimbre||0))}</span>`:'—'}</td>
          <td style="font-size:.72rem;color:var(--text3)">${v.ref||'—'}</td>
          <td style="font-size:.72rem;color:var(--text3)">${v.saisie||'—'}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:14px">Aucun versement confirmé</td></tr>';

  const html = `
    <div style="display:flex;gap:10px;margin-bottom:14px">
      <div class="stat-card purple" style="flex:1"><div class="stat-lbl">Total confirmé</div><div class="stat-val purple">${fmt(totV)}</div></div>
      <div class="stat-card blue" style="flex:1"><div class="stat-lbl">Nb versements</div><div class="stat-val blue">${verF.length}</div></div>
    </div>
    <div class="tbl-wrap">
      <table><thead><tr><th>#</th><th>Date</th><th>PDV</th><th>Type</th><th>Montant</th><th>Frais</th><th>Réf.</th><th>Saisi par</th></tr></thead>
      <tbody>${verHtml}</tbody>
      <tr style="background:var(--surface2);font-weight:700"><td colspan="4" style="text-align:right;padding:6px">TOTAL CRÉDITÉ</td><td class="amt pos">${fmt(totV)}</td><td colspan="3"></td></tr>
      </table>
    </div>`;

  afficherModalDetail(`💰 Versements → ${nomCpt} — ${fmtD(debut)} au ${fmtD(fin)}`, html);
}
window.ouvrirDetailRapportCompte = ouvrirDetailRapportCompte;

// ── Modal générique de détail ─────────────────────────
function afficherModalDetail(titre, contenu) {
  // Créer ou réutiliser le modal de détail
  let modal = document.getElementById('modalDetailRapport');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modalDetailRapport';
    modal.className = 'modal-ov';
    modal.innerHTML = `
      <div class="modal" style="max-width:900px;max-height:90vh;overflow-y:auto">
        <div class="modal-hdr">
          <div class="modal-title" id="modalDetailTitre"></div>
          <button class="close-x" onclick="document.getElementById('modalDetailRapport').style.display='none'">✕</button>
        </div>
        <div class="modal-body" id="modalDetailCorps"></div>
        <div style="padding:12px 20px;display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--border)">
          <button class="btn btn-ghost btn-sm" onclick="imprimerDetailRapport()">🖨️ Imprimer</button>
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('modalDetailRapport').style.display='none'">Fermer</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if(e.target===modal) modal.style.display='none'; });
  }
  document.getElementById('modalDetailTitre').textContent = titre;
  document.getElementById('modalDetailCorps').innerHTML = contenu;
  modal.style.display = 'flex';
}
window.afficherModalDetail = afficherModalDetail;

function imprimerDetailRapport() {
  const titre = document.getElementById('modalDetailTitre')?.textContent || 'Détail';
  const corps = document.getElementById('modalDetailCorps')?.innerHTML || '';
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${titre}</title>
  <style>
    @page{size:A4;margin:12mm}
    body{font-family:Arial,sans-serif;font-size:9pt;color:#111}
    h2{font-size:11pt;color:#00C47A;border-bottom:2px solid #00C47A;padding-bottom:6px}
    table{width:100%;border-collapse:collapse;margin-bottom:12px}
    th{background:#f5f5f5;padding:5px 8px;text-align:left;border:1px solid #ddd;font-size:7.5pt;text-transform:uppercase}
    td{padding:5px 8px;border:1px solid #eee;font-size:8.5pt}
    tr:nth-child(even) td{background:#fafafa}
    .stat-card{display:inline-block;border:1px solid #eee;border-radius:6px;padding:8px 14px;margin:4px;text-align:center}
    .stat-lbl{font-size:7pt;color:#999;text-transform:uppercase}
    .stat-val{font-size:12pt;font-weight:800;color:#00C47A}
    .tbl-wrap{overflow:visible}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body>
  <h2>${titre}</h2>
  ${corps}
  <script>window.onload=()=>window.print()<\/script>
  </body></html>`);
  w.document.close();
}
window.imprimerDetailRapport = imprimerDetailRapport;
// RELEVÉS PÉRIODIQUES — Print/PDF/Excel/Word (v4)
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
// ADMIN — CONFIG
// ══════════════════════════════════════════════════════
function adminTab(name){
  const tabs=['pdv','banques','mm-tetes','mm-pdv','caissieresdb','vacations'];
  tabs.forEach(t=>{
    const el=document.getElementById('adm-'+t);
    if(el)el.style.display=t===name?'block':'none';
  });
  document.querySelectorAll('#pg-admin .inner-tab').forEach(t=>{
    t.classList.toggle('active',t.dataset.tab===name);
  });
  if(name==='mm-tetes') renderAdminMMTetes();
  if(name==='mm-pdv') renderAdminMMPDV();
  if(name==='caissieresdb') renderAdminCaissieres();
  if(name==='vacations') renderAdminVacations();
}
window.adminTab=adminTab;

function renderAdmin(){
  adminTab('pdv');
  // PDV
  document.getElementById('pdvTbody').innerHTML=pdvs.map(p=>{
    let ps=FREQ_LABEL[p.freq]||p.freq;
    if((p.freq==='hebdomadaire'||p.freq==='bimensuel')&&p.jours?.length)ps+=` (${p.jours.map(j=>JOURS_NOM[j]).join(',')})`;
    if(p.freq==='mensuel'&&p.jourMois)ps+=` j${p.jourMois}`;if(p.heure)ps+=` ≤${p.heure}`;
    const cd=comptes.find(c=>c.id===p.compteDefaut);
    const mmNums=[p.numOM?`🟠${p.numOM}`:'',p.numMTN?`🟡${p.numMTN}`:'',p.numWave?`🔵${p.numWave}`:'',p.numMoov?`🟢${p.numMoov}`:''].filter(Boolean).join(' ');
    return`<tr><td><b>${p.nom}</b></td><td><span class="badge ${p.type==='principale'?'bg':'bb'}">${p.type}</span></td>
    <td style="color:var(--text2);font-size:.78rem">${p.resp||'—'}</td>
    <td><span class="wk">${ps}</span></td>
    <td style="font-size:.7rem;color:var(--text2)">${mmNums||'—'}</td>
    <td style="font-size:.72rem;color:var(--text2)">${cd?cd.nom:'—'}</td>
    <td><button class="btn btn-ghost btn-xs" onclick="editPDV('${p.id}')">✏️</button>
    <button class="btn btn-red btn-xs" onclick="delPDV('${p.id}')">✕</button></td></tr>`;
  }).join('');
  // BANQUES
  document.getElementById('cptTbody').innerHTML=comptes.filter(c=>c.cat==='banque').map(c=>{
    const op=c.op==='AUTRE'&&c.opLibre?c.opLibre:c.op;
    const dot=c.color?`<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c.color};margin-right:5px;vertical-align:middle"></span>`:'';
    return`<tr><td>${dot}<b>${c.nom}</b></td>
    <td>${OP_ICONS[c.op]||'🏦'} ${op}</td>
    <td style="font-size:.75rem;color:var(--text2);font-family:monospace">${c.num||'—'}</td>
    <td style="font-size:.72rem;color:var(--text2)">${c.notes||'—'}</td>
    <td class="amt ${(c.solde||0)>=0?'pos':'neg'}">${fmt(c.solde)}</td>
    <td><span class="badge ${c.actif!==false?'bg':'br'}">${c.actif!==false?'Actif':'Inactif'}</span></td>
    <td><button class="btn btn-ghost btn-xs" onclick="editCompte('${c.id}')">✏️</button>
    <button class="btn btn-red btn-xs" onclick="delCompte('${c.id}')">✕</button></td></tr>`;
  }).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text3)">Aucune banque configurée</td></tr>';
  // CAISSES dans banques aussi
  document.getElementById('cptTbody').innerHTML+=comptes.filter(c=>c.cat==='caisse').map(c=>`<tr>
    <td>💵 <b>${c.nom}</b></td><td>Caisse espèces</td>
    <td style="font-size:.75rem;color:var(--text2)">—</td>
    <td style="font-size:.72rem;color:var(--text2)">${c.notes||'—'}</td>
    <td class="amt ${(c.solde||0)>=0?'pos':'neg'}">${fmt(c.solde)}</td>
    <td><span class="badge bg">Actif</span></td>
    <td><button class="btn btn-ghost btn-xs" onclick="editCompte('${c.id}')">✏️</button>
    <button class="btn btn-red btn-xs" onclick="delCompte('${c.id}')">✕</button></td></tr>`).join('');
}
window.renderAdmin=renderAdmin;

function renderAdminMMTetes(){
  const mm=comptes.filter(c=>c.cat==='mobile_money');
  document.getElementById('mmTetesTbody').innerHTML=mm.map(c=>{
    const banque=c.banqueRattachee?comptes.find(b=>b.id===c.banqueRattachee):null;
    return`<tr>
      <td>${OP_ICONS[c.op]||'📱'} <b>${c.nom}</b></td>
      <td>${c.op}</td>
      <td style="font-size:.78rem;font-family:monospace">${c.num||'—'}</td>
      <td class="amt ${(c.solde||0)>=0?'pos':'neg'}">${fmt(c.solde)}</td>
      <td><span class="badge ${c.tetePont?'bg':'ba'}">${c.tetePont?'✓ Tête de pont':'—'}</span></td>
      <td style="font-size:.78rem;color:var(--text2)">${banque?banque.nom:'—'}</td>
      <td><button class="btn btn-ghost btn-xs" onclick="editCompte('${c.id}')">✏️</button>
      <button class="btn btn-red btn-xs" onclick="delCompte('${c.id}')">✕</button></td>
    </tr>`;
  }).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text3)">Aucun compte MM configuré</td></tr>';
}
window.renderAdminMMTetes=renderAdminMMTetes;

function renderAdminMMPDV(){
  document.getElementById('mmPDVTbody').innerHTML=pdvs.map(p=>{
    const soldeOM=p.soldeOM||0,soldeMTN=p.soldeMTN||0,soldeWave=p.soldeWave||0,soldeMoov=p.soldeMoov||0;
    const totalMM=soldeOM+soldeMTN+soldeWave+soldeMoov;
    const caisseLocale=p.caisseLocaleNom?`💵 ${p.caisseLocaleNom}${p.caisseLocaleSolde?` — <b style="color:var(--amber)">${fmt(p.caisseLocaleSolde)} FCFA</b>`:''}`:'-';
    const banqueLocale=p.banqueLocaleNom?`🏦 ${p.banqueLocaleNom}${p.banqueLocaleNum?`<br><span style="font-family:monospace;font-size:.7rem;color:var(--text3)">${p.banqueLocaleNum}</span>`:''}`:'-';
    return`<tr>
      <td><b>${p.nom}</b><br><span class="badge ${p.type==='principale'?'bg':'bb'}" style="font-size:.6rem">${p.type}</span></td>
      <td style="font-size:.78rem">
        ${p.numOM?`<div style="font-family:monospace;color:var(--text2)">${p.numOM}</div>`:'—'}
        ${soldeOM?`<div style="color:var(--amber);font-weight:700">${fmt(soldeOM)} FCFA</div>`:''}
      </td>
      <td style="font-size:.78rem">
        ${p.numMTN?`<div style="font-family:monospace;color:var(--text2)">${p.numMTN}</div>`:'—'}
        ${soldeMTN?`<div style="color:var(--amber);font-weight:700">${fmt(soldeMTN)} FCFA</div>`:''}
      </td>
      <td style="font-size:.78rem">
        ${p.numWave?`<div style="font-family:monospace;color:var(--text2)">${p.numWave}</div>`:'—'}
        ${soldeWave?`<div style="color:var(--cyan);font-weight:700">${fmt(soldeWave)} FCFA</div>`:''}
      </td>
      <td style="font-size:.78rem">
        ${p.numMoov?`<div style="font-family:monospace;color:var(--text2)">${p.numMoov}</div>`:'—'}
        ${soldeMoov?`<div style="color:var(--green);font-weight:700">${fmt(soldeMoov)} FCFA</div>`:''}
      </td>
      <td style="font-weight:700;color:${totalMM>0?'var(--amber)':'var(--text3)'}">${totalMM>0?fmt(totalMM)+' FCFA':'—'}</td>
      <td style="font-size:.75rem">${caisseLocale}</td>
      <td style="font-size:.75rem">${banqueLocale}</td>
      <td><button class="btn btn-ghost btn-xs" onclick="editPDV('${p.id}')">✏️</button></td>
    </tr>`;
  }).join('');
  const totalGeneral=pdvs.reduce((s,p)=>(s+(p.soldeOM||0)+(p.soldeMTN||0)+(p.soldeWave||0)+(p.soldeMoov||0)),0);
  const tfootEl=document.getElementById('mmPDVTfoot');
  if(tfootEl)tfootEl.innerHTML=`<tr style="background:var(--surface2);font-weight:700">
    <td colspan="5">TOTAL MM EN CIRCULATION (PDV)</td>
    <td style="color:var(--amber);font-size:1rem">${fmt(totalGeneral)} FCFA</td>
    <td colspan="3"></td>
  </tr>`;
}
window.renderAdminMMPDV=renderAdminMMPDV;

function imprimerConfig(section){
  const titres={pdv:'Points de Vente',banques:'Banques & Caisses',mmtetes:'Mobile Money — Têtes de Pont','mm-pdv':'Mobile Money — Numéros PDV'};
  let html='';
  if(section==='pdv'){
    html=`<h2>Points de Vente</h2><table border="1" cellpadding="6" style="width:100%;border-collapse:collapse;font-size:10pt">
      <tr style="background:#f0f0f0"><th>Nom</th><th>Type</th><th>Responsable</th><th>Fréquence</th><th>N° OM</th><th>N° MTN</th><th>N° Wave</th><th>N° Moov</th></tr>
      ${pdvs.map(p=>`<tr><td>${p.nom}</td><td>${p.type}</td><td>${p.resp||'—'}</td><td>${p.freq}</td><td>${p.numOM||'—'}</td><td>${p.numMTN||'—'}</td><td>${p.numWave||'—'}</td><td>${p.numMoov||'—'}</td></tr>`).join('')}
    </table>`;
  } else if(section==='banques'){
    html=`<h2>Banques & Caisses</h2><table border="1" cellpadding="6" style="width:100%;border-collapse:collapse;font-size:10pt">
      <tr style="background:#f0f0f0"><th>Nom</th><th>Opérateur</th><th>N° Compte / RIB</th><th>Notes</th><th>Solde actuel</th></tr>
      ${comptes.filter(c=>c.cat==='banque'||c.cat==='caisse').map(c=>`<tr><td>${c.nom}</td><td>${c.op}</td><td>${c.num||'—'}</td><td>${c.notes||'—'}</td><td>${fmt(c.solde)} FCFA</td></tr>`).join('')}
    </table>`;
  } else if(section==='mm-tetes'){
    html=`<h2>Mobile Money — Têtes de Pont</h2><table border="1" cellpadding="6" style="width:100%;border-collapse:collapse;font-size:10pt">
      <tr style="background:#f0f0f0"><th>Nom</th><th>Opérateur</th><th>N° Wallet</th><th>Solde</th><th>Tête de pont</th><th>Banque rattachée</th></tr>
      ${comptes.filter(c=>c.cat==='mobile_money').map(c=>{const b=c.banqueRattachee?comptes.find(x=>x.id===c.banqueRattachee):null;return`<tr><td>${c.nom}</td><td>${c.op}</td><td>${c.num||'—'}</td><td>${fmt(c.solde)} FCFA</td><td>${c.tetePont?'Oui':'Non'}</td><td>${b?b.nom:'—'}</td></tr>`;}).join('')}
    </table>`;
  } else if(section==='mm-pdv'){
    html=`<h2>Mobile Money — Numéros par PDV</h2><table border="1" cellpadding="6" style="width:100%;border-collapse:collapse;font-size:10pt">
      <tr style="background:#f0f0f0"><th>PDV</th><th>🟠 Orange Money</th><th>🟡 MTN MoMo</th><th>🔵 Wave</th><th>🟢 Moov Money</th></tr>
      ${pdvs.map(p=>`<tr><td><b>${p.nom}</b><br><small>${p.type}</small></td><td>${p.numOM||'—'}</td><td>${p.numMTN||'—'}</td><td>${p.numWave||'—'}</td><td>${p.numMoov||'—'}</td></tr>`).join('')}
    </table>`;
  }
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Configuration — ${PHARMACIE_NOM}</title>
  <style>body{font-family:Arial,sans-serif;padding:20px;color:#111}h2{color:#00C47A;margin-bottom:12px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0}th,td{border:1px solid #ccc;padding:6px 8px;font-size:10pt}.footer{margin-top:20px;font-size:8pt;color:#999;text-align:center}@media print{body{padding:10px}}</style>
  </head><body>
  <div style="text-align:right;font-size:9pt;color:#666">${PHARMACIE_NOM} — Imprimé le ${new Date().toLocaleString('fr-FR')}</div>
  ${html}
  <div class="footer">PharmaCash Pro — Document confidentiel</div>
  <script>window.onload=()=>window.print()<\/script>
  </body></html>`);
  w.document.close();
}
window.imprimerConfig=imprimerConfig;

// PDV CRUD
function onPDVFreqChange(){
  const v=document.getElementById('mPDVFreq').value;
  const showJours=['hebdomadaire','bimensuel','bihebdomadaire'].includes(v);
  document.getElementById('pdvJoursWrap').style.display=showJours?'block':'none';
  document.getElementById('pdvJourMoisWrap').style.display=v==='mensuel'?'block':'none';
}
window.onPDVFreqChange=onPDVFreqChange;
function openPDVModal(id){
  document.getElementById('mPDVTitle').textContent=id?'Modifier PDV':'Nouveau PDV';
  document.getElementById('mPDVId').value=id||'';
  document.getElementById('mPDVCompte').innerHTML='<option value="">— Aucun —</option>'+comptes.map(c=>`<option value="${c.id}">${c.nom}</option>`).join('');
  document.getElementById('mPDVBanque').innerHTML='<option value="">— Aucune —</option>'+comptes.filter(c=>c.cat==='banque'&&c.actif!==false).map(c=>`<option value="${c.id}">${c.nom}</option>`).join('');
  document.getElementById('mPDVCaisse').innerHTML='<option value="">— Aucune —</option>'+comptes.filter(c=>c.cat==='caisse'&&c.actif!==false).map(c=>`<option value="${c.id}">${c.nom}</option>`).join('');
  const p=id?pdvs.find(x=>x.id===id):{};
  document.getElementById('mPDVNom').value=p.nom||'';
  document.getElementById('mPDVType').value=p.type||'principale';
  document.getElementById('mPDVAddr').value=p.addr||'';
  document.getElementById('mPDVResp').value=p.resp||'';
  document.getElementById('mPDVFreq').value=p.freq||'quotidien';
  document.getElementById('mPDVHeure').value=p.heure||'';
  document.getElementById('mPDVTel').value=p.tel||'';
  document.getElementById('mPDVCompte').value=p.compteDefaut||'';
  document.getElementById('mPDVBanque').value=p.banqueDirecte||'';
  document.getElementById('mPDVCaisse').value=p.caisseDirecte||'';
  document.getElementById('mPDVCaisseLocaleNom').value=p.caisseLocaleNom||'';
  document.getElementById('mPDVCaisseLocaleSolde').value=p.caisseLocaleSolde||0;
  document.getElementById('mPDVBanqueLocaleNom').value=p.banqueLocaleNom||'';
  document.getElementById('mPDVBanqueLocaleNum').value=p.banqueLocaleNum||'';
  document.getElementById('mPDVJourMois').value=p.jourMois||'';
  document.getElementById('mPDVNotes').value=p.notes||'';
  document.getElementById('mPDVNumOM').value=p.numOM||'';
  document.getElementById('mPDVNumMTN').value=p.numMTN||'';
  document.getElementById('mPDVNumWave').value=p.numWave||'';
  document.getElementById('mPDVNumMoov').value=p.numMoov||'';
  document.querySelectorAll('.pdv-jour').forEach(cb=>{cb.checked=p.jours?p.jours.includes(parseInt(cb.value)):false;});
  onPDVFreqChange();openM('mPDV');
}
window.openPDVModal=openPDVModal;
function editPDV(id){openPDVModal(id);}
window.editPDV=editPDV;
async function savePDV(){
  const nom=document.getElementById('mPDVNom').value.trim();if(!nom){toast('Nom obligatoire','err');return;}
  const id=document.getElementById('mPDVId').value;
  const jours=[...document.querySelectorAll('.pdv-jour:checked')].map(cb=>parseInt(cb.value));
  const data={nom,type:document.getElementById('mPDVType').value,
    addr:document.getElementById('mPDVAddr').value,
    resp:document.getElementById('mPDVResp').value,
    freq:document.getElementById('mPDVFreq').value,
    heure:document.getElementById('mPDVHeure').value,
    tel:document.getElementById('mPDVTel').value,
    compteDefaut:document.getElementById('mPDVCompte').value,
    jourMois:document.getElementById('mPDVJourMois').value,
    jours,notes:document.getElementById('mPDVNotes').value,
    numOM:document.getElementById('mPDVNumOM').value.trim(),
    numMTN:document.getElementById('mPDVNumMTN').value.trim(),
    numWave:document.getElementById('mPDVNumWave').value.trim(),
    numMoov:document.getElementById('mPDVNumMoov').value.trim(),
    banqueDirecte:document.getElementById('mPDVBanque').value,
    caisseDirecte:document.getElementById('mPDVCaisse').value,
    caisseLocaleNom:document.getElementById('mPDVCaisseLocaleNom').value.trim(),
    caisseLocaleSolde:parseFloat(document.getElementById('mPDVCaisseLocaleSolde').value)||0,
    banqueLocaleNom:document.getElementById('mPDVBanqueLocaleNom').value.trim(),
    banqueLocaleNum:document.getElementById('mPDVBanqueLocaleNum').value.trim()};
  if(id){Object.assign(pdvs.find(p=>p.id===id),data);await saveItem('pdvs',pdvs.find(p=>p.id===id));}
  else{data.id=uid();pdvs.push(data);await saveItem('pdvs',data);}
  populateSelects();closeM('mPDV');renderAdmin();toast('PDV enregistré ✓');
}
window.savePDV=savePDV;
async function delPDV(id){
  if(!confirm('Supprimer ce PDV ?'))return;
  pdvs=pdvs.filter(p=>p.id!==id);await delItem('pdvs',id);populateSelects();renderAdmin();toast('Supprimé','info');
}
window.delPDV=delPDV;

// COMPTES CRUD — avec actif/inactif (v4)
function onTetePontChange(){
  const checked=document.getElementById('mCptTetePont').checked;
  document.getElementById('mCptBanqueRow').style.display=checked?'block':'none';
  if(checked){
    const banques=comptes.filter(c=>c.cat==='banque'&&c.actif!==false);
    document.getElementById('mCptBanqueRattachee').innerHTML=
      '<option value="">— Sélectionner une banque —</option>'+
      banques.map(b=>`<option value="${b.id}">${b.nom}</option>`).join('');
  }
}
window.onTetePontChange=onTetePontChange;
function onCptOpChange(){
  const op=document.getElementById('mCptOp').value;
  document.getElementById('mCptOpLibre').style.display=op==='AUTRE'?'block':'none';
  const cm={OM:'#ff6b00',MTN:'#f5a623',WAVE:'#22d3ee',MOOV:'#00d68f',CASH:'#00d68f',
    BICICI:'#4d8af0',SGBCI:'#4d8af0',ECOBANK:'#a855f7',UBA:'#f05050',BNI:'#22d3ee',
    NSIA:'#4d8af0',SIB:'#4d8af0',CORIS:'#a855f7',BOA:'#4d8af0'};
  if(cm[op])document.getElementById('mCptColor').value=cm[op];
  const mm=['OM','MTN','WAVE','MOOV'],bk=['BICICI','SGBCI','ECOBANK','UBA','BNI','NSIA','SIB','CORIS','BOA'];
  if(mm.includes(op))document.getElementById('mCptCat').value='mobile_money';
  else if(bk.includes(op))document.getElementById('mCptCat').value='banque';
  else if(op==='CASH')document.getElementById('mCptCat').value='caisse';
}
window.onCptOpChange=onCptOpChange;
function onCptCatChange(){if(document.getElementById('mCptCat').value==='caisse')document.getElementById('mCptOp').value='CASH';}
window.onCptCatChange=onCptCatChange;
function openCompteModal(id){
  document.getElementById('mCptTitle').textContent=id?'Modifier compte':'Nouveau compte financier';
  document.getElementById('mCptId').value=id||'';
  const c=id?comptes.find(x=>x.id===id):{};
  document.getElementById('mCptNom').value=c.nom||'';
  document.getElementById('mCptCat').value=c.cat||'mobile_money';
  document.getElementById('mCptOp').value=c.op||'OM';
  document.getElementById('mCptOpLibre').value=c.opLibre||'';
  document.getElementById('mCptOpLibre').style.display=c.op==='AUTRE'?'block':'none';
  document.getElementById('mCptNum').value=c.num||'';
  document.getElementById('mCptContact').value=c.contact||'';
  document.getElementById('mCptSolde').value=c.soldeInit||0;
  document.getElementById('mCptColor').value=c.color||'#4d8af0';
  document.getElementById('mCptNotes').value=c.notes||'';
  const actifEl=document.getElementById('mCptActif');if(actifEl)actifEl.checked=c.actif!==false;
  // Tête de pont
  const tetePont=document.getElementById('mCptTetePont');
  if(tetePont){
    tetePont.checked=c.tetePont||false;
    document.getElementById('mCptBanqueRow').style.display=c.tetePont?'block':'none';
    if(c.tetePont){
      const banques=comptes.filter(b=>b.cat==='banque'&&b.actif!==false);
      document.getElementById('mCptBanqueRattachee').innerHTML=
        '<option value="">— Sélectionner une banque —</option>'+
        banques.map(b=>`<option value="${b.id}"${c.banqueRattachee===b.id?' selected':''}>${b.nom}</option>`).join('');
    }
  }
  openM('mCompte');
}
window.openCompteModal=openCompteModal;
function editCompte(id){openCompteModal(id);}
window.editCompte=editCompte;
async function saveCompte(){
  const nom=document.getElementById('mCptNom').value.trim();if(!nom){toast('Nom obligatoire','err');return;}
  const id=document.getElementById('mCptId').value;const soldeInit=parseFloat(document.getElementById('mCptSolde').value)||0;
  const op=document.getElementById('mCptOp').value;
  const actifEl=document.getElementById('mCptActif');
  const tetePont=document.getElementById('mCptTetePont')?.checked||false;
  const banqueRattachee=tetePont?document.getElementById('mCptBanqueRattachee')?.value||'':'';
  const data={nom,cat:document.getElementById('mCptCat').value,op,
    opLibre:op==='AUTRE'?document.getElementById('mCptOpLibre').value:'',
    num:document.getElementById('mCptNum').value,contact:document.getElementById('mCptContact').value,
    soldeInit,color:document.getElementById('mCptColor').value,notes:document.getElementById('mCptNotes').value,
    actif:actifEl?actifEl.checked:true,tetePont,banqueRattachee};
  if(id){const c=comptes.find(x=>x.id===id);const diff=soldeInit-c.soldeInit;c.solde=(c.solde||0)+diff;Object.assign(c,data);await saveItem('comptes',c);}
  else{data.id=uid();data.solde=soldeInit;comptes.push(data);await saveItem('comptes',data);}
  populateSelects();closeM('mCompte');renderAdmin();toast('Compte enregistré ✓');renderDashboard();
}
window.saveCompte=saveCompte;
async function delCompte(id){
  if(!confirm('Supprimer ce compte ?'))return;
  comptes=comptes.filter(c=>c.id!==id);await delItem('comptes',id);populateSelects();renderAdmin();toast('Supprimé','info');
}
window.delCompte=delCompte;

// UTILISATEURS
function renderUsers(){
  document.getElementById('userTbody').innerHTML=users.map(u=>`<tr>
    <td><b>${u.nom}</b></td><td style="color:var(--text2);font-size:.8rem;font-family:monospace">${u.login}</td>
    <td><span class="badge ${u.role==='admin'?'ba':u.role==='collaborateur'?'bb':'bg'}">${u.role}</span></td>
    <td style="font-size:.78rem;color:var(--text2)">${u.pdv?pdvs.find(p=>p.id===u.pdv)?.nom||u.pdv:'Tous'}</td>
    <td style="font-size:.75rem;color:var(--text2)">${u.lastLogin?new Date(u.lastLogin).toLocaleString('fr-FR'):'Jamais'}</td>
    <td><span class="badge ${u.actif!==false?'bg':'br'}">${u.actif!==false?'Actif':'Inactif'}</span></td>
    <td>${u.id!==currentUser.id?`<button class="btn btn-ghost btn-xs" onclick="editUser('${u.id}')">✏️</button>
    <button class="btn btn-${u.actif!==false?'amber':'ghost'} btn-xs" onclick="toggleUser('${u.id}')">${u.actif!==false?'Désactiver':'Activer'}</button>`:'<span style="font-size:.72rem;color:var(--text3)">Vous</span>'}</td>
  </tr>`).join('');
}
window.renderUsers=renderUsers;
function openUserModal(id){
  document.getElementById('mUserTitle').textContent=id?'Modifier':'Nouvel utilisateur';
  document.getElementById('mUserId').value=id||'';const u=id?users.find(x=>x.id===id):{};
  document.getElementById('mUNom').value=u.nom||'';document.getElementById('mULogin').value=u.login||'';
  document.getElementById('mUPass').value='';document.getElementById('mURole').value=u.role||'collaborateur';
  document.getElementById('mUTel').value=u.tel||'';
  document.getElementById('mUPDV').innerHTML='<option value="">Tous</option>'+pdvs.map(p=>`<option value="${p.id}"${u.pdv===p.id?' selected':''}>${p.nom}</option>`).join('');
  openM('mUser');
}
window.openUserModal=openUserModal;
function editUser(id){openUserModal(id);}
window.editUser=editUser;
async function saveUser(){
  const nom=document.getElementById('mUNom').value.trim(),login=document.getElementById('mULogin').value.trim(),pass=document.getElementById('mUPass').value;
  if(!nom||!login){toast('Nom et login obligatoires','err');return;}
  const id=document.getElementById('mUserId').value;
  if(!id&&!pass){toast('Mot de passe obligatoire','err');return;}
  if(!id&&users.find(u=>u.login===login)){toast('Login déjà utilisé','err');return;}
  const data={nom,login,role:document.getElementById('mURole').value,pdv:document.getElementById('mUPDV').value,tel:document.getElementById('mUTel').value,actif:true};
  if(pass)data.pass=pass;
  if(id){Object.assign(users.find(u=>u.id===id),data);await saveItem('users',users.find(u=>u.id===id));}
  else{data.id=uid();data.lastLogin=null;users.push(data);await saveItem('users',data);}
  closeM('mUser');renderUsers();toast('Utilisateur enregistré ✓');
}
window.saveUser=saveUser;
async function toggleUser(id){
  const u=users.find(x=>x.id===id);if(!u)return;
  u.actif=!u.actif;await saveItem('users',u);renderUsers();toast(u.actif?'Activé':'Désactivé');
}
window.toggleUser=toggleUser;

// ── TYPE RECETTE "À CRÉDIT" (Principale uniquement) ──
function onRTypeChange(){
  const type=document.getElementById('mRType').value;
  const pdvEl=document.getElementById('mRPDV');
  if(type==='credit'){
    const principale=pdvs.find(p=>p.type==='principale');
    if(principale){ pdvEl.value=principale.id; pdvEl.disabled=true; }
    document.getElementById('mRCreditNote').style.display='block';
  } else {
    pdvEl.disabled=false;
    document.getElementById('mRCreditNote').style.display='none';
  }
}
window.onRTypeChange=onRTypeChange;

// ══════════════════════════════════════════════════════
// PETITE CAISSE (v4.1)
// ══════════════════════════════════════════════════════
function renderPetiteCaisse(){
  const cptPC=comptes.find(c=>c.nom.toLowerCase().includes('petite'));
  const soldeInit=cptPC?.soldeInit||0;
  const mvtsPC=petiteCaisse.reduce((s,m)=>s+(m.type==='appro'?m.montant:-(m.montant||0)),0);
  const solde=soldeInit+mvtsPC;
  const tbody=document.getElementById('pcTbody');
  el('pcSolde',fmt(solde)+' '+DEVISE);
  const soldeEl=document.getElementById('pcSoldeEl');
  if(soldeEl)soldeEl.style.color=solde>=0?'var(--green)':'var(--red)';
  const mois=today().slice(0,7);
  const dataMois=petiteCaisse.filter(m=>m.date?.slice(0,7)===mois);
  const entrees=dataMois.filter(m=>m.type==='appro').reduce((s,m)=>s+(m.montant||0),0);
  const sorties=dataMois.filter(m=>m.type==='depense'||m.type==='dépense').reduce((s,m)=>s+(m.montant||0),0);
  renderSoldeHeader('pcResumeHeader',{
    soldeActuel:solde, compteId:cptPC?.id,
    entrées:entrees, sorties:sorties,
    label:'Petite Caisse', couleur:'var(--amber)'
  });
  if(!tbody)return;

  // Peupler filtre catégories
  const categSel=document.getElementById('fPCCateg');
  if(categSel){
    const categs=[...new Set(petiteCaisse.map(m=>m.categorie).filter(Boolean))].sort();
    const valAct=categSel.value;
    categSel.innerHTML='<option value="">Toutes catégories</option>'+categs.map(c=>`<option value="${c}">${c}</option>`).join('');
    if(valAct)categSel.value=valAct;
  }

  // Appliquer filtres
  const dF=document.getElementById('fPCDate')?.value;
  const tF=document.getElementById('fPCType')?.value;
  const cF=document.getElementById('fPCCateg')?.value;
  const sF=document.getElementById('fPCSearch')?.value?.toLowerCase();
  let data=[...petiteCaisse].sort((a,b)=>b.date?.localeCompare(a.date||'')||0);
  if(dF)data=data.filter(m=>m.date===dF);
  if(tF)data=data.filter(m=>m.type===tF||(tF==='depense'&&m.type==='dépense'));
  if(cF)data=data.filter(m=>m.categorie===cF);
  if(sF)data=data.filter(m=>(m.libelle||'').toLowerCase().includes(sF));

  if(!data.length){
    tbody.innerHTML=`<tr><td colspan="9"><div class="empty-state"><div class="ei">💰</div>${petiteCaisse.length?'Aucun résultat pour ces filtres':'Aucun mouvement petite caisse'}</div></td></tr>`;
    return;
  }

  // Recalcul soldes chronologiques depuis soldeInit
  const allChronologique=[...petiteCaisse].sort((a,b)=>a.date?.localeCompare(b.date||'')||0);
  let running=soldeInit;
  const soldesPC={};
  for(const m of allChronologique){
    running+=m.type==='appro'?m.montant:-(m.montant||0);
    soldesPC[m.id]=running;
  }

  // Sous-total filtré
  const hasFilter=dF||tF||cF||sF;
  const totFiltre=data.reduce((s,m)=>s+(m.type==='appro'?m.montant:-(m.montant||0)),0);
  const sousTotalHtml=hasFilter?`
    <tr style="background:var(--surface2);font-weight:700;font-size:.78rem">
      <td colspan="5" style="text-align:right;padding:6px 10px;color:var(--text2)">${data.length} opération(s) filtrée(s)</td>
      <td class="amt ${totFiltre>=0?'pos':'neg'}">${totFiltre>=0?'+':''}${fmt(Math.abs(totFiltre))}</td>
      <td colspan="3"></td>
    </tr>`:'';
  tbody.innerHTML=data.map((m,i)=>`<tr>
    ${rowNum(i)}
    <td>${fmtD(m.date)} ${m.heure||''}</td>
    <td><span class="badge ${m.type==='appro'?'bg':'br'}">${m.type==='appro'?'Approvisionnement':'Dépense'}</span></td>
    <td style="font-size:.82rem">${m.libelle||'—'}</td>
    <td style="font-size:.78rem;color:var(--text2)">${m.categorie||'—'}</td>
    <td class="amt ${m.type==='appro'?'pos':'neg'}">${m.type==='appro'?'+':'-'}${fmt(m.montant)}</td>
    <td class="amt ${(soldesPC[m.id]||0)>=0?'':'neg'}">${fmt(soldesPC[m.id]||0)}</td>
    <td style="font-size:.68rem;color:var(--text3);font-family:monospace">${m.ref||'—'}</td>
    <td style="font-size:.75rem;color:var(--text2)">${m.saisie||'—'}</td>
    <td><button class="btn btn-red btn-xs" onclick="delPCMvt('${m.id}')" title="Supprimer">✕</button></td>
  </tr>`).join('') + sousTotalHtml;
}
async function delPCMvt(id){
  if(!confirm('Supprimer ce mouvement petite caisse ?'))return;
  const m=petiteCaisse.find(x=>x.id===id);
  if(!m)return;
  // Si appro avec compte débité — recrédite le compte source
  if(m.type==='appro'&&m.caisseSource){
    const c=comptes.find(x=>x.id===m.caisseSource);
    if(c){c.solde=(c.solde||0)+m.montant;await saveItem('comptes',c);}
  }
  petiteCaisse=petiteCaisse.filter(x=>x.id!==id);
  await delItem('petiteCaisse',id);
  renderPetiteCaisse();renderDashboard();
  toast('Mouvement supprimé ✓');
}
window.delPCMvt=delPCMvt;

function openPCModal(type){
  document.getElementById('pcMType').value=type;
  document.getElementById('pcMTitle').textContent=type==='appro'?'Approvisionnement petite caisse':'Dépense petite caisse';
  document.getElementById('pcMDate').value=today();
  document.getElementById('pcMMontant').value='';
  document.getElementById('pcMLibelle').value='';
  document.getElementById('pcMCategorie').value=type==='appro'?'approvisionnement':'autre';
  document.getElementById('pcMSaisie').value=currentUser.nom;
  document.getElementById('pcResponsable').value='';
  document.getElementById('pcBenefNom').value='';
  document.getElementById('pcBenefCNI').value='';
  document.getElementById('pcBenefTel').value='';
  document.getElementById('pcBenefType').value='Particulier';
  document.getElementById('pcModePaiement').value='Espèces';
  // Appro : affiche seulement le compte à débiter, cache tout le reste
  document.getElementById('pcCaisseSource').style.display=type==='appro'?'block':'none';
  document.getElementById('pcBenefSection').style.display=type==='appro'?'none':'block';
  document.getElementById('pcModePaiementRow').style.display=type==='appro'?'none':'flex';
  document.getElementById('pcResponsableRow').style.display=type==='appro'?'none':'flex';
  document.getElementById('pcCategorieRow').style.display=type==='appro'?'none':'flex';
  const caisseId=document.getElementById('pcCaisseId');
  if(type==='appro'&&caisseId){
    // ── Exclure les comptes Mobile Money — un appro PC vient toujours d'espèces ou d'une banque ──
    const comptesDisponibles=comptes.filter(c=>c.actif!==false&&c.cat!=='mobile_money');
    caisseId.innerHTML='<option value="">— Report / Solde antérieur (sans débit) —</option>'+
      comptesDisponibles
      .map(c=>`<option value="${c.id}">${c.nom} — ${fmt(c.solde||0)} ${DEVISE}</option>`).join('');
  }
  openM('mPetiteCaisse');
}
window.openPCModal=openPCModal;

function onPCCategorieChange(){
  const sel=document.getElementById('pcMCategorie');
  if(sel.value==='__custom__'){
    const n=prompt('Nouvelle catégorie :');
    if(n&&n.trim()){
      const opt=document.createElement('option');
      opt.value=n.trim().toLowerCase();
      opt.textContent=n.trim();
      opt.selected=true;
      sel.insertBefore(opt,sel.lastElementChild);
      sel.value=opt.value;
    } else {
      sel.value='autre';
    }
  }
}
window.onPCCategorieChange=onPCCategorieChange;

let _pcSaving=false;
async function savePCMouvement(){
  if(_pcSaving){toast('Enregistrement en cours…','info');return;}
  _pcSaving=true;
  try{
    const type=document.getElementById('pcMType').value;
    const date=document.getElementById('pcMDate').value;
    const montant=parseFloat(document.getElementById('pcMMontant').value);
    const libelle=document.getElementById('pcMLibelle').value.trim();
    if(!date||!montant){toast('Date et montant obligatoires','err');return;}
    // Référence unique automatique : date + heure + random
    const now=new Date();
    const refAuto=`PC-${date.replace(/-/g,'')}-${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}${now.getSeconds().toString().padStart(2,'0')}-${Math.random().toString(36).slice(2,5).toUpperCase()}`;
    // Anti-doublons général : même libellé + même montant + même date (sans limite de temps)
    const recently=petiteCaisse.filter(m=>m.date===date&&m.montant===montant&&m.type===type&&m.libelle===libelle);
    if(recently.length>0){
      if(!confirm(`⚠️ Doublon détecté !\nUne opération identique existe déjà :\n${recently[0].ref||''} — ${fmtD(date)} — ${libelle} — ${fmt(montant)} ${DEVISE}\n\nConfirmer quand même ?`)){_pcSaving=false;return;}
    }
    const benef_nom=document.getElementById('pcBenefNom')?.value.trim()||'';
    const benef_type=document.getElementById('pcBenefType')?.value||'Particulier';
    const benef_cni=document.getElementById('pcBenefCNI')?.value.trim()||'';
    const benef_tel=document.getElementById('pcBenefTel')?.value.trim()||'';
    const responsable=document.getElementById('pcResponsable')?.value.trim()||currentUser.nom;
    const modePaiement=document.getElementById('pcModePaiement')?.value||'Espèces';
    // Si appro : débite la caisse principale
    if(type==='appro'){
      const caisseEl=document.getElementById('pcCaisseId');
      if(caisseEl&&caisseEl.value){
        const c=comptes.find(x=>x.id===caisseEl.value);
        if(c){
          // ── GARDE-FOU 1 : interdit de débiter un compte Mobile Money ──
          if(c.cat==='mobile_money'){
            toast(`❌ Impossible d'approvisionner la Petite Caisse depuis un compte Mobile Money (${c.nom}). Utilise un compte Banque ou Caisse espèces.`,'err');
            _pcSaving=false;return;
          }
          // ── GARDE-FOU 2 : interdit de mettre le compte source en négatif ──
          if((c.solde||0) < montant){
            toast(`❌ Solde insuffisant sur "${c.nom}" — Disponible : ${fmt(c.solde||0)} ${DEVISE}, demandé : ${fmt(montant)} ${DEVISE}`,'err');
            _pcSaving=false;return;
          }
          c.solde=(c.solde||0)-montant;
          await saveItem('comptes',c);
          const m={id:uid(),date,compte:c.id,type:'sortie',
            libelle:`Appro petite caisse${libelle?' — '+libelle:''}`,
            ref:refAuto,montant,soldeApres:c.solde,saisie:currentUser.nom,ts:Date.now()};
          mvts.push(m);await saveItem('mvts',m);
        }
      }
    }
    const caisseSourceId=document.getElementById('pcCaisseId')?.value||'';
    const item={id:uid(),date,heure:`${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`,
      type,libelle,ref:refAuto,
      categorie:document.getElementById('pcMCategorie').value,
      modePaiement,responsable,caisseSource:caisseSourceId,
      benef_nom,benef_type,benef_cni,benef_tel,
      montant,saisie:currentUser.nom,notes:'',ts:Date.now()};
    petiteCaisse.push(item);await saveItem('petiteCaisse',item);
    closeM('mPetiteCaisse');
    toast(type==='appro'?`Approvisionnement enregistré ✓ — Réf: ${refAuto}`:`Dépense enregistrée ✓ — Réf: ${refAuto}`);
    renderPetiteCaisse();renderDashboard();
    // Générer reçu automatiquement pour les dépenses
    if(type==='depense'){
      if(confirm('Imprimer le reçu de caisse ?')){
        genererRecuCaisse({
          date,heure:item.heure,libelle,
          categorie:item.categorie,
          modePaiement,ref:refAuto,
          montant,typeRecu:'Dépense petite caisse',
          caisse:'Petite caisse',
          responsable,benef_nom,benef_type,benef_cni,benef_tel
        });
      }
    }
  } finally {
    _pcSaving=false;
  }
}
window.savePCMouvement=savePCMouvement;

// ══════════════════════════════════════════════════════
// SUIVI CAISSIÈRES (v4.1)
// ══════════════════════════════════════════════════════
function renderSuiviCaissiere(){
  const periode=document.getElementById('scPeriode')?.value||'mois';
  const t=today();
  let debut,fin;
  if(periode==='jour'){debut=t;fin=t;}
  else if(periode==='semaine'){const b=weekBounds(t);debut=b.start;fin=b.end;}
  else if(periode==='mois'){debut=t.slice(0,7)+'-01';fin=t;}
  else{debut=document.getElementById('scDebut')?.value||t;fin=document.getElementById('scFin')?.value||t;}
  // Groupe les clôtures par caissière
  const dayC=clotures.filter(c=>c.date>=debut&&c.date<=fin);
  const byCaissiere={};
  dayC.forEach(c=>{
    if(!byCaissiere[c.caissiere])byCaissiere[c.caissiere]={nom:c.caissiere,totalMachine:0,cashVerse:0,mmVerse:0,totalVerse:0,ecart:0,nb:0};
    const b=byCaissiere[c.caissiere];
    b.totalMachine+=(c.totalMachine||0);
    b.cashVerse+=(c.cashVerse||0);
    b.mmVerse+=(c.omVerse||0)+(c.mtnVerse||0)+(c.waveVerse||0)+(c.moovVerse||0);
    b.totalVerse+=(c.totalVerse||0);
    b.ecart+=(c.ecart||0);
    b.nb++;
  });
  const tbody=document.getElementById('scTbody');
  if(!tbody)return;
  const data=Object.values(byCaissiere).sort((a,b)=>b.totalVerse-a.totalVerse);
  if(!data.length){tbody.innerHTML='<tr><td colspan="7"><div class="empty-state"><div class="ei">👤</div>Aucune donnée pour cette période</div></td></tr>';return;}
  tbody.innerHTML=data.map((c,i)=>{
    const ecC=c.ecart===0?'amt pos':c.ecart<0?'amt neg':'amt neu';
    return`<tr>
      ${rowNum(i)}
      <td><b>${c.nom}</b></td>
      <td class="amt" style="color:var(--blue)">${fmt(c.totalMachine)}</td>
      <td class="amt pos">${fmt(c.cashVerse)}</td>
      <td class="amt pos">${fmt(c.mmVerse)}</td>
      <td class="amt pos">${fmt(c.totalVerse)}</td>
      <td class="${ecC}">${c.ecart>0?'+':c.ecart<0?'−':''}${fmt(Math.abs(c.ecart))}</td>
      <td style="color:var(--text2);font-size:.8rem">${c.nb} vacation(s)</td>
    </tr>`;
  }).join('');
  // Totaux
  const tot={totalMachine:0,cashVerse:0,mmVerse:0,totalVerse:0,ecart:0};
  data.forEach(c=>{tot.totalMachine+=c.totalMachine;tot.cashVerse+=c.cashVerse;tot.mmVerse+=c.mmVerse;tot.totalVerse+=c.totalVerse;tot.ecart+=c.ecart;});
  tbody.innerHTML+=`<tr style="background:var(--surface2);font-weight:700">
    <td>TOTAL</td>
    <td class="amt" style="color:var(--blue)">${fmt(tot.totalMachine)}</td>
    <td class="amt pos">${fmt(tot.cashVerse)}</td>
    <td class="amt pos">${fmt(tot.mmVerse)}</td>
    <td class="amt pos">${fmt(tot.totalVerse)}</td>
    <td class="${tot.ecart===0?'amt pos':tot.ecart<0?'amt neg':'amt neu'}">${tot.ecart>0?'+':tot.ecart<0?'−':''}${fmt(Math.abs(tot.ecart))}</td>
    <td></td>
  </tr>`;
}
window.renderSuiviCaissiere=renderSuiviCaissiere;

function onSCPeriodeChange(){
  const p=document.getElementById('scPeriode').value;
  document.getElementById('scCustomDates').style.display=p==='custom'?'flex':'none';
  renderSuiviCaissiere();
}
window.onSCPeriodeChange=onSCPeriodeChange;

// ══════════════════════════════════════════════════════
// RELEVÉS REFONDUS — 3 types (v4.1)
// ══════════════════════════════════════════════════════
function renderReleves(){
  // Populate selects
  const relPDV=document.getElementById('relPDV');
  const relCompte=document.getElementById('relCompte');
  if(relPDV)relPDV.innerHTML='<option value="">Tous les PDV</option>'+pdvs.map(p=>`<option value="${p.id}">${p.nom}</option>`).join('');
  if(relCompte)relCompte.innerHTML='<option value="">Tous les comptes</option>'+comptes.map(c=>`<option value="${c.id}">${c.nom}</option>`).join('');
  const type=document.getElementById('relType')?.value||'pdv';
  onRelTypeChange(type);
}
window.renderReleves=renderReleves;

function onRelTypeChange(type){
  if(!type)type=document.getElementById('relType')?.value||'pdv';
  // Affiche/masque les filtres selon le type
  const pdvRow=document.getElementById('relPDVRow');
  const cptRow=document.getElementById('relCptRow');
  if(pdvRow)pdvRow.style.display=(type==='pdv')?'flex':'none';
  if(cptRow)cptRow.style.display=(type==='compte')?'flex':'none';
  genererReleve();
}
window.onRelTypeChange=onRelTypeChange;

function genererReleve(){
  const t=today();
  const type=document.getElementById('relType')?.value||'pdv';
  const p=document.getElementById('relPeriode')?.value||'mois';
  let debut,fin;
  if(p==='jour'){debut=t;fin=t;}
  else if(p==='semaine'){const b=weekBounds(t);debut=b.start;fin=b.end;}
  else if(p==='mois'){debut=t.slice(0,7)+'-01';fin=t;}
  else{debut=document.getElementById('relDebut')?.value||t;fin=document.getElementById('relFin')?.value||t;}
  const pdvF=document.getElementById('relPDV')?.value;
  const cptF=document.getElementById('relCompte')?.value;
  const preview=document.getElementById('relevePreview');
  if(!preview)return;

  if(type==='pdv'){
    // ── RELEVÉ PAR PDV ──
    const recF=recettes.filter(r=>r.date>=debut&&r.date<=fin&&(!pdvF||r.pdv===pdvF));
    const verF=versements.filter(v=>v.date>=debut&&v.date<=fin&&(!pdvF||v.pdv===pdvF));
    const totRec=recF.reduce((s,r)=>s+(r.montant||0),0);
    const totVer=verF.reduce((s,v)=>s+(v.montant||0),0);
    const totConf=verF.filter(v=>v.statut==='confirmé').reduce((s,v)=>s+(v.montant||0),0);
    window._releveData={type,debut,fin,pdvF,recF,verF,totRec,totVer,totConf};
    preview.innerHTML=_buildRelevePDV(debut,fin,pdvF,recF,verF,totRec,totVer,totConf);

  } else if(type==='compte'){
    // ── RELEVÉ PAR ÉTABLISSEMENT FINANCIER ──
    // Uniquement les mouvements financiers du compte — pas les versements PDV
    const cpt=comptes.find(c=>c.id===cptF);
    const mvtF=mvts.filter(m=>m.date>=debut&&m.date<=fin&&(!cptF||m.compte===cptF))
      .sort((a,b)=>a.date?.localeCompare(b.date||'')||0);
    const trfF=transferts.filter(t=>t.date>=debut&&t.date<=fin&&(!cptF||t.compteSrc===cptF||t.compteDst===cptF))
      .sort((a,b)=>a.date?.localeCompare(b.date||'')||0);
    // Versements confirmés reçus sur ce compte (depuis les PDV)
    const verRecus=versements.filter(v=>v.date>=debut&&v.date<=fin&&v.statut==='confirmé'&&(!cptF||v.compte===cptF));
    window._releveData={type,debut,fin,cptF,cpt,mvtF,trfF,verRecus};
    preview.innerHTML=_buildRelEtablissement(debut,fin,cpt,mvtF,trfF,verRecus);

  } else {
    // ── RELEVÉ TRANSFERTS MM→BANQUE ──
    const trfF=transferts.filter(t=>t.date>=debut&&t.date<=fin);
    const totTrf=trfF.reduce((s,t)=>s+(t.montant||0),0);
    window._releveData={type,debut,fin,trfF,totTrf};
    preview.innerHTML=_buildRelTransferts(debut,fin,trfF,totTrf);
  }
}
window.genererReleve=genererReleve;

function _headerReleve(titre,debut,fin,sousTitre=''){
  return`<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:12px;border-bottom:2px solid #00C47A">
    <div>
      <div style="font-size:1.3rem;font-weight:800;color:#00C47A">${PHARMACIE_NOM}</div>
      <div style="font-size:1rem;font-weight:700;color:#111;margin-top:4px">${titre}</div>
      <div style="font-size:.85rem;color:#666;margin-top:2px">Période : ${fmtD(debut)} au ${fmtD(fin)}</div>
      ${sousTitre?`<div style="font-size:.8rem;color:#666">${sousTitre}</div>`:''}
    </div>
    <div style="text-align:right;font-size:.75rem;color:#999">Généré le ${new Date().toLocaleString('fr-FR')}</div>
  </div>`;
}

function _buildRelevePDV(debut,fin,pdvF,recF,verF,totRec,totVer,totConf){
  const pdvNom=pdvF?pdvs.find(p=>p.id===pdvF)?.nom||pdvF:'Tous les PDV';
  return`<div id="relevePrintZone" style="font-family:Arial,sans-serif;color:#111">
    ${_headerReleve('Relevé Recettes & Versements',debut,fin,'PDV : '+pdvNom)}
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px">
      ${[['Total recettes',totRec,'#00C47A'],['Total versé',totVer,'#4d8af0'],['Confirmé',totConf,'#a855f7']]
        .map(([l,v,c])=>`<div style="border:1px solid #eee;border-radius:8px;padding:12px;border-left:3px solid ${c}"><div style="font-size:.7rem;color:#999;text-transform:uppercase">${l}</div><div style="font-size:1.1rem;font-weight:800;color:${c}">${fmt(v)} ${DEVISE}</div></div>`).join('')}
    </div>
    ${recF.length?`<div style="margin-bottom:20px">
      <div style="font-weight:700;margin-bottom:8px;font-size:.85rem;text-transform:uppercase;color:#555">Recettes (${recF.length})</div>
      <table style="width:100%;border-collapse:collapse;font-size:.82rem">
        <thead><tr>${['Date','PDV','Canal','Type','Montant','Saisi par'].map(h=>`<th style="background:#f5f5f5;padding:7px 10px;text-align:left;border:1px solid #eee">${h}</th>`).join('')}</tr></thead>
        <tbody>${recF.map((r,i)=>`<tr style="background:${i%2?'#fafafa':'#fff'}">${[fmtD(r.date),pdvs.find(p=>p.id===r.pdv)?.nom||r.pdv,MM_LABEL[r.canal]||r.canal,r.type,fmt(r.montant)+' '+DEVISE,r.saisie||'—'].map(v=>`<td style="padding:6px 10px;border:1px solid #eee">${v}</td>`).join('')}</tr>`).join('')}
        <tr style="background:#e8f5f0;font-weight:700"><td colspan="4" style="padding:6px 10px;border:1px solid #ccc">TOTAL</td><td style="padding:6px 10px;border:1px solid #ccc;color:#00C47A">${fmt(totRec)} ${DEVISE}</td><td style="border:1px solid #ccc"></td></tr></tbody>
      </table></div>`:''}
    ${verF.length?`<div style="margin-bottom:20px">
      <div style="font-weight:700;margin-bottom:8px;font-size:.85rem;text-transform:uppercase;color:#555">Versements (${verF.length})</div>
      <table style="width:100%;border-collapse:collapse;font-size:.82rem">
        <thead><tr>${['Date','PDV','Type','Compte','Référence','Montant','Statut'].map(h=>`<th style="background:#f5f5f5;padding:7px 10px;text-align:left;border:1px solid #eee">${h}</th>`).join('')}</tr></thead>
        <tbody>${verF.map((v,i)=>{const cpt=comptes.find(c=>c.id===v.compte);return`<tr style="background:${i%2?'#fafafa':'#fff'}">${[fmtD(v.date),pdvs.find(p=>p.id===v.pdv)?.nom||v.pdv,MM_LABEL[v.type]||v.type,cpt?.nom||'—',v.ref||'—',fmt(v.montant)+' '+DEVISE,v.statut].map(x=>`<td style="padding:6px 10px;border:1px solid #eee">${x}</td>`).join('')}</tr>`;}).join('')}
        <tr style="background:#e8f0ff;font-weight:700"><td colspan="5" style="padding:6px 10px;border:1px solid #ccc">TOTAL</td><td style="padding:6px 10px;border:1px solid #ccc;color:#4d8af0">${fmt(totVer)} ${DEVISE}</td><td style="border:1px solid #ccc"></td></tr></tbody>
      </table></div>`:''}
    <div style="margin-top:30px;display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div style="border-top:1px solid #ccc;padding-top:8px;font-size:.82rem;color:#999">Signature Responsable</div>
      <div style="border-top:1px solid #ccc;padding-top:8px;font-size:.82rem;color:#999">Cachet & Signature Comptable</div>
    </div>
  </div>`;
}

function _buildRelEtablissement(debut,fin,cpt,mvtF,trfF,verRecus){
  const nom=cpt?cpt.nom:'Tous les comptes';
  const totEntrees=mvtF.filter(m=>m.type==='entrée').reduce((s,m)=>s+(m.montant||0),0)
    +trfF.filter(t=>t.compteDst===cpt?.id).reduce((s,t)=>s+(t.montant||0),0);
  const totSorties=mvtF.filter(m=>m.type==='sortie').reduce((s,m)=>s+(m.montant||0),0)
    +trfF.filter(t=>t.compteSrc===cpt?.id).reduce((s,t)=>s+(t.montant||0),0);
  const totVerRecus=verRecus.reduce((s,v)=>s+(v.montant||0),0);
  return`<div id="relevePrintZone" style="font-family:Arial,sans-serif;color:#111">
    ${_headerReleve('Relevé Établissement Financier',debut,fin,nom)}
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
      ${[['Entrées',totEntrees,'#00C47A'],['Sorties',totSorties,'#f05050'],
         ['Versements PDV reçus',totVerRecus,'#4d8af0'],['Solde actuel',cpt?.solde||0,'#a855f7']]
        .map(([l,v,c])=>`<div style="border:1px solid #eee;border-radius:8px;padding:10px;border-left:3px solid ${c}">
          <div style="font-size:.65rem;color:#999;text-transform:uppercase">${l}</div>
          <div style="font-size:1rem;font-weight:800;color:${c}">${fmt(v)} ${DEVISE}</div>
        </div>`).join('')}
    </div>

    ${verRecus.length?`<div style="margin-bottom:16px">
      <div style="font-weight:700;margin-bottom:8px;font-size:.82rem;text-transform:uppercase;color:#4d8af0;border-bottom:1px solid #eee;padding-bottom:4px">
        ↓ Versements reçus depuis les dépôts PDV (${verRecus.length})
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:.78rem">
        <thead><tr>${['Date','PDV','Type','Référence','Montant'].map(h=>`<th style="background:#f0f4ff;padding:6px 8px;text-align:left;border:1px solid #e0e8ff">${h}</th>`).join('')}</tr></thead>
        <tbody>${verRecus.map((v,i)=>`<tr style="background:${i%2?'#fafafa':'#fff'}">
          <td style="padding:5px 8px;border:1px solid #eee">${fmtD(v.date)}</td>
          <td style="padding:5px 8px;border:1px solid #eee">${pdvs.find(p=>p.id===v.pdv)?.nom||v.pdv}</td>
          <td style="padding:5px 8px;border:1px solid #eee">${MM_LABEL[v.type]||v.type}</td>
          <td style="padding:5px 8px;border:1px solid #eee">${v.ref||'—'}</td>
          <td style="padding:5px 8px;border:1px solid #eee;color:#4d8af0;font-weight:600">+${fmt(v.montant)} ${DEVISE}</td>
        </tr>`).join('')}
        <tr style="background:#e8f0ff;font-weight:700">
          <td colspan="4" style="padding:5px 8px;border:1px solid #ccc">TOTAL versements PDV</td>
          <td style="padding:5px 8px;border:1px solid #ccc;color:#4d8af0">+${fmt(totVerRecus)} ${DEVISE}</td>
        </tr></tbody>
      </table></div>`:''}

    ${mvtF.length||trfF.length?`<div style="margin-bottom:16px">
      <div style="font-weight:700;margin-bottom:8px;font-size:.82rem;text-transform:uppercase;color:#555;border-bottom:1px solid #eee;padding-bottom:4px">
        Journal des mouvements financiers (${mvtF.length+trfF.length})
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:.78rem">
        <thead><tr>${['Date','Type','Libellé','Référence','Montant','Solde après'].map(h=>`<th style="background:#f5f5f5;padding:6px 8px;text-align:left;border:1px solid #eee">${h}</th>`).join('')}</tr></thead>
        <tbody>
          ${[...mvtF.map(m=>({...m,_cat:'mvt'})),...trfF.map(t=>({...t,_cat:'trf'}))]
            .sort((a,b)=>a.date?.localeCompare(b.date||'')||0)
            .map((m,i)=>{
              const isEntree=m.type==='entrée'||(m._cat==='trf'&&m.compteDst===cpt?.id);
              const libelle=m._cat==='trf'?`🔄 Transfert ${isEntree?'reçu de':'vers'} ${comptes.find(c=>c.id===(isEntree?m.compteSrc:m.compteDst))?.nom||'—'}`:m.libelle||'—';
              return`<tr style="background:${i%2?'#fafafa':'#fff'}">
                <td style="padding:5px 8px;border:1px solid #eee">${fmtD(m.date)}</td>
                <td style="padding:5px 8px;border:1px solid #eee"><span style="color:${isEntree?'#00C47A':'#f05050'};font-weight:700">${isEntree?'↑ Entrée':'↓ Sortie'}</span></td>
                <td style="padding:5px 8px;border:1px solid #eee">${libelle}</td>
                <td style="padding:5px 8px;border:1px solid #eee">${m.ref||'—'}</td>
                <td style="padding:5px 8px;border:1px solid #eee;color:${isEntree?'#00C47A':'#f05050'};font-weight:600">${isEntree?'+':'-'}${fmt(m.montant)} ${DEVISE}</td>
                <td style="padding:5px 8px;border:1px solid #eee;font-weight:600">${fmt(m.soldeApres||0)} ${DEVISE}</td>
              </tr>`;
            }).join('')}
        </tbody>
      </table></div>`:'<div style="color:#999;text-align:center;padding:20px">Aucun mouvement sur cette période</div>'}

    <div style="margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div style="border-top:1px solid #ccc;padding-top:8px;font-size:.8rem;color:#999">Signature Responsable</div>
      <div style="border-top:1px solid #ccc;padding-top:8px;font-size:.8rem;color:#999">Cachet & Signature Comptable</div>
    </div>
  </div>`;
}

function _buildRelTransferts(debut,fin,trfF,totTrf){
  return`<div id="relevePrintZone" style="font-family:Arial,sans-serif;color:#111">
    ${_headerReleve('Relevé Transferts Mobile Money → Banque',debut,fin)}
    <div style="margin-bottom:16px;padding:12px;background:#fff8e1;border-radius:8px;border-left:3px solid #f5a623">
      <div style="font-size:.75rem;color:#b45309;text-transform:uppercase">Total transféré sur la période</div>
      <div style="font-size:1.3rem;font-weight:800;color:#b45309">${fmt(totTrf)} ${DEVISE}</div>
    </div>
    ${trfF.length?`<table style="width:100%;border-collapse:collapse;font-size:.82rem">
      <thead><tr>${['Date','Compte source (MM)','Compte dest. (Banque)','Référence','Montant','Saisi par'].map(h=>`<th style="background:#f5f5f5;padding:7px 10px;text-align:left;border:1px solid #eee">${h}</th>`).join('')}</tr></thead>
      <tbody>${trfF.map((t,i)=>{const src=comptes.find(c=>c.id===t.compteSrc),dst=comptes.find(c=>c.id===t.compteDst);return`<tr style="background:${i%2?'#fafafa':'#fff'}">${[fmtD(t.date),src?.nom||'—',dst?.nom||'—',t.ref||'—',fmt(t.montant)+' '+DEVISE,t.saisie||'—'].map(v=>`<td style="padding:6px 10px;border:1px solid #eee">${v}</td>`).join('')}</tr>`;}).join('')}
      <tr style="background:#fff8e1;font-weight:700"><td colspan="4" style="padding:6px 10px;border:1px solid #ccc">TOTAL</td><td style="padding:6px 10px;border:1px solid #ccc;color:#b45309">${fmt(totTrf)} ${DEVISE}</td><td style="border:1px solid #ccc"></td></tr>
      </tbody></table>`:'<div style="color:#999;text-align:center;padding:20px">Aucun transfert sur cette période</div>'}
  </div>`;
}

function onRelPeriodeChange(){
  const p=document.getElementById('relPeriode').value;
  document.getElementById('relCustomDates').style.display=p==='custom'?'flex':'none';
  genererReleve();
}
window.onRelPeriodeChange=onRelPeriodeChange;

function imprimerReleve(){
  const zone=document.getElementById('relevePrintZone');
  if(!zone){toast('Génère d\'abord le relevé','err');return;}
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Relevé ${PHARMACIE_NOM}</title>
    <style>body{font-family:Arial,sans-serif;margin:20px;color:#111}@media print{body{margin:10px}}</style>
    </head><body>${zone.innerHTML}<script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}
window.imprimerReleve=imprimerReleve;

function exporterReleveExcel(){
  const d=window._releveData;if(!d){toast('Génère d\'abord le relevé','err');return;}
  const rows=[[PHARMACIE_NOM],[`Relevé du ${fmtD(d.debut)} au ${fmtD(d.fin)}`],[]];
  if(d.type==='pdv'){
    rows.push(['=== RECETTES ==='],['Date','PDV','Canal','Type','Montant','Saisi par']);
    (d.recF||[]).forEach(r=>rows.push([fmtD(r.date),pdvs.find(p=>p.id===r.pdv)?.nom||r.pdv,MM_LABEL[r.canal]||r.canal,r.type,r.montant,r.saisie||'']));
    rows.push(['TOTAL','','','',d.totRec],[]);
    rows.push(['=== VERSEMENTS ==='],['Date','PDV','Type','Compte','Référence','Montant','Statut']);
    (d.verF||[]).forEach(v=>{const cpt=comptes.find(c=>c.id===v.compte);rows.push([fmtD(v.date),pdvs.find(p=>p.id===v.pdv)?.nom||v.pdv,MM_LABEL[v.type]||v.type,cpt?.nom||'',v.ref||'',v.montant,v.statut]);});
    rows.push(['TOTAL','','','','',d.totVer]);
  } else if(d.type==='compte'){
    rows.push([`Compte : ${d.cpt?.nom||'Tous'}`],[]);
    rows.push(['=== MOUVEMENTS ==='],['Date','Type','Libellé','Référence','Montant','Solde après']);
    (d.mvtF||[]).forEach(m=>rows.push([fmtD(m.date),m.type,m.libelle||'',m.ref||'',m.type==='entrée'?m.montant:-m.montant,m.soldeApres||0]));
  } else {
    rows.push(['=== TRANSFERTS MM→BANQUE ==='],['Date','Compte source','Compte dest.','Référence','Montant']);
    (d.trfF||[]).forEach(t=>{const src=comptes.find(c=>c.id===t.compteSrc),dst=comptes.find(c=>c.id===t.compteDst);rows.push([fmtD(t.date),src?.nom||'',dst?.nom||'',t.ref||'',t.montant]);});
    rows.push(['TOTAL','','','',d.totTrf]);
  }
  const csv=rows.map(r=>r.map(cell=>{const s=String(cell??'').replace(/"/g,'""');return s.includes(';')||s.includes('"')?`"${s}"`:s;}).join(';')).join('\n');
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`releve_${d.debut}_${d.fin}.csv`;a.click();URL.revokeObjectURL(a.href);
  toast('Export Excel (.csv) téléchargé ✓');
}
window.exporterReleveExcel=exporterReleveExcel;

function exporterReleveWord(){
  const zone=document.getElementById('relevePrintZone');
  if(!zone){toast('Génère d\'abord le relevé','err');return;}
  const d=window._releveData;
  const html=`<!DOCTYPE html><html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset="UTF-8"><title>Relevé</title><style>body{font-family:Arial,sans-serif;font-size:11pt}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:5pt 8pt;font-size:10pt}th{background:#f0f0f0;font-weight:bold}</style></head><body>${zone.innerHTML}</body></html>`;
  const blob=new Blob([html],{type:'application/msword;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`releve_${d?.debut||today()}_${d?.fin||today()}.doc`;
  a.click();URL.revokeObjectURL(a.href);toast('Export Word (.doc) téléchargé ✓');
}
window.exporterReleveWord=exporterReleveWord;

// ══════════════════════════════════════════════════════
// IMPORT EXCEL — PharmaCash_Import_Demarrage.xlsx
// ══════════════════════════════════════════════════════

// Charge SheetJS dynamiquement
async function loadSheetJS(){
  if(window.XLSX) return window.XLSX;
  return new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload=()=>resolve(window.XLSX);
    s.onerror=()=>reject(new Error('Impossible de charger SheetJS'));
    document.head.appendChild(s);
  });
}

async function importerExcel(e){
  const file=e.target.files[0]; if(!file)return;
  e.target.value='';

  // Vérifie extension
  if(!file.name.match(/\.(xlsx|xls)$/i)){
    toast('Sélectionne un fichier .xlsx','err'); return;
  }

  toast('Lecture du fichier Excel…','info');

  try{
    const XLSX=await loadSheetJS();
    const buf=await file.arrayBuffer();
    const wb=XLSX.read(buf,{type:'array',cellDates:true});

    // ── Lecture d'une feuille en tableau d'objets ──
    const readSheet=(name)=>{
      const ws=wb.Sheets[name];
      if(!ws)return[];
      // Skip ligne 1 (titre) et ligne 2 (instructions) → header = ligne 3
      return XLSX.utils.sheet_to_json(ws,{range:2,defval:''});
    };

    // ── Normalise une valeur date ──
    const normDate=v=>{
      if(!v)return '';
      if(v instanceof Date) return v.toISOString().split('T')[0];
      const s=String(v).trim();
      // AAAA-MM-JJ
      if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      // JJ/MM/AAAA
      const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if(m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
      return s;
    };

    const normStr=v=>String(v||'').trim();
    const normNum=v=>parseFloat(String(v).replace(/\s/g,'').replace(',','.'))||0;
    const normBool=v=>normStr(v).toLowerCase()!=='non';

    // ── PDV ──
    const pdvSheet=readSheet('📍 PDV');
    const newPDVs=pdvSheet.filter(r=>normStr(r['Nom du PDV *'])).map(r=>({
      id: normStr(r['ID (auto)'])||uid(),
      nom: normStr(r['Nom du PDV *']),
      type: normStr(r['Type *'])||'depot',
      addr: normStr(r['Adresse']),
      resp: normStr(r['Responsable']),
      tel: normStr(r['Téléphone']),
      freq: normStr(r['Fréquence versement *'])||'quotidien',
      heure: normStr(r['Heure limite']),
      jours: normStr(r['Jours (1=Lun…7=Dim)']).split(',').map(x=>parseInt(x.trim())).filter(n=>!isNaN(n)),
      jourMois: normStr(r['Jour du mois']),
      compteDefaut: normStr(r['ID Compte défaut']),
      notes: normStr(r['Notes / Instructions'])
    }));

    // ── COMPTES ──
    const cptSheet=readSheet('🏦 Comptes');
    const newComptes=cptSheet.filter(r=>normStr(r['Nom du compte *'])).map(r=>{
      const soldeInit=normNum(r['Solde initial (FCFA) *']);
      return{
        id: normStr(r['ID (auto)'])||uid(),
        nom: normStr(r['Nom du compte *']),
        cat: normStr(r['Catégorie *'])||'mobile_money',
        op: normStr(r['Opérateur / Banque *'])||'AUTRE',
        opLibre: normStr(r['Nom libre (si Autre)']),
        num: normStr(r['N° compte / Wallet']),
        contact: normStr(r['Titulaire / Contact']),
        soldeInit, solde: soldeInit,
        color: normStr(r['Couleur hex'])||'#4d8af0',
        notes: normStr(r['Notes']),
        actif: normBool(r['Actif (oui/non)'])
      };
    });

    // ── UTILISATEURS ──
    const usrSheet=readSheet('👥 Utilisateurs');
    const newUsers=usrSheet.filter(r=>normStr(r['Login (identifiant) *'])).map(r=>({
      id: normStr(r['ID (auto)'])||uid(),
      nom: normStr(r['Nom complet *']),
      login: normStr(r['Login (identifiant) *']),
      pass: normStr(r['Mot de passe *']),
      role: normStr(r['Rôle *'])||'collaborateur',
      pdv: normStr(r['ID PDV assigné']),
      tel: normStr(r['Téléphone']),
      actif: normBool(r['Actif (oui/non)']),
      lastLogin: null
    }));

    // ── RECETTES ──
    const recSheet=readSheet('🧾 Recettes');
    const newRecettes=recSheet.filter(r=>normStr(r['ID PDV *'])&&normNum(r['Montant (FCFA) *'])>0).map(r=>({
      id: normStr(r['ID (auto)'])||uid(),
      date: normDate(r['Date (JJ/MM/AAAA) *']),
      heure: normStr(r['Heure (HH:MM)'])||'08:00',
      pdv: normStr(r['ID PDV *']),
      type: normStr(r['Type de recette *'])||'vente comptoir',
      canal: normStr(r['Canal de paiement *'])||'CASH',
      montant: normNum(r['Montant (FCFA) *']),
      ref: normStr(r['Référence / SMS']),
      saisie: normStr(r['Saisi par'])||'Import Excel',
      notes: normStr(r['Notes']),
      ts: Date.now()
    }));

    // ── VERSEMENTS ──
    const verSheet=readSheet('💸 Versements');
    const newVersements=verSheet.filter(r=>normStr(r['ID PDV *'])&&normNum(r['Montant (FCFA) *'])>0).map(r=>({
      id: normStr(r['ID (auto)'])||uid(),
      date: normDate(r['Date (AAAA-MM-JJ) *']),
      pdv: normStr(r['ID PDV *']),
      freq: normStr(r['Fréquence'])||'quotidien',
      type: normStr(r['Type de versement *'])||'CASH',
      compte: normStr(r['ID Compte destinataire *']),
      ref: normStr(r['Référence transaction']),
      montant: normNum(r['Montant (FCFA) *']),
      statut: normStr(r['Statut *'])||'en attente',
      saisie: normStr(r['Saisi par'])||'Import Excel',
      notes: normStr(r['Notes']),
      ts: Date.now()
    }));

    // ── Résumé avant confirmation ──
    const resume=[
      `📍 ${newPDVs.length} point(s) de vente`,
      `🏦 ${newComptes.length} compte(s) financier(s)`,
      `👥 ${newUsers.length} utilisateur(s)`,
      `🧾 ${newRecettes.length} recette(s)`,
      `💸 ${newVersements.length} versement(s)`,
    ].join('\n');

    if(!newPDVs.length&&!newComptes.length&&!newUsers.length){
      toast('Aucune donnée valide trouvée dans le fichier','err'); return;
    }

    if(!confirm(`Importer depuis "${file.name}" ?\n\n${resume}\n\n⚠️ Les données existantes seront fusionnées (pas effacées).`)) return;

    sync('syncing','Import en cours…');
    toast('Import en cours…','info');

    // ── Fusion intelligente (ne supprime pas l'existant) ──
    // PDV : remplace si même ID, sinon ajoute
    for(const p of newPDVs){
      const idx=pdvs.findIndex(x=>x.id===p.id);
      if(idx>-1) pdvs[idx]={...pdvs[idx],...p}; else pdvs.push(p);
      await saveItem('pdvs',pdvs.find(x=>x.id===p.id));
    }
    // Comptes
    for(const c of newComptes){
      const idx=comptes.findIndex(x=>x.id===c.id);
      if(idx>-1) comptes[idx]={...comptes[idx],...c}; else comptes.push(c);
      await saveItem('comptes',comptes.find(x=>x.id===c.id));
    }
    // Users
    for(const u of newUsers){
      // Ne remplace pas le mot de passe si vide ou placeholder
      const existing=users.find(x=>x.id===u.id||x.login===u.login);
      if(existing){
        if(!u.pass||u.pass.includes('[TON_MOT_DE_PASSE]')) u.pass=existing.pass;
        Object.assign(existing,u);
        await saveItem('users',existing);
      } else {
        if(u.pass&&!u.pass.includes('[TON_MOT_DE_PASSE]')) users.push(u);
        else { toast(`⚠️ Utilisateur "${u.nom}" ignoré : mot de passe manquant`,'err'); continue; }
        await saveItem('users',u);
      }
    }
    // Recettes
    for(const r of newRecettes){
      if(!recettes.find(x=>x.id===r.id)){ recettes.push(r); await saveItem('recettes',r); }
    }
    // Versements
    for(const v of newVersements){
      if(!versements.find(x=>x.id===v.id)){ versements.push(v); await saveItem('versements',v); }
    }

    saveLocal();
    populateSelects();
    renderDashboard();
    sync('ok','🔴 Temps réel');
    closeM('mBackup');

    toast(`✅ Import réussi ! ${newPDVs.length} PDV · ${newComptes.length} comptes · ${newUsers.length} utilisateurs · ${newRecettes.length} recettes · ${newVersements.length} versements`);

  }catch(err){
    console.error('Import Excel error:',err);
    sync('error','Erreur');
    toast('Erreur import : '+err.message,'err');
  }
}
window.importerExcel=importerExcel;

// ══════════════════════════════════════════════════════
// IMPRESSION TABLEAU DE BORD
// ══════════════════════════════════════════════════════
function imprimerDashboard() {
  const t = today();
  const now = new Date().toLocaleString('fr-FR');
  const mois = t.slice(0, 7);

  // KPI
  const todayR = recettes.filter(r => r.date === t);
  const totalJ = todayR.reduce((s,r) => s + (r.montant||0), 0);
  const totalM = recettes.filter(r => r.date?.slice(0,7) === mois).reduce((s,r) => s + (r.montant||0), 0);
  const enAtt  = versements.filter(v => v.statut === 'en attente').reduce((s,v) => s + (v.montant||0), 0);
  const totConf = versements.filter(v => v.statut === 'confirmé' && v.date?.slice(0,7) === mois).reduce((s,v) => s + (v.montant||0), 0);
  const dispo  = totalDispo();
  const transit = totalTransit();

  // Soldes par compte
  const comptesHtml = comptes.filter(c => c.actif !== false).map(c => `
    <tr>
      <td>${c.nom}</td>
      <td>${c.cat === 'mobile_money' ? 'Mobile Money' : c.cat === 'banque' ? 'Banque' : 'Caisse'}</td>
      <td>${c.op === 'AUTRE' && c.opLibre ? c.opLibre : c.op}</td>
      <td style="text-align:right;font-weight:700;color:${(c.solde||0) >= 0 ? '#00C47A' : '#f05050'}">${fmt(c.solde||0)} ${DEVISE}</td>
      <td style="text-align:center">${c.cat === 'mobile_money' ? '⏳ En transit' : '✓ Disponible'}</td>
    </tr>`).join('');

  // Derniers versements
  const dernVers = [...versements].sort((a,b) => (b.ts||0)-(a.ts||0)).slice(0,10);
  const versHtml = dernVers.map(v => {
    const pdvNom = pdvs.find(p => p.id === v.pdv)?.nom || v.pdv;
    const cptNom = comptes.find(c => c.id === v.compte)?.nom || '—';
    return `<tr>
      <td>${fmtD(v.date)}</td>
      <td>${pdvNom}</td>
      <td>${MM_LABEL[v.type||v.canal]||v.type||v.canal}</td>
      <td style="text-align:right;font-weight:700;color:#00C47A">${fmt(v.montant)} ${DEVISE}</td>
      <td style="text-align:center"><span style="padding:2px 8px;border-radius:10px;font-size:8pt;background:${v.statut==='confirmé'?'#e8f5f0':v.statut==='en attente'?'#fff8e1':'#f0f0f0'};color:${v.statut==='confirmé'?'#00C47A':v.statut==='en attente'?'#b45309':'#666'}">${v.statut}</span></td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Tableau de bord — ${PHARMACIE_NOM}</title>
  <style>
    @page{size:A4;margin:12mm}
    body{font-family:Arial,sans-serif;font-size:9pt;color:#111;margin:0}
    .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #00C47A;padding-bottom:10px;margin-bottom:14px}
    .pharma{font-size:14pt;font-weight:800;color:#00C47A}.titre{font-size:11pt;font-weight:700;margin-top:3px}
    .meta{font-size:7.5pt;color:#999}
    .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}
    .kpi{border:1px solid #eee;border-radius:6px;padding:10px;border-left:3px solid}
    .kpi-label{font-size:7pt;color:#999;text-transform:uppercase;letter-spacing:.5px}
    .kpi-val{font-size:13pt;font-weight:800;margin-top:3px}
    .kpi-sub{font-size:7pt;color:#999;margin-top:2px}
    h3{font-size:9pt;text-transform:uppercase;letter-spacing:.7px;color:#555;margin:12px 0 6px;border-bottom:1px solid #eee;padding-bottom:4px}
    table{width:100%;border-collapse:collapse;font-size:8.5pt;margin-bottom:12px}
    th{background:#f5f5f5;padding:5px 8px;text-align:left;border:1px solid #ddd;font-size:7.5pt;text-transform:uppercase}
    td{padding:5px 8px;border:1px solid #eee}
    tr:nth-child(even) td{background:#fafafa}
    .footer{margin-top:10px;font-size:7pt;color:#bbb;text-align:center;border-top:1px solid #eee;padding-top:6px}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body>
  <div class="header">
    <div>
      <div class="pharma">${PHARMACIE_NOM}</div>
      <div class="titre">Tableau de bord — Synthèse financière</div>
      <div class="meta">Imprimé le ${now}</div>
    </div>
    <div style="text-align:right">
      <div class="meta">Période : ${fmtD(t.slice(0,7)+'-01')} au ${fmtD(t)}</div>
      <div class="meta">Généré par : ${currentUser?.nom || 'administrateur'}</div>
    </div>
  </div>

  <div class="kpis">
    <div class="kpi" style="border-left-color:#00C47A"><div class="kpi-label">Recettes aujourd'hui</div><div class="kpi-val" style="color:#00C47A">${fmt(totalJ)}</div><div class="kpi-sub">${DEVISE} — ${todayR.length} opération(s)</div></div>
    <div class="kpi" style="border-left-color:#4d8af0"><div class="kpi-label">Recettes ce mois</div><div class="kpi-val" style="color:#4d8af0">${fmt(totalM)}</div><div class="kpi-sub">${DEVISE}</div></div>
    <div class="kpi" style="border-left-color:#f5a623"><div class="kpi-label">Versements en attente</div><div class="kpi-val" style="color:#f5a623">${fmt(enAtt)}</div><div class="kpi-sub">${DEVISE}</div></div>
    <div class="kpi" style="border-left-color:#a855f7"><div class="kpi-label">Confirmés ce mois</div><div class="kpi-val" style="color:#a855f7">${fmt(totConf)}</div><div class="kpi-sub">${DEVISE}</div></div>
    <div class="kpi" style="border-left-color:#00C47A"><div class="kpi-label">✓ Disponible (Banques)</div><div class="kpi-val" style="color:#00C47A">${fmt(dispo)}</div><div class="kpi-sub">${DEVISE}</div></div>
    <div class="kpi" style="border-left-color:#f5a623"><div class="kpi-label">⏳ En transit (MM)</div><div class="kpi-val" style="color:#f5a623">${fmt(transit)}</div><div class="kpi-sub">${DEVISE}</div></div>
  </div>

  <h3>Soldes par établissement financier</h3>
  <table>
    <thead><tr><th>Compte</th><th>Type</th><th>Opérateur</th><th style="text-align:right">Solde actuel</th><th style="text-align:center">Statut</th></tr></thead>
    <tbody>${comptesHtml}</tbody>
    <tr style="background:#e8f5f0;font-weight:700">
      <td colspan="3">TOTAL DISPONIBLE (Banques + Caisses)</td>
      <td style="text-align:right;color:#00C47A">${fmt(dispo)} ${DEVISE}</td><td></td>
    </tr>
    <tr style="background:#fff8e1;font-weight:700">
      <td colspan="3">TOTAL EN TRANSIT (Mobile Money)</td>
      <td style="text-align:right;color:#f5a623">${fmt(transit)} ${DEVISE}</td><td></td>
    </tr>
  </table>

  <h3>Derniers versements (10 récents)</h3>
  <table>
    <thead><tr><th>Date</th><th>PDV</th><th>Type</th><th style="text-align:right">Montant</th><th style="text-align:center">Statut</th></tr></thead>
    <tbody>${versHtml || '<tr><td colspan="5" style="text-align:center;color:#999">Aucun versement</td></tr>'}</tbody>
  </table>

  <div class="footer">PharmaCash Pro — Document confidentiel — ${PHARMACIE_NOM} — ${now}</div>
  <script>window.onload=()=>window.print()<\/script>
  </body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}
window.imprimerDashboard = imprimerDashboard;

function exportDashboard(format) {
  const t = today(), mois = t.slice(0,7);
  const totalJ = recettes.filter(r=>r.date===t).reduce((s,r)=>s+(r.montant||0),0);
  const totalM = recettes.filter(r=>r.date?.slice(0,7)===mois).reduce((s,r)=>s+(r.montant||0),0);
  const enAtt  = versements.filter(v=>v.statut==='en attente').reduce((s,v)=>s+(v.montant||0),0);
  const totConf= versements.filter(v=>v.statut==='confirmé'&&v.date?.slice(0,7)===mois).reduce((s,v)=>s+(v.montant||0),0);

  const lignesKPI = [
    ['Indicateur','Valeur','Devise'],
    ['Recettes aujourd\'hui', totalJ, DEVISE],
    ['Recettes ce mois', totalM, DEVISE],
    ['Versements en attente', enAtt, DEVISE],
    ['Versements confirmés ce mois', totConf, DEVISE],
    ['Total disponible (Banques)', totalDispo(), DEVISE],
    ['Total en transit (MM)', totalTransit(), DEVISE],
  ];
  const lignesComptes = comptes.filter(c=>c.actif!==false).map(c=>[
    c.nom,
    c.cat==='mobile_money'?'Mobile Money':c.cat==='banque'?'Banque':'Caisse',
    c.op==='AUTRE'&&c.opLibre?c.opLibre:c.op,
    c.solde||0,
    c.cat==='mobile_money'?'En transit':'Disponible'
  ]);
  exportUniversel('Tableau de bord',
    ['Compte','Type','Opérateur','Solde (FCFA)','Statut'],
    lignesComptes,
    {format, periode:`Au ${fmtD(t)}`,
     totaux:[['TOTAL DISPONIBLE','','',fmt(totalDispo()),''],['TOTAL EN TRANSIT','','',fmt(totalTransit()),'']]}
  );
}
window.exportDashboard = exportDashboard;

// ── Navigation rapide Dashboard → Versements ou Recettes PDV+Canal ──
function ouvrirVersementsPDV(pdvId, canal) {
  goTo('versements');
  setTimeout(() => {
    const fPDV=document.getElementById('fVPDV');
    const fType=document.getElementById('fVType');
    if(fPDV)fPDV.value=pdvId;
    if(fType)fType.value=canal;
    renderVersements();
    document.getElementById('verTbody')?.closest('.card')?.scrollIntoView({behavior:'smooth',block:'start'});
    const nomPDV=pdvs.find(p=>p.id===pdvId)?.nom||pdvId;
    toast(`💸 Versements — ${nomPDV} · ${MM_LABEL[canal]||canal}`);
  }, 100);
}
window.ouvrirVersementsPDV=ouvrirVersementsPDV;

function ouvrirRecettesPDV(pdvId, canal) {
  goTo('recettes');
  setTimeout(() => {
    const fPDV=document.getElementById('fRPDV');
    const fCanal=document.getElementById('fRCanal');
    if(fPDV)fPDV.value=pdvId;
    if(fCanal)fCanal.value=canal;
    renderRecettes();
    document.getElementById('recTbody')?.closest('.card')?.scrollIntoView({behavior:'smooth',block:'start'});
    const nomPDV=pdvs.find(p=>p.id===pdvId)?.nom||pdvId;
    toast(`🧾 Recettes — ${nomPDV} · ${MM_LABEL[canal]||canal}`);
  }, 100);
}
window.ouvrirRecettesPDV=ouvrirRecettesPDV;
// ══════════════════════════════════════════════════════

// ── Détail opérations depuis la page RAN ─────────────
function ouvrirDetailCompteRAN(compteId, nomCompte) {
  const debut = today().slice(0,7) + '-01';
  const fin = today();
  const mois = today().slice(0,7);

  // Récupérer les mouvements du compte
  const mvtsCpt = mvts.filter(m =>
    (m.compte === compteId || m.compteSrc === compteId || m.compteDst === compteId)
    && m.date >= debut && m.date <= fin
  ).sort((a,b) => a.date.localeCompare(b.date));

  // Versements confirmés vers ce compte
  const versCpt = versements.filter(v =>
    v.compte === compteId && v.statut === 'confirmé'
    && v.date >= debut && v.date <= fin
  ).sort((a,b) => a.date.localeCompare(b.date));

  const totEntrees = mvtsCpt.filter(m=>m.type==='entrée').reduce((s,m)=>s+(m.montant||0),0);
  const totSorties = mvtsCpt.filter(m=>m.type==='sortie').reduce((s,m)=>s+(m.montant||0),0);
  const totVers = versCpt.reduce((s,v)=>s+(v.montant||0),0);

  // RAN du compte
  const ran = rapportsNouveaux.find(r => r.compteId === compteId && r.periode === mois);
  const soldeOuv = ran ? ran.soldeOuverture : null;
  const cpt = comptes.find(c => c.id === compteId);
  const soldeAct = cpt?.solde || 0;

  const mvtsHtml = mvtsCpt.length
    ? mvtsCpt.map((m,i) => `<tr>
        <td style="color:var(--text3);font-size:.68rem;text-align:right">${i+1}</td>
        <td>${fmtD(m.date)}</td>
        <td><span class="badge ${m.type==='entrée'?'bg':'br'}" style="font-size:.65rem">${m.type==='entrée'?'↑ Entrée':'↓ Sortie'}</span></td>
        <td style="font-size:.78rem;color:var(--text2)">${m.rubrique||m.libelle||'—'}</td>
        <td style="font-size:.8rem">${m.libelle||'—'}</td>
        <td class="amt ${m.type==='entrée'?'pos':'neg'}">${m.type==='entrée'?'+':'-'}${fmt(m.montant)}</td>
        <td style="font-size:.72rem;color:var(--text3)">${m.saisie||'—'}</td>
      </tr>`).join('')
    : '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:14px">Aucun mouvement ce mois</td></tr>';

  const versHtml = versCpt.length
    ? versCpt.map((v,i) => {
        const pdvNom = pdvs.find(p=>p.id===v.pdv)?.nom || v.pdv;
        return `<tr>
          <td style="color:var(--text3);font-size:.68rem;text-align:right">${i+1}</td>
          <td>${fmtD(v.date)}</td>
          <td>${pdvBadge(v.pdv)}</td>
          <td>${mmBadge(v.type)}</td>
          <td class="amt pos">+${fmt(v.montant)}</td>
          <td style="font-size:.72rem;color:var(--text3)">${v.ref||'—'}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:14px">Aucun versement ce mois</td></tr>';

  const html = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:14px">
      <div class="stat-card" style="border-left:3px solid var(--text3)">
        <div class="stat-lbl">📅 Solde ouverture</div>
        <div class="stat-val" style="color:${soldeOuv!==null?(soldeOuv>=0?'var(--green)':'var(--red)'):'var(--text3)'}">
          ${soldeOuv!==null?fmt(soldeOuv):'—'}
        </div>
      </div>
      <div class="stat-card" style="border-left:3px solid var(--green)">
        <div class="stat-lbl">↑ Entrées</div>
        <div class="stat-val" style="color:var(--green)">${fmt(totEntrees)}</div>
      </div>
      <div class="stat-card" style="border-left:3px solid var(--red)">
        <div class="stat-lbl">↓ Sorties</div>
        <div class="stat-val" style="color:var(--red)">${fmt(totSorties)}</div>
      </div>
      ${totVers>0?`<div class="stat-card" style="border-left:3px solid var(--blue)">
        <div class="stat-lbl">💸 Versements PDV</div>
        <div class="stat-val" style="color:var(--blue)">${fmt(totVers)}</div>
      </div>`:''}
      <div class="stat-card" style="border-left:3px solid var(--amber)">
        <div class="stat-lbl">💰 Solde actuel</div>
        <div class="stat-val" style="color:${soldeAct>=0?'var(--amber)':'var(--red)'}">${fmt(soldeAct)}</div>
      </div>
    </div>
    ${mvtsCpt.length?`
    <div style="font-weight:700;color:var(--cyan);margin-bottom:6px;font-size:.85rem">📋 Mouvements du mois (${mvtsCpt.length})</div>
    <div class="tbl-wrap" style="margin-bottom:14px">
      <table><thead><tr><th>#</th><th>Date</th><th>Type</th><th>Rubrique</th><th>Libellé</th><th>Montant</th><th>Saisi par</th></tr></thead>
      <tbody>${mvtsHtml}</tbody>
      <tr style="background:var(--surface2);font-weight:700">
        <td colspan="5" style="text-align:right;padding:6px">NET</td>
        <td class="amt ${totEntrees-totSorties>=0?'pos':'neg'}">${totEntrees-totSorties>=0?'+':''}${fmt(totEntrees-totSorties)}</td>
        <td></td>
      </tr>
      </table>
    </div>`:''}
    ${versCpt.length?`
    <div style="font-weight:700;color:var(--blue);margin-bottom:6px;font-size:.85rem">💸 Versements PDV reçus (${versCpt.length})</div>
    <div class="tbl-wrap">
      <table><thead><tr><th>#</th><th>Date</th><th>PDV</th><th>Type</th><th>Montant</th><th>Réf.</th></tr></thead>
      <tbody>${versHtml}</tbody>
      </table>
    </div>`:''}
    ${!mvtsCpt.length&&!versCpt.length?'<div class="empty-state"><div class="ei">📊</div>Aucune opération ce mois sur ce compte</div>':''}`;

  afficherModalDetail(`📊 ${nomCompte} — ${fmtD(debut)} au ${fmtD(fin)}`, html);
}
window.ouvrirDetailCompteRAN = ouvrirDetailCompteRAN;
function getRAN(compteId, periode) {
  // periode = "YYYY-MM" (ex: "2026-07")
  return rapportsNouveaux.find(r => r.compteId === compteId && r.periode === periode);
}

// ── Calculer le 1er jour d'un mois ──────────────────
function debutMois(periode) {
  return periode + '-01';
}

// ── Capturer les RAN de tous les comptes pour un mois ─
async function capturerRANMois(periode, mode = 'AUTOMATIQUE') {
  // periode = "YYYY-MM"
  let nbNouveaux = 0, nbExistants = 0;

  for (const c of comptes.filter(c => c.actif !== false)) {
    const existant = getRAN(c.id, periode);
    if (existant && existant.verrouille) { nbExistants++; continue; }

    // Priorité 1 : soldeInit = solde d'ouverture importé depuis le fichier Excel
    // C'est la valeur la plus fiable pour le mois de démarrage
    // Priorité 2 : calcul à rebours depuis le solde actuel (mois suivants)
    let soldeRAN = 0;
    const debutPeriode = debutMois(periode);

    if (c.soldeInit !== undefined && c.soldeInit !== null) {
      // Utiliser directement le solde initial importé
      soldeRAN = c.soldeInit || 0;
    } else {
      // Calcul à rebours pour les mois suivants
      soldeRAN = c.solde || 0;
      const mvtsMois = mvts.filter(m => m.compte === c.id && m.date >= debutPeriode);
      const trfMois = transferts.filter(t =>
        (t.compteSrc === c.id || t.compteDst === c.id) && t.date >= debutPeriode
      );
      for (const m of mvtsMois) {
        if (m.type === 'entrée') soldeRAN -= (m.montant || 0);
        else if (m.type === 'sortie') soldeRAN += (m.montant || 0);
      }
      for (const t of trfMois) {
        if (t.compteSrc === c.id) soldeRAN += (t.montant || 0);
        if (t.compteDst === c.id) soldeRAN -= (t.montant || 0);
      }
      const versMois = versements.filter(v =>
        v.compte === c.id && v.statut === 'confirmé' && v.date >= debutPeriode
      );
      for (const v of versMois) soldeRAN -= (v.montant || 0);
    }

    const ran = {
      id: existant ? existant.id : uid(),
      compteId: c.id,
      compteNom: c.nom,
      compteCat: c.cat,
      periode,
      soldeOuverture: Math.round(soldeRAN),
      soldeActuel: c.solde || 0,
      devise: DEVISE,
      mode,
      verrouille: false,
      captureTimestamp: new Date().toISOString(),
      captureUser: currentUser?.nom || 'SYSTEM',
      pdvIds: pdvs.map(p => p.id), // associés à tous les PDV par défaut
    };

    if (existant) {
      const idx = rapportsNouveaux.findIndex(r => r.id === existant.id);
      rapportsNouveaux[idx] = ran;
    } else {
      rapportsNouveaux.push(ran);
      nbNouveaux++;
    }
    await saveItem('rapportsNouveaux', ran);
  }
  saveLocal();
  return { nbNouveaux, nbExistants };
}
window.capturerRANMois = capturerRANMois;

// ── Verrouiller tous les RAN d'une période ───────────
async function verrouillerRANPeriode(periode) {
  const rans = rapportsNouveaux.filter(r => r.periode === periode);
  for (const r of rans) {
    r.verrouille = true;
    r.verrouilleTimestamp = new Date().toISOString();
    r.verrouilleUser = currentUser?.nom || 'admin';
    await saveItem('rapportsNouveaux', r);
  }
  saveLocal();
  toast(`${rans.length} RAN verrouillés pour ${periode} ✓`);
  renderRAN();
}
window.verrouillerRANPeriode = verrouillerRANPeriode;

// ── Détecter les saisies rétroactives ────────────────
function detecterSaisiesRetroactives(periode) {
  // Mouvements saisis APRÈS le 1er du mois mais datés AVANT
  const debutPeriode = debutMois(periode);
  const retro = [];

  // mvts
  for (const m of mvts) {
    if (m.date < debutPeriode && m.ts) {
      const saisieLe = new Date(m.ts);
      const dateMvt = new Date(m.date);
      // Si saisi plus de 5 jours après la date du mouvement
      const diffJours = Math.floor((saisieLe - dateMvt) / 86400000);
      if (diffJours > 5) {
        retro.push({
          type: 'mouvement',
          id: m.id,
          date: m.date,
          saisieLe: saisieLe.toISOString().split('T')[0],
          diffJours,
          libelle: m.libelle || m.rubrique || '—',
          montant: m.montant,
          compte: comptes.find(c => c.id === m.compte)?.nom || '—',
          saisie: m.saisie || '—',
        });
      }
    }
  }

  // versements
  for (const v of versements) {
    if (v.date < debutPeriode && v.ts) {
      const saisieLe = new Date(v.ts);
      const dateV = new Date(v.date);
      const diffJours = Math.floor((saisieLe - dateV) / 86400000);
      if (diffJours > 5) {
        retro.push({
          type: 'versement',
          id: v.id,
          date: v.date,
          saisieLe: saisieLe.toISOString().split('T')[0],
          diffJours,
          libelle: `Versement ${MM_LABEL[v.type] || v.type}`,
          montant: v.montant,
          compte: comptes.find(c => c.id === v.compte)?.nom || '—',
          saisie: v.saisie || '—',
        });
      }
    }
  }
  return retro.sort((a, b) => b.diffJours - a.diffJours);
}

// ── Rendu de la page RAN ──────────────────────────────
function renderRAN() {
  const t = today();
  const periodeActuelle = t.slice(0, 7); // "YYYY-MM"

  // Sélecteur de période dans la page
  const selEl = document.getElementById('ranPeriode');
  const periode = selEl ? selEl.value || periodeActuelle : periodeActuelle;

  // Filtre PDV
  const pdvFil = document.getElementById('ranPDVFil')?.value || '';

  // ── Résumé captures ───────────────────────────────
  const ransActuels = rapportsNouveaux.filter(r => r.periode === periode);
  const nbVerrouilles = ransActuels.filter(r => r.verrouille).length;
  const nbTotal = comptes.filter(c => c.actif !== false).length;
  const nbCaptures = ransActuels.length;

  document.getElementById('ranSummary').innerHTML = `
    <div class="sc-item"><div class="sc-lbl">Période</div><div class="sc-val" style="color:var(--cyan)">${periode}</div></div>
    <div class="sc-item"><div class="sc-lbl">Comptes capturés</div><div class="sc-val" style="color:var(--${nbCaptures >= nbTotal ? 'green' : 'amber'})">${nbCaptures} / ${nbTotal}</div></div>
    <div class="sc-item"><div class="sc-lbl">RAN verrouillés</div><div class="sc-val" style="color:var(--${nbVerrouilles === nbCaptures && nbCaptures > 0 ? 'green' : 'amber'})">${nbVerrouilles}</div></div>
    <div class="sc-item"><div class="sc-lbl">Saisies rétroactives</div><div class="sc-val" style="color:var(--${detecterSaisiesRetroactives(periode).length > 0 ? 'red' : 'green'})">${detecterSaisiesRetroactives(periode).length} détectée(s)</div></div>
  `;

  // ── Tableau des RAN ───────────────────────────────
  const tbody = document.getElementById('ranTbody');
  if (!tbody) return;

  // Pour chaque compte actif
  const lignes = comptes.filter(c => c.actif !== false).map(c => {
    const ran = getRAN(c.id, periode);
    const soldeOuv = ran ? ran.soldeOuverture : null;
    const soldeAct = c.solde || 0;
    const ecart = soldeOuv !== null ? soldeAct - soldeOuv : null;
    return { c, ran, soldeOuv, soldeAct, ecart };
  });

  if (!lignes.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="ei">📊</div>Aucun compte configuré</div></td></tr>';
    return;
  }

  tbody.innerHTML = lignes.map(({ c, ran, soldeOuv, soldeAct, ecart }, i) => {
    const catLabel = c.cat === 'mobile_money' ? 'MM' : c.cat === 'banque' ? 'Banque' : 'Caisse';
    const statut = ran
      ? ran.verrouille
        ? `<span class="badge bg">🔒 Verrouillé</span>`
        : `<span class="badge ba">📝 Capturé</span>`
      : `<span class="badge br">⚠ Absent</span>`;

    const ecartHtml = ecart !== null
      ? `<span style="color:${ecart === 0 ? 'var(--green)' : ecart > 0 ? 'var(--green)' : 'var(--red)'}; font-weight:700">
          ${ecart > 0 ? '+' : ''}${fmt(ecart)}
        </span>`
      : '<span style="color:var(--text3)">—</span>';

    const barreHtml = ecart !== null && soldeOuv !== null && soldeOuv !== 0
      ? (() => {
          const pct = Math.min(100, Math.abs(soldeAct / soldeOuv * 100));
          const col = ecart >= 0 ? 'var(--green)' : 'var(--red)';
          return `<div class="prog-bar" style="margin-top:4px;max-width:120px"><div class="prog-fill" style="width:${pct}%;background:${col}"></div></div>`;
        })()
      : '';

    return `<tr style="cursor:pointer" onclick="ouvrirDetailCompteRAN('${c.id}','${c.nom}')" title="Voir les opérations de ${c.nom}">
      ${rowNum(i)}
      <td>
        <div style="font-weight:600">${c.nom}</div>
        <div style="font-size:.68rem;color:var(--text3)">${catLabel} · ${c.op === 'AUTRE' && c.opLibre ? c.opLibre : c.op}</div>
      </td>
      <td>${statut}</td>
      <td class="amt ${soldeOuv !== null ? (soldeOuv >= 0 ? 'pos' : 'neg') : ''}">
        ${soldeOuv !== null ? fmt(soldeOuv) : '<span style="color:var(--text3)">Non capturé</span>'}
      </td>
      <td class="amt ${soldeAct >= 0 ? 'pos' : 'neg'}">${fmt(soldeAct)}</td>
      <td>${ecartHtml}${barreHtml}</td>
      <td style="font-size:.72rem;color:var(--text3)">${ran ? fmtD(ran.captureTimestamp?.split('T')[0] || '') : '—'}</td>
      <td style="font-size:.72rem;color:var(--text3)">${ran ? ran.captureUser : '—'}</td>
      <td>
        ${ran && !ran.verrouille && currentUser?.role === 'admin'
          ? `<button class="btn btn-ghost btn-xs" onclick="verrouillerRAN('${ran.id}')">🔒</button>`
          : ''}
      </td>
    </tr>`;
  }).join('');

  // ── Saisies rétroactives ──────────────────────────
  const retro = detecterSaisiesRetroactives(periode);
  const retroDiv = document.getElementById('ranRetroBody');
  if (retroDiv) {
    if (!retro.length) {
      retroDiv.innerHTML = '<tr><td colspan="7"><div class="empty-state" style="padding:20px"><div class="ei">✅</div>Aucune saisie rétroactive détectée</div></td></tr>';
    } else {
      retroDiv.innerHTML = retro.map(r => `<tr style="background:var(--red-dim)">
        <td><span class="badge br">🔴 ${r.type}</span></td>
        <td>${fmtD(r.date)}</td>
        <td>${fmtD(r.saisieLe)}</td>
        <td style="color:var(--red);font-weight:700">+${r.diffJours} jours</td>
        <td style="font-size:.8rem">${r.libelle}</td>
        <td class="amt neg">−${fmt(r.montant)}</td>
        <td style="font-size:.78rem;color:var(--text2)">${r.saisie}</td>
      </tr>`).join('');
    }
  }
}
window.renderRAN = renderRAN;

// ── Verrouiller un seul RAN ───────────────────────────
async function verrouillerRAN(ranId) {
  const r = rapportsNouveaux.find(x => x.id === ranId);
  if (!r) return;
  if (!confirm(`Verrouiller définitivement le RAN de "${r.compteNom}" pour ${r.periode} ?\n\nCette action est irréversible.`)) return;
  r.verrouille = true;
  r.verrouilleTimestamp = new Date().toISOString();
  r.verrouilleUser = currentUser?.nom || 'admin';
  await saveItem('rapportsNouveaux', r);
  saveLocal();
  renderRAN();
  toast(`RAN "${r.compteNom}" verrouillé ✓`);
}
window.verrouillerRAN = verrouillerRAN;

// ── Action : capturer RAN mois courant ───────────────
async function actionCapturerRAN() {
  const selEl = document.getElementById('ranPeriode');
  const periode = selEl ? selEl.value || today().slice(0, 7) : today().slice(0, 7);
  const nbExistants = rapportsNouveaux.filter(r => r.periode === periode && r.verrouille).length;
  if (nbExistants > 0) {
    toast(`⚠ ${nbExistants} RAN déjà verrouillés pour ${periode} — non modifiés`, 'info');
  }
  sync('syncing', 'Capture RAN…');
  const { nbNouveaux } = await capturerRANMois(periode, 'MANUEL');
  sync('ok', '🔴 Temps réel');
  toast(`✅ RAN capturés — ${nbNouveaux} nouveau(x) pour ${periode}`);
  renderRAN();
}
window.actionCapturerRAN = actionCapturerRAN;

// ── Export RAN ────────────────────────────────────────
function exportRAN(format) {
  const selEl = document.getElementById('ranPeriode');
  const periode = selEl ? selEl.value || today().slice(0, 7) : today().slice(0, 7);
  const lignes = comptes.filter(c => c.actif !== false).map(c => {
    const ran = getRAN(c.id, periode);
    const soldeAct = c.solde || 0;
    const ecart = ran ? soldeAct - ran.soldeOuverture : null;
    return [
      c.nom,
      c.cat === 'mobile_money' ? 'Mobile Money' : c.cat === 'banque' ? 'Banque' : 'Caisse',
      ran ? fmt(ran.soldeOuverture) : 'Non capturé',
      fmt(soldeAct),
      ecart !== null ? (ecart >= 0 ? '+' : '') + fmt(ecart) : '—',
      ran ? (ran.verrouille ? '🔒 Verrouillé' : 'Capturé') : 'Absent',
      ran ? ran.captureUser : '—',
      ran ? fmtD(ran.captureTimestamp?.split('T')[0] || '') : '—',
    ];
  });
  exportUniversel(
    `Reports à Nouveaux — ${periode}`,
    ['Compte', 'Type', 'Solde ouverture (RAN)', 'Solde actuel', 'Écart', 'Statut', 'Saisi par', 'Capturé le'],
    lignes,
    { format, periode }
  );
}
window.exportRAN = exportRAN;

// ── Auto-capture RAN au 1er du mois ──────────────────
function scheduleAutoRAN() {
  const now = new Date();
  const next = new Date(now);
  // Si on est le 1er du mois et qu'il est avant 8h → capturer ce matin
  if (now.getDate() === 1 && now.getHours() < 8) {
    next.setHours(8, 0, 0, 0);
  } else {
    // Sinon, prochain 1er du mois à 8h
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    next.setHours(8, 0, 0, 0);
  }
  const delay = next - now;
  setTimeout(async () => {
    const periode = today().slice(0, 7);
    const existants = rapportsNouveaux.filter(r => r.periode === periode);
    if (!existants.length) {
      await capturerRANMois(periode, 'AUTOMATIQUE');
      toast(`📅 RAN automatiques capturés pour ${periode}`);
    }
    scheduleAutoRAN();
  }, delay);
}

// ══════════════════════════════════════════════════════
// ── BACKUP & UTILS EXPOSED ─────────────────────────────
window.backupPC=backupPC;window.backupDropbox=backupDropbox;
window.backupNow=backupNow;window.importerDonnees=importerDonnees;
window.resetFilter=resetFilter;window.openM=openM;window.closeM=closeM;

// ── REFRESH (v4.1) ─────────────────────────────────────
async function refreshPage(){
  if(useFirebase){ sync('syncing','Actualisation…'); await loadAll(); }
  populateSelects();
  const active=PAGES.find(p=>document.getElementById('pg-'+p)?.classList.contains('active'));
  if(active)({dashboard:renderDashboard,recettes:renderRecettes,versements:renderVersements,
    caisse:renderCaisse,banques:renderBanques,rapport:renderRapport,
    releves:renderReleves,petitecaisse:renderPetiteCaisse,
    caissiere:renderSuiviCaissiere,admin:renderAdmin,utilisateurs:renderUsers})[active]?.();
  toast('Données actualisées ✓');
}
// ══════════════════════════════════════════════════════
// CORRECTION MASSIVE — Réimputation clôtures tête de pont
// Supprime tous les versements/mvts de clôture imputés sur
// une tête de pont depuis le 01/07/2026, et recalcule les soldes
// ══════════════════════════════════════════════════════
async function corrigerImputationsTetePont() {
  const dateDebut = '2026-07-01';

  // Identifie les comptes têtes de pont
  const tetesPont = comptes.filter(c => c.tetePont && c.actif !== false);
  if (!tetesPont.length) { toast('Aucune tête de pont configurée', 'err'); return; }

  const nomsTPs = tetesPont.map(c => c.nom).join(', ');

  // Identifie les versements issus de clôtures imputés sur une tête de pont
  const versCloture = versements.filter(v =>
    v.date >= dateDebut &&
    v.notes && v.notes.startsWith('Clôture:') &&
    tetesPont.some(tp => tp.id === v.compte)
  );

  // Identifie les mouvements Firebase correspondants (entrée créditée sur tête de pont)
  const mvtsCloture = mvts.filter(m =>
    m.date >= dateDebut &&
    m.type === 'entrée' &&
    tetesPont.some(tp => tp.id === m.compte) &&
    (m.libelle?.includes('Versement') || m.libelle?.includes('Clôture') || m.rubrique === 'Versement PDV')
  );

  // Frais associés (sortie sur même compte même date même référence)
  const fraisCloture = mvts.filter(m =>
    m.date >= dateDebut &&
    m.type === 'sortie' &&
    tetesPont.some(tp => tp.id === m.compte) &&
    (m.libelle?.includes('Frais') && m.libelle?.includes('PHARMA MBENGUE'))
  );

  const totalVers = versCloture.length;
  const totalMvts = mvtsCloture.length + fraisCloture.length;

  if (!totalVers && !totalMvts) {
    toast('Aucune écriture erronée trouvée sur les têtes de pont depuis le 01/07', 'info');
    return;
  }

  // Calcule l'impact net sur chaque tête de pont
  const impactParCompte = {};
  tetesPont.forEach(tp => { impactParCompte[tp.id] = { nom: tp.nom, montant: 0 }; });

  mvtsCloture.forEach(m => { if (impactParCompte[m.compte]) impactParCompte[m.compte].montant += m.montant; });
  fraisCloture.forEach(m => { if (impactParCompte[m.compte]) impactParCompte[m.compte].montant -= m.montant; });

  const lignesImpact = Object.values(impactParCompte)
    .filter(x => x.montant !== 0)
    .map(x => `• ${x.nom} : ${x.montant > 0 ? '-' : '+'}${fmt(Math.abs(x.montant))} FCFA (solde corrigé)`)
    .join('\n');

  const msg = `RÉINITIALISATION IMPUTATIONS CLÔTURE\n\n` +
    `Période : depuis le 01/07/2026\n` +
    `Têtes de pont concernées : ${nomsTPs}\n\n` +
    `À supprimer :\n` +
    `• ${totalVers} versement(s) de clôture mal imputé(s)\n` +
    `• ${totalMvts} mouvement(s) financier(s) associé(s)\n\n` +
    `Correction des soldes :\n${lignesImpact || '• Aucun impact calculé'}\n\n` +
    `⚠ Cette opération est irréversible.\nFais une sauvegarde avant de confirmer.\n\nConfirmer ?`;

  if (!confirm(msg)) return;

  sync('syncing', 'Correction en cours…');
  toast('Correction en cours…', 'info');

  // ── Suppression des versements erronés ──
  for (const v of versCloture) {
    versements = versements.filter(x => x.id !== v.id);
    await delItem('versements', v.id);
  }

  // ── Suppression des mouvements erronés + recalcul solde ──
  for (const m of [...mvtsCloture, ...fraisCloture]) {
    const c = comptes.find(x => x.id === m.compte);
    if (c) {
      // Annule l'effet du mouvement sur le solde
      if (m.type === 'entrée') c.solde = (c.solde || 0) - m.montant;
      else if (m.type === 'sortie') c.solde = (c.solde || 0) + m.montant;
      await saveItem('comptes', c);
    }
    mvts = mvts.filter(x => x.id !== m.id);
    await delItem('mvts', m.id);
  }

  saveLocal();
  sync('ok', '🔴 Temps réel');

  const recap = `✅ Correction terminée !\n` +
    `${totalVers} versement(s) supprimé(s)\n` +
    `${totalMvts} mouvement(s) supprimé(s)\n\n` +
    `Les soldes des têtes de pont ont été recalculés.\n` +
    `Les clôtures restent intactes — seule l'imputation comptable a été annulée.\n\n` +
    `Tu peux maintenant re-valider les clôtures depuis le 01/07 — elles iront sur les bons comptes PSRM.`;

  alert(recap);
  toast('Correction terminée ✓');
  renderDashboard();
  renderBanques();
}
window.corrigerImputationsTetePont = corrigerImputationsTetePont;

window.refreshPage=refreshPage;
async function init(){
  if(useFirebase){sync('syncing','Connexion…');try{await loadAll();sync('ok','🔴 Temps réel');}catch(e){sync('error','Mode local');}}
  else sync('ok','Mode local');
  document.getElementById('loadingOverlay').style.display='none';
  document.getElementById('loginScreen').style.display='flex';
  document.getElementById('loginUser').focus();
  scheduleAutoRAN();
}
init();
