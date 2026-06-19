// ═══════════════════════════════════════════════════════
// PHARMACASH PRO — app.js
// Firebase Firestore + LocalStorage fallback
// Sauvegarde automatique PC + Dropbox
// ═══════════════════════════════════════════════════════

import { initializeApp }       from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, doc, getDocs,
         addDoc, setDoc, deleteDoc, onSnapshot,
         serverTimestamp, query, orderBy }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── CONFIGURATION ─────────────────────────────────────
// Remplace ces valeurs par celles de la console Firebase
// https://console.firebase.google.com → Ton projet → Paramètres → Tes apps
const FIREBASE_CONFIG = {
  apiKey:            "COLLE_TON_API_KEY",
  authDomain:        "COLLE_TON_PROJECT.firebaseapp.com",
  projectId:         "COLLE_TON_PROJECT_ID",
  storageBucket:     "COLLE_TON_PROJECT.appspot.com",
  messagingSenderId: "COLLE_TON_SENDER_ID",
  appId:             "COLLE_TON_APP_ID"
};

// ── DROPBOX ────────────────────────────────────────────
// Génère un token sur https://www.dropbox.com/developers/apps
// Crée une app → "App folder" → Generate access token
const DROPBOX_TOKEN   = "COLLE_TON_DROPBOX_TOKEN";
const DROPBOX_FOLDER  = "/PharmaCash/sauvegardes";
const AUTO_BACKUP_HOUR = 23; // heure de sauvegarde automatique

// ── FIREBASE INIT ──────────────────────────────────────
let db, useFirebase = false;
try {
  if (!FIREBASE_CONFIG.apiKey.startsWith('COLLE')) {
    const app = initializeApp(FIREBASE_CONFIG);
    db = getFirestore(app);
    useFirebase = true;
  }
} catch(e) {
  console.warn('Firebase non configuré — mode local activé', e);
}

// ── LOCAL STORAGE FALLBACK ─────────────────────────────
const LS = {
  g(k) { try { return JSON.parse(localStorage.getItem('pc_'+k)||'null'); } catch { return null; } },
  s(k,v) { localStorage.setItem('pc_'+k, JSON.stringify(v)); }
};

// ── DEFAULT DATA ───────────────────────────────────────
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
  { id:'c1', nom:'Orange Money — Centrale', cat:'mobile_money', op:'OM',
    opLibre:'', num:'', contact:'', soldeInit:0, solde:0, color:'#ff6b00', notes:'' },
  { id:'c2', nom:'MTN MoMo — Centrale', cat:'mobile_money', op:'MTN',
    opLibre:'', num:'', contact:'', soldeInit:0, solde:0, color:'#f5a623', notes:'' },
  { id:'c3', nom:'Wave — Centrale', cat:'mobile_money', op:'WAVE',
    opLibre:'', num:'', contact:'', soldeInit:0, solde:0, color:'#22d3ee', notes:'' },
  { id:'c4', nom:'BICICI — Compte principal', cat:'banque', op:'BICICI',
    opLibre:'', num:'', contact:'', soldeInit:0, solde:0, color:'#4d8af0', notes:'' },
  { id:'c5', nom:'Caisse espèces', cat:'caisse', op:'CASH',
    opLibre:'', num:'', contact:'', soldeInit:0, solde:0, color:'#00d68f', notes:'' }
];

// ── STATE ──────────────────────────────────────────────
let users      = LS.g('users')      || DEF_USERS;
let pdvs       = LS.g('pdvs')       || DEF_PDV;
let comptes    = LS.g('comptes')    || DEF_COMPTES;
let recettes   = LS.g('recettes')   || [];
let versements = LS.g('versements') || [];
let mvts       = LS.g('mvts')       || [];
let clotures   = LS.g('clotures')   || [];
let currentUser = null;
let backupTimer = null;

// ══════════════════════════════════════════════════════
// FIREBASE HELPERS
// ══════════════════════════════════════════════════════
async function fbLoad(col) {
  if (!useFirebase) return null;
  try {
    const snap = await getDocs(collection(db, col));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) { console.warn('fbLoad', col, e); return null; }
}

async function fbSave(col, id, data) {
  if (!useFirebase) return;
  // strip undefined — Firestore rejects them
  const clean = JSON.parse(JSON.stringify(data));
  try { await setDoc(doc(db, col, id), { ...clean, _ts: serverTimestamp() }); }
  catch(e) { console.warn('fbSave', e); }
}

async function fbDel(col, id) {
  if (!useFirebase) return;
  try { await deleteDoc(doc(db, col, id)); } catch(e) {}
}

async function loadAll() {
  sync('syncing', 'Chargement…');
  const [fu, fp, fc, fr, fv, fm, fcl] = await Promise.all([
    fbLoad('users'), fbLoad('pdvs'), fbLoad('comptes'),
    fbLoad('recettes'), fbLoad('versements'), fbLoad('mvts'), fbLoad('clotures')
  ]);
  if (fu)  users      = fu;
  if (fp)  pdvs       = fp;
  if (fc)  comptes    = fc;
  if (fr)  recettes   = fr;
  if (fv)  versements = fv;
  if (fm)  mvts       = fm;
  if (fcl) clotures   = fcl;
  saveLocal();
  sync('ok', '🔴 Temps réel');
}

function subscribeAll() {
  if (!useFirebase) return;
  onSnapshot(collection(db,'recettes'),   s => { recettes   = s.docs.map(d=>({id:d.id,...d.data()})); saveLocal(); refreshActive('recettes');   renderDashboard(); });
  onSnapshot(collection(db,'versements'), s => { versements = s.docs.map(d=>({id:d.id,...d.data()})); saveLocal(); refreshActive('versements'); renderDashboard(); });
  onSnapshot(collection(db,'clotures'),   s => { clotures   = s.docs.map(d=>({id:d.id,...d.data()})); saveLocal(); refreshActive('caisse'); });
  onSnapshot(collection(db,'mvts'),       s => { mvts       = s.docs.map(d=>({id:d.id,...d.data()})); saveLocal(); refreshActive('banques'); });
  onSnapshot(collection(db,'comptes'),    s => { comptes    = s.docs.map(d=>({id:d.id,...d.data()})); saveLocal(); renderDashboard(); refreshActive('banques'); });
}

function refreshActive(name) {
  const el = document.getElementById('pg-'+name);
  if (el && el.classList.contains('active')) {
    const fn = { recettes:renderRecettes, versements:renderVersements, caisse:renderCaisse, banques:renderBanques }[name];
    if (fn) fn();
  }
}

// ── SAVE ──────────────────────────────────────────────
function saveLocal() {
  LS.s('users',users); LS.s('pdvs',pdvs); LS.s('comptes',comptes);
  LS.s('recettes',recettes); LS.s('versements',versements);
  LS.s('mvts',mvts); LS.s('clotures',clotures);
}

async function saveItem(col, item) {
  saveLocal();
  if (useFirebase) { sync('syncing','Sync…'); await fbSave(col, item.id, item); sync('ok','🔴 Temps réel'); }
}

async function delItem(col, id) {
  saveLocal();
  if (useFirebase) { sync('syncing','Sync…'); await fbDel(col, id); sync('ok','🔴 Temps réel'); }
}

// ══════════════════════════════════════════════════════
// BACKUP
// ══════════════════════════════════════════════════════
function buildBlob() {
  const data = { users, pdvs, comptes, recettes, versements, mvts, clotures,
                 exportedAt: new Date().toISOString(), version: '3.0' };
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

function backupPC() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(buildBlob());
  a.download = `pharmacash_${today()}.json`;
  a.click(); URL.revokeObjectURL(a.href);
  const ts = new Date().toLocaleString('fr-FR');
  LS.s('lastBackupPC', ts);
  updateBackupUI();
  toast('Sauvegarde PC téléchargée ✓');
}

