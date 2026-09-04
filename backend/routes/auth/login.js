const router = require('express').Router();
const mongoose = require('mongoose');
const User = require('../../models/User');
const Mfa = require('../../models/Mfa');
const { success, fail, getInput } = require('../../helpers/response');
const { verifyPassword } = require('../../helpers/security');
const { logActivity } = require('../../helpers/audit');

const loginAttempts = new Map();

const cleanupAttempts = () => {
  const now = Date.now();
  for (const [key, data] of loginAttempts) {
    if (now - data.windowStart > 5 * 60 * 1000) {
      loginAttempts.delete(key);
    }
  }
};

setInterval(cleanupAttempts, 60 * 1000);

router.post('/login', async (req, res) => {
  try {
    const { email, password } = getInput(req);

    if (!email || !password) {
      return fail(res, 'Email and password are required', 400);
    }

    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const attemptKey = `${ip}:${email.toLowerCase()}`;

    const existing = loginAttempts.get(attemptKey);
    if (existing && existing.count >= 10 && (Date.now() - existing.windowStart) < 5 * 60 * 1000) {
      const remaining = Math.ceil((5 * 60 * 1000 - (Date.now() - existing.windowStart)) / 1000);
      return fail(res, `Too many login attempts. Try again in ${remaining} seconds`, 429);
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return fail(res, 'Invalid email or password', 401);
    }

    const isMatch = await verifyPassword(password, user.passwordHash);
    if (!isMatch) {
      if (!existing || (Date.now() - existing.windowStart) > 5 * 60 * 1000) {
        loginAttempts.set(attemptKey, { count: 1, windowStart: Date.now() });
      } else {
        existing.count++;
      }
      return fail(res, 'Invalid email or password', 401);
    }

    loginAttempts.delete(attemptKey);

    if (user.status === 'pending') {
      return fail(res, 'Your account is awaiting admin approval', 403);
    }

    if (user.status !== 'active') {
      return fail(res, 'Your account is not active', 403);
    }

    const mfa = await Mfa.findOne({ userId: user._id });

    if (mfa && !mfa.enrolled) {
      req.session.pending_mfa_user_id = user._id.toString();
      req.session.pending_mfa_email = user.email;

      const { generateTotpSecret } = require('../../helpers/security');
      const secret = mfa.secret || generateTotpSecret();
      if (!mfa.secret) {
        mfa.secret = secret;
        await mfa.save();
      }

      const issuer = 'FeesLedger';
      const otpauthUri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user.email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;

      return success(res, {
        status: 'requires_mfa_enrollment',
        mfa_secret: secret,
        uri: otpauthUri,
        email: user.email
      });
    }

    req.session.userId = user._id.toString();
    req.session.role = user.role;
    req.session.schoolId = user.schoolId ? user.schoolId.toString() : null;
    req.session.email = user.email;

    await logActivity({
      action: 'login',
      description: `${user.email} logged in`,
      userId: user._id,
      schoolId: user.schoolId,
      userEmail: user.email,
      entityType: 'user',
      entityId: 0,
      ipAddress: ip
    });

    const schoolDoc = user.schoolId ? await mongoose.model('School').findById(user.schoolId).select('name') : null;

    return success(res, {
      userId: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      status: user.status,
      schoolId: user.schoolId,
      schoolName: schoolDoc ? schoolDoc.name : null
    });
  } catch (error) {
    return fail(res, 'Login failed', 500, { error: error.message });
  }
});

module.exports = router;
