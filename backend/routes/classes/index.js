const router = require('express').Router();
const Class = require('../../models/Class');
const AcademicYear = require('../../models/AcademicYear');
const Student = require('../../models/Student');
const Trash = require('../../models/Trash');
const { success, fail, getInput } = require('../../helpers/response');
const { validateId } = require('../../helpers/validation');
const { logActivity } = require('../../helpers/audit');
const { trashItem } = require('../../helpers/trash');
const { requireAuth } = require('../../middleware/auth');
const { requireSchoolAdmin, canPerform } = require('../../middleware/role');
const { getSchoolId } = require('../../middleware/school');

// GET /api/classes/list
router.get('/list', requireAuth, async (req, res) => {
  try {
    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) return fail(res, 'School ID required', 403);

    const yearName = req.query.year || null;

    const query = { schoolId };
    if (yearName) {
      const years = await AcademicYear.find({ schoolId, name: yearName }).distinct('_id');
      if (years.length > 0) {
        query.academicYearId = { $in: years };
      } else {
        query.academicYearId = '__none__';
      }
    }

    const trashedClassIds = await Trash.find({ entityType: 'class' }).distinct('entityId');
    if (trashedClassIds.length > 0) {
      query._id = { $nin: trashedClassIds };
    }

    const classes = await Class.find(query)
      .populate({ path: 'academicYearId', select: 'name' })
      .sort({ name: 1 })
      .lean();

    const formatted = classes.map(c => ({
      id: c._id,
      name: c.name,
      unit_fee: c.unitFee,
      academic_year_id: c.academicYearId,
      year_name: c.academicYearId && c.academicYearId.name ? c.academicYearId.name : ''
    }));

    return success(res, { classes: formatted });
  } catch (error) {
    return fail(res, 'Failed to load classes', 500, { error: error.message });
  }
});

// POST /api/classes/create
router.post('/create', requireAuth, requireSchoolAdmin, async (req, res) => {
  try {
    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) return fail(res, 'School ID required', 403);

    const input = getInput(req);
    const name = (input.name || '').trim();
    const fee = parseFloat(input.unit_fee) || 0;
    const yearName = (input.year || '').trim();
    const id = input.id || null;

    if (!name) return fail(res, 'Class name is required');
    if (fee < 0) return fail(res, 'Fee must be non-negative');
    if (!yearName) return fail(res, 'Academic year is required');

    let year = await AcademicYear.findOne({ schoolId, name: yearName });
    if (!year) {
      year = await AcademicYear.create({ schoolId, name: yearName, status: 'active' });
    }
    const yearId = year._id;

    if (id) {
      const existing = await Class.findOne({ _id: id, schoolId });
      if (!existing) return fail(res, 'Class not found', 404);

      existing.name = name;
      existing.unitFee = fee;
      existing.academicYearId = yearId;
      await existing.save();

      await Student.updateMany(
        { classId: id, schoolId },
        { unitFee: fee }
      );

      await logActivity({
        action: 'class_updated',
        description: name,
        schoolId,
        userId: req.user._id,
        userEmail: req.user.email,
        entityType: 'class',
        entityId: 0,
        ipAddress: req.ip
      });

      return success(res, { id: existing._id, name, unit_fee: fee });
    } else {
      const newClass = await Class.create({
        schoolId,
        academicYearId: yearId,
        name,
        unitFee: fee
      });

      await logActivity({
        action: 'class_created',
        description: name,
        schoolId,
        userId: req.user._id,
        userEmail: req.user.email,
        entityType: 'class',
        entityId: 0,
        ipAddress: req.ip
      });

      return success(res, { id: newClass._id, name, unit_fee: fee });
    }
  } catch (error) {
    return fail(res, 'Failed to save class', 500, { error: error.message });
  }
});

// POST /api/classes/delete
router.post('/delete', requireAuth, requireSchoolAdmin, async (req, res) => {
  try {
    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) return fail(res, 'School ID required', 403);

    const input = getInput(req);
    const id = input.id;
    if (!id) return fail(res, 'Class ID required');

    const cls = await Class.findOne({ _id: id, schoolId }).lean();
    if (!cls) return fail(res, 'Class not found', 404);

    const studentCount = await Student.countDocuments({ classId: id, schoolId, status: { $ne: 'deleted' } });
    if (studentCount > 0) {
      return fail(res, `Cannot delete: ${studentCount} student(s) are enrolled in this class`);
    }

    await trashItem({
      schoolId,
      entityType: 'class',
      entityId: id.toString(),
      name: cls.name,
      data: cls,
      userId: req.user._id
    });

    await logActivity({
      action: 'class_deleted',
      description: `${cls.name} moved to trash`,
      schoolId,
      userId: req.user._id,
      userEmail: req.user.email,
      entityType: 'class',
      entityId: 0,
      ipAddress: req.ip
    });

    return success(res, { message: 'Class moved to trash' });
  } catch (error) {
    return fail(res, 'Failed to delete class', 500, { error: error.message });
  }
});

module.exports = router;
