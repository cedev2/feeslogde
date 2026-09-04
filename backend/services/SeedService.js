const User = require('../models/User');
const School = require('../models/School');
const Mfa = require('../models/Mfa');
const { hashPassword } = require('../helpers/security');

const seedSuperAdmin = async () => {
  try {
    const existing = await User.findOne({ role: 'super_admin' });
    if (existing) {
      console.log('Super admin already exists, skipping seed.');
      return existing;
    }

    const passwordHash = await hashPassword('SuperAdmin123!');

    const school = await School.create({
      name: 'FeesLedger System',
      adminName: 'Super Admin',
      adminEmail: 'admin@feesledger.com',
      email: 'admin@feesledger.com',
      status: 'active',
      statusSince: new Date()
    });

    const user = await User.create({
      schoolId: school._id,
      fullName: 'Super Admin',
      email: 'admin@feesledger.com',
      passwordHash,
      role: 'super_admin',
      status: 'active'
    });

    await Mfa.create({
      userId: user._id,
      secret: '',
      enabled: false,
      enrolled: false,
      enrolledAt: null
    });

    console.log('Super admin seeded: admin@feesledger.com / SuperAdmin123!');
    return user;
  } catch (error) {
    console.error('Seed super admin error:', error.message);
    throw error;
  }
};

module.exports = { seedSuperAdmin };
