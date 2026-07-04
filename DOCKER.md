# KeprokScan Docker Guide

## Build & Run with Docker

### Option 1: Using Docker Compose (Recommended)
```bash
docker-compose up --build
```
Akses aplikasi di: `http://localhost:8080`

### Option 2: Using Docker CLI

**Build image:**
```bash
docker build -t keprok-scan:latest .
```

**Run container:**
```bash
docker run -d -p 8080:80 --name keprok-scan keprok-scan:latest
```

### Option 3: Using Docker Compose untuk Development

```bash
docker-compose up -d
docker-compose logs -f keprok-scan
```

## Opsi Lainnya

### Stop Container
```bash
docker-compose down
```

### Remove Image
```bash
docker rmi keprok-scan:latest
```

### Push ke Docker Registry
```bash
docker tag keprok-scan:latest username/keprok-scan:latest
docker push username/keprok-scan:latest
```

## Info Teknis

- **Base Image:** Nginx Alpine (lightweight)
- **Port:** 80 (exposed pada 8080 via docker-compose)
- **Model:** TensorFlow.js YOLOv8
- **File Size:** ~200MB (termasuk model)

## Kebutuhan Sistem
- Docker Desktop atau Docker Engine
- Minimal 512MB RAM
- ~500MB disk space

---

Untuk troubleshooting atau modifikasi, check Dockerfile dan nginx.conf
