const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null },
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ['super_admin', 'school_admin', 'accountant'],
      default: 'school_admin',
    },
    status: {
      type: String,
      enum: ['active', 'pending', 'inactive', 'suspended'],
      default: 'active',
    },
  },
  { timestamps: true }
);

userSchema.index({ schoolId: 1 });
userSchema.index({ role: 1 });

module.exports = mongoose.model('User', userSchema);