async function backupDropbox() {
  if (!DROPBOX_TOKEN || DROPBOX_TOKEN.startsWith('COLLE')) {
    toast('Token Dropbox non configuré dans app.js', 'err'); return;
  }
  try {
    sync('syncing','Dropbox…');
    const ts  = new Date().toTimeString().slice(0,5).replace(':','h');
    const path = `${DROPBOX_FOLDER}/pharmacash_${today()}_${ts}.json`;
    const resp = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DROPBOX_TOKEN}`,
        'Dropbox-API-Arg': JSON.stringify({ path, mode:'overwrite', autorename:false }),
        'Content-Type': 'application/octet-stream'
      },
      body: buildBlob()
    });
    if (!resp.ok) throw new Error(await resp.text());
    const dts = new Date().toLocaleString('fr-FR');
    LS.s('lastBackupDB', dts);
    sync('ok','🔴 Temps réel');
    updateBackupUI();
    toast('Sauvegarde Dropbox envoyée ✓');
  } catch(e) {
    sync('error','Erreur');
    toast('Dropbox : ' + e.message, 'err');
  }
}

async function backupNow() { backupPC(); await backupDropbox(); }

function updateBackupUI() {
  const lbPC = LS.g('lastBackupPC') || '—';
  const lbDB = LS.g('lastBackupDB') || '—';
  el('lastBackupLabel', lbPC !== '—' ? lbPC : lbDB !== '—' ? lbDB : 'Jamais');
  el('lastBackupPC', lbPC); el('lastBackupDB', lbDB);
  const nb = document.getElementById('nextBackup');
  if (nb) {
    const d = new Date(); d.setHours(AUTO_BACKUP_HOUR, 0, 0, 0);
    if (d < new Date()) d.setDate(d.getDate()+1);
    nb.textContent = d.toLocaleString('fr-FR');
  }
}

function scheduleAutoBackup() {
  if (backupTimer) clearTimeout(backupTimer);
  const now = new Date(), next = new Date();
  next.setHours(AUTO_BACKUP_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate()+1);
  backupTimer = setTimeout(async () => { await backupNow(); scheduleAutoBackup(); }, next - now);
}

function importerDonnees(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!confirm(`Importer sauvegarde du\n${data.exportedAt ? new Date(data.exportedAt).toLocaleString('fr-FR') : '?'}\n\n⚠️ Remplace toutes les données actuelles.`)) return;
      if (data.users)      users      = data.users;
      if (data.pdvs)       pdvs       = data.pdvs;
      if (data.comptes)    comptes    = data.comptes;
      if (data.recettes)   recettes   = data.recettes;
      if (data.versements) versements = data.versements;
      if (data.mvts)       mvts       = data.mvts;
      if (data.clotures)   clotures   = data.clotures;
      saveLocal();
      if (useFirebase) {
        sync('syncing','Upload…');
        for (const x of [...users,...pdvs,...comptes,...recettes,...versements,...mvts,...clotures]) {
          const col = users.includes(x)?'users':pdvs.includes(x)?'pdvs':comptes.includes(x)?'comptes':
                      recettes.includes(x)?'recettes':versements.includes(x)?'versements':
                      mvts.includes(x)?'mvts':'clotures';
          await fbSave(col, x.id, x);
        }
        sync('ok','🔴 Temps réel');
      }
      populateSelects(); renderDashboard();
      toast('Données importées ✓'); closeM('mBackup');
    } catch(err) { toast('Erreur fichier JSON', 'err'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ══════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════
const fmt    = n  => new Intl.NumberFormat('fr-FR').format(Math.round(n||0));
const today  = () => new Date().toISOString().split('T')[0];
const nowTm  = () => new Date().toTimeString().slice(0,5);
const uid    = () => Date.now().toString(36) + Math.random().toString(36).slice(2,5);
const fmtD   = d  => { if(!d)return'—'; const[y,m,j]=d.split('-'); return`${j}/${m}/${y}`; };
const initials = n => n.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
const nv     = id => parseFloat(document.getElementById(id)?.value)||0;
const el     = (id, txt) => { const e=document.getElementById(id); if(e) e.textContent=txt; };
function sync(state, label) {
  const dot = document.getElementById('syncDot');
  const lbl = document.getElementById('syncLabel');
  if (dot) dot.className = 'sync-dot' + (state==='syncing'?' syncing':state==='error'?' error':'');
  if (lbl) lbl.textContent = label;
}
function toast(msg, type='ok') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show ' + type;
  setTimeout(() => { t.className = 'toast'; }, 2800);
}
function closeM(id) { document.getElementById(id)?.classList.remove('open'); }
function openM(id)  { document.getElementById(id)?.classList.add('open'); updateBackupUI(); }
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-ov')) e.target.classList.remove('open');
});
function resetFilter(...ids) { ids.forEach(id => { const e=document.getElementById(id); if(e)e.value=''; }); }
function weekBounds(d) {
  const dt=new Date(d), day=dt.getDay()||7, mon=new Date(dt);
  mon.setDate(dt.getDate()-day+1);
  const sun=new Date(mon); sun.setDate(mon.getDate()+6);
  return { start:mon.toISOString().split('T')[0], end:sun.toISOString().split('T')[0] };
}
const MM_LABEL = { OM:'🟠 Orange Money',MTN:'🟡 MTN MoMo',WAVE:'🔵 Wave',MOOV:'🟢 Moov Money',CASH:'💵 Cash',CHEQUE:'📝 Chèque',VIREMENT:'🏦 Virement' };
const OP_ICONS = { OM:'🟠',MTN:'🟡',WAVE:'🔵',MOOV:'🟢',BICICI:'🏦',SGBCI:'🏦',ECOBANK:'🏦',UBA:'🏦',BNI:'🏦',NSIA:'🏦',SIB:'🏦',CORIS:'🏦',BOA:'🏦',CASH:'💵',AUTRE:'💳' };
const FREQ_LABEL = { quotidien:'Quotidien',hebdomadaire:'Hebdo',bimensuel:'2×/sem',mensuel:'Mensuel' };
const JOURS_NOM  = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
const mmBadge    = v => `<span style="font-weight:600">${MM_LABEL[v]||v}</span>`;
const statutBadge = s => { const m={'confirmé':'bg','reçu':'bc','en attente':'ba'}; return `<span class="badge ${m[s]||'ba'}">${s}</span>`; };
const pdvBadge   = id => { const p=pdvs.find(x=>x.id===id); return p?`<span class="${p.type==='principale'?'tag-principale':'tag-depot'}">${p.nom}</span>`:id; };

// ══════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════
async function doLogin() {
  const login = document.getElementById('loginUser').value.trim();
  const pass  = document.getElementById('loginPass').value;
  const u = users.find(x => x.login===login && x.pass===pass && x.actif!==false);
  if (!u) { document.getElementById('loginErr').style.display='block'; return; }
  document.getElementById('loginErr').style.display = 'none';
  u.lastLogin = new Date().toISOString();
  await saveItem('users', u);
  currentUser = u;
  startApp();
}
window.doLogin = doLogin;
document.addEventListener('keydown', e => {
  if (e.key==='Enter' && document.getElementById('loginScreen').style.display!=='none') doLogin();
});

function doLogout() {
  currentUser = null;
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appShell').style.display    = 'none';
}
window.doLogout = doLogout;

function startApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display    = 'block';
  const shell = document.getElementById('appShell');
  shell.classList.toggle('is-admin', currentUser.role==='admin');
  document.getElementById('hdrDate').textContent =
    new Date().toLocaleDateString('fr-FR', { weekday:'short',day:'numeric',month:'long',year:'numeric' });
  document.getElementById('uAvatar').textContent = initials(currentUser.nom);
  el('uName', currentUser.nom);
  el('uRole', currentUser.role);
  ['mRSaisie','mVSaisie','mMSaisie','mcSuperviseur'].forEach(id => {
    const e = document.getElementById(id); if (e) e.value = currentUser.nom;
  });
  document.getElementById('caisseDate').value = today();
  populateSelects();
  updateBackupUI();
  scheduleAutoBackup();
  subscribeAll();
  goTo('dashboard');
}

// ══════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════
const PAGES = ['dashboard','recettes','versements','caisse','banques','rapport','admin','utilisateurs'];
function goTo(name) {
  PAGES.forEach(p => document.getElementById('pg-'+p)?.classList.remove('active'));
  document.getElementById('pg-'+name)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    const t = n.textContent.trim().toLowerCase();
    n.classList.toggle('active',
      (name==='dashboard'&&t.includes('tableau'))||(name==='recettes'&&t.includes('recette'))||
      (name==='versements'&&t.includes('versement'))||(name==='caisse'&&t.includes('caisse'))||
      (name==='banques'&&t.includes('banques'))||(name==='rapport'&&t.includes('rapport'))||
      (name==='admin'&&t.includes('config'))||(name==='utilisateurs'&&t.includes('utilis')));
  });
  const mm = ['dashboard','recettes','versements','caisse','banques'];
  document.querySelectorAll('.mnav-item').forEach((n,i) => n.classList.toggle('active', mm[i]===name));
  ({ dashboard:renderDashboard, recettes:renderRecettes, versements:renderVersements,
     caisse:renderCaisse, banques:renderBanques, rapport:renderRapport,
     admin:renderAdmin, utilisateurs:renderUsers })[name]?.();
}
window.goTo = goTo;

// ══════════════════════════════════════════════════════
// SELECTS
// ══════════════════════════════════════════════════════
function populateSelects() {
  const pdvO = pdvs.map(p=>`<option value="${p.id}">${p.nom}</option>`).join('');
  const cptO = comptes.map(c=>`<option value="${c.id}">${c.nom}</option>`).join('');
  ['mRPDV','mVPDV','smsPDV'].forEach(id => { const e=document.getElementById(id); if(e) e.innerHTML=pdvO; });
  ['fRPDV','fVPDV'].forEach(id => { const e=document.getElementById(id); if(e) e.innerHTML='<option value="">Tous PDV</option>'+pdvO; });
  const mup = document.getElementById('mUPDV'); if(mup) mup.innerHTML='<option value="">Tous</option>'+pdvO;
  const mpc = document.getElementById('mPDVCompte'); if(mpc) mpc.innerHTML='<option value="">— Aucun —</option>'+cptO;
  ['mVCompte','mMCompte'].forEach(id => { const e=document.getElementById(id); if(e) e.innerHTML=cptO; });
  const fmc = document.getElementById('fMCompte'); if(fmc) fmc.innerHTML='<option value="">Tous comptes</option>'+cptO;
  const frc = document.getElementById('fRCanal');
  if(frc) frc.innerHTML='<option value="">Tous canaux</option>'+Object.entries(MM_LABEL).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
}

// ══════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════
function renderDashboard() {
  const t = today();
  const todayR = recettes.filter(r=>r.date===t);
  const totalJ = todayR.reduce((s,r)=>s+(r.montant||0), 0);
  const totalM = recettes.filter(r=>r.date?.slice(0,7)===t.slice(0,7)).reduce((s,r)=>s+(r.montant||0), 0);
  const enAtt  = versements.filter(v=>v.statut==='en attente').reduce((s,v)=>s+(v.montant||0), 0);
  const totCpt = comptes.reduce((s,c)=>s+(c.solde||0), 0);
  const totConf= versements.filter(v=>v.statut==='confirmé'&&v.date?.slice(0,7)===t.slice(0,7)).reduce((s,v)=>s+(v.montant||0),0);
  el('dbSub', `Mis à jour ${new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}`);
  document.getElementById('dbStats').innerHTML = `
    <div class="stat-card green"><div class="stat-lbl">Recettes aujourd'hui</div><div class="stat-val green">${fmt(totalJ)}</div><div class="stat-sub">FCFA — ${todayR.length} op.</div></div>
    <div class="stat-card blue"><div class="stat-lbl">Recettes ce mois</div><div class="stat-val blue">${fmt(totalM)}</div><div class="stat-sub">FCFA</div></div>
    <div class="stat-card amber"><div class="stat-lbl">Versements en attente</div><div class="stat-val amber">${fmt(enAtt)}</div><div class="stat-sub">FCFA</div></div>
    <div class="stat-card purple"><div class="stat-lbl">Confirmés ce mois</div><div class="stat-val purple">${fmt(totConf)}</div><div class="stat-sub">FCFA</div></div>
    <div class="stat-card ${totCpt>=0?'green':'red'}"><div class="stat-lbl">Total disponible</div><div class="stat-val ${totCpt>=0?'green':'red'}">${fmt(totCpt)}</div><div class="stat-sub">FCFA tous comptes</div></div>`;
  document.getElementById('dbComptes').innerHTML = comptes.map(c => {
    const col = c.color||'var(--green)';
    const op  = c.op==='AUTRE'&&c.opLibre ? c.opLibre : c.op;
    return `<div class="compte-card" style="border-left:3px solid ${col}">
      <div class="cc-icon">${OP_ICONS[c.op]||'💳'}</div>
      <div class="cc-name">${c.nom}</div>
      <div class="cc-solde" style="color:${(c.solde||0)>=0?col:'var(--red)'}">
        ${fmt(c.solde)} <span style="font-size:.7rem;font-weight:400;color:var(--text2)">FCFA</span></div>
      <div class="cc-type">${c.cat==='mobile_money'?'Mobile Money':c.cat==='banque'?'Banque':'Caisse'} · ${op}</div>
    </div>`;
  }).join('');
  const rTb = document.getElementById('dbRecTbody');
  rTb.innerHTML = todayR.length
    ? todayR.map(r=>`<tr><td>${pdvBadge(r.pdv)}</td><td>${mmBadge(r.canal)}</td><td class="amt pos">${fmt(r.montant)}</td></tr>`).join('')
    : '<tr><td colspan="3" style="color:var(--text3);text-align:center;padding:14px">Aucune recette</td></tr>';
  const vTb = document.getElementById('dbVerTbody');
  const lastV = [...versements].sort((a,b)=>(b.ts||0)-(a.ts||0)).slice(0,6);
  vTb.innerHTML = lastV.length
    ? lastV.map(v=>`<tr><td>${pdvBadge(v.pdv)}</td><td>${mmBadge(v.type)}</td><td class="amt pos">${fmt(v.montant)}</td><td>${statutBadge(v.statut)}</td></tr>`).join('')
    : '<tr><td colspan="4" style="color:var(--text3);text-align:center;padding:14px">Aucun versement</td></tr>';
}
window.renderDashboard = renderDashboard;

// ══════════════════════════════════════════════════════
// RECETTES
// ══════════════════════════════════════════════════════
function renderRecettes() {
  let data = [...recettes].sort((a,b)=>b.date?.localeCompare(a.date||'')||0);
  const dF=document.getElementById('fRDate').value, pF=document.getElementById('fRPDV').value, cF=document.getElementById('fRCanal').value;
  if (currentUser.role!=='admin' && currentUser.pdv) data=data.filter(r=>r.pdv===currentUser.pdv);
  if (dF) data=data.filter(r=>r.date===dF);
  if (pF) data=data.filter(r=>r.pdv===pF);
  if (cF) data=data.filter(r=>r.canal===cF);
  const tbody = document.getElementById('recTbody');
  if (!data.length) { tbody.innerHTML='<tr><td colspan="8"><div class="empty-state"><div class="ei">📋</div>Aucune recette</div></td></tr>'; return; }
  tbody.innerHTML = data.map(r=>`<tr>
    <td>${fmtD(r.date)}</td><td>${pdvBadge(r.pdv)}</td><td>${mmBadge(r.canal)}</td>
    <td><span class="badge bb">${r.type}</span></td>
    <td class="amt pos">${fmt(r.montant)}</td>
    <td style="color:var(--text2);font-size:.75rem">${r.ref||'—'}</td>
    <td style="color:var(--text2);font-size:.75rem">${r.saisie||'—'}</td>
    <td>${currentUser.role==='admin'?`<button class="btn btn-red btn-xs" onclick="delRecette('${r.id}')">✕</button>`:''}</td>
  </tr>`).join('');
}
window.renderRecettes = renderRecettes;

function openRecetteModal() {
  document.getElementById('mRDate').value = today();
  document.getElementById('mRHeure').value = nowTm();
  ['mRMontant','mRRef','mRNotes'].forEach(id => document.getElementById(id).value='');
  document.getElementById('mRSaisie').value = currentUser.nom;
  if (currentUser.pdv) document.getElementById('mRPDV').value = currentUser.pdv;
  openM('mRecette');
}
window.openRecetteModal = openRecetteModal;

async function saveRecette() {
  const date=document.getElementById('mRDate').value, pdv=document.getElementById('mRPDV').value,
        canal=document.getElementById('mRCanal').value, montant=parseFloat(document.getElementById('mRMontant').value);
  if (!date||!pdv||!canal||!montant) { toast('Champs obligatoires manquants','err'); return; }
  const item = { id:uid(), date, heure:document.getElementById('mRHeure').value, pdv,
                 type:document.getElementById('mRType').value, canal, montant,
                 ref:document.getElementById('mRRef').value,
                 saisie:document.getElementById('mRSaisie').value,
                 notes:document.getElementById('mRNotes').value, ts:Date.now() };
  recettes.push(item);
  await saveItem('recettes', item);
  closeM('mRecette'); toast('Recette enregistrée ✓');
  renderRecettes(); renderDashboard();
}
window.saveRecette = saveRecette;

async function delRecette(id) {
  if (!confirm('Supprimer cette recette ?')) return;
  recettes = recettes.filter(r=>r.id!==id);
  await delItem('recettes', id);
  renderRecettes(); toast('Supprimé','info');
}
window.delRecette = delRecette;

function openSMSModal() {
  document.getElementById('smsTxt').value='';
  document.getElementById('smsResult').style.display='none';
  document.getElementById('btnSaveSMS').style.display='none';
  document.getElementById('smsDate').value=today();
  document.getElementById('smsPDV').innerHTML=pdvs.map(p=>`<option value="${p.id}">${p.nom}</option>`).join('');
  openM('mSMS');
}
window.openSMSModal = openSMSModal;

function parseSMS() {
  const txt = document.getElementById('smsTxt').value;
  if (!txt.trim()) { toast('Colle un SMS','err'); return; }
  const nums=(txt.match(/\d[\d\s]*/g)||[]).map(n=>parseInt(n.replace(/\s/g,''))).filter(n=>n>100);
  const montant=nums.length?Math.max(...nums):0;
  const dm=txt.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.]?(\d{2,4})?/);
  if (dm) { const[,j,m,y]=dm; const yr=y?(y.length===2?'20'+y:y):new Date().getFullYear(); document.getElementById('smsDate').value=`${yr}-${m.padStart(2,'0')}-${j.padStart(2,'0')}`; }
  const lo=txt.toLowerCase(); let detPDV=pdvs[0]?.id;
  pdvs.forEach(p=>{ if(lo.includes(p.nom.toLowerCase().split(' ').slice(-1)[0])) detPDV=p.id; });
  document.getElementById('smsPDV').value=detPDV;
  let detCanal='CASH';
  if(/orange/i.test(txt))detCanal='OM'; else if(/mtn/i.test(txt))detCanal='MTN';
  else if(/wave/i.test(txt))detCanal='WAVE'; else if(/moov/i.test(txt))detCanal='MOOV';
  document.getElementById('smsCanal').value=detCanal;
  document.getElementById('smsMontant').value=montant||'';
  document.getElementById('smsResult').style.display='block';
  document.getElementById('btnSaveSMS').style.display='inline-block';
}
window.parseSMS = parseSMS;

async function saveSMSRecette() {
  const pdv=document.getElementById('smsPDV').value, date=document.getElementById('smsDate').value,
        montant=parseFloat(document.getElementById('smsMontant').value), canal=document.getElementById('smsCanal').value;
  if (!date||!pdv||!montant) { toast('Données incomplètes','err'); return; }
  const item={id:uid(),date,heure:nowTm(),pdv,type:'vente comptoir',canal,montant,ref:'Via SMS',
               saisie:currentUser.nom,notes:document.getElementById('smsTxt').value.slice(0,100),ts:Date.now()};
  recettes.push(item); await saveItem('recettes',item);
  closeM('mSMS'); toast('Recette SMS enregistrée ✓'); renderRecettes();
}
window.saveSMSRecette = saveSMSRecette;

// ══════════════════════════════════════════════════════
// VERSEMENTS
// ══════════════════════════════════════════════════════
function renderVersements() {
  let data=[...versements].sort((a,b)=>b.date?.localeCompare(a.date||'')||0);
  const dF=document.getElementById('fVDate').value, pF=document.getElementById('fVPDV').value,
        tF=document.getElementById('fVType').value, sF=document.getElementById('fVStatut').value;
  if (currentUser.role!=='admin'&&currentUser.pdv) data=data.filter(v=>v.pdv===currentUser.pdv);
  if (dF) data=data.filter(v=>v.date===dF);
  if (pF) data=data.filter(v=>v.pdv===pF);
  if (tF) data=data.filter(v=>v.type===tF);
  if (sF) data=data.filter(v=>v.statut===sF);
  const tbody=document.getElementById('verTbody');
  if (!data.length) { tbody.innerHTML='<tr><td colspan="10"><div class="empty-state"><div class="ei">💸</div>Aucun versement</div></td></tr>'; return; }
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
window.renderVersements = renderVersements;

function onVPDVChange() {
  const p=pdvs.find(x=>x.id===document.getElementById('mVPDV').value);
  if (p) {
    document.getElementById('mVFreq').value=p.freq||'quotidien';
    if (p.compteDefaut) document.getElementById('mVCompte').value=p.compteDefaut;
  }
}
window.onVPDVChange = onVPDVChange;

function openVersModal() {
  document.getElementById('mVDate').value=today();
  ['mVMontant','mVRef','mVNotes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('mVSaisie').value=currentUser.nom;
  document.getElementById('mVStatut').value='en attente';
  if (currentUser.pdv) document.getElementById('mVPDV').value=currentUser.pdv;
  openM('mVers');
}
window.openVersModal = openVersModal;

async function saveVersement() {
  const date=document.getElementById('mVDate').value, pdv=document.getElementById('mVPDV').value,
        type=document.getElementById('mVType').value, compte=document.getElementById('mVCompte').value,
        montant=parseFloat(document.getElementById('mVMontant').value);
  if (!date||!pdv||!type||!compte||!montant) { toast('Champs manquants','err'); return; }
  const statut=document.getElementById('mVStatut').value;
  const item={id:uid(),date,pdv,freq:document.getElementById('mVFreq').value,type,compte,
               ref:document.getElementById('mVRef').value,montant,statut,
               saisie:document.getElementById('mVSaisie').value,
               notes:document.getElementById('mVNotes').value,ts:Date.now()};
  versements.push(item);
  if (statut==='confirmé') await crediterCompte(compte, montant, pdv, item.ref, date);
  await saveItem('versements',item);
  closeM('mVers'); toast('Versement enregistré ✓');
  renderVersements(); renderDashboard();
}
window.saveVersement = saveVersement;

async function crediterCompte(compteId, montant, pdvId, ref, date) {
  const c=comptes.find(x=>x.id===compteId);
  if (!c) return;
  c.solde=(c.solde||0)+montant;
  await saveItem('comptes',c);
  const m={id:uid(),date,compte:compteId,type:'entrée',
            libelle:`Versement ${pdvs.find(p=>p.id===pdvId)?.nom||pdvId}`,
            ref,montant,soldeApres:c.solde,saisie:currentUser.nom,ts:Date.now()};
  mvts.push(m); await saveItem('mvts',m);
}

async function confirmerV(id) {
  const v=versements.find(x=>x.id===id);
  if (!v||v.statut==='confirmé') return;
  v.statut='confirmé';
  await crediterCompte(v.compte,v.montant,v.pdv,v.ref,v.date);
  await saveItem('versements',v);
  renderVersements(); toast('Versement confirmé ✓'); renderDashboard();
}
window.confirmerV = confirmerV;

async function delVers(id) {
  if (!confirm('Supprimer ?')) return;
  versements=versements.filter(v=>v.id!==id);
  await delItem('versements',id);
  renderVersements(); toast('Supprimé','info');
}
window.delVers = delVers;

// ══════════════════════════════════════════════════════
// CLÔTURE DE CAISSE
// ══════════════════════════════════════════════════════
function populateCaissiereSelect() {
  const el=document.getElementById('mcCaissiere'); if(!el) return;
  el.innerHTML=users.filter(u=>u.actif!==false).map(u=>`<option value="${u.nom}">${u.nom}</option>`).join('')+'<option value="__custom__">✏️ Autre…</option>';
  el.onchange=function(){
    if(this.value==='__custom__'){
      const n=prompt('Nom de la caissière :');
      if(n){const o=document.createElement('option');o.value=n;o.textContent=n;o.selected=true;this.insertBefore(o,this.lastElementChild);this.value=n;}
      else this.value=users[0]?.nom||'';
    }
  };
}

function calcCaisse() {
  const mc=nv('mcMachineCash'), mm=nv('mcMachineOM')+nv('mcMachineMTN')+nv('mcMachineWAVE')+nv('mcMachineMOOV'), tm=mc+mm;
  const cv=nv('mcCashVerser'), mmv=nv('mcOMVerser')+nv('mcMTNVerser')+nv('mcWAVEVerser')+nv('mcMOOVVerser'), tv=cv+mmv;
  const ec=tv-tm;
  el('rcTotalMachine', fmt(tm)+' FCFA');
  el('rcTotalVerse',   fmt(tv)+' FCFA');
  const ecEl=document.getElementById('rcEcart'), ecMsg=document.getElementById('rcEcartMsg');
  if(ecEl){ ecEl.textContent=(ec>0?'+ ':ec<0?'− ':'')+fmt(Math.abs(ec))+' FCFA'; ecEl.style.color=ec===0?'var(--green)':ec<0?'var(--red)':'var(--amber)'; }
  if(ecMsg) ecMsg.textContent=ec===0?'✓ Caisse équilibrée':ec<0?'⚠ Manquant — versé < machine':'⚡ Excédent — versé > machine';
}
window.calcCaisse = calcCaisse;

function openCaisseModal(id) {
  populateCaissiereSelect();
  document.getElementById('mcDate').value=document.getElementById('caisseDate')?.value||today();
  document.getElementById('mcSuperviseur').value=currentUser.nom;
  ['mcMachineCash','mcMachineOM','mcMachineMTN','mcMachineWAVE','mcMachineMOOV',
   'mcCashVerser','mcOMVerser','mcMTNVerser','mcWAVEVerser','mcMOOVVerser','mcRefCash','mcNotes']
    .forEach(i=>{ const e=document.getElementById(i); if(e) e.value=''; });
  if (id) {
    const c=clotures.find(x=>x.id===id);
    if (c) {
      document.getElementById('mcDate').value=c.date;
      document.getElementById('mcVacation').value=c.vacation;
      document.getElementById('mcCaissiere').value=c.caissiere;
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
  calcCaisse(); openM('mCaisse');
}
window.openCaisseModal = openCaisseModal;

async function saveCloture() {
  const date=document.getElementById('mcDate').value,
        vacation=document.getElementById('mcVacation').value,
        caissiere=document.getElementById('mcCaissiere').value;
  if (!date||!vacation||!caissiere) { toast('Date, vacation et caissière obligatoires','err'); return; }
  const machineCash=nv('mcMachineCash'),machineOM=nv('mcMachineOM'),machineMTN=nv('mcMachineMTN'),
        machineWAVE=nv('mcMachineWAVE'),machineMOOV=nv('mcMachineMOOV'),
        totalMachine=machineCash+machineOM+machineMTN+machineWAVE+machineMOOV;
  const cashVerse=nv('mcCashVerser'),omVerse=nv('mcOMVerser'),mtnVerse=nv('mcMTNVerser'),
        waveVerse=nv('mcWAVEVerser'),moovVerse=nv('mcMOOVVerser'),
        totalVerse=cashVerse+omVerse+mtnVerse+waveVerse+moovVerse,
        ecart=totalVerse-totalMachine;
  const editId=document.getElementById('mCaisse')._editId;
  const clot={id:editId||uid(),date,vacation,caissiere,superviseur:document.getElementById('mcSuperviseur').value,
              machineCash,machineOM,machineMTN,machineWAVE,machineMOOV,totalMachine,
              cashVerse,omVerse,mtnVerse,waveVerse,moovVerse,totalVerse,ecart,
              refCash:document.getElementById('mcRefCash').value,notes:document.getElementById('mcNotes').value,
              statut:'ouvert',valide_par:null,valide_ts:null,ts:Date.now()};
  if (editId) { const idx=clotures.findIndex(x=>x.id===editId); if(idx>-1)clotures[idx]={...clotures[idx],...clot}; }
  else clotures.push(clot);
  if (!editId) {
    const pdvP=pdvs.find(p=>p.type==='principale');
    if (pdvP) {
      for (const [type,montant] of [['CASH',cashVerse],['OM',omVerse],['MTN',mtnVerse],['WAVE',waveVerse],['MOOV',moovVerse]]) {
        if (!montant) continue;
        const v={id:uid(),date,pdv:pdvP.id,freq:'quotidien',type,
                  compte:comptes.find(c=>c.op===type)?.id||comptes[0]?.id||'',
                  ref:clot.refCash||`Clôture ${caissiere} — ${vacation}`,
                  montant,statut:'en attente',saisie:currentUser.nom,
                  notes:`Clôture: ${caissiere} / ${vacation}`,ts:Date.now()};
        versements.push(v); await saveItem('versements',v);
      }
    }
  }
  await saveItem('clotures',clot);
  closeM('mCaisse'); toast(editId?'Clôture modifiée ✓':'Clôture enregistrée ✓'); renderCaisse();
}
window.saveCloture = saveCloture;

async function validerClot(id) {
  const c=clotures.find(x=>x.id===id); if(!c) return;
  c.statut='validé'; c.valide_par=currentUser.nom; c.valide_ts=Date.now();
  await saveItem('clotures',c); renderCaisse(); toast('Clôture validée ✓');
}
window.validerClot = validerClot;

async function validerToutesClot() {
  const date=document.getElementById('caisseDate').value||today();
  for (const c of clotures.filter(x=>x.date===date&&x.statut==='ouvert')) {
    c.statut='validé'; c.valide_par=currentUser.nom; c.valide_ts=Date.now();
    await saveItem('clotures',c);
  }
  renderCaisse(); toast('Toutes les clôtures validées ✓');
}
window.validerToutesClot = validerToutesClot;

async function delClot(id) {
  if (!confirm('Supprimer ?')) return;
  clotures=clotures.filter(c=>c.id!==id);
  await delItem('clotures',id); renderCaisse(); toast('Supprimé','info');
}
window.delClot = delClot;

function caisseNavDay(dir) {
  const el=document.getElementById('caisseDate');
  const d=new Date(el.value||today()); d.setDate(d.getDate()+dir);
  el.value=d.toISOString().split('T')[0]; renderCaisse();
}
window.caisseNavDay = caisseNavDay;

function renderCaisse() {
  const date=document.getElementById('caisseDate')?.value||today();
  const dayC=clotures.filter(c=>c.date===date).sort((a,b)=>a.vacation.localeCompare(b.vacation));
  const totM=dayC.reduce((s,c)=>s+(c.totalMachine||0),0);
  const totV=dayC.reduce((s,c)=>s+(c.totalVerse||0),0);
  const totE=dayC.reduce((s,c)=>s+(c.ecart||0),0);
  const cO=dayC.filter(c=>c.statut==='ouvert').length;
  const cV=dayC.filter(c=>c.statut==='validé').length;
  const eCol=totE===0?'var(--green)':totE<0?'var(--red)':'var(--amber)';
  document.getElementById('caisseSummary').innerHTML=`
    <div class="sc-item"><div class="sc-lbl">Date</div><div class="sc-val">${fmtD(date)}</div></div>
    <div class="sc-item"><div class="sc-lbl">Caissières</div><div class="sc-val">${dayC.length}</div></div>
    <div class="sc-item"><div class="sc-lbl">Machine</div><div class="sc-val" style="color:var(--blue)">${fmt(totM)} FCFA</div></div>
    <div class="sc-item"><div class="sc-lbl">Versé</div><div class="sc-val" style="color:var(--green)">${fmt(totV)} FCFA</div></div>
    <div class="sc-item"><div class="sc-lbl">Écart</div><div class="sc-val" style="color:${eCol}">${totE>0?'+':totE<0?'−':''}${fmt(Math.abs(totE))} FCFA</div></div>
    <div class="sc-item"><div class="sc-lbl">Statut</div><div style="display:flex;gap:6px;margin-top:4px"><span class="clot-status clot-open">${cO} en cours</span><span class="clot-status clot-closed">${cV} validé(s)</span></div></div>`;
  const grid=document.getElementById('caisseGrid');
  if (!dayC.length) {
    grid.innerHTML=`<div style="grid-column:1/-1"><div class="empty-state"><div class="ei">🗂️</div>Aucune clôture pour le ${fmtD(date)}<br><br><button class="btn btn-green btn-sm" onclick="openCaisseModal()">+ Saisir</button></div></div>`;
    document.getElementById('caisseTbody').innerHTML='<tr><td colspan="10" style="text-align:center;color:var(--text3);padding:16px">Aucune clôture</td></tr>';
    return;
  }
  grid.innerHTML=dayC.map(c=>{
    const ep=c.ecart===0?'ecart-ok':c.ecart<0?'ecart-neg':'ecart-pos';
    const et=c.ecart===0?'✓ Équilibrée':c.ecart<0?`− ${fmt(Math.abs(c.ecart))} manquant`:`+ ${fmt(c.ecart)} excédent`;
    return`<div class="caisse-card">
      <div class="cc-head">
        <div><div class="cc-caissiere">👤 ${c.caissiere}</div><div class="cc-vacation">${c.vacation}</div></div>
        <div><span class="ecart-pill ${ep}">${et}</span><br><span class="clot-status ${c.statut==='validé'?'clot-closed':'clot-open'}" style="margin-top:4px;display:inline-block">${c.statut}</span></div>
      </div>
      <div class="cc-row"><span class="cc-row-lbl">Recette machine</span><span class="cc-row-val" style="color:var(--blue)">${fmt(c.totalMachine)}</span></div>
      <div class="cc-row"><span class="cc-row-lbl">Cash versé</span><span class="cc-row-val">${fmt(c.cashVerse)}</span></div>
      <div class="cc-row"><span class="cc-row-lbl">MM versé</span><span class="cc-row-val">${fmt((c.omVerse||0)+(c.mtnVerse||0)+(c.waveVerse||0)+(c.moovVerse||0))}</span></div>
      <div class="cc-total-row"><span>Total versé</span><span style="color:var(--green)">${fmt(c.totalVerse)}</span></div>
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        ${currentUser.role==='admin'&&c.statut==='ouvert'?`<button class="btn btn-ghost btn-xs" onclick="validerClot('${c.id}')">✓ Valider</button>`:''}
        <button class="btn btn-ghost btn-xs" onclick="openCaisseModal('${c.id}')">✏️</button>
        ${currentUser.role==='admin'?`<button class="btn btn-red btn-xs" onclick="delClot('${c.id}')">✕</button>`:''}
      </div>
    </div>`;
  }).join('');
  document.getElementById('caisseTbody').innerHTML=dayC.map(c=>{
    const ec=c.ecart||0, ecC=ec===0?'amt pos':ec<0?'amt neg':'amt neu';
    return`<tr>
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
        <button class="btn btn-ghost btn-xs" onclick="openCaisseModal('${c.id}')">✏️</button>
        ${currentUser.role==='admin'?`<button class="btn btn-red btn-xs" onclick="delClot('${c.id}')">✕</button>`:''}
      </td>
    </tr>`;
  }).join('');
}
window.renderCaisse = renderCaisse;

// ══════════════════════════════════════════════════════
// BANQUES & MM
// ══════════════════════════════════════════════════════
function renderBanques() {
  document.getElementById('bqComptes').innerHTML=comptes.map(c=>{
    const col=c.color||'var(--green)', op=c.op==='AUTRE'&&c.opLibre?c.opLibre:c.op;
    return`<div class="compte-card" style="border-left:3px solid ${col}">
      <div class="cc-icon">${OP_ICONS[c.op]||'💳'}</div>
      <div class="cc-name">${c.nom}</div>
      <div class="cc-solde" style="color:${(c.solde||0)>=0?col:'var(--red)'};">${fmt(c.solde)}</div>
      <div class="cc-type">${c.cat==='mobile_money'?'Mobile Money':c.cat==='banque'?'Banque':'Caisse'} · ${op}</div>
      ${c.num?`<div style="font-size:.68rem;color:var(--text3);margin-top:2px;font-family:monospace">${c.num}</div>`:''}
    </div>`;
  }).join('');
  document.getElementById('fMCompte').innerHTML='<option value="">Tous comptes</option>'+comptes.map(c=>`<option value="${c.id}">${c.nom}</option>`).join('');
  renderMvts();
}
window.renderBanques = renderBanques;

function renderMvts() {
  let data=[...mvts].sort((a,b)=>b.date?.localeCompare(a.date||'')||0);
  const dF=document.getElementById('fMDate').value, cF=document.getElementById('fMCompte').value, tF=document.getElementById('fMType').value;
  if (dF) data=data.filter(m=>m.date===dF);
  if (cF) data=data.filter(m=>m.compte===cF);
  if (tF) data=data.filter(m=>m.type===tF);
  const tbody=document.getElementById('mvtTbody');
  if (!data.length) { tbody.innerHTML='<tr><td colspan="9"><div class="empty-state"><div class="ei">🏦</div>Aucun mouvement</div></td></tr>'; return; }
  tbody.innerHTML=data.map(m=>{
    const cpt=comptes.find(c=>c.id===m.compte);
    return`<tr>
      <td>${fmtD(m.date)}</td>
      <td style="font-size:.78rem">${cpt?cpt.nom:m.compte}</td>
      <td><span class="badge ${m.type==='entrée'?'bg':m.type==='sortie'?'br':'bc'}">${m.type}</span></td>
      <td style="font-size:.78rem;color:var(--text2)">${m.libelle||'—'}</td>
      <td style="font-size:.75rem;color:var(--text2)">${m.ref||'—'}</td>
      <td class="amt ${m.type==='entrée'?'pos':'neg'}">${m.type==='sortie'?'−':'+'}${fmt(m.montant)}</td>
      <td class="amt">${fmt(m.soldeApres)}</td>
      <td style="font-size:.75rem;color:var(--text2)">${m.saisie||'—'}</td>
      <td>${currentUser.role==='admin'?`<button class="btn btn-red btn-xs" onclick="delMvt('${m.id}')">✕</button>`:''}</td>
    </tr>`;
  }).join('');
}
window.renderMvts = renderMvts;

function openMvtModal() {
  document.getElementById('mMDate').value=today();
  ['mMMontant','mMRef','mMNotes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('mMSaisie').value=currentUser.nom;
  openM('mMvt');
}
window.openMvtModal = openMvtModal;

async function saveMvt() {
  const date=document.getElementById('mMDate').value, compteId=document.getElementById('mMCompte').value,
        type=document.getElementById('mMType').value, montant=parseFloat(document.getElementById('mMMontant').value);
  if (!date||!compteId||!montant) { toast('Champs manquants','err'); return; }
  const c=comptes.find(x=>x.id===compteId);
  if (c) { if(type==='entrée')c.solde=(c.solde||0)+montant; else if(type==='sortie')c.solde=(c.solde||0)-montant; await saveItem('comptes',c); }
  const item={id:uid(),date,compte:compteId,type,libelle:document.getElementById('mMNotes').value,
               ref:document.getElementById('mMRef').value,montant,soldeApres:c?.solde||0,
               saisie:document.getElementById('mMSaisie').value,ts:Date.now()};
  mvts.push(item); await saveItem('mvts',item);
  closeM('mMvt'); toast('Mouvement enregistré ✓'); renderBanques(); renderDashboard();
}
window.saveMvt = saveMvt;

async function delMvt(id) {
  if (!confirm('Supprimer ?')) return;
  mvts=mvts.filter(m=>m.id!==id); await delItem('mvts',id); renderMvts(); toast('Supprimé','info');
}
window.delMvt = delMvt;

// ══════════════════════════════════════════════════════
// RAPPORT
// ══════════════════════════════════════════════════════
function onPeriodeChange() {
  const p=document.getElementById('rPeriode').value;
  document.getElementById('rCustomDates').style.display=p==='custom'?'flex':'none';
  renderRapport();
}
window.onPeriodeChange = onPeriodeChange;

function renderRapport() {
  const t=today(), p=document.getElementById('rPeriode').value;
  let debut,fin;
  if(p==='jour'){debut=t;fin=t;}
  else if(p==='semaine'){const b=weekBounds(t);debut=b.start;fin=b.end;}
  else if(p==='mois'){debut=t.slice(0,7)+'-01';fin=t;}
  else{debut=document.getElementById('rDebut').value||t;fin=document.getElementById('rFin').value||t;}
  const recF=recettes.filter(r=>r.date>=debut&&r.date<=fin);
  const verF=versements.filter(v=>v.date>=debut&&v.date<=fin);
  const totR=recF.reduce((s,r)=>s+(r.montant||0),0);
  const totV=verF.reduce((s,v)=>s+(v.montant||0),0);
  const totC=verF.filter(v=>v.statut==='confirmé').reduce((s,v)=>s+(v.montant||0),0);
  const totA=verF.filter(v=>v.statut==='en attente').reduce((s,v)=>s+(v.montant||0),0);
  const ecart=totR-totC;
  const byPDV={};
  pdvs.forEach(p=>{byPDV[p.id]={nom:p.nom,type:p.type,rec:0,ver:0,verC:0}});
  recF.forEach(r=>{if(byPDV[r.pdv])byPDV[r.pdv].rec+=r.montant||0});
  verF.forEach(v=>{if(byPDV[v.pdv]){byPDV[v.pdv].ver+=v.montant||0;if(v.statut==='confirmé')byPDV[v.pdv].verC+=v.montant||0}});
  const byCanal={};
  recF.forEach(r=>{if(!byCanal[r.canal])byCanal[r.canal]=0;byCanal[r.canal]+=r.montant||0});
  const byCpt={};
  verF.filter(v=>v.statut==='confirmé').forEach(v=>{if(!byCpt[v.compte])byCpt[v.compte]=0;byCpt[v.compte]+=v.montant||0});
  document.getElementById('rapportContent').innerHTML=`
    <div class="stats-grid">
      <div class="stat-card green"><div class="stat-lbl">Recettes</div><div class="stat-val green">${fmt(totR)}</div><div class="stat-sub">FCFA sur la période</div></div>
      <div class="stat-card blue"><div class="stat-lbl">Versements</div><div class="stat-val blue">${fmt(totV)}</div><div class="stat-sub">FCFA</div></div>
      <div class="stat-card purple"><div class="stat-lbl">Confirmés</div><div class="stat-val purple">${fmt(totC)}</div><div class="stat-sub">FCFA</div></div>
      <div class="stat-card amber"><div class="stat-lbl">En attente</div><div class="stat-val amber">${fmt(totA)}</div><div class="stat-sub">FCFA</div></div>
      <div class="stat-card ${ecart>0?'amber':ecart===0?'green':'red'}"><div class="stat-lbl">Écart recettes − versés</div><div class="stat-val ${ecart>0?'amber':ecart===0?'green':'red'}">${fmt(ecart)}</div><div class="stat-sub">FCFA</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div class="card"><div class="card-title" style="margin-bottom:12px">Recettes par canal</div>
        ${Object.entries(byCanal).sort((a,b)=>b[1]-a[1]).map(([k,v])=>{const pct=totR>0?Math.round(v/totR*100):0;return`<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>${mmBadge(k)}</span><span class="amt pos" style="font-size:.85rem">${fmt(v)}</span></div><div class="prog-bar"><div class="prog-fill" style="width:${pct}%;background:var(--green)"></div></div><div style="font-size:.68rem;color:var(--text3);margin-top:2px">${pct}%</div></div>`}).join('')||'<div style="color:var(--text3)">Aucune donnée</div>'}
      </div>
      <div class="card"><div class="card-title" style="margin-bottom:12px">Versements par compte</div>
        ${Object.entries(byCpt).sort((a,b)=>b[1]-a[1]).map(([id,v])=>{const cpt=comptes.find(c=>c.id===id);const pct=totC>0?Math.round(v/totC*100):0;return`<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:.78rem;color:var(--text2)">${cpt?cpt.nom:id}</span><span class="amt pos" style="font-size:.85rem">${fmt(v)}</span></div><div class="prog-bar"><div class="prog-fill" style="width:${pct}%;background:var(--blue)"></div></div><div style="font-size:.68rem;color:var(--text3);margin-top:2px">${pct}%</div></div>`}).join('')||'<div style="color:var(--text3)">Aucun versement confirmé</div>'}
      </div>
    </div>
    <div class="card" style="margin-top:14px"><div class="card-title" style="margin-bottom:12px">Performance par point de vente</div>
      <div class="tbl-wrap"><table><thead><tr><th>PDV</th><th>Type</th><th>Recettes</th><th>Versé</th><th>Confirmé</th><th>Taux versement</th></tr></thead>
      <tbody>${Object.values(byPDV).map(p=>{const taux=p.rec>0?Math.round(p.verC/p.rec*100):0;const col=taux>=80?'var(--green)':taux>=50?'var(--amber)':'var(--red)';return`<tr><td><b>${p.nom}</b></td><td><span class="badge ${p.type==='principale'?'bg':'bb'}">${p.type}</span></td><td class="amt pos">${fmt(p.rec)}</td><td class="amt">${fmt(p.ver)}</td><td class="amt pos">${fmt(p.verC)}</td><td><span style="color:${col};font-weight:700">${taux}%</span><div class="prog-bar"><div class="prog-fill" style="width:${taux}%;background:${col}"></div></div></td></tr>`}).join('')}</tbody></table></div>
    </div>
    <div class="card" style="margin-top:14px"><div class="card-title" style="margin-bottom:12px">Soldes actuels par établissement</div>
      <div class="compte-cards">${comptes.map(c=>{const col=c.color||'var(--green)';return`<div class="compte-card" style="border-left:3px solid ${col}"><div class="cc-icon">${OP_ICONS[c.op]||'💳'}</div><div class="cc-name">${c.nom}</div><div class="cc-solde" style="color:${(c.solde||0)>=0?col:'var(--red)'};">${fmt(c.solde)} <span style="font-size:.65rem;font-weight:400;color:var(--text2)">FCFA</span></div></div>`}).join('')}</div>
    </div>`;
}
window.renderRapport = renderRapport;

// ══════════════════════════════════════════════════════
// ADMIN — CONFIG
// ══════════════════════════════════════════════════════
function adminTab(name) {
  document.querySelectorAll('#pg-admin .inner-tab').forEach((t,i)=>t.classList.toggle('active',['pdv','comptes'][i]===name));
  document.getElementById('adm-pdv').style.display=name==='pdv'?'block':'none';
  document.getElementById('adm-comptes').style.display=name==='comptes'?'block':'none';
}
window.adminTab = adminTab;

function renderAdmin() {
  adminTab('pdv');
  document.getElementById('pdvTbody').innerHTML=pdvs.map(p=>{
    let ps=FREQ_LABEL[p.freq]||p.freq;
    if((p.freq==='hebdomadaire'||p.freq==='bimensuel')&&p.jours?.length) ps+=` (${p.jours.map(j=>JOURS_NOM[j]).join(',')})`;
    if(p.freq==='mensuel'&&p.jourMois) ps+=` j${p.jourMois}`;
    if(p.heure) ps+=` ≤${p.heure}`;
    const cd=comptes.find(c=>c.id===p.compteDefaut);
    return`<tr><td><b>${p.nom}</b></td><td><span class="badge ${p.type==='principale'?'bg':'bb'}">${p.type}</span></td><td style="color:var(--text2);font-size:.78rem">${p.addr||'—'}</td><td style="color:var(--text2);font-size:.78rem">${p.resp||'—'}</td><td><span class="wk">${ps}</span></td><td style="font-size:.72rem;color:var(--text2)">${cd?cd.nom:'—'}</td><td><button class="btn btn-ghost btn-xs" onclick="editPDV('${p.id}')">✏️</button><button class="btn btn-red btn-xs" onclick="delPDV('${p.id}')">✕</button></td></tr>`;
  }).join('');
  document.getElementById('cptTbody').innerHTML=comptes.map(c=>{
    const op=c.op==='AUTRE'&&c.opLibre?c.opLibre:c.op;
    const dot=c.color?`<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c.color};margin-right:5px;vertical-align:middle"></span>`:'';
    return`<tr><td>${dot}<b>${c.nom}</b></td><td><span class="badge ${c.cat==='mobile_money'?'bc':c.cat==='banque'?'bb':'bg'}">${c.cat}</span></td><td>${OP_ICONS[c.op]||'💳'} ${op}</td><td style="color:var(--text2);font-size:.75rem;font-family:monospace">${c.num||'—'}</td><td class="amt">${fmt(c.soldeInit)}</td><td class="amt ${(c.solde||0)>=0?'pos':'neg'}">${fmt(c.solde)}</td><td><button class="btn btn-ghost btn-xs" onclick="editCompte('${c.id}')">✏️</button><button class="btn btn-red btn-xs" onclick="delCompte('${c.id}')">✕</button></td></tr>`;
  }).join('');
}
window.renderAdmin = renderAdmin;

