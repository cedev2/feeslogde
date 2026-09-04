const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    academicYearId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Parent', default: null },
    studentId: { type: String, required: true },
    name: { type: String, required: true },
    gender: { type: String, enum: ['M', 'F'], default: null },
    photo: { type: String, default: '' },
    unitFee: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['active', 'inactive', 'graduated', 'deleted'],
      default: 'active',
    },
  },
  { timestamps: true }
);

studentSchema.index({ schoolId: 1, academicYearId: 1, studentId: 1 }, { unique: true });

module.exports = mongoose.model('Student', studentSchema);
