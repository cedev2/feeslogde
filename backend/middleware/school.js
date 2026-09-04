const requireSchool = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  if (req.user.role === 'super_admin') {
    return next();
  }

  const schoolId = req.user.schoolId
    ? (typeof req.user.schoolId === 'object' ? req.user.schoolId._id || req.user.schoolId : req.user.schoolId)
    : null;

  if (!schoolId) {
    return res.status(403).json({ success: false, message: 'No school assigned to this account' });
  }

  req.schoolId = schoolId;
  next();
};

const getSchoolId = (user, req) => {
  if (user.role === 'super_admin') {
    return (req && req.params && req.params.schoolId) || null;
  }
  if (user.schoolId) {
    return typeof user.schoolId === 'object'
      ? (user.schoolId._id || user.schoolId)
      : user.schoolId;
  }
  return null;
};

module.exports = { requireSchool, getSchoolId };
