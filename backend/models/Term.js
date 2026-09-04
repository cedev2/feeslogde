const mongoose = require('mongoose');

const termSchema = new mongoose.Schema(
  {
    academicYearId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    name: { type: String, required: true },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
  },
  { timestamps: true }
);

termSchema.index({ academicYearId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Term', termSchema);