// PDV CRUD
function onPDVFreqChange() {
  const v=document.getElementById('mPDVFreq').value;
  document.getElementById('pdvJoursWrap').style.display=(v==='hebdomadaire'||v==='bimensuel')?'block':'none';
  document.getElementById('pdvJourMoisWrap').style.display=v==='mensuel'?'block':'none';
}
window.onPDVFreqChange = onPDVFreqChange;

function openPDVModal(id) {
  document.getElementById('mPDVTitle').textContent=id?'Modifier PDV':'Nouveau PDV';
  document.getElementById('mPDVId').value=id||'';
  document.getElementById('mPDVCompte').innerHTML='<option value="">— Aucun —</option>'+comptes.map(c=>`<option value="${c.id}">${c.nom}</option>`).join('');
  const p=id?pdvs.find(x=>x.id===id):{};
  document.getElementById('mPDVNom').value=p.nom||'';
  document.getElementById('mPDVType').value=p.type||'principale';
  document.getElementById('mPDVAddr').value=p.addr||'';
  document.getElementById('mPDVResp').value=p.resp||'';
  document.getElementById('mPDVFreq').value=p.freq||'quotidien';
  document.getElementById('mPDVHeure').value=p.heure||'';
  document.getElementById('mPDVTel').value=p.tel||'';
  document.getElementById('mPDVCompte').value=p.compteDefaut||'';
  document.getElementById('mPDVJourMois').value=p.jourMois||'';
  document.getElementById('mPDVNotes').value=p.notes||'';
  document.querySelectorAll('.pdv-jour').forEach(cb=>{ cb.checked=p.jours?p.jours.includes(parseInt(cb.value)):false; });
  onPDVFreqChange(); openM('mPDV');
}
window.openPDVModal = openPDVModal;
function editPDV(id){openPDVModal(id);}
window.editPDV = editPDV;

