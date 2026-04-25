# AI Task Processing Platform — Architecture Document

**Version:** 1.0  
**Author:** [Your Name]  
**Stack:** MERN + Python Worker + Redis + Docker + Kubernetes + Argo CD

---

## 1. System Overview

The AI Task Processing Platform is a cloud-native, microservices-based application that allows users to create and run text-processing tasks asynchronously. The system decouples task creation (synchronous HTTP) from task execution (asynchronous background processing) using a Redis-backed job queue.

```
User Browser
     │  HTTPS
     ▼
┌──────────┐     REST API      ┌──────────────┐    Bull Queue    ┌──────────────┐
│ React    │ ────────────────► │ Node.js      │ ──────────────► │ Python       │
│ Frontend │                  │ Express API   │    (Redis)       │ Worker(s)    │
└──────────┘                  └──────────────┘                  └──────────────┘
                                     │                                  │
                               MongoDB Write                     MongoDB Write
                               (task created)                  (status/result)
                                     │                                  │
                                     ▼                                  ▼
                              ┌─────────────────────────────────────────────┐
                              │              MongoDB Database               │
                              │  Collections: users, tasks                  │
                              └─────────────────────────────────────────────┘
```

### Service Breakdown

| Service      | Technology          | Role                                      |
|--------------|---------------------|-------------------------------------------|
| Frontend     | React 18 + Nginx    | User interface, task management dashboard |
| Backend API  | Node.js + Express   | REST API, auth, queue producer            |
| Worker       | Python 3.12         | Queue consumer, task processor            |
| Database     | MongoDB 7           | Persistent storage for users & tasks      |
| Queue        | Redis 7 + Bull.js   | Async job queue with retries              |

---

## 2. Worker Scaling Strategy

### Current Architecture
Workers are stateless consumers that read from a Redis queue. This enables horizontal scaling with zero coordination between workers — each worker independently picks the next available job using an atomic `BRPOPLPUSH` operation (no two workers process the same job).

### Scaling Mechanism
```
Redis Queue (bull:task-processing:wait)
          │
    ┌─────┴──────────────────────┐
    │     BRPOPLPUSH (atomic)    │
    ├─────────┬─────────┬────────┤
    ▼         ▼         ▼        ▼
 Worker-1  Worker-2  Worker-3  Worker-N
    │         │         │        │
    └─────────┴─────────┴────────┘
              │
        MongoDB writes
```

### Kubernetes HPA (Horizontal Pod Autoscaler)
The worker Deployment is configured with an HPA that scales between **2–10 replicas** based on CPU utilization (70% threshold). When task volume increases, CPU rises on workers → HPA adds pods → more jobs processed in parallel.

```yaml
minReplicas: 2
maxReplicas: 10
targetCPUUtilizationPercentage: 70
```

### For 100k Tasks/Day
- 100,000 tasks/day = ~1.16 tasks/second average
- Peak may be 5–10x = 6–12 tasks/second
- Each task completes in < 500ms → 1 worker handles ~120 tasks/minute
- **4–6 worker replicas** comfortably handle peak load
- HPA auto-adjusts, so no manual intervention needed

---

## 3. Handling 100,000 Tasks Per Day

### Database Strategy

**Indexes (already applied in schema):**
```javascript
taskSchema.index({ userId: 1, createdAt: -1 });  // User's task list query
taskSchema.index({ status: 1, createdAt: -1 });   // Filter by status
taskSchema.index({ jobId: 1 });                    // Worker lookup
```

These three indexes make the most common queries O(log n) instead of O(n), supporting 100k+ documents without degradation.

**Write Volume Estimation:**
- Task created: 1 write
- Task queued (jobId update): 1 write  
- Worker running (status + log): 2 writes
- Worker complete (status + result + log): 2 writes
- **Total: ~6 writes per task × 100k = 600k writes/day = ~7 writes/second**

MongoDB handles thousands of writes/second — this load is well within capacity.

**Optimization for higher scale:**
- Enable MongoDB connection pooling (`maxPoolSize: 10` already configured)
- Use `$push` with `$slice` to cap log arrays (prevent unbounded document growth)
- Archive completed tasks older than 30 days to a separate collection

### Redis Queue Capacity
Redis stores only job IDs in the wait list (not full payloads). At 100k tasks/day, the queue holds at most a few thousand items during peak — trivial for Redis.

---

## 4. Database Indexing Strategy

### Indexes and Their Purpose

