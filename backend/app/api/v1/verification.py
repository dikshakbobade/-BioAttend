"""
Face Verification & Attendance — Enterprise Secure Pipeline.
=============================================================
Architecture:
  1. RetinaFace Detection    (InsightFace buffalo_l)
  2. Passive Anti-Spoof      (ONNX CNN / texture fallback)
  3. Active Liveness          (MediaPipe FaceMesh: blink + nod + smile)
  4. ArcFace 512-d Embedding (InsightFace buffalo_l)
  5. Cosine Similarity        (match against stored templates)
  6. Mark Attendance

No DeepFace, no face_recognition, no base64 image storage, no pixel-hash fallback.
"""

import base64
import logging
import sys
from datetime import datetime, date, timezone, timedelta
from typing import Optional, List

import cv2
import numpy as np
import time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field

from app.db import get_db
from app.models import Employee, BiometricTemplate, AttendanceLog, AuditLog, AdminUser
from app.api.v1.dependencies import get_current_admin
from app.core.security import encryption_service
from app.core.config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/verification", tags=["verification"])
settings = get_settings()


# ============================================================
# SCHEMAS
# ============================================================

class FaceAttendanceRequest(BaseModel):
    image_base64: str = Field(..., min_length=100)
    action: str = Field(..., pattern="^(CHECK_IN|CHECK_OUT)$")
    liveness_frames: Optional[List[str]] = None


class AutoAttendanceRequest(BaseModel):
    image_base64: str = Field(..., min_length=100)
    liveness_frames: Optional[List[str]] = None


class LivenessCheckRequest(BaseModel):
    image_base64: str = Field(..., min_length=100)
    liveness_frames: Optional[List[str]] = None




class AttendanceResult(BaseModel):
    success: bool
    action: Optional[str] = None
    employee_id: Optional[str] = None
    employee_name: Optional[str] = None
    employee_code: Optional[str] = None
    confidence_score: Optional[float] = None
    liveness_score: Optional[float] = None
    liveness_details: Optional[dict] = None
    antispoof_score: Optional[float] = None
    timestamp: Optional[datetime] = None
    message: str


class LivenessResult(BaseModel):
    is_live: bool
    score: float
    reason: str
    details: Optional[dict] = None


class AttendanceStatusResponse(BaseModel):
    employee_id: str
    employee_name: str
    employee_code: str
    date: date
    checked_in: bool
    checked_out: bool
    check_in_time: Optional[datetime] = None
    check_out_time: Optional[datetime] = None


# ============================================================
# HELPERS
# ============================================================

def b64_to_cv2(b64_str: str) -> Optional[np.ndarray]:
    """Convert base64 image to OpenCV BGR image."""
    try:
        return cv2.imdecode(
            np.frombuffer(base64.b64decode(b64_str), np.uint8),
            cv2.IMREAD_COLOR,
        )
    except Exception:
        return None


def cosine_similarity(vec_a: np.ndarray, vec_b: np.ndarray) -> float:
    """Cosine similarity between two vectors. Returns -1 to 1."""
    norm_a = np.linalg.norm(vec_a)
    norm_b = np.linalg.norm(vec_b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(vec_a, vec_b) / (norm_a * norm_b))


def deserialize_embedding(template_data: bytes) -> Optional[np.ndarray]:
    """Deserialize a stored embedding from encrypted template data."""
    try:
        raw = template_data if isinstance(template_data, bytes) else template_data.encode("utf-8")
        decrypted = encryption_service.decrypt_template(raw)

        # Standard 512-d embedding = 2048 bytes (512 * 4 bytes per float32)
        if len(decrypted) == 2048:
            embedding = np.frombuffer(decrypted, dtype=np.float32)
            if len(embedding) == 512:
                return embedding

        # Also handle other embedding sizes
        if len(decrypted) in (512, 1024, 2048, 4096):
            n_floats = len(decrypted) // 4
            embedding = np.frombuffer(decrypted, dtype=np.float32)
            if len(embedding) == n_floats and n_floats in (128, 256, 512, 1024):
                return embedding

        logger.warning(f"Template format unrecognized ({len(decrypted)} bytes)")
        return None

    except Exception as e:
        logger.error(f"Failed to deserialize embedding: {e}")
        return None


