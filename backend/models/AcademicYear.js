const mongoose = require('mongoose');

const academicYearSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    name: { type: String, required: true },
    status: {
      type: String,
      enum: ['active', 'closed'],
      default: 'active',
    },
  },
  { timestamps: true }
);

academicYearSchema.index({ schoolId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('AcademicYear', academicYearSchema);
