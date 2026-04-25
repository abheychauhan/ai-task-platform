import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { getTask, runTask } from '../api';

const StatusBadge = ({ status }) => (
  <span className={`badge badge-${status}`}>{status}</span>
);

const formatDate = (d) => d ? new Date(d).toLocaleString() : '—';

export default function TaskDetail() {
  const { id } = useParams();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const fetchTask = useCallback(async () => {
    try {
      const { data } = await getTask(id);
      setTask(data.task);
    } catch {
      toast.error('Failed to load task');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchTask();
    const interval = setInterval(() => {
      fetchTask();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchTask]);

  const handleRun = async () => {
    setRunning(true);
    try {
      await runTask(id);
      toast.success('Task queued!');
      fetchTask();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to run task');
    } finally {
      setRunning(false);
    }
  };

  if (loading) return (
    <div className="loading-screen"><div className="spinner" /></div>
  );

  if (!task) return (
    <div className="container" style={{ paddingTop: '3rem' }}>
      <p>Task not found. <Link to="/dashboard">Go back</Link></p>
    </div>
  );

  return (
    <>
      <nav className="navbar">
        <span className="navbar-brand">⚡ AI Task Platform</span>
        <Link to="/dashboard" className="btn btn-secondary btn-sm">← Back</Link>
      </nav>

      <div className="container">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.4rem' }}>{task.title}</h1>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusBadge status={task.status} />
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                Operation: <strong style={{ color: 'var(--text-primary)' }}>{task.operation.replace('_', ' ')}</strong>
              </span>
            </div>
          </div>
          {(task.status === 'pending' || task.status === 'failed') && (
            <button className="btn btn-success" disabled={running} onClick={handleRun}>
              {running ? 'Queuing...' : '▶ Run Task'}
            </button>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
          {[
            { label: 'Created',   value: formatDate(task.createdAt) },
            { label: 'Started',   value: formatDate(task.startedAt) },
            { label: 'Completed', value: formatDate(task.completedAt) },
            { label: 'Job ID',    value: task.jobId || '—' },
          ].map(({ label, value }) => (
            <div key={label} className="card" style={{ padding: '1rem' }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', marginBottom: '0.3rem' }}>{label}</div>
              <div style={{ fontSize: '0.88rem', fontWeight: 500 }}>{value}</div>
            </div>
          ))}
        </div>

        <div className="card" style={{ marginBottom: '1.25rem' }}>
          <h3 style={{ marginBottom: '0.75rem', fontSize: '0.95rem', color: 'var(--text-secondary)' }}>INPUT TEXT</h3>
          <div style={{ background: 'var(--bg-secondary)', borderRadius: '8px', padding: '1rem', fontFamily: 'monospace', fontSize: '0.85rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {task.inputText}
          </div>
        </div>

        {task.result && (
          <div className="card" style={{ marginBottom: '1.25rem' }}>
            <h3 style={{ marginBottom: '0.75rem', fontSize: '0.95rem', color: 'var(--text-secondary)' }}>RESULT ✅</h3>
            <div className="result-box">
              {task.operation === 'word_count'
                ? JSON.stringify(JSON.parse(task.result), null, 2)
                : task.result}
            </div>
          </div>
        )}

        {task.errorMessage && (
          <div className="card" style={{ marginBottom: '1.25rem', borderColor: 'var(--error)' }}>
            <h3 style={{ marginBottom: '0.5rem', fontSize: '0.95rem', color: 'var(--error)' }}>ERROR ❌</h3>
            <p style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: '#fca5a5' }}>{task.errorMessage}</p>
          </div>
        )}

        <div className="card">
          <h3 style={{ marginBottom: '0.75rem', fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
            TASK LOGS ({task.logs?.length || 0} entries)
          </h3>
          <div className="logs-container">
            {task.logs?.length === 0 ? (
              <span style={{ color: '#4b5563' }}>No logs yet</span>
            ) : (
              task.logs.map((log, i) => (
                <div key={i} className="log-entry">
                  <span className="log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  <span className={`log-${log.level}`}>[{log.level.toUpperCase()}]</span>
                  <span>{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}