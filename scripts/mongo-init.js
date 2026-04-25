// MongoDB initialization script
// Creates app user with limited permissions (least privilege)
db = db.getSiblingDB('ai-task-platform');

db.createUser({
  user: 'appuser',
  pwd: process.env.MONGO_APP_PASSWORD || 'apppassword',
  roles: [{ role: 'readWrite', db: 'ai-task-platform' }],
});

// Create indexes upfront
db.tasks.createIndex({ userId: 1, createdAt: -1 });
db.tasks.createIndex({ status: 1, createdAt: -1 });
db.tasks.createIndex({ jobId: 1 });
db.users.createIndex({ email: 1 }, { unique: true });

print('MongoDB initialized successfully');
