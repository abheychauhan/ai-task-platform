# ⚡ AI Task Processing Platform

A production-ready, cloud-native task processing platform built with MERN stack, Python worker, Docker, Kubernetes, and Argo CD.

![Architecture](https://img.shields.io/badge/Stack-MERN%20%2B%20Python-blue)
![Docker](https://img.shields.io/badge/Docker-Multi--stage-blue)
![Kubernetes](https://img.shields.io/badge/Kubernetes-k3s-blue)
![CI/CD](https://img.shields.io/badge/CI%2FCD-GitHub%20Actions-green)
![GitOps](https://img.shields.io/badge/GitOps-Argo%20CD-orange)

---

## 📋 Features

- 🔐 **JWT Authentication** — Secure register/login with bcrypt password hashing
- ✅ **Task Management** — Create, run, monitor, and delete AI tasks
- ⚙️ **4 Operations** — Uppercase, Lowercase, Reverse, Word Count
- 📊 **Real-time Status** — Live polling with status badges (pending/running/success/failed)
- 📝 **Task Logs** — Per-task execution logs with timestamps
- 🔁 **Async Processing** — Redis queue with Bull.js + Python worker
- 🐳 **Docker** — Multi-stage builds, non-root containers
- ☸️ **Kubernetes** — Full manifests with HPA, probes, resource limits
- 🔄 **GitOps** — Argo CD auto-sync from infra repo
- 🚀 **CI/CD** — GitHub Actions: lint → build → push → update infra

---

## 🏗 Architecture

```
React Frontend → Node.js API → Redis Queue → Python Worker → MongoDB
```

See [docs/architecture.md](docs/architecture.md) for full architecture details.

---

## 🚀 Quick Start (Local with Docker Compose)

### Prerequisites
- Docker & Docker Compose installed
- Node.js 20+ (for local dev without Docker)

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/ai-task-platform.git
cd ai-task-platform

# 2. Setup environment variables
cp .env.example .env
# Edit .env with your values (change passwords!)

# 3. Start all services
docker-compose up --build

# 4. Open the app
open http://localhost:3000
```

### Services running locally
| Service  | URL                          |
|----------|------------------------------|
| Frontend | http://localhost:3000        |
| Backend  | http://localhost:5000        |
| MongoDB  | mongodb://localhost:27017    |
| Redis    | redis://localhost:6379       |

---

## 🛠 Local Development (Without Docker)

### Backend
```bash
cd backend
cp .env.example .env   # fill in MongoDB/Redis URIs
npm install
npm run dev            # starts on port 5000 with nodemon
```

### Frontend
```bash
cd frontend
npm install
npm start              # starts on port 3000
```

### Worker
```bash
cd worker
pip install -r requirements.txt
# Set env vars (MONGODB_URI, REDIS_HOST, REDIS_PASSWORD)
python worker.py
```

---

## ☸️ Kubernetes Deployment (k3s)

### 1. Install k3s
```bash
curl -sfL https://get.k3s.io | sh -
# Verify
kubectl get nodes
```

### 2. Install Argo CD
```bash
kubectl create namespace argocd
kubectl apply -n argocd -f \
  https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Get initial admin password
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d

# Access UI (port-forward)
kubectl port-forward svc/argocd-server -n argocd 8080:443
# Open: https://localhost:8080
```

### 3. Create Secrets
```bash
# Update k8s/base/secrets.yaml with base64-encoded values
# echo -n "yourpassword" | base64

kubectl apply -f k8s/base/secrets.yaml
```

### 4. Deploy via Argo CD
```bash
# Update k8s/argocd-app.yaml with your infra repo URL
kubectl apply -f k8s/argocd-app.yaml -n argocd

# Argo CD auto-syncs and deploys everything!
```

### 5. Scale workers manually
```bash
kubectl scale deployment worker --replicas=5 -n ai-task-platform
```

---

## 🔄 CI/CD Setup

### GitHub Secrets Required
Go to your repo → Settings → Secrets and Variables → Actions:

| Secret              | Value                                    |
|---------------------|------------------------------------------|
| `DOCKER_USERNAME`   | Your Docker Hub username                 |
| `DOCKER_PASSWORD`   | Your Docker Hub password/token           |
| `INFRA_REPO_TOKEN`  | GitHub PAT with repo write access        |

### Pipeline Flow
```
Push to main
    │
    ├── Lint (backend + frontend + worker)
    │
    ├── Build Docker images (multi-stage)
    │
    ├── Push to Docker Hub (with SHA tag)
    │
    └── Update image tags in infra repo → Argo CD auto-deploys
```

---

## 📡 API Endpoints

### Auth
| Method | Endpoint            | Description        | Auth Required |
|--------|---------------------|--------------------|---------------|
| POST   | `/api/auth/register`| Register user      | No            |
| POST   | `/api/auth/login`   | Login user         | No            |
| GET    | `/api/auth/me`      | Get current user   | Yes           |

### Tasks
| Method | Endpoint              | Description        | Auth Required |
|--------|-----------------------|--------------------|---------------|
| GET    | `/api/tasks`          | List all tasks     | Yes           |
| POST   | `/api/tasks`          | Create task        | Yes           |
| GET    | `/api/tasks/:id`      | Get task + logs    | Yes           |
| POST   | `/api/tasks/:id/run`  | Queue task         | Yes           |
| DELETE | `/api/tasks/:id`      | Delete task        | Yes           |

### Health
| Method | Endpoint   | Description   |
|--------|------------|---------------|
| GET    | `/health`  | Health check  |

---

## 🔒 Security Features

- ✅ bcrypt password hashing (12 rounds)
- ✅ JWT authentication (7-day expiry)
- ✅ Helmet.js security headers
- ✅ Rate limiting (100 req/15min, 20 req/15min for auth)
- ✅ CORS whitelist
- ✅ Non-root Docker containers
- ✅ No secrets in repository
- ✅ MongoDB least-privilege user
- ✅ Input validation & sanitization

---

## 📁 Project Structure

```
ai-task-platform/
├── backend/                    # Node.js Express API
│   ├── src/
│   │   ├── config/            # DB, Redis, Logger config
│   │   ├── middleware/        # JWT auth middleware
│   │   ├── models/            # Mongoose schemas
│   │   └── routes/            # API routes
│   └── Dockerfile
├── frontend/                  # React application
│   ├── src/
│   │   ├── api/               # Axios API client
│   │   ├── context/           # Auth context
│   │   └── pages/             # Dashboard, Login, Register, TaskDetail
│   ├── nginx.conf
│   └── Dockerfile
├── worker/                    # Python background worker
│   ├── worker.py
│   ├── requirements.txt
│   └── Dockerfile
├── k8s/                       # Kubernetes manifests
│   ├── base/                  # Base manifests
│   ├── overlays/production/   # Production overrides
│   └── argocd-app.yaml        # Argo CD Application
├── .github/workflows/         # GitHub Actions CI/CD
├── docs/architecture.md       # Architecture document
└── docker-compose.yml         # Local development
```

---

## 🤝 Repositories

- **App Repository:** `github.com/YOUR_USERNAME/ai-task-platform`
- **Infra Repository:** `github.com/YOUR_USERNAME/ai-task-platform-infra`

The infra repo should contain: `k8s/` directory with all Kubernetes manifests.

---

## 📖 Architecture Document

See [docs/architecture.md](docs/architecture.md) for:
- Worker scaling strategy
- Handling 100k tasks/day
- Database indexing strategy
- Redis failure handling
- Staging vs Production environments