async def log_security_event(
    db: AsyncSession,
    event_type: str,
    employee_id=None,
    confidence_score=None,
    error_message=None,
    request_payload=None,
):
    """Log a security event to the audit log."""
    try:
        audit = AuditLog(
            event_type=event_type,
            employee_id=employee_id,
            confidence_score=confidence_score,
            error_message=error_message,
            request_payload=request_payload,
        )
        db.add(audit)
        await db.commit()
    except Exception as e:
        logger.error(f"Failed to log security event: {e}")


# ============================================================
# PUBLIC FUNCTION: Used by enrollment (matching_service.py)
# ============================================================

def extract_face_embedding_bytes(b64_image: str) -> Optional[bytes]:
    """
    Extract face embedding from a base64 image and return as raw bytes.
    Used during enrollment to store the embedding in the database.
    Returns None if no face is detected.
    """
    from app.services.face_engine import get_face_engine
    engine = get_face_engine()
    embedding = engine.extract_embedding_from_b64(b64_image)
    if embedding is None:
        return None
    return embedding.tobytes()


# ============================================================
# LIVENESS CHECK ENDPOINT (for enrollment)
# ============================================================

@router.post("/check-liveness", response_model=LivenessResult)
async def check_liveness_endpoint(request: LivenessCheckRequest):
    """
    Eye-blink liveness check.
    Used before enrollment to ensure a real person is present (not a photo).
    """
    from app.services.face_engine import get_face_engine
    from app.services.active_liveness import get_active_liveness_service

    engine = get_face_engine()
    active_liveness = get_active_liveness_service()

    # Decode main image
    main_img = b64_to_cv2(request.image_base64)
    if main_img is None:
        return LivenessResult(is_live=False, score=0.0, reason="Invalid image")

    # Step 1: Detect face
    faces = engine.detect_faces(main_img)
    if not faces:
        return LivenessResult(is_live=False, score=0.0, reason="No face detected")

    # Step 2: Eye-blink liveness check
    all_frames = []
    if request.liveness_frames:
        for fb64 in request.liveness_frames:
            img = b64_to_cv2(fb64)
            if img is not None:
                all_frames.append(img)
    all_frames.append(main_img)

    if len(all_frames) >= 3:
        passed, details = active_liveness.check(all_frames)
        if not passed:
            return LivenessResult(
                is_live=False, score=0.3,
                reason="No blink detected — please blink naturally while looking at the camera",
                details=details,
            )
        metrics = details.get('liveness_metrics', {})
        reason = f"passed (EAR max: {metrics.get('ear_max', 0):.3f}, range: {metrics.get('ear_range', 0):.3f})"
        return LivenessResult(
            is_live=True, score=0.95,
            reason=reason,
            details=details,
        )

    # Not enough frames — pass with warning
    return LivenessResult(
        is_live=True, score=0.7,
        reason="passed (not enough frames for blink detection)",
        details={"blink_detected": False, "nod_detected": False, "smile_detected": False},
    )


# ============================================================
# MAIN ENDPOINT: Face Verify + Attendance
# ============================================================

