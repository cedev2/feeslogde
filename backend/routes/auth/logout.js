const router = require('express').Router();
const { success, fail } = require('../../helpers/response');
const { logActivity } = require('../../helpers/audit');

router.post('/logout', async (req, res) => {
  try {
    if (req.session && req.session.userId) {
      await logActivity({
        action: 'logout',
        description: `${req.session.email || 'user'} logged out`,
        userId: req.session.userId,
        schoolId: req.session.schoolId,
        userEmail: req.session.email || '',
        entityType: 'user',
        ipAddress: req.ip || req.connection.remoteAddress || ''
      });
    }

    req.session.destroy((err) => {
      if (err) {
        return fail(res, 'Logout failed', 500);
      }
      res.clearCookie('connect.sid', {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: req.secure
      });
      return success(res, { message: 'Logged out successfully' });
    });
  } catch (error) {
    return fail(res, 'Logout failed', 500, { error: error.message });
  }
});

module.exports = router;
