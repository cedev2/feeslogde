const Trash = require('../models/Trash');
const SavedFile = require('../models/SavedFile');
const Student = require('../models/Student');
const Parent = require('../models/Parent');
const Class = require('../models/Class');
const User = require('../models/User');
const School = require('../models/School');
const fs = require('fs');
const path = require('path');

const TRASH_TTL_DAYS = 5;

const trashItem = async ({
  schoolId,
  userId,
  entityType,
  entityId,
  name,
  data
}) => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + TRASH_TTL_DAYS);

  return Trash.create({
    schoolId: schoolId || null,
    userId: userId || null,
    entityType: entityType || '',
    entityId: entityId || '',
    name: name || '',
    data: data || {},
    deletedAt: new Date(),
    expiresAt
  });
};

const getTrashRow = async (id, schoolId, user) => {
  const trash = await Trash.findById(id);
  if (!trash) return null;

  if (user.role === 'super_admin') return trash;

  if (schoolId && trash.schoolId && trash.schoolId.toString() !== schoolId.toString()) {
    return null;
  }

  return trash;
};

const destroyEntity = async (trash) => {
  switch (trash.entityType) {
    case 'file': {
      const file = await SavedFile.findById(trash.entityId);
      if (file && file.filePath) {
        const fullPath = path.join(__dirname, '..', file.filePath);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      }
      await SavedFile.findByIdAndDelete(trash.entityId);
      break;
    }
    case 'student':
      await Student.findByIdAndDelete(trash.entityId);
      break;
    case 'parent':
      await Parent.findByIdAndDelete(trash.entityId);
      break;
    case 'class':
      await Class.findByIdAndDelete(trash.entityId);
      break;
    case 'user':
      await User.findByIdAndDelete(trash.entityId);
      break;
    case 'school':
      await School.findByIdAndDelete(trash.entityId);
      break;
    default:
      break;
  }

  await Trash.findByIdAndDelete(trash._id);
};

const restoreEntity = async (trash) => {
  const data = trash.data || {};
  const entityId = trash.entityId;

  switch (trash.entityType) {
    case 'file': {
      const docId = data._id || entityId;
      if (docId) {
        const existing = await SavedFile.findById(docId);
        if (!existing) {
          const { _id, ...rest } = data;
          await SavedFile.create(rest);
        }
      }
      break;
    }
    case 'student': {
      const docId = entityId || (data._id && data._id.toString());
      if (docId) {
        const existing = await Student.findById(docId);
        if (existing) {
          const prevStatus = (data.status && data.status !== 'deleted') ? data.status : 'active';
          existing.status = prevStatus;
          await existing.save();
        } else if (data._id) {
          const { _id, ...rest } = data;
          rest.status = (rest.status && rest.status !== 'deleted') ? rest.status : 'active';
          await Student.create(rest);
        }
      }
      break;
    }
    case 'parent': {
      const docId = data._id || entityId;
      if (docId) {
        const existing = await Parent.findById(docId);
        if (!existing) {
          const { _id, ...rest } = data;
          await Parent.create(rest);
        }
      }
      break;
    }
    case 'class': {
      const docId = data._id || entityId;
      if (docId) {
        const existing = await Class.findById(docId);
        if (!existing) {
          const { _id, ...rest } = data;
          await Class.create(rest);
        }
      }
      break;
    }
    case 'user': {
      const docId = data._id || entityId;
      if (docId) {
        const existing = await User.findById(docId);
        if (!existing) {
          const { _id, ...rest } = data;
          await User.create(rest);
        }
      }
      break;
    }
    case 'school': {
      const docId = entityId || (data._id && data._id.toString());
      const validStatuses = ['active', 'paid', 'unpaid', 'suspended', 'pending_delete', 'deleted'];
      const restoreStatus = (data.restore_status && validStatuses.includes(data.restore_status)) ? data.restore_status : 'active';
      if (docId) {
        const existing = await School.findById(docId);
        if (existing) {
          existing.status = restoreStatus;
          existing.deleteRequestedAt = null;
          existing.statusSince = new Date();
          await existing.save();
        } else if (data._id) {
          const { _id, ...rest } = data;
          rest.status = restoreStatus;
          await School.create(rest);
        }
      }
      if (data.user_id) {
        const userStatus = data.restore_status || 'active';
        await User.findByIdAndUpdate(data.user_id, { status: userStatus });
      }
      break;
    }
    default:
      break;
  }

  await Trash.findByIdAndDelete(trash._id);
};

const purgeExpiredTrash = async (schoolId) => {
  const query = {
    expiresAt: { $lte: new Date() }
  };
  if (schoolId) {
    query.schoolId = schoolId;
  }
  const expired = await Trash.find(query);
  for (const item of expired) {
    await destroyEntity(item);
  }
  return expired.length;
};

module.exports = {
  TRASH_TTL_DAYS,
  trashItem,
  getTrashRow,
  destroyEntity,
  restoreEntity,
  purgeExpiredTrash
};
