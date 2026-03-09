"""
Biometric matching service for face and fingerprint verification.
"""
import base64
import logging
import numpy as np

logger = logging.getLogger(__name__)
import cv2
import faiss
from uuid import UUID
from typing import Optional, List, Tuple
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Employee, BiometricTemplate, BiometricType, EmployeeStatus
from app.core.security import encryption_service
from app.core.config import get_settings

settings = get_settings()


class TemplateCache:
    """Cache for biometric templates to improve matching performance."""
    
    def __init__(self):
        self._face_cache = {}
        self._loaded = {"FACE": False}
        
        # Faiss components
        self._face_index: Optional[faiss.IndexFlatIP] = None
        self._face_id_map: List[Employee] = []  # Maps Faiss index i to Employee

    def get_face_templates(self) -> dict:
        """Get cached face templates."""
        return dict(self._face_cache)
    
    def set_face_template(self, employee_id: UUID, embedding: np.ndarray, employee: Employee):
        """Cache a face template. Appends if employee already exists in cache."""
        eid_str = str(employee_id)
        if eid_str not in self._face_cache:
            self._face_cache[eid_str] = {
                "embeddings": [],
                "employee": employee
            }
        self._face_cache[eid_str]["embeddings"].append(embedding)

    def rebuild_face_index(self):
        """Build the Faiss index from all cached face embeddings."""
        all_embs = []
        all_emps = []
        for eid_str, data in self._face_cache.items():
            for emb in data["embeddings"]:
                all_embs.append(emb)
                all_emps.append(data["employee"])

        self._face_id_map = all_emps

        if not all_embs:
            self._face_index = None
            return

        # Convert to float32 numpy array
        embeddings_arr = np.array(all_embs).astype('float32')

        # ArcFace embeddings are usually pre-normalized,
        # but we ensure normalization for Inner Product to be Cosine Similarity
        faiss.normalize_L2(embeddings_arr)

        dim = embeddings_arr.shape[1]
        self._face_index = faiss.IndexFlatIP(dim)
        self._face_index.add(embeddings_arr)
        logger.info(f"Faiss index built with {len(all_embs)} vectors (dim={dim})")

    def search_face(self, query_embedding: np.ndarray, top_k: int = 5) -> List[Tuple[Employee, float]]:
        """Search for top_k matches using Faiss (Inner Product for Cosine Similarity)."""
        if not self._face_cache:
            logger.warning("search_face: Cache is EMPTY!")
            return []
            
        if self._face_index is None:
            logger.warning("search_face: Faiss index is None! Rebuilding...")
            self.rebuild_face_index()
            if self._face_index is None:
                return []

        try:
            # Reshape and normalize for Cosine Similarity (using IndexFlatIP)
            query_arr = query_embedding.astype('float32').reshape(1, -1)
            faiss.normalize_L2(query_arr)

            # Search
            distances, indices = self._face_index.search(query_arr, top_k)
            
            results = []
            for score, idx in zip(distances[0], indices[0]):
                if idx != -1 and idx < len(self._face_id_map):
                    results.append((self._face_id_map[idx], float(score)))
            
            return results
        except Exception as e:
            logger.error(f"Faiss search error: {e}")
            return []

    def set_fingerprint_template(self, employee_id: UUID, template: bytes, employee: Employee):
        """Deprecated: Fingerprint matching is no longer supported."""
        pass
    
    def clear(self):
        """Clear face template cache."""
        self._face_cache.clear()
        self._loaded = {"FACE": False}
        self._face_index = None
        self._face_id_map = []
    
    def is_loaded(self, biometric_type: str) -> bool:
        """Check if face templates are loaded."""
        if biometric_type != "FACE":
            return False
        return self._loaded.get("FACE", False)
    
    def set_loaded(self, biometric_type: str, loaded: bool = True):
        """Mark face templates as loaded."""
        if biometric_type == "FACE":
            self._loaded["FACE"] = loaded


# Global template cache
template_cache = TemplateCache()


