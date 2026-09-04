const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const School = require('../../models/School');
const User = require('../../models/User');
const Student = require('../../models/Student');
const Payment = require('../../models/Payment');
const Trash = require('../../models/Trash');
const { success, fail, getInput } = require('../../helpers/response');
const { validateId } = require('../../helpers/validation');
const { logActivity } = require('../../helpers/audit');
const { trashItem } = require('../../helpers/trash');
const { requireAuth } = require('../../middleware/auth');
const { requireSuperAdmin, canPerform } = require('../../middleware/role');
const { getSchoolId } = require('../../middleware/school');

const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'schools');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, 'sch_' + require('crypto').randomBytes(12).toString('hex') + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, GIF, WebP images allowed'));
    }
  }
}).single('logo');

// GET /api/schools/list
router.get('/list', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const search = (req.query.search || '').trim();

    const query = { status: { $ne: 'deleted' } };
    const trashedSchoolIds = await Trash.find({ entityType: 'school' }).distinct('entityId');
    if (trashedSchoolIds.length > 0) {
      query._id = { $nin: trashedSchoolIds };
    }
    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [
        { name: regex },
        { adminName: regex },
        { adminEmail: regex }
      ];
    }
    const schools = await School.find(query).sort({ createdAt: -1 }).lean();

    const pendingUsers = await User.find({
      role: 'school_admin',
      status: 'pending'
    }).select('fullName email createdAt schoolId').sort({ createdAt: -1 }).lean();

    const pending = [];
    for (const u of pendingUsers) {
      const sch = u.schoolId ? await School.findById(u.schoolId).select('name').lean() : null;
      pending.push({
        id: u._id,
        full_name: u.fullName,
        email: u.email,
        created_at: u.createdAt,
        school_name: sch ? sch.name : null,
        school_id: u.schoolId
      });
    }

    const trashRows = await Trash.find({ entityType: 'school' }).sort({ deletedAt: -1 }).lean();
    const rejected = [];
    for (const t of trashRows) {
      let user = null;
      if (t.data && t.data.user_id) {
        user = await User.findById(t.data.user_id).select('email fullName').lean();
      }
      rejected.push({
        trash_id: t._id,
        school_id: t.entityId,
        school_name: t.name,
        deleted_at: t.deletedAt,
        data: t.data,
        user_id: user ? user._id : null,
        email: user ? user.email : null,
        full_name: user ? user.fullName : null
      });
    }

    return success(res, {
      schools,
      pending_registrations: pending,
      rejected_registrations: rejected
    });
  } catch (error) {
    return fail(res, 'Failed to load schools', 500, { error: error.message });
  }
});

// GET /api/schools/get?id=
router.get('/get', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const id = req.query.id;
    if (!id) return fail(res, 'School ID required');

    const school = await School.findById(id).lean();
    if (!school) return fail(res, 'School not found', 404);

    const adminCount = await User.countDocuments({ schoolId: school._id, role: 'school_admin' });
    const studentCount = await Student.countDocuments({ schoolId: school._id, status: { $ne: 'deleted' } });
    const paymentCount = await Payment.countDocuments({ schoolId: school._id });

    return success(res, {
      school: {
        ...school,
        admin_count: adminCount,
        student_count: studentCount,
        payment_count: paymentCount
      }
    });
  } catch (error) {
    return fail(res, 'Failed to load school', 500, { error: error.message });
  }
});

// POST /api/schools/update
router.post('/update', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const input = getInput(req);
    const id = input.school_id;
    const action = input.action || '';

    if (!id || !action) return fail(res, 'school_id and action are required');

    const school = await School.findById(id);
    if (!school) return fail(res, 'School not found', 404);

    const now = new Date();

    switch (action) {
      case 'set_status': {
        const newStatus = input.status || '';
        if (!['active', 'suspended'].includes(newStatus)) {
          return fail(res, 'Invalid status');
        }
        school.status = newStatus;
        school.statusSince = now;
        await school.save();
        break;
      }
      case 'mark_paid': {
        const paidUntil = new Date();
        paidUntil.setDate(paidUntil.getDate() + 32);
        school.status = 'paid';
        school.paidUntil = paidUntil;
        school.statusSince = now;
        await school.save();
        break;
      }
      case 'mark_unpaid': {
        school.status = 'unpaid';
        school.paidUntil = null;
        school.statusSince = now;
        await school.save();
        break;
      }
      case 'request_delete': {
        school.status = 'pending_delete';
        school.statusSince = now;
        school.deleteRequestedAt = now;
        await school.save();

        const admin = await User.findOne({ schoolId: school._id, role: 'school_admin' })
          .sort({ _id: 1 })
          .lean();

        await trashItem({
          schoolId: school._id,
          entityType: 'school',
          entityId: school._id.toString(),
          name: school.name || 'School',
          data: {
            user_id: admin ? admin._id.toString() : null,
            email: admin ? admin.email : null,
            restore_status: 'active'
          },
          userId: req.user._id
        });
        break;
      }
      case 'cancel_delete': {
        school.status = 'active';
        school.deleteRequestedAt = null;
        school.deleteConfirmedAt = null;
        await school.save();
        await Trash.deleteMany({ entityType: 'school', entityId: school._id.toString() });
        break;
      }
      default:
        return fail(res, 'Unknown action');
    }

    await logActivity({
      action: 'school_updated',
      description: `School ${action}`,
      schoolId: school._id,
      userId: req.user._id,
      userEmail: req.user.email,
      entityType: 'school',
      entityId: 0,
      ipAddress: req.ip
    });

    const updated = await School.findById(id).lean();
    return success(res, { school: updated });
  } catch (error) {
    return fail(res, 'Failed to update school', 500, { error: error.message });
  }
});

