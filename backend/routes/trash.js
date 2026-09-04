const router = require('express').Router();
const Trash = require('../models/Trash');
const { success, fail } = require('../helpers/response');
const { logActivity } = require('../helpers/audit');
const {
  TRASH_TTL_DAYS,
  trashItem,
  getTrashRow,
  destroyEntity,
  restoreEntity,
  purgeExpiredTrash
} = require('../helpers/trash');
const { requireAuth } = require('../middleware/auth');
const { requireSchool, getSchoolId } = require('../middleware/school');

router.get('/list', requireAuth, requireSchool, async (req, res) => {
  try {
    const schoolId = getSchoolId(req.user, req);
    if (!schoolId && req.user.role !== 'super_admin') {
      return fail(res, 'No school assigned', 403);
    }

    const query = schoolId ? { schoolId } : {};
    await purgeExpiredTrash(schoolId || null);

    const items = await Trash.find(query).sort({ deletedAt: -1 });

    const now = new Date();
    const result = items.map(item => {
      const deletedAt = new Date(item.deletedAt);
      const elapsed = Math.floor((now - deletedAt) / (1000 * 60 * 60 * 24));
      const daysLeft = Math.max(0, TRASH_TTL_DAYS - elapsed);

      return {
        _id: item._id,
        entityType: item.entityType,
        entityId: item.entityId,
        name: item.name,
        deletedAt: item.deletedAt,
        expiresAt: item.expiresAt,
        days_left: daysLeft
      };
    });

    return success(res, { items: result, ttl_days: TRASH_TTL_DAYS });
  } catch (error) {
    return fail(res, 'Failed to fetch trash', 500, { error: error.message });
  }
});

router.post('/restore', requireAuth, requireSchool, async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return fail(res, 'Trash item ID is required', 422, { id: 'Trash item ID is required' });
    }

    const schoolId = getSchoolId(req.user, req);
    if (!schoolId && req.user.role !== 'super_admin') {
      return fail(res, 'No school assigned', 403);
    }

    const trash = await getTrashRow(id, schoolId, req.user);
    if (!trash) {
      return fail(res, 'Trash item not found', 404);
    }

    await restoreEntity(trash);

    await logActivity({
      action: 'trash_restored',
      description: `"${trash.name}" (${trash.entityType}) restored from trash`,
      schoolId,
      userId: req.user._id,
      userEmail: req.user.email,
      entityType: trash.entityType,
      entityId: 0,
      ipAddress: req.ip
    });

    return success(res, { message: 'Item restored' });
  } catch (error) {
    return fail(res, 'Failed to restore item', 500, { error: error.message });
  }
});

router.post('/delete', requireAuth, requireSchool, async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return fail(res, 'Trash item ID is required', 422, { id: 'Trash item ID is required' });
    }

    const schoolId = getSchoolId(req.user, req);
    if (!schoolId && req.user.role !== 'super_admin') {
      return fail(res, 'No school assigned', 403);
    }

    const trash = await getTrashRow(id, schoolId, req.user);
    if (!trash) {
      return fail(res, 'Trash item not found', 404);
    }

    await destroyEntity(trash);

    await logActivity({
      action: 'trash_permanently_deleted',
      description: `"${trash.name}" (${trash.entityType}) permanently deleted`,
      schoolId,
      userId: req.user._id,
      userEmail: req.user.email,
      entityType: trash.entityType,
      entityId: 0,
      ipAddress: req.ip
    });

    return success(res, { message: 'Item permanently deleted' });
  } catch (error) {
    return fail(res, 'Failed to delete item', 500, { error: error.message });
  }
});

router.post('/clean', requireAuth, requireSchool, async (req, res) => {
  try {
    const schoolId = getSchoolId(req.user, req);
    if (!schoolId && req.user.role !== 'super_admin') {
      return fail(res, 'No school assigned', 403);
    }

    const query = {};
    if (schoolId) query.schoolId = schoolId;
    const items = await Trash.find(query);
    let count = 0;

    for (const item of items) {
      await destroyEntity(item);
      count++;
    }

    await logActivity({
      action: 'trash_cleaned',
      description: `${count} items permanently deleted from trash`,
      schoolId,
      userId: req.user._id,
      userEmail: req.user.email,
      entityType: 'trash',
      entityId: 0,
      ipAddress: req.ip
    });

    return success(res, { message: `${count} items permanently deleted`, count });
  } catch (error) {
    return fail(res, 'Failed to clean trash', 500, { error: error.message });
  }
});

module.exports = router;
