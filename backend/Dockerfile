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

# Hybrid Model Strategy: Use buffalo_sc (16MB) + inject landmarks from buffalo_s (5MB)
# Total footprint ~21MB instead of 160MB.
RUN apt-get update && apt-get install -y unzip curl && \
    mkdir -p /home/appuser/.insightface/models/buffalo_sc && \
    # 1. Download and extract buffalo_sc (Det + Rec)
    curl -L "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_sc.zip" -o buffalo_sc.zip && \
    unzip buffalo_sc.zip -d /home/appuser/.insightface/models/buffalo_sc && \
    rm buffalo_sc.zip && \
    # 2. Download buffalo_s ONLY to get the 5MB landmark model
    curl -L "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_s.zip" -o buffalo_s.zip && \
    mkdir -p tmp_s && unzip buffalo_s.zip 2d106det.onnx -d tmp_s && \
    mv tmp_s/2d106det.onnx /home/appuser/.insightface/models/buffalo_sc/ && \
    rm -rf tmp_s buffalo_s.zip && \
    # 3. Final cleanup and permissions
    chown -R appuser:appuser /home/appuser/.insightface && \
    apt-get purge -y unzip curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Copy application code
COPY . .

# Set permissions for the app
RUN chown -R appuser:appuser /app
USER appuser

# Expose port (Render injects PORT env var)
EXPOSE ${PORT:-8000}

# Run migrations and start server
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
