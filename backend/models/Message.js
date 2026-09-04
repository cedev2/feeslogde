const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    type: { type: String, default: '' },
    subject: { type: String, default: '' },
    body: { type: String, default: '' },
    recipientCount: { type: Number, default: 0 },
    recipients: { type: [mongoose.Schema.Types.Mixed], default: [] },
    status: {
      type: String,
      enum: ['draft', 'queued', 'sent', 'failed', 'opened'],
      default: 'draft',
    },
  },
  { timestamps: true }
);

messageSchema.index({ schoolId: 1 });

module.exports = mongoose.model('Message', messageSchema);
