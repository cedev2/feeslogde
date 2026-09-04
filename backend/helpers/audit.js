const ActivityLog = require('../models/ActivityLog');

const logActivity = async ({
  action,
  description,
  schoolId,
  userId,
  userEmail,
  entityType,
  entityId,
  studentName,
  studentId,
  className,
  academicYear,
  term,
  ipAddress
}) => {
  try {
    await ActivityLog.create({
      action: action || '',
      description: description || '',
      schoolId: schoolId || null,
      userId: userId || null,
      userEmail: userEmail || '',
      entityType: entityType || '',
      entityId: entityId || 0,
      studentName: studentName || '',
      studentId: studentId || '',
      className: className || '',
      academicYear: academicYear || '',
      term: term || '',
      ipAddress: ipAddress || ''
    });
  } catch (error) {
    console.error('Activity log error:', error.message);
  }
};

module.exports = { logActivity };
