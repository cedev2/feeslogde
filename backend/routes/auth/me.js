const router = require('express').Router();
const mongoose = require('mongoose');
const { success, fail } = require('../../helpers/response');
const { requireAuth } = require('../../middleware/auth');

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    let schoolName = null;
    if (user.schoolId) {
      const schoolDoc = user.schoolId._id ? user.schoolId : null;
      if (!schoolDoc) {
        const School = mongoose.model('School');
        const s = await School.findById(user.schoolId).select('name');
        if (s) schoolName = s.name;
      } else {
        schoolName = schoolDoc.name || null;
      }
    }

    return success(res, {
      userId: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      status: user.status,
      schoolId: user.schoolId,
      schoolName
    });
  } catch (error) {
    return fail(res, 'Failed to fetch user data', 500, { error: error.message });
  }
});

module.exports = router;
