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
const DROPBOX_TOKEN = "sl.u.AGlv_YKIdRu88ciXa4fc5vIC_8mftdu8prBtOyYOgyeOcUTgpfitUjwWfAlXtMkIUR0SXuCXe5jg5vFlBjepZX8vu1OQnb0wEzydWzdwquq014jOfi_SFf1dzAQ6rZrO514pJTdA-1LpPP3fpP0-vG6JGV86t-K40tnVDb4BKEk9zy2HXycZoKIWsCXeBj08RgfaMWu2qwdovbPWAWJlQW9CnCmhHv8q55UJW2gI8nBDODrOdOli3ofhJtx7xOti2AfooQMrGyxfe_63TY8HdNGDXSIn6zBtFhFC0QazGCZnqKpqHWZf5LiifOsz_LhWXWfvRaHoCWY5f_KxvJMK24BKUWPPm9elx-7T6ljOEJXLqTbitoUfGyHxj1b6iMaHnMlimOkc8xeQRc7TeqdUEiAfFMPQMe0p0Uu1QkSHJu5As4FGqYrEC9l1YAxF8VjiNK5kd6iewDjEiJhKgxDy6hz0IIVsFlfwu5ICgdrbQPHZbVDaLkZgHuv-5oPRyA1qYRbu7PVhk0zD0ehvWnPUmAVU3b3kRsRtPUIMb4ozbB82OBr_j_ZwDM7-T0Ab-UAcsOiSMvaS5puLaY2dRPALEg91QDkEBJPtHWMLhH6oj-QeF1VSvPNlroOd9ZAt22-zrr6fNYpG_noERS7EAxlRONYO1Gp6ahSDIJrz2QOxJp1JLAhKKj12Dm1f0MDLvkiWHMZszN6YoYCvB6WU4QZSPt-nr-4nUVnXFATAnvATVRmQckuW3aDhoGskIPSUbPKTWY4FkcOYBS-uBalssGao_pSCtI92WTW1iW6n0_tFG2l76AwpDdfND2Qk46MeD5xP3y8GoHs05lzJiiH4dPoPrlzOm68TTC1G_vJDnvadKkRlLdUHimQw-IfwMToNjYsYZkfXL4Ei0RBZR9BjTsgmNGk-GlHAf5vHX4zL86NtCv4mjCoX50UzMFF79R7HtbA6zlHra2kUcfTnGZRgJn8k1AJ5MwDLXgxRqtEqmAVhGwq94uXZUrRRRxkxUwPWB6mUYGBGcFSGYPDBDsTIVsxGUv_k-XAhjVwPBrzapBTdLTXUfQizTZdH4AWdG8x8NAdEFqm7oWCW0yzwRB_6kE1_9aJqxMhbH2-qu9rMrofplenASTfCWeQkUrT_v_ttNH8wBK4gs1ysPm0v2HGpqOBBS4AKglDvGW1JG-EE9hDWaGsoGXEahWpty3ZqpyQ1hebkpxOI6cxyF1Tw-2nIQvzB9LNA6wfAHrj2MF8S5mRPyRSru77ew_h6N2PsX5r7ad6x7rqL5eI22aUpBn0NP01ITVK-NyjRMy8xNQBAfjK3EPGBV2o1KDUqZOSxrxMLRvCCDxQ";
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
  const [fu,fp,fc,fr,fv,fm,fcl,ft,fpc]=await Promise.all([
    fbLoad('users'),fbLoad('pdvs'),fbLoad('comptes'),fbLoad('recettes'),
    fbLoad('versements'),fbLoad('mvts'),fbLoad('clotures'),fbLoad('transferts'),
    fbLoad('petiteCaisse')
  ]);
  if(fu)users=fu; if(fp)pdvs=fp; if(fc)comptes=fc; if(fr)recettes=fr;
  if(fv)versements=fv; if(fm)mvts=fm; if(fcl)clotures=fcl; if(ft)transferts=ft;
  if(fpc)petiteCaisse=fpc;
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
const MM_LABEL={OM:'🟠 Orange Money',MTN:'🟡 MTN MoMo',WAVE:'🔵 Wave',MOOV:'🟢 Moov Money',CASH:'💵 Cash',CHEQUE:'📝 Chèque',VIREMENT:'🏦 Virement'};
const OP_ICONS={OM:'🟠',MTN:'🟡',WAVE:'🔵',MOOV:'🟢',BICICI:'🏦',SGBCI:'🏦',ECOBANK:'🏦',UBA:'🏦',BNI:'🏦',NSIA:'🏦',SIB:'🏦',CORIS:'🏦',BOA:'🏦',CASH:'💵',AUTRE:'💳'};
const FREQ_LABEL={quotidien:'Quotidien',hebdomadaire:'Hebdo',bimensuel:'2×/sem',mensuel:'Mensuel'};
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
const PAGES=['dashboard','recettes','versements','caisse','banques','rapport','releves','petitecaisse','caissiere','admin','utilisateurs'];
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
      (name==='caissiere'&&t.includes('caissière'))||(name==='admin'&&t.includes('config'))||
      (name==='utilisateurs'&&t.includes('utilis')));
  });
  const mm=['dashboard','recettes','versements','caisse','banques'];
  document.querySelectorAll('.mnav-item').forEach((n,i)=>n.classList.toggle('active',mm[i]===name));
  ({dashboard:renderDashboard,recettes:renderRecettes,versements:renderVersements,
    caisse:renderCaisse,banques:renderBanques,rapport:renderRapport,
    releves:renderReleves,petitecaisse:renderPetiteCaisse,
    caissiere:renderSuiviCaissiere,admin:renderAdmin,utilisateurs:renderUsers})[name]?.();
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
    return`<div class="compte-card" style="border-left:3px solid ${col}">
      <div class="cc-icon">${OP_ICONS[c.op]||'💳'}</div>
      <div class="cc-name">${c.nom}</div>
      <div class="cc-solde" style="color:${(c.solde||0)>=0?col:'var(--red)'};">${fmt(c.solde)} <span style="font-size:.7rem;font-weight:400;color:var(--text2)">${DEVISE}</span></div>
      <div style="margin-top:4px">${dispoBadge(c)}</div>
      <div class="cc-type">${c.cat==='mobile_money'?'Mobile Money':c.cat==='banque'?'Banque':'Caisse'} · ${op}</div>
    </div>`;
  }).join('');
  const rTb=document.getElementById('dbRecTbody');
  rTb.innerHTML=todayR.length?todayR.map(r=>`<tr><td>${pdvBadge(r.pdv)}</td><td>${mmBadge(r.canal)}</td><td class="amt pos">${fmt(r.montant)}</td></tr>`).join('')
    :'<tr><td colspan="3" style="color:var(--text3);text-align:center;padding:14px">Aucune recette</td></tr>';
  const vTb=document.getElementById('dbVerTbody');
  const lastV=[...versements].sort((a,b)=>(b.ts||0)-(a.ts||0)).slice(0,6);
  vTb.innerHTML=lastV.length?lastV.map(v=>`<tr><td>${pdvBadge(v.pdv)}</td><td>${mmBadge(v.type||v.canal)}</td><td class="amt pos">${fmt(v.montant)}</td><td>${statutBadge(v.statut)}</td></tr>`).join('')
    :'<tr><td colspan="4" style="color:var(--text3);text-align:center;padding:14px">Aucun versement</td></tr>';
}
window.renderDashboard=renderDashboard;

