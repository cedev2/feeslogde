const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    userEmail: { type: String, default: '' },
    action: { type: String, default: '' },
    description: { type: String, default: '' },
    entityType: { type: String, default: '' },
    entityId: { type: Number, default: 0 },
    studentName: { type: String, default: '' },
    studentId: { type: String, default: '' },
    className: { type: String, default: '' },
    academicYear: { type: String, default: '' },
    term: { type: String, default: '' },
    ipAddress: { type: String, default: '' },
  },
  { timestamps: true }
);

activityLogSchema.index({ schoolId: 1 });
activityLogSchema.index({ action: 1 });
activityLogSchema.index({ createdAt: 1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
