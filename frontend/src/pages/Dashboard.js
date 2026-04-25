import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { getTasks, createTask, runTask, deleteTask } from '../api';
import { useAuth } from '../context/AuthContext';

const OPERATIONS = [
  { value: 'uppercase', label: '⬆ UPPERCASE' },
  { value: 'lowercase', label: '⬇ lowercase' },
  { value: 'reverse',   label: '↩ Reverse' },
  { value: 'word_count', label: '🔢 Word Count' },
];

const StatusBadge = ({ status }) => (
  <span className={`badge badge-${status}`}>{status}</span>
);

const formatDate = (d) => new Date(d).toLocaleString();

export default function Dashboard() {
  const { user, logoutUser } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [runningId, setRunningId] = useState(null);
  const [form, setForm] = useState({ title: '', inputText: '', operation: 'uppercase' });
  const [filterStatus, setFilterStatus] = useState('');

  const fetchTasks = useCallback(async () => {
    try {
      const params = filterStatus ? { status: filterStatus } : {};
      const { data } = await getTasks(params);
      setTasks(data.tasks);
    } catch {
      toast.error('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    fetchTasks();
    // Poll every 5s to refresh running tasks
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.inputText.trim()) {
      toast.error('Please fill in all fields');
      return;
    }
    setCreating(true);
    try {
      const { data } = await createTask(form);
      setTasks([data.task, ...tasks]);
      setShowModal(false);
      setForm({ title: '', inputText: '', operation: 'uppercase' });
      toast.success('Task created!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create task');
    } finally {
      setCreating(false);
    }
  };

  const handleRun = async (e, taskId) => {
    e.preventDefault();
    e.stopPropagation();
    setRunningId(taskId);
    try {
      await runTask(taskId);
      toast.success('Task queued for processing!');
      fetchTasks();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to run task');
    } finally {
      setRunningId(null);
    }
  };

  const handleDelete = async (e, taskId) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm('Delete this task?')) return;
    try {
      await deleteTask(taskId);
      setTasks(tasks.filter((t) => t._id !== taskId));
      toast.success('Task deleted');
    } catch {
      toast.error('Failed to delete task');
    }
  };

  return (
    <>
      <nav className="navbar">
        <span className="navbar-brand">⚡ AI Task Platform</span>
        <div className="navbar-right">
          <span className="nav-user">👤 {user?.name}</span>
          <button className="btn btn-secondary btn-sm" onClick={logoutUser}>Logout</button>
        </div>
      </nav>

      <div className="container">
        <div className="tasks-header">
          <h1 className="tasks-title">My Tasks</h1>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <select
              className="form-control"
              style={{ width: 'auto', padding: '0.45rem 0.75rem' }}
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="running">Running</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              + New Task
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <div className="spinner" style={{ margin: '0 auto' }} />
          </div>
        ) : tasks.length === 0 ? (
          <div className="empty-state card">
            <h3>No tasks yet</h3>
            <p>Click "+ New Task" to create your first AI task</p>
          </div>
        ) : (
          tasks.map((task) => (
            <Link to={`/tasks/${task._id}`} key={task._id} className="task-card">
              <div className="task-card-left">
                <div className="task-title">{task.title}</div>
                <div className="task-meta">
                  {task.operation.replace('_', ' ')} · {formatDate(task.createdAt)}
                </div>
              </div>
              <div className="task-card-right">
                <StatusBadge status={task.status} />
                {(task.status === 'pending' || task.status === 'failed') && (
                  <button
                    className="btn btn-success btn-sm"
                    disabled={runningId === task._id}
                    onClick={(e) => handleRun(e, task._id)}
                  >
                    {runningId === task._id ? '...' : '▶ Run'}
                  </button>
                )}
                <button
                  className="btn btn-danger btn-sm"
                  onClick={(e) => handleDelete(e, task._id)}
                >
                  🗑
                </button>
              </div>
            </Link>
          ))
        )}
      </div>

      {/* Create Task Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Create New Task</h2>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label className="form-label">Task Title</label>
                <input
                  className="form-control"
                  placeholder="e.g. Process my text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Input Text</label>
                <textarea
                  className="form-control"
                  placeholder="Enter the text to process..."
                  value={form.inputText}
                  onChange={(e) => setForm({ ...form, inputText: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Operation</label>
                <div className="op-grid">
                  {OPERATIONS.map((op) => (
                    <button
                      type="button"
                      key={op.value}
                      className={`op-btn ${form.operation === op.value ? 'selected' : ''}`}
                      onClick={() => setForm({ ...form, operation: op.value })}
                    >
                      {op.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Creating...' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