class MatchingService:
    """Service for biometric template matching."""
    
    def __init__(self):
        self.face_threshold = settings.FACE_SIMILARITY_THRESHOLD
        self.fingerprint_threshold = settings.FINGERPRINT_MATCH_THRESHOLD
    
    @staticmethod
    def cosine_similarity(embedding1: np.ndarray, embedding2: np.ndarray) -> float:
        """Calculate cosine similarity between two embeddings."""
        norm1 = np.linalg.norm(embedding1)
        norm2 = np.linalg.norm(embedding2)
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return float(np.dot(embedding1, embedding2) / (norm1 * norm2))
    
    async def load_templates(
        self, 
        db: AsyncSession, 
        biometric_type: BiometricType
    ) -> int:
        """Load face templates into cache."""
        if biometric_type != BiometricType.FACE:
            return 0

        # Clear existing face cache
        template_cache.clear()
        
        result = await db.execute(
            select(BiometricTemplate, Employee)
            .join(Employee)
            .where(
                BiometricTemplate.biometric_type == BiometricType.FACE,
                BiometricTemplate.is_active == True,
                Employee.status == EmployeeStatus.ACTIVE
            )
        )
        rows = result.all()
        
        count = 0
        for template, employee in rows:
            try:
                decrypted = encryption_service.decrypt_template(template.template_data)
                embedding = np.frombuffer(decrypted, dtype=np.float32)
                template_cache.set_face_template(employee.id, embedding, employee)
                count += 1
            except Exception as e:
                logger.error(f"Error loading template for employee {employee.id}: {e}")
        
        template_cache.set_loaded(BiometricType.FACE.value)
        template_cache.rebuild_face_index()
        return count
    
    async def match_face(
        self, 
        db: AsyncSession,
        query_embedding: List[float],
        liveness_score: float
    ) -> Optional[Tuple[Employee, float]]:
        """Match face embedding against stored templates using Faiss search."""
        # Check liveness
        if liveness_score < settings.LIVENESS_THRESHOLD:
            return None
        
        # Ensure templates are loaded
        if not template_cache.is_loaded("FACE"):
            logger.info("match_face: Templates not loaded. Loading now...")
            await self.load_templates(db, BiometricType.FACE)
        
        query_array = np.array(query_embedding, dtype=np.float32)
        matches = template_cache.search_face(query_array, top_k=1)
        
        if not matches:
            return None
            
        best_match, similarity = matches[0]
        
        if similarity >= self.face_threshold:
            return (best_match, similarity)
            
        return None
    
    def _clear_cache(self):
        """Internal cleanup."""
        template_cache.clear()
    
    async def register_template(
        self,
        db: AsyncSession,
        employee_id: UUID,
        biometric_type: BiometricType,
        template_data: str,  # Base64 encoded
        quality_score: Optional[float] = None
    ) -> BiometricTemplate:
        """Register a new biometric template for an employee."""
        
        if biometric_type != BiometricType.FACE:
            raise ValueError("Only face verification is supported.")

        # 1. Decode image for quality analysis
        img_bytes = base64.b64decode(template_data)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            raise ValueError("Could not decode face image.")

        # 2. Extract 512-d ArcFace embedding via InsightFace
        from .face_engine import get_face_engine
        from .face_quality import get_face_quality_service
        
        engine = get_face_engine()
        quality_service = get_face_quality_service()

        # Perform quality analysis
        passed, q_details = quality_service.analyze_quality(img)
        if not passed:
            error_msg = " | ".join(q_details['errors'])
            # Log the quality failure but DO NOT block enrollment anymore
            print(f"⚠️ Face quality check warning (proceeding anyway): {error_msg}")
        else:
            print(f"✅ Face quality check passed: {q_details}")

        embedding = engine.extract_embedding(img)
        if embedding is None:
            raise ValueError("Could not detect face in the image. Please try again with better lighting.")
        
        raw_template = embedding.tobytes()
        # Use sharpness as a proxy for quality_score if not provided
        if quality_score is None:
            quality_score = q_details.get("sharpness", 0.0)
            
        print(f"✅ Face quality passed and embedding extracted: {len(raw_template)} bytes")
        
        # Encrypt template for storage
        encrypted_template = encryption_service.encrypt_template(raw_template)
        
        # Limit to 3 active templates per type
        existing_count_result = await db.execute(
            select(BiometricTemplate).where(
                BiometricTemplate.employee_id == employee_id,
                BiometricTemplate.biometric_type == biometric_type,
                BiometricTemplate.is_active == True
            )
        )
        existing_active = existing_count_result.scalars().all()
        
        # If we reached 3, deactivate the oldest one
        if len(existing_active) >= 3:
            # Sort by created_at and deactivate oldest
            existing_active.sort(key=lambda x: x.created_at)
            existing_active[0].is_active = False
            print(f"🔄 Maximum templates reached for {employee_id}. Deactivating oldest template.")
        
        # Create new template
        template = BiometricTemplate(
            employee_id=employee_id,
            biometric_type=biometric_type,
            template_data=encrypted_template,
            quality_score=quality_score,
            is_active=True
        )
        db.add(template)
        await db.commit()
        await db.refresh(template)
        
        # Incremental cache update (avoid heavy global reload)
        try:
            # 1. Get employee from DB (already have it)
            # 2. Update local cache
            template_cache.set_face_template(employee.id, embedding, employee)
            # 3. Mark as loaded and rebuild index
            template_cache.set_loaded("FACE")
            template_cache.rebuild_face_index()
            logger.info(f"Incremental cache update successful for employee {employee.id}")
        except Exception as e:
            logger.error(f"Failed to incrementally update cache: {e}. Clearing to force reload.")
            template_cache.clear()
        
        return template
    
    async def get_employee_templates(
        self,
        db: AsyncSession,
        employee_id: UUID
    ) -> List[BiometricTemplate]:
        """Get all templates for an employee."""
        result = await db.execute(
            select(BiometricTemplate).where(
                BiometricTemplate.employee_id == employee_id
            ).order_by(BiometricTemplate.created_at.desc())
        )
        return list(result.scalars().all())


# Singleton instance
matching_service = MatchingService()
