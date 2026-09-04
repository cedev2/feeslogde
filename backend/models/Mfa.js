const mongoose = require('mongoose');

const mfaSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    secret: { type: String, default: '' },
    enabled: { type: Boolean, default: false },
    enrolled: { type: Boolean, default: false },
    enrolledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Mfa', mfaSchema);
