const validateRequired = (data, fields) => {
  const errors = {};
  for (const field of fields) {
    const value = data[field];
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      errors[field] = `${field} is required`;
    }
  }
  return errors;
};

const validateEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.trim());
};

const validateNumeric = (value) => {
  if (value === undefined || value === null || value === '') return false;
  const num = Number(value);
  return !isNaN(num) && isFinite(num) && num >= 0;
};

const validateId = (id) => {
  if (id === undefined || id === null || id === '') return false;
  const num = Number(id);
  return Number.isInteger(num) && num > 0;
};

const VALID_ROLES = ['super_admin', 'school_admin', 'accountant'];

const validateRole = (role) => {
  return VALID_ROLES.includes(role);
};

const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;
  return str
    .trim()
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '');
};

module.exports = {
  validateRequired,
  validateEmail,
  validateNumeric,
  validateId,
  validateRole,
  sanitizeString
};
