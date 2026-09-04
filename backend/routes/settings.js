const router = require('express').Router();
const School = require('../models/School');
const User = require('../models/User');
const Mfa = require('../models/Mfa');
const Trash = require('../models/Trash');
const SavedFile = require('../models/SavedFile');
const { success, fail, getInput } = require('../helpers/response');
const { validateRequired, validateEmail } = require('../helpers/validation');
const { hashPassword, generateTotpSecret } = require('../helpers/security');
const { logActivity } = require('../helpers/audit');
const { trashItem } = require('../helpers/trash');
const { requireAuth } = require('../middleware/auth');
const { requireSchool, getSchoolId } = require('../middleware/school');
const { requireSchoolAdmin } = require('../middleware/role');

router.get('/school', requireAuth, requireSchool, async (req, res) => {
  try {
    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) {
      return fail(res, 'No school assigned', 403);
    }

    const school = await School.findById(schoolId).select('id name email phone logo');
    if (!school) {
      return fail(res, 'School not found', 404);
    }

    return success(res, { school });
  } catch (error) {
    return fail(res, 'Failed to fetch school profile', 500, { error: error.message });
  }
});

router.patch('/school', requireAuth, requireSchool, requireSchoolAdmin, async (req, res) => {
  try {
    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) {
      return fail(res, 'No school assigned', 403);
    }

    const input = getInput(req);
    const update = {};

    if (input.name !== undefined) update.name = input.name;
    if (input.email !== undefined) update.email = input.email;
    if (input.phone !== undefined) update.phone = input.phone;
    if (input.logo !== undefined) update.logo = input.logo;

    const school = await School.findByIdAndUpdate(schoolId, update, { new: true });
    if (!school) {
      return fail(res, 'School not found', 404);
    }

    await logActivity({
      action: 'school_updated',
      description: 'School profile updated',
      schoolId,
      userId: req.user._id,
      userEmail: req.user.email,
      entityType: 'school',
      entityId: 0,
      ipAddress: req.ip
    });

    return success(res, school);
  } catch (error) {
    return fail(res, 'Failed to update school profile', 500, { error: error.message });
  }
});

router.get('/users-list', requireAuth, requireSchool, requireSchoolAdmin, async (req, res) => {
  try {
    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) {
      return fail(res, 'No school assigned', 403);
    }

    const trashedUserIds = (await Trash.find({
      schoolId,
      entityType: 'user'
    }).select('entityId')).map(t => t.entityId);

    const users = await User.find({
      schoolId,
      _id: { $nin: trashedUserIds }
    }).select('-passwordHash');

    const userIds = users.map(u => u._id);
    const mfaRecords = await Mfa.find({ userId: { $in: userIds } });
    const mfaMap = {};
    for (const mfa of mfaRecords) {
      mfaMap[mfa.userId.toString()] = mfa.enabled;
    }

    const result = users.map(u => ({
      _id: u._id,
      fullName: u.fullName,
      email: u.email,
      role: u.role,
      status: u.status,
      mfaEnabled: mfaMap[u._id.toString()] || false,
      createdAt: u.createdAt
    }));

    return success(res, { users: result });
  } catch (error) {
    return fail(res, 'Failed to fetch users list', 500, { error: error.message });
  }
});

router.get('/users', requireAuth, requireSchool, requireSchoolAdmin, async (req, res) => {
  try {
    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) {
      return fail(res, 'No school assigned', 403);
    }

    const trashedUserIds = (await Trash.find({
      schoolId,
      entityType: 'user'
    }).select('entityId')).map(t => t.entityId);

    const users = await User.find({
      schoolId,
      role: 'accountant',
      _id: { $nin: trashedUserIds }
    }).select('-passwordHash');

    return success(res, users);
  } catch (error) {
    return fail(res, 'Failed to fetch users', 500, { error: error.message });
  }
});

router.post('/users', requireAuth, requireSchool, requireSchoolAdmin, async (req, res) => {
  try {
    const input = getInput(req);
    const errors = validateRequired(input, ['email', 'password']);
    if (Object.keys(errors).length > 0) {
      return fail(res, 'Validation failed', 422, errors);
    }

    if (!validateEmail(input.email)) {
      return fail(res, 'Invalid email format', 422, { email: 'Invalid email format' });
    }

    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) {
      return fail(res, 'No school assigned', 403);
    }

    const existing = await User.findOne({ email: input.email.toLowerCase().trim() });
    if (existing) {
      return fail(res, 'Email already in use', 409);
    }

    const passwordHash = await hashPassword(input.password);

    const user = await User.create({
      schoolId,
      fullName: input.fullName || input.email,
      email: input.email.toLowerCase().trim(),
      passwordHash,
      role: 'accountant',
      status: 'active'
    });

    const secret = generateTotpSecret();
    await Mfa.create({
      userId: user._id,
      secret,
      enabled: false,
      enrolled: false
    });

    await logActivity({
      action: 'user_created',
      description: `Accountant "${user.email}" created`,
      schoolId,
      userId: req.user._id,
      userEmail: req.user.email,
      entityType: 'user',
      entityId: 0,
      ipAddress: req.ip
    });

    return success(res, {
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      status: user.status
    }, 201);
  } catch (error) {
    return fail(res, 'Failed to create user', 500, { error: error.message });
  }
});

router.delete('/users', requireAuth, requireSchool, requireSchoolAdmin, async (req, res) => {
  try {
    const input = getInput(req);
    const { id } = input;

    if (!id) {
      return fail(res, 'User ID is required', 422, { id: 'User ID is required' });
    }

    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) {
      return fail(res, 'No school assigned', 403);
    }

    const user = await User.findOne({ _id: id, schoolId, role: 'accountant' });
    if (!user) {
      return fail(res, 'User not found', 404);
    }

    if (user._id.toString() === req.user._id.toString()) {
      return fail(res, 'Cannot delete your own account', 422);
    }

    const userData = user.toObject();
    delete userData.passwordHash;

    await trashItem({
      schoolId,
      userId: req.user._id,
      entityType: 'user',
      entityId: 0,
      name: user.email,
      data: userData
    });

    await user.deleteOne();

    await logActivity({
      action: 'user_deleted',
      description: `Accountant "${user.email}" moved to trash`,
      schoolId,
      userId: req.user._id,
      userEmail: req.user.email,
      entityType: 'user',
      entityId: 0,
      ipAddress: req.ip
    });

    return success(res, { message: 'User moved to trash' });
  } catch (error) {
    return fail(res, 'Failed to delete user', 500, { error: error.message });
  }
});

module.exports = router;
