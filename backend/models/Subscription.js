const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    plan: { type: String, default: 'standard' },
    status: {
      type: String,
      enum: ['active', 'expired', 'cancelled'],
      default: 'active',
    },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    amount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

subscriptionSchema.index({ schoolId: 1 });
subscriptionSchema.index({ status: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