async function savePDV() {
  const nom=document.getElementById('mPDVNom').value.trim();
  if (!nom) { toast('Nom obligatoire','err'); return; }
  const id=document.getElementById('mPDVId').value;
  const jours=[...document.querySelectorAll('.pdv-jour:checked')].map(cb=>parseInt(cb.value));
  const data={nom,type:document.getElementById('mPDVType').value,addr:document.getElementById('mPDVAddr').value,
               resp:document.getElementById('mPDVResp').value,freq:document.getElementById('mPDVFreq').value,
               heure:document.getElementById('mPDVHeure').value,tel:document.getElementById('mPDVTel').value,
               compteDefaut:document.getElementById('mPDVCompte').value,jourMois:document.getElementById('mPDVJourMois').value,
               jours,notes:document.getElementById('mPDVNotes').value};
  if (id) { Object.assign(pdvs.find(p=>p.id===id), data); await saveItem('pdvs',pdvs.find(p=>p.id===id)); }
  else { data.id=uid(); pdvs.push(data); await saveItem('pdvs',data); }
  populateSelects(); closeM('mPDV'); renderAdmin(); toast('PDV enregistré ✓');
}
window.savePDV = savePDV;

async function delPDV(id) {
  if (!confirm('Supprimer ce PDV ?')) return;
  pdvs=pdvs.filter(p=>p.id!==id); await delItem('pdvs',id); populateSelects(); renderAdmin(); toast('Supprimé','info');
}
window.delPDV = delPDV;