**`{ userId: 1, createdAt: -1 }` — Compound Index**
- Used by: `GET /api/tasks` (user's dashboard)
- Why: Every user query filters by `userId` then sorts by `createdAt` descending
- Without it: Full collection scan on every dashboard load

**`{ status: 1, createdAt: -1 }` — Status Filter Index**
- Used by: Admin monitoring, status-filtered queries
- Why: Enables fast "show all pending tasks" queries as volume grows

**`{ jobId: 1 }` — Job Lookup Index**
- Used by: Worker updating task status by Bull job ID
- Why: Workers frequently look up tasks by jobId after processing

**`{ email: 1 }` on Users — Unique Index**
- Used by: Login, registration uniqueness check
- Ensures email uniqueness at DB level (not just app level)

---

## 5. Handling Redis Failure

Redis failure is the most critical single point of failure since it holds the job queue. Here's the multi-layered strategy:

### Layer 1: Automatic Reconnection
Both the Node.js backend (ioredis) and Python worker have retry logic:
```javascript
// ioredis retryStrategy in queue.js
retryStrategy: (times) => Math.min(times * 50, 2000)
```
```python
# Python worker reconnects in a loop with 5s backoff
def connect_redis():
    while True:
        try: ...
        except: time.sleep(5)
```

### Layer 2: Bull Job Persistence
Bull.js stores job data in Redis hashes (not just in memory). If Redis restarts with persistence enabled (`appendonly yes`), all pending jobs survive the restart.

### Layer 3: Graceful Degradation
- If Redis is down, `POST /api/tasks` still creates the task in MongoDB with status `pending`
- The task is NOT lost — it stays in MongoDB
- Once Redis recovers, users can click "Run" again to re-queue
- Workers detect Redis reconnection and resume processing automatically

### Layer 4: Monitoring
In production, configure alerting on:
- Redis memory usage > 80%
- Queue length > 1000 (backlog building up)
- Worker pod restarts

### For Production: Redis Sentinel / Cluster
For zero-downtime Redis failure, deploy **Redis Sentinel** (3 nodes: 1 primary + 2 replicas with automatic failover). This is the recommended upgrade path after initial deployment.

---

## 6. Staging and Production Environments

### Environment Strategy using Kustomize + Argo CD

```
infra-repo/
└── k8s/
    ├── base/               ← Shared manifests (deployments, services)
    └── overlays/
        ├── staging/        ← Staging-specific overrides
        └── production/     ← Production-specific overrides
```

### Staging Environment
- Namespace: `ai-task-platform-staging`
- Replicas: 1 per service (cost-efficient)
- Domain: `staging.ai-task-platform.yourdomain.com`
- Auto-deploy on every push to `develop` branch
- Smaller resource limits (CPU/memory)

### Production Environment  
- Namespace: `ai-task-platform`
- Replicas: 2–3 per service + HPA for workers
- Domain: `ai-task-platform.yourdomain.com`
- Auto-deploy only on push to `main` branch
- Full resource limits + liveness/readiness probes

### Promotion Flow
```
Developer pushes code
       │
       ▼
GitHub Actions (lint → build → push images)
       │
       ▼ updates image tag
Infra Repo (develop branch)
       │
       ▼ Argo CD auto-sync
Staging Cluster
       │
  Manual approval / merge to main
       ▼
Infra Repo (main branch)
       │
       ▼ Argo CD auto-sync
Production Cluster
```

---

## 7. Security Architecture

| Layer           | Measure                                              |
|-----------------|------------------------------------------------------|
| Authentication  | JWT tokens (7-day expiry, signed with HS256)         |
| Passwords       | bcrypt with salt rounds = 12                        |
| Transport       | HTTPS via Ingress + cert-manager (Let's Encrypt)    |
| API Protection  | Helmet.js (15 security headers), CORS whitelist     |
| Rate Limiting   | 100 req/15min global, 20 req/15min on auth routes   |
| Secrets         | Kubernetes Secrets (never in git), .env.example only|
| Containers      | Non-root users in all Dockerfiles                   |
| DB Access       | Least-privilege app user (readWrite only)           |

---

## 8. Deployment Instructions Summary

### Local Development
```bash
cp .env.example .env          # Fill in your values
docker-compose up --build     # Start all services
# App runs at http://localhost:3000
```

### Kubernetes (k3s)
```bash
# Install k3s
curl -sfL https://get.k3s.io | sh -

# Install Argo CD
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Apply Argo CD Application
kubectl apply -f k8s/argocd-app.yaml -n argocd

# Argo CD will auto-deploy everything from infra repo
```

---

*This architecture supports scaling from 100 users to 100,000+ tasks/day with minimal changes — primarily increasing worker replicas and enabling Redis Sentinel for HA.*
