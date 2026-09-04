const mongoose = require('mongoose');

const savedFileSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    displayName: { type: String, default: '' },
    originalName: { type: String, default: '' },
    filePath: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    fileSize: { type: Number, default: 0 },
    category: {
      type: String,
      enum: ['pdf', 'doc', 'xls', 'image', 'other'],
      default: 'other',
    },
    academicYear: { type: String, default: '' },
    term: { type: String, default: '' },
    day: { type: String, default: '' },
  },
  { timestamps: true }
);

savedFileSchema.index({ userId: 1 });
savedFileSchema.index({ schoolId: 1 });

module.exports = mongoose.model('SavedFile', savedFileSchema);
