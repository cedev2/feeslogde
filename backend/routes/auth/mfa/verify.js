const router = require('express').Router();
const mongoose = require('mongoose');
const User = require('../../../models/User');
const Mfa = require('../../../models/Mfa');
const BackupCode = require('../../../models/BackupCode');
const { success, fail, getInput } = require('../../../helpers/response');
const { generateTotp, generateBackupCodes, hashPassword } = require('../../../helpers/security');
const { logActivity } = require('../../../helpers/audit');
const { requireAuth } = require('../../../middleware/auth');

const verifyTotp = (secret, code) => {
  const now = Math.floor(Date.now() / 30000);
  for (let offset = -1; offset <= 1; offset++) {
    const expected = generateTotp(secret, now + offset);
    if (expected === code) return true;
  }
  return false;
};

router.post('/mfa/verify', async (req, res) => {
  try {
    const data = getInput(req);
    const { code } = data;

    if (!code || code.length !== 6) {
      return fail(res, 'A 6-digit code is required', 400);
    }

    const pendingUserId = req.session ? req.session.pending_mfa_user_id : null;
    const isPendingFlow = !!pendingUserId;

    let userId;
    let user;

    if (isPendingFlow) {
      userId = new mongoose.Types.ObjectId(pendingUserId);
      user = await User.findById(userId);
      if (!user) {
        return fail(res, 'User not found', 404);
      }
    } else {
      if (!req.session || !req.session.userId) {
        return fail(res, 'Authentication required', 401);
      }
      userId = new mongoose.Types.ObjectId(req.session.userId);
      user = await User.findById(userId);
      if (!user) {
        return fail(res, 'User not found', 404);
      }
    }

    const mfa = await Mfa.findOne({ userId });
    if (!mfa || !mfa.secret) {
      return fail(res, 'MFA not configured', 400);
    }

    const isValid = verifyTotp(mfa.secret, code);
    if (!isValid) {
      return fail(res, 'Invalid verification code', 401);
    }

    if (isPendingFlow) {
      delete req.session.pending_mfa_user_id;
      delete req.session.pending_mfa_email;

      if (!mfa.enrolled) {
        mfa.enrolled = true;
        mfa.enrolledAt = new Date();
        mfa.enabled = true;
        await mfa.save();

        const rawCodes = generateBackupCodes();
        const codesToSave = await Promise.all(
          rawCodes.map(async (c) => ({
            userId: user._id,
            codeHash: await hashPassword(c),
            used: false
          }))
        );
        await BackupCode.insertMany(codesToSave);

        if (user.status === 'pending') {
          req.session.userId = user._id.toString();
          req.session.role = user.role;
          req.session.schoolId = user.schoolId ? user.schoolId.toString() : null;
          req.session.email = user.email;

          await logActivity({
            action: 'mfa_enrolled',
            description: `${user.email} completed MFA enrollment, awaiting approval`,
            userId: user._id,
            schoolId: user.schoolId,
            userEmail: user.email,
            entityType: 'user',
            ipAddress: req.ip || req.connection.remoteAddress || ''
          });

          return success(res, {
            status: 'requires_approval',
            message: 'MFA enrolled. Your account is awaiting admin approval.',
            backup_codes: rawCodes
          });
        }

        req.session.userId = user._id.toString();
        req.session.role = user.role;
        req.session.schoolId = user.schoolId ? user.schoolId.toString() : null;
        req.session.email = user.email;

        const schoolDoc = user.schoolId ? await mongoose.model('School').findById(user.schoolId).select('name') : null;

        await logActivity({
          action: 'login',
          description: `${user.email} logged in with MFA`,
          userId: user._id,
          schoolId: user.schoolId,
          userEmail: user.email,
          entityType: 'user',
          ipAddress: req.ip || req.connection.remoteAddress || ''
        });

        return success(res, {
          status: 'authenticated',
          userId: user._id,
          fullName: user.fullName,
          email: user.email,
          role: user.role,
          schoolId: user.schoolId,
          schoolName: schoolDoc ? schoolDoc.name : null,
          backup_codes: rawCodes
        });
      }

      req.session.userId = user._id.toString();
      req.session.role = user.role;
      req.session.schoolId = user.schoolId ? user.schoolId.toString() : null;
      req.session.email = user.email;

      const schoolDoc = user.schoolId ? await mongoose.model('School').findById(user.schoolId).select('name') : null;

      await logActivity({
        action: 'login',
        description: `${user.email} logged in with MFA`,
        userId: user._id,
        schoolId: user.schoolId,
        userEmail: user.email,
        entityType: 'user',
        ipAddress: req.ip || req.connection.remoteAddress || ''
      });

      return success(res, {
        status: 'authenticated',
        userId: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        schoolId: user.schoolId,
        schoolName: schoolDoc ? schoolDoc.name : null
      });
    }

    // Setup flow (user is already logged in)
    if (!mfa.enrolled) {
      mfa.enrolled = true;
      mfa.enrolledAt = new Date();
      mfa.enabled = true;
      await mfa.save();

      const rawCodes = generateBackupCodes();
      const codesToSave = await Promise.all(
        rawCodes.map(async (c) => ({
          userId: user._id,
          codeHash: await hashPassword(c),
          used: false
        }))
      );
      await BackupCode.insertMany(codesToSave);

      await logActivity({
        action: 'mfa_enabled',
        description: `${user.email} enabled MFA`,
        userId: user._id,
        schoolId: user.schoolId,
        userEmail: user.email,
        entityType: 'user',
        ipAddress: req.ip || req.connection.remoteAddress || ''
      });

      return success(res, {
        status: 'mfa_enabled',
        message: 'MFA has been enabled',
        backup_codes: rawCodes
      });
    }

    mfa.enabled = true;
    await mfa.save();

    await logActivity({
      action: 'mfa_enabled',
      description: `${user.email} re-enabled MFA`,
      userId: user._id,
      schoolId: user.schoolId,
      userEmail: user.email,
      entityType: 'user',
      ipAddress: req.ip || req.connection.remoteAddress || ''
    });

    return success(res, {
      status: 'mfa_enabled',
      message: 'MFA has been enabled'
    });
  } catch (error) {
    return fail(res, 'MFA verification failed', 500, { error: error.message });
  }
});

module.exports = router;
