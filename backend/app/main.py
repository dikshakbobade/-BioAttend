"""
Main FastAPI application.
"""
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.db import init_db, get_db, check_db_connection, AsyncSessionLocal
from app.api.v1 import api_router
from app.services import template_cache, device_service, admin_service
from app.services.scheduler import start_scheduler, stop_scheduler
import logging

logger = logging.getLogger(__name__)

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    # Startup
    logger.info("Starting up Biometric Attendance System...")

    # Initialize database
    try:
        await init_db()
        logger.info("Database initialized.")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        # In production, you might want to exit here
        raise

    # Create initial admin user if needed and pre-load templates
    try:
        async with AsyncSessionLocal() as db:
            admin = await admin_service.create_initial_admin(db)
            if admin:
                logger.info(f"Initial admin user created: {admin.username}")
                logger.warning("WARNING: Change the default password immediately!")

            # Warmup Face Engine in background (to avoid blocking port binding)
            async def warmup_engine():
                try:
                    import gc
                    from app.services.face_engine import get_face_engine
                    logger.info("Initializing Face Engine (Hybrid Mode)...")
                    get_face_engine()._ensure_initialized()
                    gc.collect()
                    logger.info("Face Engine WARMUP COMPLETE ✅")
                except Exception as e:
                    logger.error(f"Face Engine Warmup FAILED: {e}")

            import asyncio
            asyncio.create_task(warmup_engine())

            # Pre-load biometric templates for faster matching
            try:
                from app.services.matching_service import matching_service
                from app.models import BiometricType
                count = await matching_service.load_templates(db, BiometricType.FACE)
                logger.info(f"Pre-loaded {count} face templates.")
            except Exception as e:
                logger.warning(f"Failed to pre-load templates: {e}")
    except Exception as e:
        logger.error(f"Failed to create initial admin or pre-load templates: {e}")

    # Start email notification scheduler
    try:
        start_scheduler()
        logger.info("Email notification scheduler started.")
    except Exception as e:
        logger.error(f"Warning: Scheduler failed to start: {e}")

    yield

    # Shutdown
    print("Shutting down...")
    stop_scheduler()
    template_cache.clear()


app = FastAPI(
    title="Biometric Attendance System",
    description="Production-ready biometric attendance system with face and fingerprint recognition",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
)

# Request context logger (for debugging CORS origins)
@app.middleware("http")
async def log_headers_middleware(request: Request, call_next):
    origin = request.headers.get("origin")
    if origin:
        logger.info(f"Incoming request from origin: {origin}")
    return await call_next(request)

# CORS middleware
# Note: allow_credentials=True CANNOT be used with allow_origins=["*"]
# Since we use Bearer tokens in headers (not cookies), we can set this to False.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(api_router)


@app.get("/")
async def root():
    return {
        "name": "Biometric Attendance System",
        "version": "1.0.0",
        "status": "running"
    }


@app.get("/health")
async def health_check():
    async with AsyncSessionLocal() as db:
        db_healthy = await check_db_connection(db)
        active_devices = await device_service.get_active_device_count(db)

    checks = {
        "database": db_healthy,
        "face_templates_loaded": template_cache.is_loaded("FACE"),
        "active_devices": active_devices
    }

    status = "healthy" if db_healthy else "degraded"

    return {
        "status": status,
        "timestamp": datetime.utcnow().isoformat(),
        "checks": checks
    }


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # Always log the full traceback in server logs for debugging
    logger.exception(f"CRITICAL: Unhandled exception during {request.method} {request.url.path}: {exc}")
    
    return JSONResponse(
        status_code=500,
        content={
            "detail": str(exc), # We'll show the message to help the user identify if it's a Timeout/OOM
            "error_code": "INTERNAL_ERROR",
            "type": type(exc).__name__
        }
    )

from fastapi.exceptions import RequestValidationError
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    body = await request.body()
    logger.error(f"Validation error: {exc.errors()}\nBody: {body.decode()[:500]}...")
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "body": body.decode()[:500]}
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG
    )