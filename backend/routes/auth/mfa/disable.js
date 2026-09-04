const router = require('express').Router();
const Mfa = require('../../../models/Mfa');
const BackupCode = require('../../../models/BackupCode');
const { success, fail } = require('../../../helpers/response');
const { logActivity } = require('../../../helpers/audit');
const { requireAuth } = require('../../../middleware/auth');

router.post('/mfa/disable', requireAuth, async (req, res) => {
  try {
    const user = req.user;

    const mfa = await Mfa.findOne({ userId: user._id });
    if (!mfa) {
      return fail(res, 'MFA is not configured', 400);
    }

    if (!mfa.enabled && !mfa.enrolled) {
      return fail(res, 'MFA is already disabled', 400);
    }

    mfa.enabled = false;
    await mfa.save();

    await BackupCode.deleteMany({ userId: user._id });

    await logActivity({
      action: 'mfa_disabled',
      description: `${user.email} disabled MFA`,
      userId: user._id,
      schoolId: user.schoolId,
      userEmail: user.email,
      entityType: 'user',
      ipAddress: req.ip || req.connection.remoteAddress || ''
    });

    return success(res, { message: 'MFA has been disabled' });
  } catch (error) {
    return fail(res, 'Failed to disable MFA', 500, { error: error.message });
  }
});

module.exports = router;
