# Link Machine - VPS Deployment Guide

Step-by-step guide to deploy Link Machine on a fresh Linux VPS (Ubuntu 22.04/24.04).

---

## 1. Connect to your VPS

```bash
ssh root@YOUR_VPS_IP
```

---

## 2. Update system packages

```bash
apt update && apt upgrade -y
```

---

## 3. Install Docker

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Start Docker and enable on boot
systemctl start docker
systemctl enable docker

# Verify Docker is running
docker --version
```

---

## 4. Install Docker Compose

```bash
# Docker Compose is included with modern Docker, verify:
docker compose version

# If not available, install the plugin:
apt install docker-compose-plugin -y
```

---

## 5. Install Git

```bash
apt install git -y
```

---

## 6. Clone the repository

```bash
cd /opt
git clone https://github.com/cryptosaras/link-machine.git
cd link-machine
```

---

## 7. Create environment file

```bash
cp .env.example .env
```

Now edit the `.env` file with real values:

```bash
nano .env
```

Fill in these values:

```
DB_PASSWORD=your-strong-database-password-here
JWT_SECRET=paste-a-64-character-random-string-here
ENCRYPTION_KEY=paste-a-32-byte-base64-key-here
```

To generate secure random values, run these commands:

```bash
# Generate JWT_SECRET (64 char hex string)
openssl rand -hex 32

# Generate ENCRYPTION_KEY (32 byte base64 key)
openssl rand -base64 32
```

Copy the outputs into your `.env` file. Save and exit nano (Ctrl+X, then Y, then Enter).

---

## 8. Build and start the containers

```bash
docker compose up -d --build
```

This starts:
- PostgreSQL database (port 5432)
- Redis (port 6379)
- Backend API (port 8000)
- Frontend (port 3000)

Wait about 30 seconds for everything to start up. Check status:

```bash
docker compose ps
```

All services should show "running".

---

## 9. Create your admin user

```bash
docker compose exec backend python -c "
import asyncio, sys
sys.path.insert(0, '.')
from app.auth.service import hash_password
from app.database import async_session
from app.models.user import User

async def create():
    async with async_session() as session:
        user = User(username='admin', password_hash=hash_password('YOUR_PASSWORD_HERE'))
        session.add(user)
        await session.commit()
        print('Admin user created!')

asyncio.run(create())
"
```

Replace `YOUR_PASSWORD_HERE` with your desired password.

---

## 10. Open the app

Open your browser and go to:

```
http://YOUR_VPS_IP:3000
```

Login with the username `admin` and the password you set above.

---

## Useful Commands

### View logs
```bash
# All services
docker compose logs -f

# Just backend
docker compose logs -f backend

# Just frontend
docker compose logs -f frontend
```

### Stop everything
```bash
docker compose down
```

### Restart everything
```bash
docker compose restart
```

### Pull latest code and rebuild
```bash
cd /opt/link-machine
git pull
docker compose up -d --build
```

### Reset database (WARNING: deletes all data)
```bash
docker compose down -v
docker compose up -d --build
```

---

## Firewall (optional but recommended)

```bash
# Allow SSH
ufw allow 22

# Allow the app
ufw allow 3000

# Enable firewall
ufw enable
```

---

## Troubleshooting

### Backend won't start
```bash
# Check backend logs
docker compose logs backend

# Common fix: database not ready yet, restart backend
docker compose restart backend
```

### Can't connect to the app
- Make sure port 3000 is open in your VPS provider's firewall/security group
- Check `docker compose ps` - all services should be "running"

### Database connection error
- Check that PostgreSQL is running: `docker compose ps postgres`
- Check the DB_PASSWORD in `.env` matches what you set