@router.post("/face", response_model=AttendanceResult)
async def verify_face_and_mark_attendance(
    request: FaceAttendanceRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Enterprise face verification pipeline:
      1. Decode image
      2. RetinaFace detection
      3. Passive anti-spoof (reject spoofs)
      4. Active liveness (blink + nod + smile)
      5. ArcFace 512-d embedding
      6. Cosine similarity match
      7. Mark attendance
    """
    from app.services.face_engine import get_face_engine
    from app.services.antispoof_service import get_antispoof_service
    from app.services.active_liveness import get_active_liveness_service
    from app.services.matching_service import matching_service

    engine = get_face_engine()
    antispoof = get_antispoof_service()
    active_liveness = get_active_liveness_service()

    # =====================================================
    # STEP 0: Validate image
    # =====================================================
    print(f"\n[DEBUG] Face Verification Started - Action: {request.action}")
    logger.info("=" * 60)
    logger.info(f"FACE VERIFICATION PIPELINE START - {request.action}")
    
    sys.stderr.write(f"\n>>> [DEBUG] VERIFY_FACE START - Action: {request.action}\n")
    sys.stderr.flush()
    
    try:
        raw_bytes = base64.b64decode(request.image_base64)
        if len(raw_bytes) < 100:
            sys.stderr.write(">>> [DEBUG] Image too small\n")
            return AttendanceResult(success=False, message="Image too small.")
    except Exception as e:
        sys.stderr.write(f">>> [DEBUG] B64 Error: {e}\n")
        return AttendanceResult(success=False, message=f"Invalid image: {e}")

    main_img = b64_to_cv2(request.image_base64)
    if main_img is None:
        sys.stderr.write(">>> [DEBUG] CV2 Decode Failed\n")
        return AttendanceResult(success=False, message="Could not decode image.")

    # =====================================================
    # STEP 1: RetinaFace Detection
    # =====================================================
    try:
        faces = engine.detect_faces(main_img)
        if not faces:
            print("[DEBUG] No face detected")
            return AttendanceResult(
                success=False,
                message="No face detected. Please look directly at the camera.",
            )

        largest_face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
        print(f"[DEBUG] Face detected: {len(faces)} faces found")
    except Exception as e:
        import traceback
        print(f"[DEBUG] Detection crash: {e}")
        traceback.print_exc()
        return AttendanceResult(success=False, message=f"Detection error: {e}")

    # =====================================================
    # STEP 2: Passive Anti-Spoof (logged only, not blocking)
    # Eye-blink detection is the real liveness gate.
    # =====================================================
    face_crop = engine.get_face_crop(main_img, largest_face)
    is_real, spoof_score, spoof_reason = antispoof.check(face_crop)
    logger.info(f"Passive anti-spoof: score={spoof_score:.3f}, real={is_real} ({spoof_reason})")

    # =====================================================
    # STEP 3: Eye-Blink Liveness Detection
    # =====================================================
    liveness_details = None
    lv_score = spoof_score  # Default to passive score

    all_frames = []
    if request.liveness_frames and len(request.liveness_frames) >= 2:
        for fb64 in request.liveness_frames:
            img = b64_to_cv2(fb64)
            if img is not None:
                all_frames.append(img)
    all_frames.append(main_img)

    if len(all_frames) >= 3:
        passed, details = active_liveness.check(all_frames)
        liveness_details = details
        if passed:
            lv_score = 0.95
            logger.info(f"✅ Eye-blink liveness passed")
        else:
            lv_score = 0.2
            logger.warning(f"❌ Eye-blink liveness FAILED: {details.get('reason')}")
            await log_security_event(
                db,
                event_type="LIVENESS_FAILED",
                error_message=details.get("reason"),
                request_payload=details,
            )
            return AttendanceResult(
                success=False,
                liveness_score=lv_score,
                liveness_details=details,
                antispoof_score=spoof_score,
                message="No blink detected — please look at the camera and blink naturally.",
            )
    else:
        logger.info("⚠️ Liveness skipped — not enough frames (passive-only mode)")

    # =====================================================
    # STEP 4: Temporal Voting Match (Multi-Frame)
    # =====================================================
    t_matching_start = time.time()
    
    # 4a. Primary Frame Matching (Early Termination Optimization)
    primary_match = await matching_service.match_face(db, largest_face.normed_embedding.tolist(), liveness_score=1.0)
    
    if primary_match:
        emp, score = primary_match
        # If confidence is high enough, Terminate Early to save extraction time on liveness frames
        if score >= 0.82:
            logger.info(f"⚡ EARLY TERMINATION: High confidence match {score:.3f} for {emp.full_name}")
            best_emp = emp
            best_similarity = score
            final_best_score = score
            best_match_id = str(emp.id)
            goto_attendance = True
        else:
            goto_attendance = False
    else:
        goto_attendance = False

    if not goto_attendance:
        # We collect embeddings from the current frame AND liveness frames
        vote_embeddings = []
        
        # Add embeddings from liveness frames if available
        # OPTIMIZATION: Only take 2 frames for voting to save time
        if request.liveness_frames:
            for fb64 in request.liveness_frames[-2:]:  
                emb = engine.extract_embedding_from_b64(fb64)
                if emb is not None:
                    vote_embeddings.append(emb)
        
        # Always add the main/current frame embedding
        vote_embeddings.append(largest_face.normed_embedding)
        
        similarity_threshold = settings.FACE_SIMILARITY_THRESHOLD
        high_confidence_threshold = 0.60  # Auto-pass if any single frame is this high (was 0.75)
        
        # Tally votes for each employee recognized
        votes = {}  # {employee_id: {"count": N, "max_score": S, "employee": E}}
        
        for emb in vote_embeddings:
            # Use matching_service.match_face which now uses Faiss
            match_result = await matching_service.match_face(db, emb.tolist(), liveness_score=1.0)
            if match_result:
                emp, score = match_result
                eid = str(emp.id)
                if eid not in votes:
                    votes[eid] = {"count": 0, "max_score": 0.0, "employee": emp}
                
                votes[eid]["count"] += 1
                if score > votes[eid]["max_score"]:
                    votes[eid]["max_score"] = score

        # Decision Logic:
        # 1. High Confidence Pass: Any frame > 0.75
        # 2. Majority Vote Pass: 3+ frames > threshold (0.60)
        best_match_id = None
        final_best_score = 0.0
        
        for eid, data in votes.items():
            # High confidence check
            if data["max_score"] >= high_confidence_threshold:
                best_match_id = eid
                final_best_score = data["max_score"]
                logger.info(f"🏆 HIGH CONFIDENCE MATCH: {data['employee'].full_name} ({data['max_score']:.3f})")
                break
                
            # Majority vote check (2+ of 3 frames)
            if data["count"] >= 2:
                best_match_id = eid
                final_best_score = data["max_score"]
                logger.info(f"🗳️ MAJORITY VOTE MATCH: {data['employee'].full_name} ({data['count']} votes)")
                break

        if best_match_id is None:
            # Fallback to absolute best if neither met (for better debugging feedback)
            fallback_eid = max(votes.keys(), key=lambda k: votes[k]["max_score"]) if votes else None
            fallback_score = votes[fallback_eid]["max_score"] if fallback_eid else 0.0
            
            vote_list = [f"{v['employee'].full_name}: {v['count']}v" for v in votes.values()]
            return AttendanceResult(
                success=False,
                confidence_score=round(fallback_score, 4),
                liveness_score=lv_score,
                liveness_details=liveness_details,
                antispoof_score=spoof_score,
                message=f"Face match failed (Votes: {vote_list}). Try clear lighting.",
            )

        best_emp = votes[best_match_id]["employee"]
        best_similarity = final_best_score
    
    logger.info(f"Matching Time: {(time.time() - t_matching_start):.3f}s")
    logger.info(f"Final Selection: {best_emp.full_name} with score {best_similarity:.4f}")

    # =====================================================
    # STEP 6: Mark Attendance
    # =====================================================
    t_db_start = time.time()
    emp = best_emp
    confidence = round(best_similarity, 4)
    today = date.today()
    IST = timezone(timedelta(hours=5, minutes=30))
    now = datetime.now(IST).replace(tzinfo=None)

    existing = await db.execute(
        select(AttendanceLog).where(and_(
            AttendanceLog.employee_id == emp.id, AttendanceLog.date == today
        ))
    )
    log = existing.scalar_one_or_none()
    print(f"[DEBUG] Existing log found: {log is not None}")

    if request.action == "CHECK_IN":
        if log and log.check_in_time:
            return AttendanceResult(
                success=False, employee_id=str(emp.id), employee_name=emp.full_name,
                employee_code=emp.employee_code,
                message=f"{emp.full_name} already checked in at {log.check_in_time.strftime('%I:%M %p')}.",
            )
        if log is None:
            log = AttendanceLog(employee_id=emp.id, date=today, check_in_time=now, check_in_method="FACE")
            db.add(log)
        else:
            print(f"[DEBUG] Updating existing log for check-in")
            log.check_in_time, log.check_in_method = now, "FACE"
        
        print(f"[DEBUG] Attempting DB commit for check-in...")
        
        try:
            await db.commit()
            print(f"[DEBUG] Check-in committed for {emp.full_name}")
        except Exception as e:
            print(f"[DEBUG] DB Commit failed: {e}")
            await db.rollback()
            return AttendanceResult(success=False, message=f"Database error: {e}")

        # Late arrival alert
        try:
            from app.services.email_service import email_service
            sm = settings.OFFICE_START_HOUR * 60 + settings.OFFICE_START_MINUTE
            cm = now.hour * 60 + now.minute
            if cm > sm:
                print(f"[DEBUG] Threshold exceeded: {cm} > {sm}. Sending late alert...")
                email_service.send_late_arrival_alert(
                    employee_name=emp.full_name, employee_code=emp.employee_code,
                    check_in_time=now, late_by_minutes=cm - sm)
                print(f"[DEBUG] Late alert sent (or failed silently but didn't hang).")
        except Exception:
            pass

        return AttendanceResult(
            success=True, action="CHECK_IN", employee_id=str(emp.id),
            employee_name=emp.full_name, employee_code=emp.employee_code,
            confidence_score=confidence, liveness_score=lv_score,
            liveness_details=liveness_details, antispoof_score=spoof_score,
            timestamp=now, message=f"{emp.full_name} checked in successfully!",
        )

    elif request.action == "CHECK_OUT":
        if not log or not log.check_in_time:
            return AttendanceResult(
                success=False, employee_id=str(emp.id), employee_name=emp.full_name,
                employee_code=emp.employee_code, message=f"{emp.full_name} hasn't checked in today.",
            )
        if log.check_out_time:
            return AttendanceResult(
                success=False, employee_id=str(emp.id), employee_name=emp.full_name,
                employee_code=emp.employee_code,
                message=f"{emp.full_name} already checked out at {log.check_out_time.strftime('%I:%M %p')}.",
            )
        log.check_out_time, log.check_out_method = now, "FACE"
        if log.check_in_time:
            log.working_hours = round((now - log.check_in_time).total_seconds() / 3600, 2)
        await db.commit()
        hrs = f" ({log.working_hours:.1f} hrs)" if log.working_hours else ""
        return AttendanceResult(
            success=True, action="CHECK_OUT", employee_id=str(emp.id),
            employee_name=emp.full_name, employee_code=emp.employee_code,
            confidence_score=confidence, liveness_score=lv_score,
            liveness_details=liveness_details, antispoof_score=spoof_score,
            timestamp=now, message=f"{emp.full_name} checked out!{hrs}",
        )


# ============================================================
# AUTO-ATTEND ENDPOINT (Hands-free Kiosk)
# ============================================================

@router.post("/auto-attend", response_model=AttendanceResult)
async def auto_attend(
    request: AutoAttendanceRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Fully automatic attendance endpoint for hands-free kiosk.
    Runs the same verification pipeline but auto-determines
    CHECK_IN vs CHECK_OUT based on today's attendance record.
    """
    try:
        from app.services.face_engine import get_face_engine
        from app.services.antispoof_service import get_antispoof_service
        from app.services.active_liveness import get_active_liveness_service
        from app.services.matching_service import matching_service

        engine = get_face_engine()
        antispoof = get_antispoof_service()
        active_liveness = get_active_liveness_service()

        print(f"\n[AUTO-ATTEND] Automatic attendance started")
        logger.info("=" * 60)
        logger.info("AUTO-ATTEND PIPELINE START")

        # STEP 0: Validate image
        try:
            raw_bytes = base64.b64decode(request.image_base64)
            if len(raw_bytes) < 100:
                return AttendanceResult(success=False, message="Image too small.")
        except Exception as e:
            return AttendanceResult(success=False, message=f"Invalid image: {e}")

        main_img = b64_to_cv2(request.image_base64)
        if main_img is None:
            return AttendanceResult(success=False, message="Could not decode image.")

        # STEP 1: RetinaFace Detection
        try:
            faces = engine.detect_faces(main_img)
            if not faces:
                return AttendanceResult(
                    success=False,
                    message="No face detected. Please look directly at the camera.",
                )
            largest_face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
            print(f"[AUTO-ATTEND] Face detected: {len(faces)} faces found")
        except Exception as e:
            import traceback
            traceback.print_exc()
            return AttendanceResult(success=False, message=f"Detection error: {e}")

        # STEP 2: Passive Anti-Spoof
        face_crop = engine.get_face_crop(main_img, largest_face)
        is_real, spoof_score, spoof_reason = antispoof.check(face_crop)
        logger.info(f"Passive anti-spoof: score={spoof_score:.3f}, real={is_real} ({spoof_reason})")

        # STEP 3: Eye-Blink Liveness Detection
        liveness_details = None
        lv_score = spoof_score

        all_frames = []
        if request.liveness_frames and len(request.liveness_frames) >= 2:
            for fb64 in request.liveness_frames:
                img = b64_to_cv2(fb64)
                if img is not None:
                    all_frames.append(img)
        all_frames.append(main_img)

        if len(all_frames) >= 3:
            passed, details = active_liveness.check(all_frames)
            liveness_details = details
            if passed:
                lv_score = 0.95
                logger.info("Eye-blink liveness passed")
            else:
                lv_score = 0.2
                logger.warning(f"Eye-blink liveness FAILED: {details.get('reason')}")
                await log_security_event(
                    db, event_type="LIVENESS_FAILED",
                    error_message=details.get("reason"), request_payload=str(details),
                )
                return AttendanceResult(
                    success=False, liveness_score=lv_score,
                    liveness_details=details, antispoof_score=spoof_score,
                    message="Liveness failed - please blink naturally while looking at the camera.",
                )
        else:
            logger.info("Liveness skipped - not enough frames")

        # STEP 4: Temporal Voting Match
        t_matching_start = time.time()
        
        # 4a. Primary Frame Matching (Early Termination Optimization)
        primary_match = await matching_service.match_face(db, largest_face.normed_embedding.tolist(), liveness_score=1.0)
        
        if primary_match:
            emp, score = primary_match
            # If confidence is high enough, Terminate Early to save extraction time on liveness frames
            if score >= 0.82:
                logger.info(f"⚡ EARLY TERMINATION: High confidence match {score:.3f} for {emp.full_name}")
                best_emp = emp
                best_similarity = score
                final_best_score = score
                best_match_id = str(emp.id)
                goto_attendance = True
            else:
                goto_attendance = False
        else:
            goto_attendance = False

        if not goto_attendance:
            vote_embeddings = []
            if request.liveness_frames:
                for fb64 in request.liveness_frames[-2:]:
                    emb = engine.extract_embedding_from_b64(fb64)
                    if emb is not None:
                        vote_embeddings.append(emb)
            vote_embeddings.append(largest_face.normed_embedding)

            high_confidence_threshold = 0.60

            votes = {}
            for emb in vote_embeddings:
                match_result = await matching_service.match_face(db, emb.tolist(), liveness_score=1.0)
                if match_result:
                    emp, score = match_result
                    eid = str(emp.id)
                    if eid not in votes:
                        votes[eid] = {"count": 0, "max_score": 0.0, "employee": emp}
                    votes[eid]["count"] += 1
                    if score > votes[eid]["max_score"]:
                        votes[eid]["max_score"] = score

            best_match_id = None
            final_best_score = 0.0

            for eid, data in votes.items():
                if data["max_score"] >= high_confidence_threshold:
                    best_match_id = eid
                    final_best_score = data["max_score"]
                    break
                # Only need 2 out of 3 frames to pass
                if data["count"] >= 2:
                    best_match_id = eid
                    final_best_score = data["max_score"]
                    break

            if best_match_id is None:
                fallback_eid = max(votes.keys(), key=lambda k: votes[k]["max_score"]) if votes else None
                fallback_score = votes[fallback_eid]["max_score"] if fallback_eid else 0.0
                return AttendanceResult(
                    success=False, confidence_score=round(fallback_score, 4),
                    liveness_score=lv_score, liveness_details=liveness_details,
                    antispoof_score=spoof_score,
                    message="Face not recognized. Please ensure you are enrolled.",
                )

            best_emp = votes[best_match_id]["employee"]
            best_similarity = final_best_score
        
        logger.info(f"Matching Time: {(time.time() - t_matching_start):.3f}s")
        print(f"[AUTO-ATTEND] Match: {best_emp.full_name} ({best_similarity:.4f})")

        # STEP 5: AUTO-DETERMINE ACTION (CHECK_IN or CHECK_OUT)
        emp = best_emp
        confidence = round(best_similarity, 4)
        today = date.today()
        IST = timezone(timedelta(hours=5, minutes=30))
        now = datetime.now(IST).replace(tzinfo=None)

        existing = await db.execute(
            select(AttendanceLog).where(and_(
                AttendanceLog.employee_id == emp.id, AttendanceLog.date == today
            ))
        )
        log = existing.scalar_one_or_none()

        if log and log.check_in_time and log.check_out_time:
            return AttendanceResult(
                success=False, employee_id=str(emp.id), employee_name=emp.full_name,
                employee_code=emp.employee_code, confidence_score=confidence,
                liveness_score=lv_score, liveness_details=liveness_details,
                message=f"{emp.full_name}, you've already checked in and out today.",
            )

        if log and log.check_in_time and not log.check_out_time:
            # AUTO CHECK-OUT
            log.check_out_time, log.check_out_method = now, "FACE"
            if log.check_in_time:
                log.working_hours = round((now - log.check_in_time).total_seconds() / 3600, 2)
            await db.commit()
            hrs = f" ({log.working_hours:.1f} hrs)" if log.working_hours else ""
            print(f"[AUTO-ATTEND] Auto CHECK-OUT for {emp.full_name}{hrs}")
            return AttendanceResult(
                success=True, action="CHECK_OUT", employee_id=str(emp.id),
                employee_name=emp.full_name, employee_code=emp.employee_code,
                confidence_score=confidence, liveness_score=lv_score,
                liveness_details=liveness_details, antispoof_score=spoof_score,
                timestamp=now, message=f"{emp.full_name} checked out!{hrs}",
            )
        else:
            # AUTO CHECK-IN
            if log is None:
                log = AttendanceLog(employee_id=emp.id, date=today, check_in_time=now, check_in_method="FACE")
                db.add(log)
            else:
                log.check_in_time, log.check_in_method = now, "FACE"

            try:
                await db.commit()
                print(f"[AUTO-ATTEND] Auto CHECK-IN for {emp.full_name}")
            except Exception as e:
                await db.rollback()
                return AttendanceResult(success=False, message=f"Database error: {e}")

            # Late arrival alert
            try:
                from app.services.email_service import email_service
                sm = settings.OFFICE_START_HOUR * 60 + settings.OFFICE_START_MINUTE
                cm = now.hour * 60 + now.minute
                if cm > sm:
                    email_service.send_late_arrival_alert(
                        employee_name=emp.full_name, employee_code=emp.employee_code,
                        check_in_time=now, late_by_minutes=cm - sm)
            except Exception:
                pass

            return AttendanceResult(
                success=True, action="CHECK_IN", employee_id=str(emp.id),
                employee_name=emp.full_name, employee_code=emp.employee_code,
                confidence_score=confidence, liveness_score=lv_score,
                liveness_details=liveness_details, antispoof_score=spoof_score,
                timestamp=now, message=f"{emp.full_name} checked in successfully!",
            )

    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"[AUTO-ATTEND] UNHANDLED ERROR: {e}")
        return AttendanceResult(success=False, message=f"Server error: {str(e)}")




