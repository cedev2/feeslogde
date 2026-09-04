const router = require('express').Router();
const { success, fail, getInput } = require('../../helpers/response');
const { hashPassword, verifyPassword } = require('../../helpers/security');
const { validateRequired } = require('../../helpers/validation');
const { logActivity } = require('../../helpers/audit');
const { requireAuth } = require('../../middleware/auth');

router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const data = getInput(req);
    const { current_password, new_password, confirm_password } = data;

    const requiredErrors = validateRequired(data, ['current_password', 'new_password', 'confirm_password']);
    if (Object.keys(requiredErrors).length > 0) {
      return fail(res, 'Validation failed', 400, requiredErrors);
    }

    if (new_password.length < 6) {
      return fail(res, 'New password must be at least 6 characters', 400);
    }

    if (new_password !== confirm_password) {
      return fail(res, 'New passwords do not match', 400);
    }

    const user = req.user;

    const isMatch = await verifyPassword(current_password, user.passwordHash);
    if (!isMatch) {
      return fail(res, 'Current password is incorrect', 401);
    }

    user.passwordHash = await hashPassword(new_password);
    await user.save();

    await logActivity({
      action: 'change_password',
      description: `${user.email} changed their password`,
      userId: user._id,
      schoolId: user.schoolId,
      userEmail: user.email,
      entityType: 'user',
      ipAddress: req.ip || req.connection.remoteAddress || ''
    });

    return success(res, { message: 'Password changed successfully' });
  } catch (error) {
    return fail(res, 'Failed to change password', 500, { error: error.message });
  }
});

module.exports = router;
