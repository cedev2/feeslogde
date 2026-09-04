const mongoose = require('mongoose');

const backupCodeSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    codeHash: { type: String, required: true },
    used: { type: Boolean, default: false },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

backupCodeSchema.index({ userId: 1 });

module.exports = mongoose.model('BackupCode', backupCodeSchema);