// POST /api/schools/approve
router.post('/approve', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const input = getInput(req);
    const userId = input.user_id;
    const action = input.action || '';

    if (!userId || !['approve', 'reject'].includes(action)) {
      return fail(res, 'user_id and a valid action are required');
    }

    const target = await User.findOne({ _id: userId, role: 'school_admin' })
      .populate('schoolId', 'name')
      .lean();

    if (!target) return fail(res, 'Registration not found', 404);

    if (action === 'approve') {
      await User.findByIdAndUpdate(userId, { status: 'active' });

      if (target.schoolId) {
        const schId = typeof target.schoolId === 'object' ? target.schoolId._id : target.schoolId;
        await School.findOneAndUpdate(
          { _id: schId, status: { $nin: ['suspended', 'deleted'] } },
          { status: 'active', statusSince: new Date() }
        );
      }

      await logActivity({
        action: 'approve',
        description: `Approved school admin: ${target.email} (${target.schoolId ? target.schoolId.name : ''})`,
        schoolId: target.schoolId ? target.schoolId._id : null,
        userId: req.user._id,
        userEmail: req.user.email,
        entityType: 'user',
        entityId: 0,
        ipAddress: req.ip
      });

      return success(res, {
        message: 'Registration approved. The school admin can now log in.',
        email: target.email
      });
    } else {
      await User.findByIdAndUpdate(userId, { status: 'inactive' });

      if (target.schoolId) {
        const schId = typeof target.schoolId === 'object' ? target.schoolId._id : target.schoolId;
        await School.findByIdAndUpdate(schId, { status: 'inactive', statusSince: new Date() });

        await trashItem({
          schoolId: schId,
          entityType: 'school',
          entityId: schId.toString(),
          name: (target.schoolId && target.schoolId.name) || 'School',
          data: {
            user_id: userId.toString(),
            email: target.email,
            restore_status: 'pending'
          },
          userId: req.user._id
        });
      }

      await logActivity({
        action: 'reject',
        description: `Rejected school admin: ${target.email} (${target.schoolId ? target.schoolId.name : ''})`,
        schoolId: target.schoolId ? target.schoolId._id : null,
        userId: req.user._id,
        userEmail: req.user.email,
        entityType: 'user',
        entityId: 0,
        ipAddress: req.ip
      });

      return success(res, {
        message: 'Registration rejected.',
        email: target.email
      });
    }
  } catch (error) {
    return fail(res, 'Failed to process registration', 500, { error: error.message });
  }
});

// POST /api/schools/logo
router.post('/logo', requireAuth, async (req, res) => {
  try {
    if (!canPerform(req.user, 'manage_settings')) {
      return fail(res, 'Permission denied', 403);
    }

    const schoolId = getSchoolId(req.user, req);

    upload(req, res, async (err) => {
      if (err) {
        return fail(res, err.message || 'Upload error');
      }

      if (!req.file) {
        return fail(res, 'No logo uploaded');
      }

      const url = 'uploads/schools/' + req.file.filename;
      await School.findByIdAndUpdate(schoolId, { logo: url });

      return success(res, { url });
    });
  } catch (error) {
    return fail(res, 'Failed to upload logo', 500, { error: error.message });
  }
});

// GET /api/schools/stats
router.get('/stats', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const total = await School.countDocuments({ status: { $ne: 'deleted' } });
    const active = await School.countDocuments({ status: { $in: ['active', 'paid'] } });
    const unpaid = await School.countDocuments({ status: { $in: ['unpaid', 'suspended'] } });
    const pending = await School.countDocuments({ status: 'pending_delete' });
    const deleted = await School.countDocuments({ status: 'deleted' });
    const totalStudents = await Student.countDocuments({ status: { $ne: 'deleted' } });
    const totalPayments = await Payment.countDocuments();

    return success(res, {
      total_schools: total,
      active_schools: active,
      unpaid_schools: unpaid,
      pending_deletion: pending,
      deleted_schools: deleted,
      total_students: totalStudents,
      total_payments: totalPayments
    });
  } catch (error) {
    return fail(res, 'Failed to load stats', 500, { error: error.message });
  }
});

module.exports = router;
