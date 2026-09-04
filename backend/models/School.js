const mongoose = require('mongoose');

const schoolSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    adminName: { type: String, default: '' },
    adminEmail: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    logo: { type: String, default: '' },
    status: {
      type: String,
      enum: ['active', 'paid', 'unpaid', 'suspended', 'pending_delete', 'deleted'],
      default: 'active',
    },
    statusSince: { type: Date, default: null },
    paidUntil: { type: Date, default: null },
    deleteRequestedAt: { type: Date, default: null },
    deleteConfirmedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('School', schoolSchema);
