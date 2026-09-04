const router = require('express').Router();
const User = require('../../models/User');
const PasswordReset = require('../../models/PasswordReset');
const { success, fail, getInput } = require('../../helpers/response');
const { hashToken } = require('../../helpers/security');
const { validateRequired, validateEmail } = require('../../helpers/validation');

router.post('/forgot-password', async (req, res) => {
  try {
    const data = getInput(req);
    const { email } = data;

    const requiredErrors = validateRequired(data, ['email']);
    if (Object.keys(requiredErrors).length > 0) {
      return fail(res, 'Validation failed', 400, requiredErrors);
    }

    if (!validateEmail(email)) {
      return fail(res, 'Invalid email address', 400);
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    // Always return success to prevent email enumeration
    if (!user) {
      return success(res, { message: 'If the email exists, a reset code has been sent' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const tokenHash = hashToken(code);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Invalidate any existing unused tokens for this user
    await PasswordReset.updateMany(
      { userId: user._id, used: false },
      { used: true }
    );

    await PasswordReset.create({
      userId: user._id,
      tokenHash,
      expiresAt,
      used: false
    });

    return success(res, {
      message: 'If the email exists, a reset code has been sent',
      code
    });
  } catch (error) {
    return fail(res, 'Failed to process request', 500, { error: error.message });
  }
});

module.exports = router;
