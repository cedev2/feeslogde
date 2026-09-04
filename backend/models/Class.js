const mongoose = require('mongoose');

const classSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    academicYearId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    name: { type: String, required: true },
    unitFee: { type: Number, default: 0 },
  },
  { timestamps: true }
);

classSchema.index({ schoolId: 1 });
classSchema.index({ academicYearId: 1 });

module.exports = mongoose.model('Class', classSchema);
