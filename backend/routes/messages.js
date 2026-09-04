const router = require('express').Router();
const Message = require('../models/Message');
const { success, fail, getInput } = require('../helpers/response');
const { validateRequired } = require('../helpers/validation');
const { logActivity } = require('../helpers/audit');
const { requireAuth } = require('../middleware/auth');
const { requireSchool, getSchoolId } = require('../middleware/school');

router.get('/list', requireAuth, requireSchool, async (req, res) => {
  try {
    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) {
      return fail(res, 'No school assigned', 403);
    }

    const messages = await Message.find({ schoolId })
      .populate('userId', 'email fullName')
      .sort({ createdAt: -1 });

    return success(res, messages);
  } catch (error) {
    return fail(res, 'Failed to fetch messages', 500, { error: error.message });
  }
});

router.post('/send', requireAuth, requireSchool, async (req, res) => {
  try {
    const input = getInput(req);
    const errors = validateRequired(input, ['subject']);
    if (Object.keys(errors).length > 0) {
      return fail(res, 'Validation failed', 422, errors);
    }

    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) {
      return fail(res, 'No school assigned', 403);
    }

    const message = await Message.create({
      schoolId,
      userId: req.user._id,
      type: input.type || '',
      subject: input.subject,
      body: input.body || '',
      recipientCount: input.recipientCount || 0,
      recipients: input.recipients || [],
      status: input.status || 'sent'
    });

    await logActivity({
      action: 'message_sent',
      description: `Message "${input.subject}" sent`,
      schoolId,
      userId: req.user._id,
      userEmail: req.user.email,
      entityType: 'message',
      entityId: 0,
      ipAddress: req.ip
    });

    return success(res, message, 201);
  } catch (error) {
    return fail(res, 'Failed to send message', 500, { error: error.message });
  }
});

module.exports = router;
