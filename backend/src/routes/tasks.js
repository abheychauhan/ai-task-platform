const express = require('express');
const Task = require('../models/Task');
const { protect } = require('../middleware/auth');
const { taskQueue } = require('../config/queue');
const logger = require('../config/logger');

const router = express.Router();

router.use(protect);

//Get all tasks for logged-in user
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;

    const query = { userId: req.user._id };
    if (status) query.status = status;

    const tasks = await Task.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('-logs'); // Exclude logs from list view for performance

    const total = await Task.countDocuments(query);

    res.json({
      success: true,
      tasks,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    logger.error(`Get tasks error: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

//Get single task with logs
router.get('/:id', async (req, res) => {
  try {
    const task = await Task.findOne({ _id: req.params.id, userId: req.user._id });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json({ success: true, task });
  } catch (error) {
    logger.error(`Get task error: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

//Create new task
router.post('/', async (req, res) => {
  try {
    const { title, inputText, operation } = req.body;

    if (!title || !inputText || !operation) {
      return res.status(400).json({ error: 'Title, inputText, and operation are required' });
    }

    const validOps = ['uppercase', 'lowercase', 'reverse', 'word_count'];
    if (!validOps.includes(operation)) {
      return res.status(400).json({ error: `Operation must be one of: ${validOps.join(', ')}` });
    }

    const task = await Task.create({
      title,
      inputText,
      operation,
      userId: req.user._id,
      status: 'pending',
      logs: [{ message: 'Task created, waiting in queue', level: 'info' }],
    });

    logger.info(`Task created: ${task._id} by user ${req.user._id}`);

    res.status(201).json({ success: true, task });
  } catch (error) {
    logger.error(`Create task error: ${error.message}`);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

//Push task to queue
router.post('/:id/run', async (req, res) => {
  try {
    const task = await Task.findOne({ _id: req.params.id, userId: req.user._id });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (task.status === 'running') {
      return res.status(400).json({ error: 'Task is already running' });
    }

    // Push to Redis queue
    const job = await taskQueue.add(
      { taskId: task._id.toString(), operation: task.operation, inputText: task.inputText },
      { priority: 1 }
    );

    // Update task status
    task.status = 'pending';
    task.jobId = job.id.toString();
    task.result = null;
    task.errorMessage = null;
    task.startedAt = null;
    task.completedAt = null;
    task.logs.push({ message: `Job queued with ID: ${job.id}`, level: 'info' });
    await task.save();

    logger.info(`Task ${task._id} queued as job ${job.id}`);

    res.json({ success: true, task, jobId: job.id });
  } catch (error) {
    logger.error(`Run task error: ${error.message}`);
    res.status(500).json({ error: 'Failed to queue task' });
  }
});

//Delete task
router.delete('/:id', async (req, res) => {
  try {
    const task = await Task.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json({ success: true, message: 'Task deleted' });
  } catch (error) {
    logger.error(`Delete task error: ${error.message}`);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

module.exports = router;
