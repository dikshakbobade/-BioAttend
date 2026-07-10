# BioAttend — Biometric Attendance System

A production-ready dual-biometric (face + fingerprint) attendance system for office environments supporting 50-60 employees.

## 🏗️ Architecture Overview
┌─────────────────────────────────────────────────────────────────┐
│                         OFFICE NETWORK                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │ Face Agent   │    │ Fingerprint  │    │  Admin Dashboard │   │
│  │ (Entry Gate) │    │    Agent     │    │    (React SPA)   │   │
│  │              │    │ (Exit Gate)  │    │                  │   │
│  └──────┬───────┘    └──────┬───────┘    └────────┬─────────┘   │
│         │                   │                     │             │
│         │ HTTPS/API Key     │ HTTPS/API Key       │ HTTPS/JWT   │
│         │                   │                     │             │
│         └───────────────────┼─────────────────────┘             │
│                             │                                   │
│                    ┌────────▼────────┐                          │
│                    │  FastAPI Server │                          │
│                    │   (Port 8000)   │                          │
│                    └────────┬────────┘                          │
│                             │                                   │
│                    ┌────────▼────────┐                          │
│                    │     MySQL 8     │                          │
│                    │   (Port 3306)   │                          │
│                    └─────────────────┘                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

## 📸 Screenshots

### Login
![Login](docs/screenshots/login.png)

### Dashboard
![Dashboard](docs/screenshots/dashboard.png)

### Live Dashboard
![Dashboard Live](docs/screenshots/dashboard-live.png)

### Employees
![Employees](docs/screenshots/employees.png)

### Attendance Kiosk — Check In
![Kiosk Check-in](docs/screenshots/kiosk-checkin.png)

### Attendance Kiosk — Check Out
![Kiosk Check-out](docs/screenshots/kiosk-checkout.png)

## 🎥 Demo Video

[▶️ Watch Demo Video](docs/Video/Demo.mp4)

> Note: GitHub doesn't play `.mp4` inline via markdown — this link will download/open the file. For an inline-playable video, drag-drop the mp4 into a new GitHub Issue comment box (don't submit the issue), copy the generated `https://github.com/user-attachments/...` link, and swap it in above — it'll render as an inline player.

## 📁 Project Structure
biometric-attendance-system/
├── backend/                    # FastAPI Backend Server
│   ├── app/
│   │   ├── api/v1/            # API endpoints
│   │   ├── core/              # Config, security utilities
│   │   ├── db/                # Database connection
│   │   ├── models/            # SQLAlchemy models
│   │   ├── schemas/           # Pydantic schemas
│   │   ├── services/          # Business logic
│   │   └── main.py            # FastAPI application
│   ├── migrations/            # Alembic migrations
│   ├── requirements.txt
│   └── alembic.ini
├── agents/                     # Device Agents
│   ├── face_agent/            # Face recognition agent
│   │   ├── agent.py
│   │   └── requirements.txt
│   └── fingerprint_agent/     # Fingerprint scanner agent
│       ├── agent.py
│       └── requirements.txt
├── frontend/                   # React Admin Dashboard
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   └── store/
│   ├── package.json
│   └── vite.config.js
├── scripts/                    # Utility scripts
├── docs/                       # Screenshots and demo video
├── docker-compose.yml
└── README.md

## 🚀 Quick Start

### Prerequisites

- Python 3.10+ (⚠️ some dependencies like `insightface`, `onnxruntime`, and `mediapipe` may lack pre-built wheels for the very latest Python versions — 3.10 or 3.11 is recommended)
- MySQL 8+ (via Docker, recommended — see Docker Deployment below)
- Node.js 18+ (for frontend)
- Camera (for face agent)
- USB Fingerprint Scanner (Mantra MFS100/SecuGen/ZKTeco)

### 1. Database Setup

The recommended way to run MySQL locally is via Docker Compose, which handles this for you:

```bash
docker-compose up -d db
```

This starts a MySQL 8 container, mapping host port `3307` → container port `3306` (adjust in `docker-compose.yml` if you need a different host port).

If you prefer a manually installed MySQL instance instead of Docker:

```sql
CREATE DATABASE bioattend_db;
CREATE USER 'bioattend_user'@'localhost' IDENTIFIED BY 'your_secure_password';
GRANT ALL PRIVILEGES ON bioattend_db.* TO 'bioattend_user'@'localhost';
FLUSH PRIVILEGES;
```

