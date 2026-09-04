/* FEESLEDGER REGISTRATION SYSTEM */

(function () {
  const KEY = 'feesledger_users';
  const SESSION = 'feesledger_session';

  function users() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function saveUsers(v) { localStorage.setItem(KEY, JSON.stringify(v)); }
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }
  function openRegister() {
    const o = document.getElementById('registerOverlay');
    if (o) o.style.display = 'flex';
  }
  function closeRegister() {
    const o = document.getElementById('registerOverlay');
    if (o) o.style.display = 'none';
  }

  window.FeSLedgerRegister = openRegister;

  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('registerForm');
    if (!form) return;
    form.addEventListener('submit', e => {
      e.preventDefault();
      const name = document.getElementById('regName').value.trim();
      const school = document.getElementById('regSchool').value.trim();
      const email = document.getElementById('regEmail').value.trim().toLowerCase();
      const password = document.getElementById('regPassword').value;
      const confirm = document.getElementById('regConfirm').value;
      const msg = document.getElementById('registerMsg');
      if (password !== confirm) { msg.style.color = '#d92d20'; msg.textContent = 'Passwords do not match.'; return; }
      if (password.length < 8) { msg.style.color = '#d92d20'; msg.textContent = 'Password must contain at least 8 characters.'; return; }
      const list = users();
      if (list.some(u => u.email === email)) { msg.style.color = '#d92d20'; msg.textContent = 'This email is already registered.'; return; }

      const user = {
        id: 'USR-' + Date.now(),
        fullName: name,
        email,
        passwordHash: hash(password),
        role: 'school_admin',
        schoolId: 'SCH-' + Date.now(),
        schoolName: school,
        mfa: {
          enabled: false,
          enrolled: false,
          backupCodes: []
        },
        createdAt: new Date().toISOString()
      };
      list.push(user);
      saveUsers(list);
      try {
        const mainDb = JSON.parse(localStorage.getItem("feesledger_v1") || "null");
        if (mainDb) {
          mainDb.users = mainDb.users || [];
          if (!mainDb.users.some(u => u.email === email)) mainDb.users.push({ id: user.id, email, password, role: "school_admin", fullName: name, schoolId: user.schoolId, schoolName: school, mfa: { enabled: false, secret: null, backup: [] } });
          mainDb.school = mainDb.school || {};
          mainDb.school.name = school;
          mainDb.school.email = email;
          mainDb.schools = mainDb.schools || [];
          if (!mainDb.schools.some(s => s.id === user.schoolId)) mainDb.schools.push({ id: user.schoolId, name: school, adminName: name, adminEmail: email, status: "active", statusSince: new Date().toISOString(), deleteRequestedAt: null, deleteConfirmedAt: null, paidUntil: null });
          localStorage.setItem("feesledger_v1", JSON.stringify(mainDb));
          localStorage.setItem("feesledger_v1_session", JSON.stringify({ id: user.id, email, role: "school_admin" }));
        }
      } catch (err) { console.warn("Registration sync failed", err); }
      localStorage.setItem(SESSION, JSON.stringify({
        userId: user.id, role: user.role, schoolId: user.schoolId,
        fullName: user.fullName, email: user.email, schoolName: user.schoolName
      }));

      const profile = JSON.parse(localStorage.getItem('feesledger_school_profile') || '{}');
      profile.schoolId = user.schoolId;
      profile.schoolName = school;
      profile.adminName = name;
      profile.adminEmail = email;
      localStorage.setItem('feesledger_school_profile', JSON.stringify(profile));

      msg.style.color = '#16834a';
      msg.textContent = 'Account created successfully. Opening FeesLedger…';
      setTimeout(() => { closeRegister(); location.reload(); }, 700);
    });
  });

  document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem(SESSION)) return;
    const candidates = [...document.querySelectorAll('button,a')];
    const login = candidates.find(x => /login|sign in|connexion/i.test((x.textContent || '').trim()));
    if (login && !document.getElementById('dynamicRegisterBtn')) {
      const b = document.createElement('button');
      b.id = 'dynamicRegisterBtn';
      b.type = 'button';
      b.textContent = 'Create account / Register';
      b.onclick = openRegister;
      b.style.cssText = 'margin-left:8px;padding:10px 14px;border:1px solid #16a34a;border-radius:9px;background:#fff;color:#16834a;font-weight:700;cursor:pointer';
      login.parentElement?.appendChild(b);
    }
  });
})();
