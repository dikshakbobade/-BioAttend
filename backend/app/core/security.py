"""
Security utilities for authentication and encryption.
"""
from datetime import datetime, timedelta
from typing import Optional
import hashlib
import secrets

from jose import JWTError, jwt
import bcrypt
from cryptography.fernet import Fernet
import base64

from app.core.config import get_settings

settings = get_settings()


def _pre_hash_password(password: str) -> bytes:
    """Pre-hash password with SHA-256 to avoid bcrypt's 72-byte limit."""
    hashed = hashlib.sha256(password.encode('utf-8')).digest()
    return base64.b64encode(hashed)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against its hash."""
    try:
        pwd_bytes = _pre_hash_password(plain_password)
        return bcrypt.checkpw(pwd_bytes, hashed_password.encode('utf-8'))
    except Exception:
        return False


def get_password_hash(password: str) -> str:
    """Generate password hash."""
    salt = bcrypt.gensalt()
    pwd_bytes = _pre_hash_password(password)
    return bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def decode_token(token: str) -> Optional[dict]:
    """Decode and verify JWT token."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except JWTError:
        return None


def generate_api_key() -> str:
    """Generate a secure random API key."""
    return secrets.token_urlsafe(32)


def hash_api_key(api_key: str) -> str:
    """Hash API key using SHA-256."""
    return hashlib.sha256(api_key.encode()).hexdigest()


def verify_api_key(plain_key: str, hashed_key: str) -> bool:
    """Verify API key against its hash."""
    return hash_api_key(plain_key) == hashed_key


class EncryptionService:
    """Service for encrypting/decrypting biometric templates."""
    
    def __init__(self):
        # Ensure encryption key is 32 bytes, base64 encoded
        key = settings.ENCRYPTION_KEY.encode()
        if len(key) < 32:
            key = key.ljust(32, b'0')
        elif len(key) > 32:
            key = key[:32]
        self._fernet = Fernet(base64.urlsafe_b64encode(key))
    
    def encrypt(self, data: bytes) -> bytes:
        """Encrypt data using Fernet (AES-256)."""
        return self._fernet.encrypt(data)
    
    def decrypt(self, encrypted_data: bytes) -> bytes:
        """Decrypt data using Fernet."""
        return self._fernet.decrypt(encrypted_data)
    
    def encrypt_template(self, template_data: bytes) -> bytes:
        """Encrypt a biometric template."""
        return self.encrypt(template_data)
    
    def decrypt_template(self, encrypted_template: bytes) -> bytes:
        """Decrypt a biometric template."""
        return self.decrypt(encrypted_template)


# Singleton encryption service
encryption_service = EncryptionService()
