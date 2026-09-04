const router = require('express').Router();
const User = require('../../models/User');
const Mfa = require('../../models/Mfa');
const { success, fail, getInput } = require('../../helpers/response');
const { hashPassword, generateTotpSecret } = require('../../helpers/security');
const { validateRequired, validateEmail } = require('../../helpers/validation');
const { logActivity } = require('../../helpers/audit');

router.post('/register-super-admin', async (req, res) => {
  try {
    const existingSuperAdmin = await User.findOne({ role: 'super_admin' });
    if (existingSuperAdmin) {
      return fail(res, 'Super admin already exists', 403);
    }

    const data = getInput(req);
    const { full_name, email, password, confirm_password } = data;

    const requiredErrors = validateRequired(data, ['full_name', 'email', 'password', 'confirm_password']);
    if (Object.keys(requiredErrors).length > 0) {
      return fail(res, 'Validation failed', 400, requiredErrors);
    }

    if (!validateEmail(email)) {
      return fail(res, 'Invalid email address', 400);
    }

    if (password.length < 6) {
      return fail(res, 'Password must be at least 6 characters', 400);
    }

    if (password !== confirm_password) {
      return fail(res, 'Passwords do not match', 400);
    }

    const duplicate = await User.findOne({ email: email.toLowerCase().trim() });
    if (duplicate) {
      return fail(res, 'Email already registered', 409);
    }

    const passwordHash = await hashPassword(password);

    const user = await User.create({
      fullName: full_name.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      role: 'super_admin',
      status: 'active'
    });

    const secret = generateTotpSecret();
    await Mfa.create({
      userId: user._id,
      secret,
      enabled: false,
      enrolled: false
    });

    const otpauthUri = `otpauth://totp/FeesLedger:${encodeURIComponent(user.email)}?secret=${secret}&issuer=FeesLedger&digits=6&period=30`;

    await logActivity({
      action: 'register_super_admin',
      description: `Super admin registered: ${user.email}`,
      userId: user._id,
      userEmail: user.email,
      entityType: 'user',
      ipAddress: req.ip || req.connection.remoteAddress || ''
    });

    return success(res, {
      userId: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      status: user.status,
      mfa_secret: secret,
      mfa_uri: otpauthUri
    }, 201);
  } catch (error) {
    return fail(res, 'Registration failed', 500, { error: error.message });
  }
});

module.exports = router;