### 2. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Linux/Mac
# or: venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL to your MySQL connection string, e.g.:
# DATABASE_URL=mysql+aiomysql://bioattend_user:your_password@localhost:3307/bioattend_db

# Run migrations
alembic upgrade head

# Start the server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

> **Important:** The backend uses `aiomysql`/`PyMySQL` drivers (MySQL), not `asyncpg` (PostgreSQL). Make sure `backend/.env.example` and your `.env` both use the `mysql+aiomysql://` scheme — an older PostgreSQL-style URL may still be present in `backend/.env.example` from an earlier version and should be replaced or removed.

### 3. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

### 4. Agent Setup

#### Face Agent
```bash
cd agents/face_agent

# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
export BACKEND_URL="http://localhost:8000"
export DEVICE_ID="FACE-ENTRY-001"
export API_KEY="your_device_api_key"  # Get from admin dashboard
export CAMERA_INDEX=0

# Run agent
python agent.py
```

#### Fingerprint Agent
```bash
cd agents/fingerprint_agent

# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Install vendor SDK (example for Mantra MFS100)
# Follow vendor-specific instructions

# Configure environment
export BACKEND_URL="http://localhost:8000"
export DEVICE_ID="FP-EXIT-001"
export API_KEY="your_device_api_key"

# Run agent
python agent.py
```

## 🔧 Configuration

### Environment Variables (Backend)

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | MySQL async connection string (`mysql+aiomysql://user:pass@host:port/db`) | Required |
| `SECRET_KEY` | JWT signing key | Required |
| `ENCRYPTION_KEY` | Fernet key for biometric encryption | Required |
| `FACE_MATCH_THRESHOLD` / `FACE_SIMILARITY_THRESHOLD` | Face similarity threshold (0-1) | 0.60 |
| `FINGERPRINT_MATCH_THRESHOLD` | Fingerprint match score (0-100) | 70 |
| `LIVENESS_THRESHOLD` | Anti-spoofing threshold | 0.70 |
| `ATTENDANCE_COOLDOWN_MINUTES` / `COOLDOWN_MINUTES` | Min time between scans | 5 |
| `WORKDAY_START_HOUR` / `WORKING_HOURS_START` | Earliest check-in hour | 06:00 |
| `WORKDAY_END_HOUR` / `WORKING_HOURS_END` | Latest check-out hour | 22:00 |
| `CORS_ORIGINS` | Allowed frontend origins | `["http://localhost:3000"]` |
| `DEBUG` | Enables `/docs` and verbose SQL logging | `false` |

### Generate Encryption Key

```python
from cryptography.fernet import Fernet
print(Fernet.generate_key().decode())
```

## 📡 API Endpoints

### Authentication
- `POST /api/v1/admin/login` - Admin login (returns JWT)

### Employees
- `GET /api/v1/employees` - List all employees
- `POST /api/v1/employees` - Create employee
- `GET /api/v1/employees/{id}` - Get employee details
- `PUT /api/v1/employees/{id}` - Update employee
- `DELETE /api/v1/employees/{id}` - Delete employee
- `POST /api/v1/employees/{id}/biometric` - Register biometric template

### Biometric Verification (Device Auth)
- `POST /api/v1/biometric/face/verify` - Verify face embedding
- `POST /api/v1/biometric/fingerprint/verify` - Verify fingerprint template

### Attendance
- `GET /api/v1/attendance/today` - Today's attendance status
- `GET /api/v1/attendance/report` - Attendance report with date range
- `GET /api/v1/attendance/monthly/{employee_id}` - Monthly report

### Devices
- `GET /api/v1/devices` - List all devices
- `POST /api/v1/devices` - Register new device
- `PUT /api/v1/devices/{id}/activate` - Activate device
- `PUT /api/v1/devices/{id}/deactivate` - Deactivate device
- `POST /api/v1/devices/{id}/regenerate-key` - Regenerate API key

## 🔒 Security Features

1. **Biometric Template Encryption**: All templates encrypted with AES-256 (Fernet)
2. **API Key Authentication**: Devices authenticate via SHA-256 hashed API keys
3. **JWT Authentication**: Admin dashboard uses JWT tokens
4. **Liveness Detection**: Multi-factor anti-spoofing (blink, texture, motion, skin)
5. **Audit Logging**: All operations logged with IP, payload, and timestamps
6. **No Raw Biometrics**: Only encrypted templates stored, never raw images

