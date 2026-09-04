const mongoose = require('mongoose');

const passwordResetSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    used: { type: Boolean, default: false },
  },
  { timestamps: true }
);

passwordResetSchema.index({ userId: 1 });
passwordResetSchema.index({ tokenHash: 1 });
passwordResetSchema.index({ expiresAt: 1 });

module.exports = mongoose.model('PasswordReset', passwordResetSchema);
