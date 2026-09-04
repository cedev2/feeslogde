/* FEESLEDGER MFA ENROLLMENT */

(function () {
  const USERS_KEY = 'feesledger_users';
  const SESSION_KEY = 'feesledger_session';
  let pendingUserId = null;

  const readUsers = () => { try { return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); } catch (e) { return []; } };
  const writeUsers = u => localStorage.setItem(USERS_KEY, JSON.stringify(u));

  function randomBase32() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    let out = '', buffer = 0, bits = 0;
    for (const b of bytes) {
      buffer = (buffer << 8) | b; bits += 8;
      while (bits >= 5) { out += chars[(buffer >> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits) out += chars[(buffer << (5 - bits)) & 31];
    return out;
  }

  function base32Bytes(str) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let buffer = 0, bits = 0, out = [];
    for (const c of str.replace(/=+$/, '').toUpperCase()) {
      const n = chars.indexOf(c);
      if (n < 0) continue;
      buffer = (buffer << 5) | n; bits += 5;
      if (bits >= 8) { bits -= 8; out.push((buffer >> bits) & 255); }
    }
    return new Uint8Array(out);
  }

  async function totp(secret, offset = 0) {
    const counter = Math.floor(Date.now() / 30000) + offset;
    const data = new ArrayBuffer(8), dv = new DataView(data);
    dv.setUint32(0, Math.floor(counter / 4294967296));
    dv.setUint32(4, counter >>> 0);
    const key = await crypto.subtle.importKey('raw', base32Bytes(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
    const o = mac[mac.length - 1] & 15;
    const n = ((mac[o] & 127) << 24) | ((mac[o + 1] & 255) << 16) | ((mac[o + 2] & 255) << 8) | (mac[o + 3] & 255);
    return String(n % 1000000).padStart(6, '0');
  }

  async function verifyTotp(secret, code) {
    for (const offset of [-1, 0, 1]) if (await totp(secret, offset) === code) return true;
    return false;
  }

  function openMfaEnrollment(user) {
    pendingUserId = user.id;
    user.mfa = user.mfa || {};
    if (!user.mfa.secret) user.mfa.secret = randomBase32();
    const users = readUsers(), i = users.findIndex(x => x.id === user.id);
    if (i >= 0) { users[i] = user; writeUsers(users); }

    const overlay = document.getElementById('mfaEnrollOverlay');
    overlay.style.display = 'flex';
    document.getElementById('mfaQr').innerHTML = '';

    const uri = 'otpauth://totp/FeesLedger:' + encodeURIComponent(user.email)
      + '?secret=' + user.mfa.secret + '&issuer=FeesLedger&algorithm=SHA1&digits=6&period=30';

    if (window.QRCode) {
      new QRCode(document.getElementById('mfaQr'), {
        text: uri, width: 220, height: 220,
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      document.getElementById('mfaQr').innerHTML = '<div style="padding:20px;color:#d92d20">QR library could not load. Use the manual setup key below.</div>';
    }
    document.getElementById('mfaSecret').textContent = user.mfa.secret;
    document.getElementById('mfaOtp').value = '';
    document.getElementById('mfaMsg').textContent = '';
  }

  function showBackupCodes(codes) {
    document.getElementById('backupCodes').innerHTML = codes.map(c => '<div style="padding:10px;background:#f2f4f7;border-radius:7px;text-align:center">' + c + '</div>').join('');
    document.getElementById('backupOverlay').style.display = 'flex';
  }

  document.addEventListener('DOMContentLoaded', function () {
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (session) {
        const users = readUsers(), user = users.find(x => x.id === session.userId);
        if (user && user.mfa && !user.mfa.enrolled) {
          clearInterval(timer);
          openMfaEnrollment(user);
        }
      }
      if (tries > 40) clearInterval(timer);
    }, 250);

    const verify = document.getElementById('mfaVerifyBtn');
    if (verify) verify.addEventListener('click', async function () {
      const code = document.getElementById('mfaOtp').value.trim();
      const msg = document.getElementById('mfaMsg');
      const users = readUsers(), i = users.findIndex(x => x.id === pendingUserId);
      if (i < 0) { msg.style.color = '#d92d20'; msg.textContent = 'Account not found.'; return; }
      if (!/^\d{6}$/.test(code)) { msg.style.color = '#d92d20'; msg.textContent = 'Enter the 6-digit code shown in your authenticator app.'; return; }
      msg.style.color = '#667085'; msg.textContent = 'Checking OTP…';
      const user = users[i];
      if (await verifyTotp(user.mfa.secret, code)) {
        const backup = [];
        for (let n = 0; n < 8; n++) backup.push(String(Math.floor(100000 + Math.random() * 900000)));
        user.mfa.enabled = true;
        user.mfa.enrolled = true;
        user.mfa.backupCodes = backup;
        user.mfa.enrolledAt = new Date().toISOString();
        users[i] = user;
        writeUsers(users);
        document.getElementById('mfaEnrollOverlay').style.display = 'none';
        showBackupCodes(backup);
      } else {
        msg.style.color = '#d92d20';
        msg.textContent = 'Invalid or expired OTP. Make sure your phone time is set automatically and try again.';
      }
    });
  });
})();