## 🗄️ Database Schema
┌─────────────────┐     ┌─────────────────────┐
│    employees    │     │  biometric_templates│
├─────────────────┤     ├─────────────────────┤
│ id (PK)         │◄────│ employee_id (FK)    │
│ employee_code   │     │ biometric_type      │
│ full_name       │     │ template_data       │
│ email           │     │ quality_score       │
│ department      │     │ is_active           │
│ designation     │     │ created_at          │
│ status          │     └─────────────────────┘
│ created_at      │
└─────────────────┘     ┌─────────────────────┐
│   attendance_logs   │
├─────────────────────┤
┌───────►│ employee_id (FK)    │
│        │ date                │
│        │ check_in_time       │
│        │ check_out_time      │
│        │ check_in_method     │
│        │ check_out_method    │
│        │ confidence_scores   │
│        └─────────────────────┘
┌─────────────────┐     ┌─────────────────────┐
│    devices      │     │    admin_users      │
├─────────────────┤     ├─────────────────────┤
│ id (PK)         │     │ id (PK)             │
│ device_id       │     │ username            │
│ device_type     │     │ email               │
│ api_key_hash    │     │ password_hash       │
│ location        │     │ role                │
│ is_active       │     │ is_active           │
│ last_seen       │     │ last_login          │
└─────────────────┘     └─────────────────────┘
┌─────────────────────┐
│     audit_logs      │
├─────────────────────┤
│ id (PK)             │
│ event_type          │
│ employee_id         │
│ device_id           │
│ ip_address          │
│ request_payload     │
│ response_status     │
│ confidence_score    │
│ created_at          │
└─────────────────────┘

## 🐳 Docker Deployment

```bash
# Build and start all services (MySQL, backend, frontend)
docker-compose up -d

# Start only the database
docker-compose up -d db

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Stop and remove volumes (⚠️ deletes all data)
docker-compose down -v
```

## 📊 Admin Dashboard Features

1. **Dashboard**: Real-time attendance statistics
2. **Employee Management**: Add/edit/delete employees
3. **Biometric Registration**: Capture and register face/fingerprint
4. **Attendance Reports**: Daily, weekly, monthly reports
5. **Device Management**: Register and monitor devices
6. **Audit Logs**: Security event viewer

## 🔌 Hardware Requirements

### Face Recognition Station
- Camera: 1080p USB camera with IR support recommended
- Minimum: 720p webcam
- Lighting: Adequate ambient lighting

### Fingerprint Station
- Supported Scanners:
  - Mantra MFS100 (recommended)
  - SecuGen Hamster Pro
  - ZKTeco ZK4500
- USB 2.0 connection

### Server
- CPU: 4 cores minimum
- RAM: 8GB minimum
- Storage: 50GB SSD
- Network: Gigabit LAN

## 🧪 Testing

```bash
# Backend tests
cd backend
pytest tests/ -v

# Frontend tests
cd frontend
npm test
```

## 📝 Default Credentials

After first run, an admin user is created:
- **Username**: `admin`
- **Password**: `admin123`

⚠️ **Change this immediately in production!**

## 🆘 Troubleshooting

### Face Agent Issues
1. **Camera not detected**: Check `CAMERA_INDEX` environment variable
2. **Low match scores**: Ensure adequate lighting, clean camera lens
3. **Liveness fails**: Ensure user blinks naturally, avoid printed photos

### Fingerprint Agent Issues
1. **Scanner not found**: Install vendor drivers, check USB connection
2. **Poor quality scans**: Clean scanner surface, dry fingers
3. **Match failures**: Re-enroll employee with better quality template

### Backend Issues
1. **Database connection**: Verify the MySQL container/service is running (`docker-compose ps`), check `DATABASE_URL` credentials and port (default Docker mapping is host `3307` → container `3306`)
2. **Template decryption fails**: Ensure `ENCRYPTION_KEY` matches enrollment key
3. **JWT errors**: Check `SECRET_KEY` configuration
4. **`Fatal error in launcher` on pip/uvicorn**: Usually means the virtual environment was created in a different folder path and later moved/copied. Delete `.venv` and recreate it in the current project location: `python -m venv .venv`, then reinstall dependencies.

## 📄 License

MIT License - See LICENSE file for details.

## 👥 Support

For issues and feature requests, please create an issue in the repository.