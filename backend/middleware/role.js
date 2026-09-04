const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    next();
  };
};

const requireSuperAdmin = requireRole('super_admin');
const requireSchoolAdmin = requireRole('super_admin', 'school_admin');
const requireAccountant = requireRole('super_admin', 'school_admin', 'accountant');

const PERMISSIONS = {
  super_admin: [
    'manage_schools', 'manage_users', 'manage_students', 'manage_parents',
    'manage_classes', 'manage_payments', 'manage_academic_years', 'manage_terms',
    'manage_files', 'manage_messages', 'view_reports', 'manage_settings',
    'manage_trash', 'manage_subscriptions', 'view_activity_logs',
    'manage_mfa', 'seed_data'
  ],
  school_admin: [
    'manage_users', 'manage_students', 'manage_parents', 'manage_classes',
    'manage_payments', 'manage_academic_years', 'manage_terms',
    'manage_files', 'manage_messages', 'view_reports', 'manage_settings',
    'manage_trash', 'view_activity_logs', 'manage_mfa'
  ],
  accountant: [
    'manage_students', 'manage_parents', 'manage_payments',
    'view_reports', 'manage_files', 'view_activity_logs'
  ]
};

const canPerform = (user, action) => {
  if (!user || !user.role) return false;
  const allowed = PERMISSIONS[user.role];
  if (!allowed) return false;
  return allowed.includes(action);
};

module.exports = {
  requireRole,
  requireSuperAdmin,
  requireSchoolAdmin,
  requireAccountant,
  canPerform
};
