const mongoose = require('mongoose');

const trashSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    entityType: { type: String, default: '' },
    entityId: { type: String, default: '' },
    name: { type: String, default: '' },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    deletedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

trashSchema.index({ schoolId: 1 });
trashSchema.index({ entityType: 1, entityId: 1 });
trashSchema.index({ expiresAt: 1 });

module.exports = mongoose.model('Trash', trashSchema);