// COMPTES CRUD
function onCptOpChange() {
  const op=document.getElementById('mCptOp').value;
  document.getElementById('mCptOpLibre').style.display=op==='AUTRE'?'block':'none';
  const cm={OM:'#ff6b00',MTN:'#f5a623',WAVE:'#22d3ee',MOOV:'#00d68f',CASH:'#00d68f',BICICI:'#4d8af0',SGBCI:'#4d8af0',ECOBANK:'#a855f7',UBA:'#f05050',BNI:'#22d3ee',NSIA:'#4d8af0',SIB:'#4d8af0',CORIS:'#a855f7',BOA:'#4d8af0'};
  if (cm[op]) document.getElementById('mCptColor').value=cm[op];
  const mmOps=['OM','MTN','WAVE','MOOV'], bkOps=['BICICI','SGBCI','ECOBANK','UBA','BNI','NSIA','SIB','CORIS','BOA'];
  if(mmOps.includes(op)) document.getElementById('mCptCat').value='mobile_money';
  else if(bkOps.includes(op)) document.getElementById('mCptCat').value='banque';
  else if(op==='CASH') document.getElementById('mCptCat').value='caisse';
}
window.onCptOpChange = onCptOpChange;

function onCptCatChange() {
  if (document.getElementById('mCptCat').value==='caisse') document.getElementById('mCptOp').value='CASH';
}
window.onCptCatChange = onCptCatChange;

