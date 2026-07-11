/* ════════════════════════════════════════════════════════════════
   PHARMACASH — MIGRATION VERS FIREBASE AUTHENTICATION (à exécuter UNE FOIS)

   Ce script :
   1. Lit les utilisateurs existants (localStorage du poste)
   2. Crée pour chacun un compte Firebase Auth avec son mot de passe ACTUEL
      → personne ne change de mot de passe
   3. EFFACE les mots de passe de la base Firestore (ils n'y reviendront jamais)

   ⚠️ ORDRE OBLIGATOIRE :
   - AVANT : activer Email/Password dans Firebase Console (voir guide)
   - AVANT : déployer le nouveau app.js sur GitHub
   - APRÈS : vérifier le login, PUIS seulement coller les règles Firestore

   À coller dans la console (F12) sur pharmacash-mbengue.netlify.app
   ════════════════════════════════════════════════════════════════ */
(async () => {
  const SUFFIX = '@pharmacash-mbengue.app';   // DOIT être identique à AUTH_EMAIL_SUFFIX de app.js

  const { getApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
  const { getAuth, createUserWithEmailAndPassword, signOut } =
    await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
  const { getFirestore, doc, updateDoc, deleteField } =
    await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

  const auth = getAuth(getApp());
  const db = getFirestore(getApp());

  const users = JSON.parse(localStorage.getItem('pc_users') || '[]');
  if (!users.length) {
    console.log('%c⚠️ Aucun utilisateur en cache. Charge d\'abord le Tableau de bord, puis relance.', 'color:#f59e0b;font-weight:700');
    return;
  }

  console.log(`%c═══ MIGRATION — ${users.length} utilisateur(s) ═══`, 'color:#38bdf8;font-weight:700;font-size:13px');
  const bilan = [];

  for (const u of users) {
    const email = (u.login || '').includes('@') ? u.login.trim().toLowerCase()
                                                : (u.login || '').trim().toLowerCase() + SUFFIX;
    if (!u.login) { bilan.push({ Utilisateur: u.nom, Statut: '⏭ ignoré (pas de login)' }); continue; }
    if (!u.pass)  { bilan.push({ Utilisateur: u.nom, Email: email, Statut: '⏭ pas de mot de passe local — créer à la main dans la console Firebase' }); continue; }
    if (u.pass.length < 6) {
      bilan.push({ Utilisateur: u.nom, Email: email, Statut: '❌ mot de passe < 6 caractères — Firebase le refuse, créer à la main avec un mot de passe plus long' });
      continue;
    }
    try {
      await createUserWithEmailAndPassword(auth, email, u.pass);
      bilan.push({ Utilisateur: u.nom, Email: email, Statut: '✅ compte Auth créé (mot de passe inchangé)' });
    } catch (e) {
      if (e.code === 'auth/email-already-in-use') {
        bilan.push({ Utilisateur: u.nom, Email: email, Statut: '✓ existait déjà' });
      } else {
        bilan.push({ Utilisateur: u.nom, Email: email, Statut: '❌ ' + e.code });
        continue;   // ne pas effacer le pass si le compte Auth n'existe pas
      }
    }
    // Effacer le mot de passe de Firestore — il ne sert plus à rien là-bas
    try {
      await updateDoc(doc(db, 'users', u.id), { pass: deleteField() });
    } catch (e) { console.warn('Effacement pass', u.nom, e.code); }
  }

  await signOut(auth).catch(() => {});
  console.table(bilan);

  const ok = bilan.filter(b => b.Statut.startsWith('✅') || b.Statut.startsWith('✓')).length;
  const ko = bilan.length - ok;
  console.log(`%c═══ RÉSULTAT : ${ok} compte(s) prêt(s), ${ko} à traiter à la main ═══`, ko ? 'color:#f59e0b;font-weight:700' : 'color:#22c55e;font-weight:700');
  console.log('%c→ Recharge la page (Ctrl+Shift+R) et connecte-toi avec ton login habituel.', 'font-weight:700');
  console.log('%c→ Si le login fonctionne, colle ALORS les règles Firestore (fichier firestore_rules.txt).', 'font-weight:700');
})();
