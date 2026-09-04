const router = require('express').Router();
const User = require('../../models/User');
const Mfa = require('../../models/Mfa');
const { success, fail } = require('../../helpers/response');
const { validateRequired, validateEmail } = require('../../helpers/validation');

router.get('/signup-status', async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return fail(res, 'Email query parameter is required', 400);
    }

    if (!validateEmail(email)) {
      return fail(res, 'Invalid email address', 400);
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return fail(res, 'User not found', 404);
    }

    const mfa = await Mfa.findOne({ userId: user._id });

    return success(res, {
      email: user.email,
      status: user.status,
      role: user.role,
      mfa_enrolled: mfa ? mfa.enrolled : false,
      mfa_enabled: mfa ? mfa.enabled : false,
      awaiting_approval: user.status === 'pending'
    });
  } catch (error) {
    return fail(res, 'Failed to check signup status', 500, { error: error.message });
  }
});

module.exports = router;
