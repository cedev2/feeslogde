const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    termId: { type: mongoose.Schema.Types.ObjectId, ref: 'Term', default: null },
    amount: { type: Number, default: 0 },
    paymentMethod: {
      type: String,
      enum: ['cash', 'bank', 'mobile_money', 'card', 'other'],
      default: 'cash',
    },
    receiptNumber: { type: String, unique: true },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    paymentDate: { type: Date, default: Date.now },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

paymentSchema.index({ schoolId: 1 });
paymentSchema.index({ studentId: 1 });
paymentSchema.index({ receiptNumber: 1 });

module.exports = mongoose.model('Payment', paymentSchema);
