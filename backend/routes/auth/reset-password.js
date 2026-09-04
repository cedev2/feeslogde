const router = require('express').Router();
const User = require('../../models/User');
const PasswordReset = require('../../models/PasswordReset');
const { success, fail, getInput } = require('../../helpers/response');
const { hashPassword, hashToken } = require('../../helpers/security');
const { validateRequired, validateEmail } = require('../../helpers/validation');
const { logActivity } = require('../../helpers/audit');

router.post('/reset-password', async (req, res) => {
  try {
    const data = getInput(req);
    const { email, code, new_password, confirm_password } = data;

    const requiredErrors = validateRequired(data, ['email', 'code', 'new_password', 'confirm_password']);
    if (Object.keys(requiredErrors).length > 0) {
      return fail(res, 'Validation failed', 400, requiredErrors);
    }

    if (!validateEmail(email)) {
      return fail(res, 'Invalid email address', 400);
    }

    if (new_password.length < 6) {
      return fail(res, 'Password must be at least 6 characters', 400);
    }

    if (new_password !== confirm_password) {
      return fail(res, 'Passwords do not match', 400);
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return fail(res, 'Invalid email or code', 400);
    }

    const tokenHash = hashToken(code.toString());
    const resetRecord = await PasswordReset.findOne({
      userId: user._id,
      tokenHash,
      used: false,
      expiresAt: { $gt: new Date() }
    });

    if (!resetRecord) {
      return fail(res, 'Invalid or expired reset code', 400);
    }

    user.passwordHash = await hashPassword(new_password);
    await user.save();

    resetRecord.used = true;
    await resetRecord.save();

    // Invalidate all other reset tokens for this user
    await PasswordReset.updateMany(
      { userId: user._id, used: false },
      { used: true }
    );

    await logActivity({
      action: 'reset_password',
      description: `${user.email} reset their password`,
      userId: user._id,
      schoolId: user.schoolId,
      userEmail: user.email,
      entityType: 'user',
      ipAddress: req.ip || req.connection.remoteAddress || ''
    });

    return success(res, { message: 'Password reset successfully' });
  } catch (error) {
    return fail(res, 'Failed to reset password', 500, { error: error.message });
  }
});

module.exports = router;