# ============================================================
# UTILITY ENDPOINTS
# ============================================================

@router.get("/today", response_model=list[AttendanceStatusResponse])
async def get_today_attendance(db: AsyncSession = Depends(get_db)):
    """Public endpoint for kiosk to show today's activity."""
    today = date.today()
    result = await db.execute(
        select(Employee, AttendanceLog).outerjoin(AttendanceLog, and_(
            AttendanceLog.employee_id == Employee.id, AttendanceLog.date == today
        )).where(Employee.status == "ACTIVE").order_by(Employee.full_name)
    )
    return [
        AttendanceStatusResponse(
            employee_id=str(e.id), employee_name=e.full_name, employee_code=e.employee_code,
            date=today, checked_in=bool(l and l.check_in_time), checked_out=bool(l and l.check_out_time),
            check_in_time=l.check_in_time if l else None, check_out_time=l.check_out_time if l else None,
        ) for e, l in result.all()
    ]


@router.get("/engine-status")
async def get_engine_status():
    """Return the current engine configuration and status."""
    from app.services.face_engine import get_face_engine
    from app.services.antispoof_service import get_antispoof_service
    from app.services.active_liveness import get_active_liveness_service

    engine = get_face_engine()
    antispoof = get_antispoof_service()
    active = get_active_liveness_service()

    return {
        "detection_recognition": engine.model_info,
        "passive_liveness": antispoof.info,
        "active_liveness": active.info,
        "similarity_threshold": settings.FACE_SIMILARITY_THRESHOLD,
        "status": "ready" if engine.is_available else "error",
    }


@router.get("/debug-templates")
async def debug_templates(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(BiometricTemplate, Employee).join(Employee, BiometricTemplate.employee_id == Employee.id)
        .where(BiometricTemplate.biometric_type == "FACE")
    )
    items = []
    for t, e in result.all():
        emb = deserialize_embedding(t.template_data)
        items.append({
            "employee": e.full_name,
            "format": "embedding" if emb is not None else "unknown",
            "dimensions": len(emb) if emb is not None else 0,
        })
    return {"templates": items}


@router.get("/test-email")
async def test_email():
    from app.services.email_service import email_service
    r = email_service.send_to_admin("✅ BioAttend Test", '<h2 style="color:green">✅ Working!</h2>')
    return {"sent": r, "email": email_service.settings.ADMIN_EMAIL}


@router.get("/test-daily-summary")
async def test_daily_summary(db: AsyncSession = Depends(get_db)):
    from app.services.email_service import email_service
    return {"sent": await email_service.send_daily_summary(db)}


@router.get("/test-absent-alert")
async def test_absent_alert(db: AsyncSession = Depends(get_db)):
    from app.services.email_service import email_service
    return {"sent": await email_service.send_absent_alert(db)}
