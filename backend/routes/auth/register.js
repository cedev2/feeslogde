const router = require('express').Router();
const User = require('../../models/User');
const School = require('../../models/School');
const Mfa = require('../../models/Mfa');
const AcademicYear = require('../../models/AcademicYear');
const Term = require('../../models/Term');
const Class = require('../../models/Class');
const { success, fail, getInput } = require('../../helpers/response');
const { hashPassword, generateTotpSecret } = require('../../helpers/security');
const { validateRequired, validateEmail } = require('../../helpers/validation');
const { logActivity } = require('../../helpers/audit');

router.post('/register', async (req, res) => {
  try {
    const data = getInput(req);
    const { full_name, school_name, email, password, confirm_password } = data;

    const requiredErrors = validateRequired(data, ['full_name', 'school_name', 'email', 'password', 'confirm_password']);
    if (Object.keys(requiredErrors).length > 0) {
      return fail(res, 'Validation failed', 400, requiredErrors);
    }

    if (!validateEmail(email)) {
      return fail(res, 'Invalid email address', 400);
    }

    if (password.length < 6) {
      return fail(res, 'Password must be at least 6 characters', 400);
    }

    if (password !== confirm_password) {
      return fail(res, 'Passwords do not match', 400);
    }

    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return fail(res, 'Email already registered', 409);
    }

    const currentYear = new Date().getFullYear();
    const yearName = `${currentYear}/${currentYear + 1}`;

    const school = await School.create({
      name: school_name.trim(),
      adminName: full_name.trim(),
      adminEmail: email.toLowerCase().trim(),
      email: email.toLowerCase().trim(),
      status: 'active',
      statusSince: new Date()
    });

    const passwordHash = await hashPassword(password);

    const user = await User.create({
      schoolId: school._id,
      fullName: full_name.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      role: 'school_admin',
      status: 'pending'
    });

    const secret = generateTotpSecret();
    const mfa = await Mfa.create({
      userId: user._id,
      secret,
      enabled: false,
      enrolled: false
    });

    const academicYear = await AcademicYear.create({
      schoolId: school._id,
      name: yearName,
      status: 'active'
    });

    const now = new Date();
    const termStart1 = new Date(currentYear, 0, 1);
    const termEnd1 = new Date(currentYear, 3, 30);
    const termStart2 = new Date(currentYear, 4, 1);
    const termEnd2 = new Date(currentYear, 7, 31);
    const termStart3 = new Date(currentYear, 8, 1);
    const termEnd3 = new Date(currentYear, 11, 31);

    await Term.insertMany([
      { academicYearId: academicYear._id, name: 'Term 1', startDate: termStart1, endDate: termEnd1 },
      { academicYearId: academicYear._id, name: 'Term 2', startDate: termStart2, endDate: termEnd2 },
      { academicYearId: academicYear._id, name: 'Term 3', startDate: termStart3, endDate: termEnd3 }
    ]);

    const classNames = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
    const classDocs = classNames.map(name => ({
      schoolId: school._id,
      academicYearId: academicYear._id,
      name,
      unitFee: 0
    }));
    await Class.insertMany(classDocs);

    const otpauthUri = `otpauth://totp/FeesLedger:${encodeURIComponent(user.email)}?secret=${secret}&issuer=FeesLedger&digits=6&period=30`;

    req.session.pending_mfa_user_id = user._id.toString();
    req.session.pending_mfa_email = user.email;

    await logActivity({
      action: 'register',
      description: `New school registered: ${school.name}`,
      userId: user._id,
      schoolId: school._id,
      userEmail: user.email,
      entityType: 'school',
      ipAddress: req.ip || req.connection.remoteAddress || ''
    });

    return success(res, {
      userId: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      status: user.status,
      schoolId: school._id,
      schoolName: school.name,
      mfa_secret: secret,
      mfa_uri: otpauthUri
    }, 201);
  } catch (error) {
    return fail(res, 'Registration failed', 500, { error: error.message });
  }
});

module.exports = router;