// ══════════════════════════════════════════════════════
// RECETTES
// ══════════════════════════════════════════════════════
function renderRecettes(){
  let data=[...recettes].sort((a,b)=>b.date?.localeCompare(a.date||'')||0);
  const dF=document.getElementById('fRDate').value,pF=document.getElementById('fRPDV').value,cF=document.getElementById('fRCanal').value;
  if(currentUser.role!=='admin'&&currentUser.pdv)data=data.filter(r=>r.pdv===currentUser.pdv);
  if(dF)data=data.filter(r=>r.date===dF);if(pF)data=data.filter(r=>r.pdv===pF);if(cF)data=data.filter(r=>r.canal===cF);
  const tbody=document.getElementById('recTbody');
  if(!data.length){tbody.innerHTML='<tr><td colspan="8"><div class="empty-state"><div class="ei">📋</div>Aucune recette</div></td></tr>';return;}
  tbody.innerHTML=data.map(r=>`<tr>
    <td>${fmtD(r.date)}</td><td>${pdvBadge(r.pdv)}</td><td>${mmBadge(r.canal)}</td>
    <td><span class="badge bb">${r.type}</span></td>
    <td class="amt pos">${fmt(r.montant)}</td>
    <td style="color:var(--text2);font-size:.75rem">${r.ref||'—'}</td>
    <td style="color:var(--text2);font-size:.75rem">${r.saisie||'—'}</td>
    <td>${currentUser.role==='admin'?`<button class="btn btn-red btn-xs" onclick="delRecette('${r.id}')">✕</button>`:''}</td>
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
async function saveRecette(){
  const date=document.getElementById('mRDate').value,pdv=document.getElementById('mRPDV').value,
    canal=document.getElementById('mRCanal').value,montant=parseFloat(document.getElementById('mRMontant').value);
  if(!date||!pdv||!canal||!montant){toast('Champs obligatoires manquants','err');return;}
  // Anti-doublons
  const doublon=recettes.find(r=>r.pdv===pdv&&r.date===date&&Math.abs((r.montant||0)-montant)<montant*0.01);
  if(doublon&&!confirm(`⚠️ Doublon possible !\nUne recette similaire existe déjà pour ce PDV à cette date :\n${fmtD(doublon.date)} — ${fmt(doublon.montant)} ${DEVISE}\n\nConfirmer quand même ?`))return;
  const item={id:uid(),date,heure:document.getElementById('mRHeure').value,pdv,
    type:document.getElementById('mRType').value,canal,montant,
    ref:document.getElementById('mRRef').value,saisie:document.getElementById('mRSaisie').value,
    notes:document.getElementById('mRNotes').value,ts:Date.now()};
  recettes.push(item);await saveItem('recettes',item);
  closeM('mRecette');toast('Recette enregistrée ✓');renderRecettes();renderDashboard();
}
window.saveRecette=saveRecette;
async function delRecette(id){
  if(!confirm('Supprimer ?'))return;
  recettes=recettes.filter(r=>r.id!==id);await delItem('recettes',id);renderRecettes();toast('Supprimé','info');
}
window.delRecette=delRecette;

// ── SMS/WhatsApp parser (tous PDV) ────────────────────
function openSMSModal(){
  document.getElementById('smsTxt').value='';
  document.getElementById('smsResult').style.display='none';
  document.getElementById('btnSaveSMS').style.display='none';
  document.getElementById('smsDate').value=today();
  document.getElementById('smsPDV').innerHTML=pdvs.map(p=>`<option value="${p.id}">${p.nom}</option>`).join('');
  openM('mSMS');
}
window.openSMSModal=openSMSModal;
function parseSMS(){
  const txt=document.getElementById('smsTxt').value;
  if(!txt.trim()){toast('Colle un SMS ou message WhatsApp','err');return;}
  // Montant : reconnaît 178.300 ou 178 300 comme 178300
  const txtNorm=txt.replace(/(\d)\.(\d{3})/g,'$1$2').replace(/(\d)\s(\d{3})/g,'$1$2');
  const nums=(txtNorm.match(/\d+/g)||[]).map(n=>parseInt(n)).filter(n=>n>100&&n<999999999);
  const montant=nums.length?Math.max(...nums):0;
  const dm=txt.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.]?(\d{2,4})?/);
  if(dm){const[,j,m,y]=dm;const yr=y?(y.length===2?'20'+y:y):new Date().getFullYear();
    document.getElementById('smsDate').value=`${yr}-${m.padStart(2,'0')}-${j.padStart(2,'0')}`;}
  // PDV : détection phonétique avec normalisation accents
  const normalize=s=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,' ').trim();
  const loNorm=normalize(txt);
  let detPDV=pdvs[0]?.id;
  let bestScore=0;
  pdvs.forEach(p=>{
    const words=normalize(p.nom).split(' ').filter(w=>w.length>3);
    const score=words.filter(w=>loNorm.includes(w)).length;
    if(score>bestScore){bestScore=score;detPDV=p.id;}
  });
  document.getElementById('smsPDV').value=detPDV;
  let detCanal='CASH';
  if(/orange/i.test(txt))detCanal='OM';else if(/mtn/i.test(txt))detCanal='MTN';
  else if(/wave/i.test(txt))detCanal='WAVE';else if(/moov/i.test(txt))detCanal='MOOV';
  document.getElementById('smsCanal').value=detCanal;
  document.getElementById('smsMontant').value=montant||'';
  document.getElementById('smsResult').style.display='block';
  document.getElementById('btnSaveSMS').style.display='inline-block';
  toast('Données extraites — vérifie et confirme');
}
window.parseSMS=parseSMS;
async function saveSMSRecette(){
  const pdv=document.getElementById('smsPDV').value,date=document.getElementById('smsDate').value,
    montant=parseFloat(document.getElementById('smsMontant').value),canal=document.getElementById('smsCanal').value;
  if(!date||!pdv||!montant){toast('Données incomplètes','err');return;}
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
  tbody.innerHTML=data.map(v=>{
    const cpt=comptes.find(c=>c.id===v.compte);
    return`<tr>
      <td>${fmtD(v.date)}</td><td>${pdvBadge(v.pdv)}</td>
      <td><span class="wk">${v.freq||'quotidien'}</span></td>
      <td>${mmBadge(v.type)}</td>
      <td style="font-size:.78rem;color:var(--text2)">${cpt?cpt.nom:'—'}</td>
      <td style="font-size:.75rem;color:var(--text2)">${v.ref||'—'}</td>
      <td class="amt pos">${fmt(v.montant)}</td>
      <td>${statutBadge(v.statut)}</td>
      <td style="font-size:.75rem;color:var(--text2)">${v.saisie||'—'}</td>
      <td style="display:flex;gap:4px">
        ${v.statut==='en attente'?`<button class="btn btn-ghost btn-xs" onclick="confirmerV('${v.id}')">✓</button>`:''}
        ${currentUser.role==='admin'?`<button class="btn btn-red btn-xs" onclick="delVers('${v.id}')">✕</button>`:''}
      </td>
    </tr>`;
  }).join('');
}
window.renderVersements=renderVersements;

// Versement multiple v4 — plusieurs lignes par PDV
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

function renderLignesVersement(){
  const container=document.getElementById('lignesVersContainer');
  if(!container)return;
  container.innerHTML=lignesVersement.map((l,i)=>`
    <div style="background:var(--surface2);border-radius:8px;padding:12px;margin-bottom:8px;position:relative">
      <div style="font-size:.72rem;color:var(--text3);margin-bottom:8px">Versement ${i+1}</div>
      <div class="fg2">
        <div class="fg"><label>Type *</label>
          <select onchange="lignesVersement[${i}].type=this.value">
            ${Object.entries(MM_LABEL).map(([k,v])=>`<option value="${k}"${l.type===k?' selected':''}>${v}</option>`).join('')}
          </select>
        </div>
        <div class="fg"><label>Vers compte *</label>
          <select onchange="lignesVersement[${i}].compte=this.value">
            ${comptes.filter(c=>c.actif!==false).map(c=>`<option value="${c.id}"${l.compte===c.id?' selected':''}>${c.nom}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="fg2">
        <div class="fg"><label>Montant (${DEVISE}) *</label>
          <input type="number" value="${l.montant||''}" placeholder="0" min="0"
            oninput="lignesVersement[${i}].montant=parseFloat(this.value)||0;updateTotalVers()"
            onchange="lignesVersement[${i}].montant=parseFloat(this.value)||0;updateTotalVers()">
        </div>
        <div class="fg"><label>Référence</label>
          <input type="text" value="${l.ref||''}" placeholder="N° reçu, réf MM…"
            oninput="lignesVersement[${i}].ref=this.value">
        </div>
      </div>
      ${lignesVersement.length>1?`<button onclick="removeLigneVersement(${i})" style="position:absolute;top:8px;right:8px;background:var(--red-dim);color:var(--red);border:none;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:.75rem">✕</button>`:''}
    </div>
  `).join('');
  updateTotalVers();
}
function addLigneVersement(){
  lignesVersement.push({type:'OM',compte:comptes[0]?.id||'',montant:0,ref:''});
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

async function saveVersements(){
  const date=document.getElementById('mVDate2').value;
  const pdv=document.getElementById('mVPDV2').value;
  const statut=document.getElementById('mVStatut2').value;
  const saisie=document.getElementById('mVSaisie2').value;
  const freq=document.getElementById('mVFreq2')?.value||'quotidien';
  if(!date||!pdv){toast('Date et PDV obligatoires','err');return;}
  const valides=lignesVersement.filter(l=>l.montant>0&&l.compte);
  if(!valides.length){toast('Ajoute au moins un versement avec un montant','err');return;}
  // Anti-doublons
  const totalNouv=valides.reduce((s,l)=>s+l.montant,0);
  const doublon=versements.find(v=>v.pdv===pdv&&v.date===date&&Math.abs((v.montant||0)-totalNouv)<totalNouv*0.01);
  if(doublon&&!confirm(`⚠️ Doublon possible !\nUn versement similaire existe déjà pour ce PDV à cette date :\n${fmtD(doublon.date)} — ${fmt(doublon.montant)} ${DEVISE}\n\nConfirmer quand même ?`))return;
  for(const l of valides){
    const item={id:uid(),date,pdv,freq,type:l.type,compte:l.compte,ref:l.ref||'',
      montant:l.montant,statut,saisie,notes:'',ts:Date.now()};
    versements.push(item);
    if(statut==='confirmé')await crediterCompte(l.compte,l.montant,pdv,l.ref,date);
    await saveItem('versements',item);
  }
  closeM('mVers2');toast(`${valides.length} versement(s) enregistré(s) ✓`);
  renderVersements();renderDashboard();
}
window.saveVersements=saveVersements;

function onVPDVChange(){
  const p=pdvs.find(x=>x.id===document.getElementById('mVPDV2')?.value);
  if(p&&document.getElementById('mVFreq2'))document.getElementById('mVFreq2').value=p.freq||'quotidien';
}
window.onVPDVChange=onVPDVChange;

async function crediterCompte(compteId,montant,pdvId,ref,date){
  const c=comptes.find(x=>x.id===compteId);if(!c)return;
  c.solde=(c.solde||0)+montant;await saveItem('comptes',c);
  const m={id:uid(),date,compte:compteId,type:'entrée',
    libelle:`Versement ${pdvs.find(p=>p.id===pdvId)?.nom||pdvId}`,
    ref,montant,soldeApres:c.solde,saisie:currentUser.nom,ts:Date.now()};
  mvts.push(m);await saveItem('mvts',m);
}
async function confirmerV(id){
  const v=versements.find(x=>x.id===id);if(!v||v.statut==='confirmé')return;
  v.statut='confirmé';await crediterCompte(v.compte,v.montant,v.pdv,v.ref,v.date);
  await saveItem('versements',v);renderVersements();toast('Confirmé ✓');renderDashboard();
}
window.confirmerV=confirmerV;
async function delVers(id){
  if(!confirm('Supprimer ?'))return;
  versements=versements.filter(v=>v.id!==id);await delItem('versements',id);renderVersements();toast('Supprimé','info');
}
window.delVers=delVers;

// ══════════════════════════════════════════════════════
// CLÔTURE DE CAISSE
// ══════════════════════════════════════════════════════
function populateCaissiereSelect(){
  const el=document.getElementById('mcCaissiere');if(!el)return;
  el.innerHTML=users.filter(u=>u.actif!==false).map(u=>`<option value="${u.nom}">${u.nom}</option>`).join('')+'<option value="__custom__">✏️ Autre…</option>';
  el.onchange=function(){
    if(this.value==='__custom__'){
      const n=prompt('Nom de la caissière :');
      if(n){const o=document.createElement('option');o.value=n;o.textContent=n;o.selected=true;this.insertBefore(o,this.lastElementChild);this.value=n;}
      else this.value=users[0]?.nom||'';
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
  document.getElementById('mcDate').value=document.getElementById('caisseDate')?.value||today();
  document.getElementById('mcSuperviseur').value=currentUser.nom;
  ['mcMachineCash','mcMachineOM','mcMachineMTN','mcMachineWAVE','mcMachineMOOV',
   'mcCashVerser','mcOMVerser','mcMTNVerser','mcWAVEVerser','mcMOOVVerser','mcRefCash','mcNotes']
    .forEach(i=>{const e=document.getElementById(i);if(e)e.value='';});
  if(id){
    const c=clotures.find(x=>x.id===id);
    if(c){
      document.getElementById('mcDate').value=c.date;document.getElementById('mcVacation').value=c.vacation;
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
  calcCaisse();openM('mCaisse');
}
window.openCaisseModal=openCaisseModal;
async function saveCloture(){
  const date=document.getElementById('mcDate').value,vacation=document.getElementById('mcVacation').value,caissiere=document.getElementById('mcCaissiere').value;
  if(!date||!vacation||!caissiere){toast('Date, vacation et caissière obligatoires','err');return;}
  const machineCash=nv('mcMachineCash'),machineOM=nv('mcMachineOM'),machineMTN=nv('mcMachineMTN'),
    machineWAVE=nv('mcMachineWAVE'),machineMOOV=nv('mcMachineMOOV'),
    totalMachine=machineCash+machineOM+machineMTN+machineWAVE+machineMOOV;
  const cashVerse=nv('mcCashVerser'),omVerse=nv('mcOMVerser'),mtnVerse=nv('mcMTNVerser'),
    waveVerse=nv('mcWAVEVerser'),moovVerse=nv('mcMOOVVerser'),
    totalVerse=cashVerse+omVerse+mtnVerse+waveVerse+moovVerse,ecart=totalVerse-totalMachine;
  const editId=document.getElementById('mCaisse')._editId;
  const clot={id:editId||uid(),date,vacation,caissiere,superviseur:document.getElementById('mcSuperviseur').value,
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
        const v={id:uid(),date,pdv:pdvP.id,freq:'quotidien',type,
          compte:comptes.find(c=>c.op===type&&c.actif!==false)?.id||comptes[0]?.id||'',
          ref:clot.refCash||`Clôture ${caissiere} — ${vacation}`,
          montant,statut:'en attente',saisie:currentUser.nom,notes:`Clôture: ${caissiere}/${vacation}`,ts:Date.now()};
        versements.push(v);await saveItem('versements',v);
      }
    }
  }
  await saveItem('clotures',clot);closeM('mCaisse');toast(editId?'Clôture modifiée ✓':'Clôture enregistrée ✓');renderCaisse();
}
window.saveCloture=saveCloture;
async function validerClot(id){
  const c=clotures.find(x=>x.id===id);if(!c)return;
  c.statut='validé';c.valide_par=currentUser.nom;c.valide_ts=Date.now();
  await saveItem('clotures',c);renderCaisse();toast('Validée ✓');
}
window.validerClot=validerClot;
async function validerToutesClot(){
  const date=document.getElementById('caisseDate').value||today();
  for(const c of clotures.filter(x=>x.date===date&&x.statut==='ouvert')){
    c.statut='validé';c.valide_par=currentUser.nom;c.valide_ts=Date.now();await saveItem('clotures',c);
  }
  renderCaisse();toast('Toutes validées ✓');
}
window.validerToutesClot=validerToutesClot;
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
    return`<div class="caisse-card"><div class="cc-head"><div><div class="cc-caissiere">👤 ${c.caissiere}</div><div class="cc-vacation">${c.vacation}</div></div><div><span class="ecart-pill ${ep}">${et}</span><br><span class="clot-status ${c.statut==='validé'?'clot-closed':'clot-open'}" style="margin-top:4px;display:inline-block">${c.statut}</span></div></div>
    <div class="cc-row"><span class="cc-row-lbl">Machine</span><span class="cc-row-val" style="color:var(--blue)">${fmt(c.totalMachine)}</span></div>
    <div class="cc-row"><span class="cc-row-lbl">Cash versé</span><span class="cc-row-val">${fmt(c.cashVerse)}</span></div>
    <div class="cc-row"><span class="cc-row-lbl">MM versé</span><span class="cc-row-val">${fmt((c.omVerse||0)+(c.mtnVerse||0)+(c.waveVerse||0)+(c.moovVerse||0))}</span></div>
    <div class="cc-total-row"><span>Total versé</span><span style="color:var(--green)">${fmt(c.totalVerse)}</span></div>
    <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
      ${currentUser.role==='admin'&&c.statut==='ouvert'?`<button class="btn btn-ghost btn-xs" onclick="validerClot('${c.id}')">✓ Valider</button>`:''}
      <button class="btn btn-ghost btn-xs" onclick="openCaisseModal('${c.id}')">✏️</button>
      ${currentUser.role==='admin'?`<button class="btn btn-red btn-xs" onclick="delClot('${c.id}')">✕</button>`:''}
    </div></div>`;
  }).join('');
  document.getElementById('caisseTbody').innerHTML=dayC.map(c=>{
    const ec=c.ecart||0,ecC=ec===0?'amt pos':ec<0?'amt neg':'amt neu';
    return`<tr><td><span class="wk">${c.vacation}</span></td><td><b>${c.caissiere}</b></td>
    <td class="amt" style="color:var(--blue)">${fmt(c.totalMachine)}</td>
    <td class="amt ${c.cashVerse>0?'pos':''}">${fmt(c.cashVerse)}</td>
    <td class="amt pos">${fmt((c.omVerse||0)+(c.mtnVerse||0)+(c.waveVerse||0)+(c.moovVerse||0))}</td>
    <td class="amt pos">${fmt(c.totalVerse)}</td>
    <td class="${ecC}">${ec>0?'+':ec<0?'−':''}${fmt(Math.abs(ec))}</td>
    <td><span class="clot-status ${c.statut==='validé'?'clot-closed':'clot-open'}">${c.statut}</span></td>
    <td style="font-size:.75rem;color:var(--text2)">${c.valide_par||'—'}</td>
    <td style="display:flex;gap:4px">
      ${currentUser.role==='admin'&&c.statut==='ouvert'?`<button class="btn btn-ghost btn-xs" onclick="validerClot('${c.id}')">✓</button>`:''}
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
    return`<div class="compte-card" style="border-left:3px solid ${col}">
      <div class="cc-icon">${OP_ICONS[c.op]||'💳'}</div>
      <div class="cc-name">${c.nom}</div>
      <div class="cc-solde" style="color:${(c.solde||0)>=0?col:'var(--red)'};">${fmt(c.solde)}</div>
      <div style="margin-top:4px">${dispoBadge(c)}</div>
      <div class="cc-type">${c.cat==='mobile_money'?'Mobile Money':c.cat==='banque'?'Banque':'Caisse'} · ${op}</div>
      ${c.num?`<div style="font-size:.68rem;color:var(--text3);margin-top:2px;font-family:monospace">${c.num}</div>`:''}
    </div>`;
  }).join('');
  document.getElementById('fMCompte').innerHTML='<option value="">Tous comptes</option>'+comptes.map(c=>`<option value="${c.id}">${c.nom}</option>`).join('');
  renderMvts();
}
window.renderBanques=renderBanques;
function renderMvts(){
  // Fusion mouvements + transferts
  const allMvts=[
    ...mvts.map(m=>({...m,_src:'mvt'})),
    ...transferts.map(t=>({...t,_src:'transfert'}))
  ].sort((a,b)=>b.date?.localeCompare(a.date||'')||0);
  let data=allMvts;
  const dF=document.getElementById('fMDate').value,cF=document.getElementById('fMCompte').value,tF=document.getElementById('fMType').value;
  if(dF)data=data.filter(m=>m.date===dF);if(cF)data=data.filter(m=>m.compte===cF||m.compteSrc===cF||m.compteDst===cF);if(tF)data=data.filter(m=>m.type===tF);
  const tbody=document.getElementById('mvtTbody');
  if(!data.length){tbody.innerHTML='<tr><td colspan="9"><div class="empty-state"><div class="ei">🏦</div>Aucun mouvement</div></td></tr>';return;}
  tbody.innerHTML=data.map(m=>{
    const cpt=comptes.find(c=>c.id===(m.compte||m.compteSrc));
    const cptDst=m.compteDst?comptes.find(c=>c.id===m.compteDst):null;
    const libelle=m._src==='transfert'?`🔄 Transfert MM→Banque${cptDst?' → '+cptDst.nom:''}`:m.libelle||'—';
    return`<tr>
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
}
window.renderMvts=renderMvts;
function openMvtModal(){
  document.getElementById('mMDate').value=today();
  ['mMMontant','mMRef','mMNotes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('mMSaisie').value=currentUser.nom;openM('mMvt');
}
window.openMvtModal=openMvtModal;
async function saveMvt(){
  const date=document.getElementById('mMDate').value,compteId=document.getElementById('mMCompte').value,
    type=document.getElementById('mMType').value,montant=parseFloat(document.getElementById('mMMontant').value);
  if(!date||!compteId||!montant){toast('Champs manquants','err');return;}
  const c=comptes.find(x=>x.id===compteId);
  if(c){if(type==='entrée')c.solde=(c.solde||0)+montant;else if(type==='sortie')c.solde=(c.solde||0)-montant;await saveItem('comptes',c);}
  const item={id:uid(),date,compte:compteId,type,libelle:document.getElementById('mMNotes').value,
    ref:document.getElementById('mMRef').value,montant,soldeApres:c?.solde||0,
    saisie:document.getElementById('mMSaisie').value,ts:Date.now()};
  mvts.push(item);await saveItem('mvts',item);
  closeM('mMvt');toast('Mouvement enregistré ✓');renderBanques();renderDashboard();
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
  if((src.solde||0)<montant){if(!confirm(`Solde ${src.nom} insuffisant (${fmt(src.solde)} ${DEVISE}). Continuer quand même ?`))return;}
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
// RAPPORT
// ══════════════════════════════════════════════════════
function onPeriodeChange(){
  const p=document.getElementById('rPeriode').value;
  document.getElementById('rCustomDates').style.display=p==='custom'?'flex':'none';
  renderRapport();
}
window.onPeriodeChange=onPeriodeChange;
function renderRapport(){
  const t=today(),p=document.getElementById('rPeriode').value;
  let debut,fin;
  if(p==='jour'){debut=t;fin=t;}else if(p==='semaine'){const b=weekBounds(t);debut=b.start;fin=b.end;}
  else if(p==='mois'){debut=t.slice(0,7)+'-01';fin=t;}
  else{debut=document.getElementById('rDebut').value||t;fin=document.getElementById('rFin').value||t;}
  const recF=recettes.filter(r=>r.date>=debut&&r.date<=fin);
  const verF=versements.filter(v=>v.date>=debut&&v.date<=fin);
  const totR=recF.reduce((s,r)=>s+(r.montant||0),0),totV=verF.reduce((s,v)=>s+(v.montant||0),0),
    totC=verF.filter(v=>v.statut==='confirmé').reduce((s,v)=>s+(v.montant||0),0),
    totA=verF.filter(v=>v.statut==='en attente').reduce((s,v)=>s+(v.montant||0),0),ecart=totR-totC;
  const byPDV={};pdvs.forEach(p=>{byPDV[p.id]={nom:p.nom,type:p.type,rec:0,ver:0,verC:0}});
  recF.forEach(r=>{if(byPDV[r.pdv])byPDV[r.pdv].rec+=r.montant||0});
  verF.forEach(v=>{if(byPDV[v.pdv]){byPDV[v.pdv].ver+=v.montant||0;if(v.statut==='confirmé')byPDV[v.pdv].verC+=v.montant||0}});
  const byCanal={};recF.forEach(r=>{if(!byCanal[r.canal])byCanal[r.canal]=0;byCanal[r.canal]+=r.montant||0});
  const byCpt={};verF.filter(v=>v.statut==='confirmé').forEach(v=>{if(!byCpt[v.compte])byCpt[v.compte]=0;byCpt[v.compte]+=v.montant||0});
  document.getElementById('rapportContent').innerHTML=`
    <div class="stats-grid">
      <div class="stat-card green"><div class="stat-lbl">Recettes</div><div class="stat-val green">${fmt(totR)}</div><div class="stat-sub">${DEVISE}</div></div>
      <div class="stat-card blue"><div class="stat-lbl">Versements</div><div class="stat-val blue">${fmt(totV)}</div><div class="stat-sub">${DEVISE}</div></div>
      <div class="stat-card purple"><div class="stat-lbl">Confirmés</div><div class="stat-val purple">${fmt(totC)}</div><div class="stat-sub">${DEVISE}</div></div>
      <div class="stat-card amber"><div class="stat-lbl">En attente</div><div class="stat-val amber">${fmt(totA)}</div><div class="stat-sub">${DEVISE}</div></div>
      <div class="stat-card ${ecart>0?'amber':ecart===0?'green':'red'}"><div class="stat-lbl">Écart</div><div class="stat-val ${ecart>0?'amber':ecart===0?'green':'red'}">${fmt(ecart)}</div><div class="stat-sub">${DEVISE}</div></div>
      <div class="stat-card green"><div class="stat-lbl">✓ Disponible banques</div><div class="stat-val green">${fmt(totalDispo())}</div><div class="stat-sub">${DEVISE}</div></div>
      <div class="stat-card amber"><div class="stat-lbl">⏳ En transit MM</div><div class="stat-val amber">${fmt(totalTransit())}</div><div class="stat-sub">${DEVISE}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div class="card"><div class="card-title" style="margin-bottom:12px">Recettes par canal</div>
        ${Object.entries(byCanal).sort((a,b)=>b[1]-a[1]).map(([k,v])=>{const pct=totR>0?Math.round(v/totR*100):0;return`<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>${mmBadge(k)}</span><span class="amt pos">${fmt(v)}</span></div><div class="prog-bar"><div class="prog-fill" style="width:${pct}%;background:var(--green)"></div></div><div style="font-size:.68rem;color:var(--text3)">${pct}%</div></div>`}).join('')||'<div style="color:var(--text3)">Aucune donnée</div>'}
      </div>
      <div class="card"><div class="card-title" style="margin-bottom:12px">Versements par compte</div>
        ${Object.entries(byCpt).sort((a,b)=>b[1]-a[1]).map(([id,v])=>{const cpt=comptes.find(c=>c.id===id);const pct=totC>0?Math.round(v/totC*100):0;return`<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:.78rem;color:var(--text2)">${cpt?cpt.nom:id}</span><span class="amt pos">${fmt(v)}</span></div><div class="prog-bar"><div class="prog-fill" style="width:${pct}%;background:var(--blue)"></div></div><div style="font-size:.68rem;color:var(--text3)">${pct}%</div></div>`}).join('')||'<div style="color:var(--text3)">Aucun versement confirmé</div>'}
      </div>
    </div>
    <div class="card" style="margin-top:14px"><div class="card-title" style="margin-bottom:12px">Performance par point de vente</div>
      <div class="tbl-wrap"><table><thead><tr><th>PDV</th><th>Type</th><th>Recettes</th><th>Versé</th><th>Confirmé</th><th>Taux</th></tr></thead>
      <tbody>${Object.values(byPDV).map(p=>{const taux=p.rec>0?Math.round(p.verC/p.rec*100):0;const col=taux>=80?'var(--green)':taux>=50?'var(--amber)':'var(--red)';return`<tr><td><b>${p.nom}</b></td><td><span class="badge ${p.type==='principale'?'bg':'bb'}">${p.type}</span></td><td class="amt pos">${fmt(p.rec)}</td><td class="amt">${fmt(p.ver)}</td><td class="amt pos">${fmt(p.verC)}</td><td><span style="color:${col};font-weight:700">${taux}%</span><div class="prog-bar"><div class="prog-fill" style="width:${taux}%;background:${col}"></div></div></td></tr>`}).join('')}</tbody></table></div>
    </div>`;
}
window.renderRapport=renderRapport;

// ══════════════════════════════════════════════════════
// RELEVÉS PÉRIODIQUES — Print/PDF/Excel/Word (v4)
// ══════════════════════════════════════════════════════
function renderReleves(){
  document.getElementById('relPDV').innerHTML='<option value="">Tous les PDV</option>'+pdvs.map(p=>`<option value="${p.id}">${p.nom}</option>`).join('');
  document.getElementById('relCompte').innerHTML='<option value="">Tous les comptes</option>'+comptes.map(c=>`<option value="${c.id}">${c.nom}</option>`).join('');
  genererReleve();
}
window.renderReleves=renderReleves;

function genererReleve(){
  const t=today(),p=document.getElementById('relPeriode')?.value||'mois';
  let debut,fin;
  if(p==='jour'){debut=t;fin=t;}else if(p==='semaine'){const b=weekBounds(t);debut=b.start;fin=b.end;}
  else if(p==='mois'){debut=t.slice(0,7)+'-01';fin=t;}
  else{debut=document.getElementById('relDebut')?.value||t;fin=document.getElementById('relFin')?.value||t;}
  const pdvF=document.getElementById('relPDV')?.value;
  const cptF=document.getElementById('relCompte')?.value;
  const recF=recettes.filter(r=>r.date>=debut&&r.date<=fin&&(!pdvF||r.pdv===pdvF));
  const verF=versements.filter(v=>v.date>=debut&&v.date<=fin&&(!pdvF||v.pdv===pdvF)&&(!cptF||v.compte===cptF));
  const mvtF=mvts.filter(m=>m.date>=debut&&m.date<=fin&&(!cptF||m.compte===cptF));
  const trfF=transferts.filter(t=>t.date>=debut&&t.date<=fin);
  const totRec=recF.reduce((s,r)=>s+(r.montant||0),0);
  const totVer=verF.reduce((s,v)=>s+(v.montant||0),0);
  const totConf=verF.filter(v=>v.statut==='confirmé').reduce((s,v)=>s+(v.montant||0),0);
  const totTrf=trfF.reduce((s,t)=>s+(t.montant||0),0);
  window._releveData={debut,fin,pdvF,cptF,recF,verF,mvtF,trfF,totRec,totVer,totConf,totTrf};
  const preview=document.getElementById('relevePreview');
  if(!preview)return;
  preview.innerHTML=`
    <div id="relevePrintZone" style="font-family:Arial,sans-serif;color:#111">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:12px;border-bottom:2px solid #00C47A">
        <div>
          <div style="font-size:1.3rem;font-weight:800;color:#00C47A">${PHARMACIE_NOM}</div>
          <div style="font-size:.85rem;color:#666;margin-top:4px">Relevé de trésorerie — ${fmtD(debut)} au ${fmtD(fin)}</div>
          ${pdvF?`<div style="font-size:.8rem;color:#666">PDV : ${pdvs.find(p=>p.id===pdvF)?.nom||pdvF}</div>`:''}
          ${cptF?`<div style="font-size:.8rem;color:#666">Compte : ${comptes.find(c=>c.id===cptF)?.nom||cptF}</div>`:''}
        </div>
        <div style="text-align:right;font-size:.75rem;color:#999">Généré le ${new Date().toLocaleString('fr-FR')}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
        ${[['Total recettes',totRec,'#00C47A'],['Total versé',totVer,'#4d8af0'],['Confirmé',totConf,'#a855f7'],['Transferts MM→BQ',totTrf,'#f5a623']]
          .map(([l,v,c])=>`<div style="border:1px solid #eee;border-radius:8px;padding:12px;border-left:3px solid ${c}"><div style="font-size:.7rem;color:#999;text-transform:uppercase">${l}</div><div style="font-size:1.1rem;font-weight:800;color:${c}">${fmt(v)} ${DEVISE}</div></div>`).join('')}
      </div>
      ${recF.length?`
      <div style="margin-bottom:20px">
        <div style="font-weight:700;margin-bottom:8px;font-size:.85rem;text-transform:uppercase;color:#555">Recettes (${recF.length})</div>
        <table style="width:100%;border-collapse:collapse;font-size:.82rem">
          <thead><tr>${['Date','PDV','Canal','Type','Montant','Saisi par'].map(h=>`<th style="background:#f5f5f5;padding:7px 10px;text-align:left;border:1px solid #eee">${h}</th>`).join('')}</tr></thead>
          <tbody>${recF.map((r,i)=>`<tr style="background:${i%2?'#fafafa':'#fff'}">${[fmtD(r.date),pdvs.find(p=>p.id===r.pdv)?.nom||r.pdv,MM_LABEL[r.canal]||r.canal,r.type,fmt(r.montant)+' '+DEVISE,r.saisie||'—'].map(v=>`<td style="padding:6px 10px;border:1px solid #eee">${v}</td>`).join('')}</tr>`).join('')}
          <tr style="background:#e8f5f0;font-weight:700"><td colspan="4" style="padding:6px 10px;border:1px solid #ccc">TOTAL</td><td style="padding:6px 10px;border:1px solid #ccc;color:#00C47A">${fmt(totRec)} ${DEVISE}</td><td style="border:1px solid #ccc"></td></tr>
          </tbody>
        </table>
      </div>`:''}
      ${verF.length?`
      <div style="margin-bottom:20px">
        <div style="font-weight:700;margin-bottom:8px;font-size:.85rem;text-transform:uppercase;color:#555">Versements (${verF.length})</div>
        <table style="width:100%;border-collapse:collapse;font-size:.82rem">
          <thead><tr>${['Date','PDV','Type','Compte','Référence','Montant','Statut'].map(h=>`<th style="background:#f5f5f5;padding:7px 10px;text-align:left;border:1px solid #eee">${h}</th>`).join('')}</tr></thead>
          <tbody>${verF.map((v,i)=>{const cpt=comptes.find(c=>c.id===v.compte);return`<tr style="background:${i%2?'#fafafa':'#fff'}">${[fmtD(v.date),pdvs.find(p=>p.id===v.pdv)?.nom||v.pdv,MM_LABEL[v.type]||v.type,cpt?.nom||'—',v.ref||'—',fmt(v.montant)+' '+DEVISE,v.statut].map(x=>`<td style="padding:6px 10px;border:1px solid #eee">${x}</td>`).join('')}</tr>`;}).join('')}
          <tr style="background:#e8f0ff;font-weight:700"><td colspan="5" style="padding:6px 10px;border:1px solid #ccc">TOTAL</td><td style="padding:6px 10px;border:1px solid #ccc;color:#4d8af0">${fmt(totVer)} ${DEVISE}</td><td style="border:1px solid #ccc"></td></tr>
          </tbody>
        </table>
      </div>`:''}
      ${trfF.length?`
      <div style="margin-bottom:20px">
        <div style="font-weight:700;margin-bottom:8px;font-size:.85rem;text-transform:uppercase;color:#555">Transferts MM → Banque (${trfF.length})</div>
        <table style="width:100%;border-collapse:collapse;font-size:.82rem">
          <thead><tr>${['Date','Compte source (MM)','Compte dest. (Banque)','Référence','Montant'].map(h=>`<th style="background:#f5f5f5;padding:7px 10px;text-align:left;border:1px solid #eee">${h}</th>`).join('')}</tr></thead>
          <tbody>${trfF.map((t,i)=>{const src=comptes.find(c=>c.id===t.compteSrc),dst=comptes.find(c=>c.id===t.compteDst);return`<tr style="background:${i%2?'#fafafa':'#fff'}">${[fmtD(t.date),src?.nom||'—',dst?.nom||'—',t.ref||'—',fmt(t.montant)+' '+DEVISE].map(v=>`<td style="padding:6px 10px;border:1px solid #eee">${v}</td>`).join('')}</tr>`;}).join('')}</tbody>
        </table>
      </div>`:''}
      <div style="margin-top:30px;display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div style="border-top:1px solid #ccc;padding-top:8px;font-size:.82rem;color:#999">Signature Responsable</div>
        <div style="border-top:1px solid #ccc;padding-top:8px;font-size:.82rem;color:#999">Cachet & Signature Comptable</div>
      </div>
    </div>`;
}
window.genererReleve=genererReleve;

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
  // Construit un CSV compatible Excel (séparateur ;)
  const rows=[];
  rows.push([PHARMACIE_NOM]);
  rows.push([`Relevé du ${fmtD(d.debut)} au ${fmtD(d.fin)}`]);
  rows.push([]);
  rows.push(['=== RÉCAPITULATIF ===']);
  rows.push(['Total recettes',fmt(d.totRec),DEVISE]);
  rows.push(['Total versé',fmt(d.totVer),DEVISE]);
  rows.push(['Confirmé',fmt(d.totConf),DEVISE]);
  rows.push(['Transferts MM→BQ',fmt(d.totTrf),DEVISE]);
  rows.push([]);
  if(d.recF.length){
    rows.push(['=== RECETTES ===']);
    rows.push(['Date','PDV','Canal','Type','Montant','Référence','Saisi par']);
    d.recF.forEach(r=>rows.push([fmtD(r.date),pdvs.find(p=>p.id===r.pdv)?.nom||r.pdv,MM_LABEL[r.canal]||r.canal,r.type,r.montant,r.ref||'',r.saisie||'']));
    rows.push(['TOTAL','','','',d.totRec]);
    rows.push([]);
  }
  if(d.verF.length){
    rows.push(['=== VERSEMENTS ===']);
    rows.push(['Date','PDV','Type','Compte','Référence','Montant','Statut','Saisi par']);
    d.verF.forEach(v=>{const cpt=comptes.find(c=>c.id===v.compte);rows.push([fmtD(v.date),pdvs.find(p=>p.id===v.pdv)?.nom||v.pdv,MM_LABEL[v.type]||v.type,cpt?.nom||'',v.ref||'',v.montant,v.statut,v.saisie||'']);});
    rows.push(['TOTAL','','','','',d.totVer]);
    rows.push([]);
  }
  if(d.trfF.length){
    rows.push(['=== TRANSFERTS MM→BANQUE ===']);
    rows.push(['Date','Compte source','Compte dest.','Référence','Montant']);
    d.trfF.forEach(t=>{const src=comptes.find(c=>c.id===t.compteSrc),dst=comptes.find(c=>c.id===t.compteDst);rows.push([fmtD(t.date),src?.nom||'',dst?.nom||'',t.ref||'',t.montant]);});
  }
  // Soldes actuels
  rows.push([]);rows.push(['=== SOLDES ACTUELS ===']);
  rows.push(['Compte','Catégorie','Solde',DEVISE,'Disponibilité']);
  comptes.filter(c=>c.actif!==false).forEach(c=>rows.push([c.nom,c.cat,c.solde,DEVISE,isBanque(c)?'Disponible':'En transit']));

  const csv=rows.map(r=>r.map(cell=>{
    const s=String(cell??'').replace(/"/g,'""');
    return s.includes(';')||s.includes('"')||s.includes('\n')?`"${s}"`:s;
  }).join(';')).join('\n');
  const bom='\uFEFF'; // BOM pour Excel
  const blob=new Blob([bom+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`releve_${d.debut}_${d.fin}.csv`;
  a.click();URL.revokeObjectURL(a.href);
  toast('Export Excel (.csv) téléchargé ✓');
}
window.exporterReleveExcel=exporterReleveExcel;

function exporterReleveWord(){
  const zone=document.getElementById('relevePrintZone');
  if(!zone){toast('Génère d\'abord le relevé','err');return;}
  const d=window._releveData;
  const html=`<!DOCTYPE html><html xmlns:o='urn:schemas-microsoft-com:office:office'
    xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head><meta charset="UTF-8"><meta name=ProgId content=Word.Document>
    <meta name=Generator content='Microsoft Word 15'><title>Relevé ${PHARMACIE_NOM}</title>
    <style>body{font-family:Arial,sans-serif;font-size:11pt}
    table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:5pt 8pt;font-size:10pt}
    th{background:#f0f0f0;font-weight:bold}.green{color:#00C47A}.total{font-weight:bold;background:#e8f5f0}</style>
    </head><body>${zone.innerHTML}</body></html>`;
  const blob=new Blob([html],{type:'application/msword;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`releve_${d?.debut||today()}_${d?.fin||today()}.doc`;
  a.click();URL.revokeObjectURL(a.href);
  toast('Export Word (.doc) téléchargé ✓');
}
window.exporterReleveWord=exporterReleveWord;

// ══════════════════════════════════════════════════════
// ADMIN — CONFIG
// ══════════════════════════════════════════════════════
function adminTab(name){
  document.querySelectorAll('#pg-admin .inner-tab').forEach((t,i)=>t.classList.toggle('active',['pdv','comptes'][i]===name));
  document.getElementById('adm-pdv').style.display=name==='pdv'?'block':'none';
  document.getElementById('adm-comptes').style.display=name==='comptes'?'block':'none';
}
window.adminTab=adminTab;
function renderAdmin(){
  adminTab('pdv');
  document.getElementById('pdvTbody').innerHTML=pdvs.map(p=>{
    let ps=FREQ_LABEL[p.freq]||p.freq;
    if((p.freq==='hebdomadaire'||p.freq==='bimensuel')&&p.jours?.length)ps+=` (${p.jours.map(j=>JOURS_NOM[j]).join(',')})`;
    if(p.freq==='mensuel'&&p.jourMois)ps+=` j${p.jourMois}`;if(p.heure)ps+=` ≤${p.heure}`;
    const cd=comptes.find(c=>c.id===p.compteDefaut);
    return`<tr><td><b>${p.nom}</b></td><td><span class="badge ${p.type==='principale'?'bg':'bb'}">${p.type}</span></td>
    <td style="color:var(--text2);font-size:.78rem">${p.addr||'—'}</td>
    <td style="color:var(--text2);font-size:.78rem">${p.resp||'—'}</td>
    <td><span class="wk">${ps}</span></td>
    <td style="font-size:.72rem;color:var(--text2)">${cd?cd.nom:'—'}</td>
    <td><button class="btn btn-ghost btn-xs" onclick="editPDV('${p.id}')">✏️</button>
    <button class="btn btn-red btn-xs" onclick="delPDV('${p.id}')">✕</button></td></tr>`;
  }).join('');
  document.getElementById('cptTbody').innerHTML=comptes.map(c=>{
    const op=c.op==='AUTRE'&&c.opLibre?c.opLibre:c.op;
    const dot=c.color?`<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c.color};margin-right:5px;vertical-align:middle"></span>`:'';
    return`<tr><td>${dot}<b>${c.nom}</b></td>
    <td><span class="badge ${c.cat==='mobile_money'?'bc':c.cat==='banque'?'bb':'bg'}">${c.cat}</span></td>
    <td>${OP_ICONS[c.op]||'💳'} ${op}</td>
    <td style="color:var(--text2);font-size:.75rem;font-family:monospace">${c.num||'—'}</td>
    <td class="amt">${fmt(c.soldeInit)}</td>
    <td class="amt ${(c.solde||0)>=0?'pos':'neg'}">${fmt(c.solde)}</td>
    <td>${dispoBadge(c)}</td>
    <td><span class="badge ${c.actif!==false?'bg':'br'}">${c.actif!==false?'Actif':'Inactif'}</span></td>
    <td><button class="btn btn-ghost btn-xs" onclick="editCompte('${c.id}')">✏️</button>
    <button class="btn btn-red btn-xs" onclick="delCompte('${c.id}')">✕</button></td></tr>`;
  }).join('');
}
window.renderAdmin=renderAdmin;

// PDV CRUD
function onPDVFreqChange(){
  const v=document.getElementById('mPDVFreq').value;
  document.getElementById('pdvJoursWrap').style.display=(v==='hebdomadaire'||v==='bimensuel')?'block':'none';
  document.getElementById('pdvJourMoisWrap').style.display=v==='mensuel'?'block':'none';
}
window.onPDVFreqChange=onPDVFreqChange;
function openPDVModal(id){
  document.getElementById('mPDVTitle').textContent=id?'Modifier PDV':'Nouveau PDV';
  document.getElementById('mPDVId').value=id||'';
  document.getElementById('mPDVCompte').innerHTML='<option value="">— Aucun —</option>'+comptes.map(c=>`<option value="${c.id}">${c.nom}</option>`).join('');
  const p=id?pdvs.find(x=>x.id===id):{};
  document.getElementById('mPDVNom').value=p.nom||'';document.getElementById('mPDVType').value=p.type||'principale';
  document.getElementById('mPDVAddr').value=p.addr||'';document.getElementById('mPDVResp').value=p.resp||'';
  document.getElementById('mPDVFreq').value=p.freq||'quotidien';document.getElementById('mPDVHeure').value=p.heure||'';
  document.getElementById('mPDVTel').value=p.tel||'';document.getElementById('mPDVCompte').value=p.compteDefaut||'';
  document.getElementById('mPDVJourMois').value=p.jourMois||'';document.getElementById('mPDVNotes').value=p.notes||'';
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
  const data={nom,type:document.getElementById('mPDVType').value,addr:document.getElementById('mPDVAddr').value,
    resp:document.getElementById('mPDVResp').value,freq:document.getElementById('mPDVFreq').value,
    heure:document.getElementById('mPDVHeure').value,tel:document.getElementById('mPDVTel').value,
    compteDefaut:document.getElementById('mPDVCompte').value,jourMois:document.getElementById('mPDVJourMois').value,
    jours,notes:document.getElementById('mPDVNotes').value};
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
  document.getElementById('mCptNom').value=c.nom||'';document.getElementById('mCptCat').value=c.cat||'mobile_money';
  document.getElementById('mCptOp').value=c.op||'OM';document.getElementById('mCptOpLibre').value=c.opLibre||'';
  document.getElementById('mCptOpLibre').style.display=c.op==='AUTRE'?'block':'none';
  document.getElementById('mCptNum').value=c.num||'';document.getElementById('mCptContact').value=c.contact||'';
  document.getElementById('mCptSolde').value=c.soldeInit||0;document.getElementById('mCptColor').value=c.color||'#4d8af0';
  document.getElementById('mCptNotes').value=c.notes||'';
  const actifEl=document.getElementById('mCptActif');if(actifEl)actifEl.checked=c.actif!==false;
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
  const data={nom,cat:document.getElementById('mCptCat').value,op,
    opLibre:op==='AUTRE'?document.getElementById('mCptOpLibre').value:'',
    num:document.getElementById('mCptNum').value,contact:document.getElementById('mCptContact').value,
    soldeInit,color:document.getElementById('mCptColor').value,notes:document.getElementById('mCptNotes').value,
    actif:actifEl?actifEl.checked:true};
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
  const solde=petiteCaisse.reduce((s,m)=>s+(m.type==='appro'?m.montant:-(m.montant||0)),0);
  const tbody=document.getElementById('pcTbody');
  const data=[...petiteCaisse].sort((a,b)=>b.date?.localeCompare(a.date||'')||0);
  el('pcSolde',fmt(solde)+' '+DEVISE);
  const soldeEl=document.getElementById('pcSoldeEl');
  if(soldeEl)soldeEl.style.color=solde>=0?'var(--green)':'var(--red)';
  if(!tbody)return;
  if(!data.length){tbody.innerHTML='<tr><td colspan="7"><div class="empty-state"><div class="ei">💰</div>Aucun mouvement petite caisse</div></td></tr>';return;}
  let running=0;
  const rows=[...data].reverse().map(m=>{
    running+=m.type==='appro'?m.montant:-(m.montant||0);
    return{...m,soldeApres:running};
  }).reverse();
  tbody.innerHTML=rows.map(m=>`<tr>
    <td>${fmtD(m.date)}</td>
    <td><span class="badge ${m.type==='appro'?'bg':'br'}">${m.type==='appro'?'Approvisionnement':'Dépense'}</span></td>
    <td style="font-size:.82rem">${m.libelle||'—'}</td>
    <td style="font-size:.78rem;color:var(--text2)">${m.categorie||'—'}</td>
    <td class="amt ${m.type==='appro'?'pos':'neg'}">${m.type==='appro'?'+':'-'}${fmt(m.montant)}</td>
    <td class="amt">${fmt(m.soldeApres)}</td>
    <td style="font-size:.75rem;color:var(--text2)">${m.saisie||'—'}</td>
  </tr>`).join('');
}
window.renderPetiteCaisse=renderPetiteCaisse;

function openPCModal(type){
  document.getElementById('pcMType').value=type;
  document.getElementById('pcMTitle').textContent=type==='appro'?'Approvisionnement petite caisse':'Dépense petite caisse';
  document.getElementById('pcMDate').value=today();
  document.getElementById('pcMMontant').value='';
  document.getElementById('pcMLibelle').value='';
  document.getElementById('pcMCategorie').value=type==='appro'?'approvisionnement':'autre';
  document.getElementById('pcMSaisie').value=currentUser.nom;
  document.getElementById('pcCaisseSource').style.display=type==='appro'?'block':'none';
  openM('mPetiteCaisse');
}
window.openPCModal=openPCModal;

async function savePCMouvement(){
  const type=document.getElementById('pcMType').value;
  const date=document.getElementById('pcMDate').value;
  const montant=parseFloat(document.getElementById('pcMMontant').value);
  const libelle=document.getElementById('pcMLibelle').value.trim();
  if(!date||!montant){toast('Date et montant obligatoires','err');return;}
  // Si appro : débite la caisse principale
  if(type==='appro'){
    const caisseEl=document.getElementById('pcCaisseId');
    if(caisseEl&&caisseEl.value){
      const c=comptes.find(x=>x.id===caisseEl.value);
      if(c){
        c.solde=(c.solde||0)-montant;
        await saveItem('comptes',c);
        const m={id:uid(),date,compte:c.id,type:'sortie',
          libelle:`Appro petite caisse${libelle?' — '+libelle:''}`,
          ref:'',montant,soldeApres:c.solde,saisie:currentUser.nom,ts:Date.now()};
        mvts.push(m);await saveItem('mvts',m);
      }
    }
  }
  const item={id:uid(),date,type,libelle,
    categorie:document.getElementById('pcMCategorie').value,
    montant,saisie:currentUser.nom,notes:'',ts:Date.now()};
  petiteCaisse.push(item);await saveItem('petiteCaisse',item);
  closeM('mPetiteCaisse');
  toast(type==='appro'?'Approvisionnement enregistré ✓':'Dépense enregistrée ✓');
  renderPetiteCaisse();renderDashboard();
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
  tbody.innerHTML=data.map(c=>{
    const ecC=c.ecart===0?'amt pos':c.ecart<0?'amt neg':'amt neu';
    return`<tr>
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
    const cpt=comptes.find(c=>c.id===cptF);
    const mvtF=[
      ...mvts.filter(m=>m.date>=debut&&m.date<=fin&&(!cptF||m.compte===cptF)),
      ...transferts.filter(t=>t.date>=debut&&t.date<=fin&&(!cptF||t.compteSrc===cptF||t.compteDst===cptF))
    ].sort((a,b)=>a.date?.localeCompare(b.date||'')||0);
    const verF=versements.filter(v=>v.date>=debut&&v.date<=fin&&v.statut==='confirmé'&&(!cptF||v.compte===cptF));
    window._releveData={type,debut,fin,cptF,cpt,mvtF,verF};
    preview.innerHTML=_buildRelEtablissement(debut,fin,cpt,mvtF,verF);

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

function _buildRelEtablissement(debut,fin,cpt,mvtF,verF){
  const nom=cpt?cpt.nom:'Tous les comptes';
  // Calcul solde progressif
  let soldeInit=cpt?.solde||0;
  // Recalcule solde début de période
  const tousMvts=[...mvtF].sort((a,b)=>a.date?.localeCompare(b.date||'')||0);
  return`<div id="relevePrintZone" style="font-family:Arial,sans-serif;color:#111">
    ${_headerReleve('Relevé Établissement Financier',debut,fin,nom)}
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px">
      ${[['Entrées',tousMvts.filter(m=>m.type==='entrée').reduce((s,m)=>s+(m.montant||0),0),'#00C47A'],
         ['Sorties',tousMvts.filter(m=>m.type==='sortie').reduce((s,m)=>s+(m.montant||0),0),'#f05050'],
         ['Solde actuel',cpt?.solde||0,'#4d8af0']]
        .map(([l,v,c])=>`<div style="border:1px solid #eee;border-radius:8px;padding:12px;border-left:3px solid ${c}"><div style="font-size:.7rem;color:#999;text-transform:uppercase">${l}</div><div style="font-size:1.1rem;font-weight:800;color:${c}">${fmt(v)} ${DEVISE}</div></div>`).join('')}
    </div>
    ${verF.length?`<div style="margin-bottom:12px">
      <div style="font-weight:700;margin-bottom:8px;font-size:.85rem;text-transform:uppercase;color:#555">Versements reçus (${verF.length})</div>
      <table style="width:100%;border-collapse:collapse;font-size:.82rem">
        <thead><tr>${['Date','PDV','Type','Montant','Référence'].map(h=>`<th style="background:#f5f5f5;padding:7px 10px;text-align:left;border:1px solid #eee">${h}</th>`).join('')}</tr></thead>
        <tbody>${verF.map((v,i)=>`<tr style="background:${i%2?'#fafafa':'#fff'}">${[fmtD(v.date),pdvs.find(p=>p.id===v.pdv)?.nom||v.pdv,MM_LABEL[v.type]||v.type,fmt(v.montant)+' '+DEVISE,v.ref||'—'].map(x=>`<td style="padding:6px 10px;border:1px solid #eee">${x}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`:''}
    ${tousMvts.length?`<div style="margin-bottom:20px">
      <div style="font-weight:700;margin-bottom:8px;font-size:.85rem;text-transform:uppercase;color:#555">Journal des mouvements (${tousMvts.length})</div>
      <table style="width:100%;border-collapse:collapse;font-size:.82rem">
        <thead><tr>${['Date','Type','Libellé','Référence','Montant','Solde après'].map(h=>`<th style="background:#f5f5f5;padding:7px 10px;text-align:left;border:1px solid #eee">${h}</th>`).join('')}</tr></thead>
        <tbody>${tousMvts.map((m,i)=>`<tr style="background:${i%2?'#fafafa':'#fff'}">
          <td style="padding:6px 10px;border:1px solid #eee">${fmtD(m.date)}</td>
          <td style="padding:6px 10px;border:1px solid #eee"><span style="color:${m.type==='entrée'?'#00C47A':'#f05050'};font-weight:700">${m.type==='entrée'?'↑ Entrée':'↓ Sortie'}</span></td>
          <td style="padding:6px 10px;border:1px solid #eee">${m.libelle||'—'}</td>
          <td style="padding:6px 10px;border:1px solid #eee">${m.ref||'—'}</td>
          <td style="padding:6px 10px;border:1px solid #eee;color:${m.type==='entrée'?'#00C47A':'#f05050'};font-weight:700">${m.type==='entrée'?'+':'-'}${fmt(m.montant)} ${DEVISE}</td>
          <td style="padding:6px 10px;border:1px solid #eee;font-weight:700">${fmt(m.soldeApres||0)} ${DEVISE}</td>
        </tr>`).join('')}</tbody>
      </table></div>`:'<div style="color:#999;text-align:center;padding:20px">Aucun mouvement sur cette période</div>'}
    <div style="margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div style="border-top:1px solid #ccc;padding-top:8px;font-size:.82rem;color:#999">Signature Responsable</div>
      <div style="border-top:1px solid #ccc;padding-top:8px;font-size:.82rem;color:#999">Cachet & Signature Comptable</div>
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
window.refreshPage=refreshPage;
async function init(){
  if(useFirebase){sync('syncing','Connexion…');try{await loadAll();sync('ok','🔴 Temps réel');}catch(e){sync('error','Mode local');}}
  else sync('ok','Mode local');
  document.getElementById('loadingOverlay').style.display='none';
  document.getElementById('loginScreen').style.display='flex';
  document.getElementById('loginUser').focus();
}
init();
