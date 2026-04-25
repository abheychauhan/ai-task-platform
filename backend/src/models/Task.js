const mongoose = require('mongoose');

const OPERATIONS = ['uppercase', 'lowercase', 'reverse', 'word_count'];
const STATUSES = ['pending', 'running', 'success', 'failed'];

const taskSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters'],
  },
  inputText: {
    type: String,
    required: [true, 'Input text is required'],
    maxlength: [10000, 'Input text cannot exceed 10000 characters'],
  },
  operation: {
    type: String,
    required: [true, 'Operation is required'],
    enum: OPERATIONS,
  },
  status: {
    type: String,
    enum: STATUSES,
    default: 'pending',
  },
  result: {
    type: String,
    default: null,
  },
  logs: [{
    timestamp: { type: Date, default: Date.now },
    message: String,
    level: { type: String, enum: ['info', 'error', 'warn'], default: 'info' },
  }],
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  jobId: {
    type: String,
    default: null,
  },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  errorMessage: { type: String, default: null },
}, {
  timestamps: true,
});

taskSchema.index({ userId: 1, createdAt: -1 });
taskSchema.index({ status: 1, createdAt: -1 });
taskSchema.index({ jobId: 1 });

module.exports = mongoose.model('Task', taskSchema);
module.exports.OPERATIONS = OPERATIONS;
