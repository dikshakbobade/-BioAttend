# Backend Dockerfile
FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Set work directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    build-essential \
    libpq-dev \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create non-root user
RUN adduser --disabled-password --gecos '' appuser

# Pre-download InsightFace buffalo_s model (to avoid downloading on first request)
RUN apt-get update && apt-get install -y unzip && \
    mkdir -p /home/appuser/.insightface/models/buffalo_s && \
    curl -L "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_s.zip" -o buffalo_s.zip && \
    unzip buffalo_s.zip -d /home/appuser/.insightface/models/buffalo_s && \
    rm buffalo_s.zip && \
    chown -R appuser:appuser /home/appuser/.insightface

# Copy application code
COPY . .

# Set permissions for the app
RUN chown -R appuser:appuser /app
USER appuser

# Expose port (Render injects PORT env var)
EXPOSE ${PORT:-8000}

# Run migrations and start server
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
