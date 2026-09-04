const router = require('express').Router();
const Parent = require('../../models/Parent');
const Student = require('../../models/Student');
const Trash = require('../../models/Trash');
const { success, fail, getInput } = require('../../helpers/response');
const { validateId, validateEmail } = require('../../helpers/validation');
const { logActivity } = require('../../helpers/audit');
const { trashItem } = require('../../helpers/trash');
const { requireAuth } = require('../../middleware/auth');
const { canPerform } = require('../../middleware/role');
const { getSchoolId } = require('../../middleware/school');

// GET /api/parents/list
router.get('/list', requireAuth, async (req, res) => {
  try {
    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) return fail(res, 'School ID required', 403);

    const trashedParentIds = await Trash.find({ entityType: 'parent' }).distinct('entityId');

    const query = { schoolId };
    if (trashedParentIds.length > 0) {
      query._id = { $nin: trashedParentIds };
    }

    const parents = await Parent.find(query).sort({ name: 1 }).lean();

    const enriched = [];
    for (const p of parents) {
      const children = await Student.find({
        parentId: p._id,
        status: { $ne: 'deleted' }
      }).select('name').lean();

      enriched.push({
        ...p,
        children_names: children.map(c => c.name).join(', '),
        child_count: children.length
      });
    }

    return success(res, { parents: enriched });
  } catch (error) {
    return fail(res, 'Failed to load parents', 500, { error: error.message });
  }
});

// POST /api/parents/create
router.post('/create', requireAuth, async (req, res) => {
  try {
    if (!canPerform(req.user, 'manage_students')) {
      return fail(res, 'Permission denied', 403);
    }

    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) return fail(res, 'School ID required', 403);

    const input = getInput(req);
    const name = (input.name || '').trim();
    const email = (input.email || '').toLowerCase().trim();
    const phone = (input.phone || '').trim();
    const id = input.id || null;

    if (!name) return fail(res, 'Parent name is required');
    if (email && !validateEmail(email)) return fail(res, 'Valid email is required');

    if (id) {
      const existing = await Parent.findOne({ _id: id, schoolId });
      if (!existing) return fail(res, 'Parent not found', 404);

      existing.name = name;
      existing.email = email;
      existing.phone = phone;
      await existing.save();
    } else {
      if (email) {
        const duplicateEmail = await Parent.findOne({ schoolId, email });
        if (duplicateEmail) {
          return fail(res, 'A parent with this email already exists', 409);
        }
      }
      if (phone) {
        const duplicatePhone = await Parent.findOne({ schoolId, phone });
        if (duplicatePhone) {
          return fail(res, 'A parent with this phone number already exists', 409);
        }
      }

      const newParent = await Parent.create({ schoolId, name, email, phone });

      return success(res, { id: newParent._id, name, email });
    }

    return success(res, { id, name, email });
  } catch (error) {
    return fail(res, 'Failed to save parent', 500, { error: error.message });
  }
});

// POST /api/parents/delete
router.post('/delete', requireAuth, async (req, res) => {
  try {
    if (!canPerform(req.user, 'manage_students')) {
      return fail(res, 'Permission denied', 403);
    }

    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) return fail(res, 'School ID required', 403);

    const input = getInput(req);
    const id = input.id;
    if (!id) return fail(res, 'Parent ID required');

    const parent = await Parent.findOne({ _id: id, schoolId }).lean();
    if (!parent) return fail(res, 'Parent not found', 404);

    await trashItem({
      schoolId,
      entityType: 'parent',
      entityId: id.toString(),
      name: parent.name,
      data: parent,
      userId: req.user._id
    });

    await logActivity({
      action: 'parent_deleted',
      description: `${parent.name} moved to trash`,
      schoolId,
      userId: req.user._id,
      userEmail: req.user.email,
      entityType: 'parent',
      entityId: 0,
      studentName: parent.name,
      ipAddress: req.ip
    });

    return success(res, { message: 'Parent moved to trash' });
  } catch (error) {
    return fail(res, 'Failed to delete parent', 500, { error: error.message });
  }
});

module.exports = router;
