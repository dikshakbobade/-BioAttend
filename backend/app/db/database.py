"""
Database connection and session management.
"""
import ssl
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import text

from app.core.config import get_settings

settings = get_settings()


def _build_engine_args(url: str):
    """Parse DATABASE_URL and handle SSL for aiomysql properly."""
    parsed = urlparse(url)
    query_params = parse_qs(parsed.query)
    connect_args = {}

    # Extract ssl_ca and build a real SSLContext for aiomysql
    if "ssl_ca" in query_params:
        ca_path = query_params.pop("ssl_ca")[0]
        ctx = ssl.create_default_context(cafile=ca_path)
        ctx.check_hostname = True
        ctx.verify_mode = ssl.CERT_REQUIRED
        connect_args["ssl"] = ctx

    # Also handle bare ?ssl=true
    if "ssl" in query_params:
        val = query_params.pop("ssl")[0]
        if val.lower() == "true" and "ssl" not in connect_args:
            ctx = ssl.create_default_context()
            connect_args["ssl"] = ctx

    # Rebuild URL without ssl params
    new_query = urlencode(query_params, doseq=True)
    clean_url = urlunparse(parsed._replace(query=new_query))

    return clean_url, connect_args


_clean_url, _connect_args = _build_engine_args(settings.DATABASE_URL)

# Create async engine
engine = create_async_engine(
    _clean_url,
    echo=settings.DEBUG,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    connect_args=_connect_args,
)

# Session factory
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

# Base class for models
Base = declarative_base()


async def get_db() -> AsyncSession:
    """Dependency to get database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    """Initialize database tables."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def check_db_connection(db: AsyncSession) -> bool:
    """Check if database connection is alive."""
    try:
        await db.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