function openCompteModal(id) {
  document.getElementById('mCptTitle').textContent=id?'Modifier compte':'Nouveau compte';
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
  openM('mCompte');
}
window.openCompteModal = openCompteModal;
function editCompte(id){openCompteModal(id);}
window.editCompte = editCompte;

async function saveCompte() {
  const nom=document.getElementById('mCptNom').value.trim();
  if (!nom) { toast('Nom obligatoire','err'); return; }
  const id=document.getElementById('mCptId').value;
  const soldeInit=parseFloat(document.getElementById('mCptSolde').value)||0;
  const op=document.getElementById('mCptOp').value;
  const data={nom,cat:document.getElementById('mCptCat').value,op,
               opLibre:op==='AUTRE'?document.getElementById('mCptOpLibre').value:'',
               num:document.getElementById('mCptNum').value,contact:document.getElementById('mCptContact').value,
               soldeInit,color:document.getElementById('mCptColor').value,notes:document.getElementById('mCptNotes').value};
  if (id) {
    const c=comptes.find(x=>x.id===id); const diff=soldeInit-c.soldeInit;
    c.solde=(c.solde||0)+diff; Object.assign(c,data); await saveItem('comptes',c);
  } else { data.id=uid(); data.solde=soldeInit; comptes.push(data); await saveItem('comptes',data); }
  populateSelects(); closeM('mCompte'); renderAdmin(); toast('Compte enregistré ✓'); renderDashboard();
}
window.saveCompte = saveCompte;

