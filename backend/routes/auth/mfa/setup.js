const router = require('express').Router();
const Mfa = require('../../../models/Mfa');
const { success, fail } = require('../../../helpers/response');
const { generateTotpSecret } = require('../../../helpers/security');
const { requireAuth } = require('../../../middleware/auth');

router.post('/mfa/setup', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const secret = generateTotpSecret();

    const mfa = await Mfa.findOne({ userId: user._id });
    if (mfa) {
      mfa.secret = secret;
      mfa.enabled = false;
      mfa.enrolled = false;
      mfa.enrolledAt = null;
      await mfa.save();
    } else {
      await Mfa.create({
        userId: user._id,
        secret,
        enabled: false,
        enrolled: false
      });
    }

    const issuer = 'FeesLedger';
    const otpauthUri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user.email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;

    return success(res, {
      mfa_secret: secret,
      uri: otpauthUri
    });
  } catch (error) {
    return fail(res, 'Failed to setup MFA', 500, { error: error.message });
  }
});

module.exports = router;
