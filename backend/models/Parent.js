const mongoose = require('mongoose');

const parentSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    name: { type: String, required: true },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    address: { type: String, default: '' },
  },
  { timestamps: true }
);

parentSchema.index({ schoolId: 1 });
parentSchema.index({ email: 1 });

module.exports = mongoose.model('Parent', parentSchema);