async function delCompte(id) {
  if (!confirm('Supprimer ce compte ?')) return;
  comptes=comptes.filter(c=>c.id!==id); await delItem('comptes',id); populateSelects(); renderAdmin(); toast('Supprimé','info');
}
window.delCompte = delCompte;

// ══════════════════════════════════════════════════════
// UTILISATEURS
// ══════════════════════════════════════════════════════
function renderUsers() {
  document.getElementById('userTbody').innerHTML=users.map(u=>`<tr>
    <td><b>${u.nom}</b></td>
    <td style="color:var(--text2);font-size:.8rem;font-family:monospace">${u.login}</td>
    <td><span class="badge ${u.role==='admin'?'ba':u.role==='collaborateur'?'bb':'bg'}">${u.role}</span></td>
    <td style="font-size:.78rem;color:var(--text2)">${u.pdv?pdvs.find(p=>p.id===u.pdv)?.nom||u.pdv:'Tous'}</td>
    <td style="font-size:.75rem;color:var(--text2)">${u.lastLogin?new Date(u.lastLogin).toLocaleString('fr-FR'):'Jamais'}</td>
    <td><span class="badge ${u.actif!==false?'bg':'br'}">${u.actif!==false?'Actif':'Inactif'}</span></td>
    <td>${u.id!==currentUser.id
      ?`<button class="btn btn-ghost btn-xs" onclick="editUser('${u.id}')">✏️</button>
         <button class="btn btn-${u.actif!==false?'amber':'ghost'} btn-xs" onclick="toggleUser('${u.id}')">${u.actif!==false?'Désactiver':'Activer'}</button>`
      :'<span style="font-size:.72rem;color:var(--text3)">Vous</span>'}</td>
  </tr>`).join('');
}
window.renderUsers = renderUsers;

function openUserModal(id) {
  document.getElementById('mUserTitle').textContent=id?'Modifier utilisateur':'Nouvel utilisateur';
  document.getElementById('mUserId').value=id||'';
  const u=id?users.find(x=>x.id===id):{};
  document.getElementById('mUNom').value=u.nom||'';
  document.getElementById('mULogin').value=u.login||'';
  document.getElementById('mUPass').value='';
  document.getElementById('mURole').value=u.role||'collaborateur';
  document.getElementById('mUTel').value=u.tel||'';
  document.getElementById('mUPDV').innerHTML='<option value="">Tous</option>'+pdvs.map(p=>`<option value="${p.id}"${u.pdv===p.id?' selected':''}>${p.nom}</option>`).join('');
  openM('mUser');
}
window.openUserModal = openUserModal;
function editUser(id){openUserModal(id);}
window.editUser = editUser;

async function saveUser() {
  const nom=document.getElementById('mUNom').value.trim(), login=document.getElementById('mULogin').value.trim(), pass=document.getElementById('mUPass').value;
  if (!nom||!login) { toast('Nom et login obligatoires','err'); return; }
  const id=document.getElementById('mUserId').value;
  if (!id&&!pass) { toast('Mot de passe obligatoire','err'); return; }
  if (!id&&users.find(u=>u.login===login)) { toast('Login déjà utilisé','err'); return; }
  const data={nom,login,role:document.getElementById('mURole').value,pdv:document.getElementById('mUPDV').value,tel:document.getElementById('mUTel').value,actif:true};
  if (pass) data.pass=pass;
  if (id) { Object.assign(users.find(u=>u.id===id),data); await saveItem('users',users.find(u=>u.id===id)); }
  else { data.id=uid(); data.lastLogin=null; users.push(data); await saveItem('users',data); }
  closeM('mUser'); renderUsers(); toast('Utilisateur enregistré ✓');
}
window.saveUser = saveUser;

async function toggleUser(id) {
  const u=users.find(x=>x.id===id); if(!u)return;
  u.actif=!u.actif; await saveItem('users',u); renderUsers(); toast(u.actif?'Utilisateur activé':'Utilisateur désactivé');
}
window.toggleUser = toggleUser;

// ══════════════════════════════════════════════════════
// BACKUP EXPOSED
// ══════════════════════════════════════════════════════
window.backupPC       = backupPC;
window.backupDropbox  = backupDropbox;
window.backupNow      = backupNow;
window.importerDonnees = importerDonnees;
window.resetFilter    = resetFilter;
window.openM          = openM;
window.closeM         = closeM;

// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════
async function init() {
  if (useFirebase) {
    sync('syncing','Connexion Firebase…');
    try { await loadAll(); sync('ok','🔴 Temps réel'); }
    catch(e) { sync('error','Mode local'); console.warn(e); }
  } else {
    sync('ok','Mode local');
  }
  document.getElementById('loadingOverlay').style.display='none';
  document.getElementById('loginScreen').style.display='flex';
  document.getElementById('loginUser').focus();
}
init();
