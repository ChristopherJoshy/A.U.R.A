
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, field_validator
from typing import Optional, List
import httpx
import time
import logging
import re
from datetime import datetime
from app.core.firebase import get_current_user_uid
from app.core.database import get_aura_modules_db, get_aura_events_db
from app.db.aura_modules import AuraModulesDB
from app.db.aura_events import AuraEventsDB
from app.models.journal import JournalEntry
from app.models.user import User, UserRole
from app.utils.access_control import check_patient_access

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/aura", tags=["aura"])


class CircuitBreaker:
    
    def __init__(self, failure_threshold: int = 5, recovery_timeout: int = 30):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.failures = 0
        self.last_failure_time: Optional[float] = None
        self.state = "closed"
        self.cached_response: Optional[dict] = None
    
    def record_success(self):
        self.failures = 0
        self.state = "closed"
        self.cached_response = None
    
    def record_failure(self, cached_response: Optional[dict] = None):
        self.failures += 1
        self.last_failure_time = time.time()
        if cached_response:
            self.cached_response = cached_response
        if self.failures >= self.failure_threshold:
            self.state = "open"
            logger.warning(f"Circuit breaker opened after {self.failures} failures")
    
    def can_execute(self) -> bool:
        if self.state == "closed":
            return True
        if self.state == "open":
            if time.time() - self.last_failure_time >= self.recovery_timeout:
                self.state = "half-open"
                logger.info("Circuit breaker entering half-open state")
                return True
            return False
        return True
    
    def get_state(self) -> dict:
        return {
            "state": self.state,
            "failures": self.failures,
            "failure_threshold": self.failure_threshold,
            "recovery_timeout": self.recovery_timeout,
            "last_failure_time": self.last_failure_time
        }


circuit_breakers: dict[str, CircuitBreaker] = {}


#------This Function gets circuit breaker for patient---------
def get_circuit_breaker(patient_uid: str) -> CircuitBreaker:
    if patient_uid not in circuit_breakers:
        circuit_breakers[patient_uid] = CircuitBreaker()
    return circuit_breakers[patient_uid]


#------This Function resolves target patient UID---------
async def _resolve_target_patient_uid(uid: str, patient_uid: Optional[str]) -> str:
    requester = await User.find_one(User.firebase_uid == uid)
    if not requester:
        raise HTTPException(status_code=404, detail="User not found")

    target_uid = patient_uid
    if not target_uid:
        if requester.role == UserRole.CAREGIVER and requester.linked_patients:
            target_uid = requester.linked_patients[0]
        else:
            target_uid = uid

    has_access = await check_patient_access(uid, target_uid)
    if not has_access:
        raise HTTPException(
            status_code=403,
            detail="You don't have permission to access this patient's module",
        )
    return target_uid


class RegisterRequest(BaseModel):

    patient_uid: str
    ip: str
    port: int = 8001
    hardware_info: Optional[dict] = None


class HeartbeatRequest(BaseModel):

    patient_uid: str


class IdentifyPersonRequest(BaseModel):
    image_base64: Optional[str] = None
    relatives: Optional[List[dict]] = None


class AuraModuleInfo(BaseModel):

    patient_uid: str
    ip: str
    port: int
    status: str
    last_seen: str
    hardware_info: Optional[dict] = None


class IdentifyPersonResponse(BaseModel):

    success: bool
    identified_faces: List[dict] = []
    message: Optional[str] = None


class EventLogRequest(BaseModel):
    patient_uid: str
    event_type: str
    data: dict

    @field_validator('data')
    @classmethod
    def validate_data_structure(cls, v, info):
        
        
        if not isinstance(v, dict):
            raise ValueError('data must be a dictionary')
        return v


class UpdateNameRequest(BaseModel):
    name: str

    @field_validator('name')
    @classmethod
    def validate_name(cls, v, info):
        if not v or not isinstance(v, str):
            raise ValueError('name must be a non-empty string')
        if len(v) > 100:
            raise ValueError('name must be at most 100 characters')
        if not re.match(r'^[a-zA-Z0-9\s]+$', v):
            raise ValueError('name must contain only alphanumeric characters and spaces')
        return v.strip()


#------This Function validates event payload---------
def _validate_event_payload(body: EventLogRequest) -> None:
    if body.event_type == "face_detection":
        required_keys = ["detected_faces"]
        missing_keys = [k for k in required_keys if k not in body.data]
        if missing_keys:
            raise HTTPException(
                status_code=400,
                detail=f"Missing required keys in data: {missing_keys}. Required: detected_faces",
            )
    elif body.event_type == "conversation":
        if not any(k in body.data for k in ["transcript", "extracted_events", "mood"]):
            raise HTTPException(
                status_code=400,
                detail="Missing required data. For conversation events, provide at least one of: transcript, extracted_events, mood",
            )
    elif body.event_type == "conversation_summary":
        required_keys = ["summary"]
        missing_keys = [k for k in required_keys if k not in body.data]
        if missing_keys:
            raise HTTPException(
                status_code=400,
                detail=f"Missing required keys in data: {missing_keys}. Required: summary",
            )
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown event type: {body.event_type}",
        )


#------This Function stores event and journal---------
async def _store_event_and_journal(
    body: EventLogRequest,
    aura_events_db: AuraEventsDB,
    aura_modules_db: AuraModulesDB,
) -> dict:
    module = await aura_modules_db.get_module(body.patient_uid)
    if not module:
        raise HTTPException(
            status_code=404,
            detail=f"Module not found for patient {body.patient_uid}",
        )

    module_id = module["_id"]

    if body.event_type == "face_detection":
        event_id = await aura_events_db.log_face_detection(
            patient_uid=body.patient_uid,
            module_id=module_id,
            detected_faces=body.data.get("detected_faces", []),
        )
    elif body.event_type == "conversation":
        event_id = await aura_events_db.log_conversation(
            patient_uid=body.patient_uid,
            module_id=module_id,
            transcript=body.data.get("transcript", ""),
            extracted_events=body.data.get("extracted_events", []),
            mood=body.data.get("mood", ""),
        )
    elif body.event_type == "conversation_summary":
        summary = (body.data.get("summary") or "").strip()
        transcript_count = int(body.data.get("transcript_count") or 0)
        event_id = await aura_events_db.log_conversation_summary(
            patient_uid=body.patient_uid,
            module_id=module_id,
            summary=summary,
            transcript_count=transcript_count,
        )

        if summary:
            journal_entry = JournalEntry(
                patient_uid=body.patient_uid,
                content=summary,
                source="voice",
                mood=body.data.get("mood", "") or "",
                speaker_tags=[],
                extracted_events=[],
                ai_summary=summary,
                event_datetime=datetime.utcnow(),
            )
            await journal_entry.insert()
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown event type: {body.event_type}",
        )

    return {
        "status": "logged",
        "event_id": event_id,
        "event_type": body.event_type,
    }




#------This Function registers a module---------
@router.post("/register")
async def register_module(
    body: RegisterRequest,
    uid: str = Depends(get_current_user_uid),
    aura_modules_db: AuraModulesDB = Depends(get_aura_modules_db),
):
    
    if uid != body.patient_uid:
        raise HTTPException(
            status_code=403,
            detail="You can only register a module for your own account",
        )
    
    try:
        module = await aura_modules_db.upsert_module(
            patient_uid=body.patient_uid,
            ip=body.ip,
            port=body.port,
            hardware_info=body.hardware_info,
        )

        return {
            "status": "registered",
            "module": module,
            "message": f"Module registered for patient {body.patient_uid}",
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to register module: {str(e)}",
        )


#------This Function registers module from device---------
@router.post("/device/register")
async def register_module_from_device(
    body: RegisterRequest,
    aura_modules_db: AuraModulesDB = Depends(get_aura_modules_db),
):
    try:
        module = await aura_modules_db.upsert_module(
            patient_uid=body.patient_uid,
            ip=body.ip,
            port=body.port,
            hardware_info=body.hardware_info,
        )
        return {
            "status": "registered",
            "module": module,
            "message": f"Module registered for patient {body.patient_uid}",
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to register module: {str(e)}",
        )


#------This Function handles heartbeat---------
@router.post("/heartbeat")
async def heartbeat(
    body: HeartbeatRequest,
    uid: str = Depends(get_current_user_uid),
    aura_modules_db: AuraModulesDB = Depends(get_aura_modules_db),
):
    
    if uid != body.patient_uid:
        raise HTTPException(
            status_code=403,
            detail="You can only update heartbeat for your own module",
        )
    
    try:
        success = await aura_modules_db.update_heartbeat(body.patient_uid)

        if not success:
            raise HTTPException(
                status_code=404,
                detail=f"Module not found for patient {body.patient_uid}. Please register first.",
            )

        return {"status": "ok", "message": "Heartbeat updated"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update heartbeat: {str(e)}",
        )


#------This Function handles heartbeat from device---------
@router.post("/device/heartbeat")
async def heartbeat_from_device(
    body: HeartbeatRequest,
    aura_modules_db: AuraModulesDB = Depends(get_aura_modules_db),
):
    try:
        module = await aura_modules_db.get_module(body.patient_uid)
        if not module:
            raise HTTPException(
                status_code=404,
                detail=f"Module not found for patient {body.patient_uid}. Please register first.",
            )

        success = await aura_modules_db.update_heartbeat(body.patient_uid)

        if not success:
            raise HTTPException(
                status_code=404,
                detail=f"Module not found for patient {body.patient_uid}. Please register first.",
            )

        return {"status": "ok", "message": "Heartbeat updated"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update heartbeat: {str(e)}",
        )


#------This Function returns pairing context---------
@router.get("/pairing/context")
async def get_pairing_context(
    request: Request,
    patient_uid: Optional[str] = Query(default=None),
    uid: str = Depends(get_current_user_uid),
):
    target_uid = await _resolve_target_patient_uid(uid, patient_uid)
    backend_url = str(request.base_url).rstrip("/")
    return {
        "patient_uid": target_uid,
        "backend_url": backend_url,
    }


#------This Function discovers modules---------
@router.get("/discover")
async def discover_modules(
    status: Optional[str] = "online",
    patient_uid: Optional[str] = None,
    uid: str = Depends(get_current_user_uid),
    aura_modules_db: AuraModulesDB = Depends(get_aura_modules_db),
):
    normalized_status = (status or "").strip().lower()
    if normalized_status not in ("online", "offline", "all", ""):
        raise HTTPException(
            status_code=400,
            detail="status must be one of: online, offline, all",
        )
    if normalized_status in ("all", ""):
        normalized_status = None

    requester = await User.find_one(User.firebase_uid == uid)
    if not requester:
        raise HTTPException(status_code=404, detail="User not found")

    if patient_uid:
        has_access = await check_patient_access(uid, patient_uid)
        if not has_access:
            raise HTTPException(
                status_code=403,
                detail="You don't have permission to access this patient's module",
            )

        module = await aura_modules_db.get_module(patient_uid)
        modules = []
        if module and (normalized_status is None or module.get("status") == normalized_status):
            modules.append(module)
        return {"modules": modules, "count": len(modules)}

    if requester.role == UserRole.ADMIN:
        modules = await aura_modules_db.list_modules(status=normalized_status, limit=100)
        return {"modules": modules, "count": len(modules)}

    target_uids: List[str] = []
    if requester.role == UserRole.CAREGIVER:
        target_uids.extend(requester.linked_patients or [])
        target_uids.append(uid)
    else:
        target_uids.append(uid)

    modules: List[dict] = []
    seen_uids = set()
    for target_uid in target_uids:
        if not target_uid or target_uid in seen_uids:
            continue
        seen_uids.add(target_uid)
        module = await aura_modules_db.get_module(target_uid)
        if not module:
            continue
        if normalized_status is not None and module.get("status") != normalized_status:
            continue
        modules.append(module)

    return {"modules": modules, "count": len(modules)}


#------This Function gets module---------
@router.get("/module/{patient_uid}")
async def get_module(
    patient_uid: str,
    uid: str = Depends(get_current_user_uid),
    aura_modules_db: AuraModulesDB = Depends(get_aura_modules_db),
):
    
    has_access = await check_patient_access(uid, patient_uid)
    if not has_access:
        raise HTTPException(
            status_code=403,
            detail="You don't have permission to access this patient's module",
        )
    
    try:
        module = await aura_modules_db.get_module(patient_uid)

        if not module:
            raise HTTPException(
                status_code=404,
                detail=f"No module found for patient {patient_uid}",
            )

        return module
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get module: {str(e)}",
        )


#------This Function updates module name---------
@router.patch("/module/{patient_uid}/name")
async def update_module_name(
    patient_uid: str,
    body: UpdateNameRequest,
    uid: str = Depends(get_current_user_uid),
    aura_modules_db: AuraModulesDB = Depends(get_aura_modules_db),
):
    
    has_access = await check_patient_access(uid, patient_uid)
    if not has_access:
        raise HTTPException(
            status_code=403,
            detail="You don't have permission to update this module's name",
        )
    
    try:
        module = await aura_modules_db.update_name(patient_uid, body.name)

        if not module:
            raise HTTPException(
                status_code=404,
                detail=f"No module found for patient {patient_uid}",
            )

        return {
            "status": "updated",
            "module": module,
            "message": f"Module name updated to '{body.name}'",
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update module name: {str(e)}",
        )


@router.post("/identify_person")
async def identify_person(
    body: IdentifyPersonRequest,
    request: Request,
    uid: str = Depends(get_current_user_uid),
    aura_modules_db: AuraModulesDB = Depends(get_aura_modules_db),
):
    cb = get_circuit_breaker(uid)

    if not cb.can_execute():
        if cb.cached_response:
            logger.info(f"Returning cached response for patient {uid[:8]}...")
            return {
                **cb.cached_response,
                "from_cache": True,
                "circuit_breaker_state": cb.state
            }
        raise HTTPException(
            status_code=503,
            detail=f"AuraModule is currently unavailable (circuit open). Please try again later.",
        )
    
    module = await aura_modules_db.get_module(uid)

    if not module:
        raise HTTPException(
            status_code=404,
            detail=f"No module registered for your account. Please ensure AuraModule is running and registered.",
        )

    if module["status"] != "online":
        raise HTTPException(
            status_code=503,
            detail=f"Your AuraModule is currently offline. Please check the module connection.",
        )

    
    module_url = f"http://{module['ip']}:{module['port']}/identify_person"

    payload = {"patient_uid": uid}
    if body.image_base64:
        payload["image_base64"] = body.image_base64
    
    if body.relatives:
        payload["relatives"] = body.relatives

    auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
    if auth_header:
        if auth_header.lower().startswith("bearer "):
            payload["auth_token"] = auth_header[7:].strip()
        else:
            payload["auth_token"] = auth_header.strip()

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(module_url, json=payload)

            if response.status_code != 200:
                cb.record_failure()
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"AuraModule returned error: {response.text}",
                )
            
            cb.record_success()
            result = response.json()
            return {
                **result,
                "circuit_breaker_state": cb.state
            }

    except httpx.ConnectError:
        cb.record_failure({"success": False, "message": "Connection failed", "identified_faces": []})
        
        await aura_modules_db.upsert_module(
            patient_uid=uid,
            ip=module["ip"],
            port=module["port"],
            hardware_info=module.get("hardware_info"),
        )
        raise HTTPException(
            status_code=502,
            detail=f"Cannot reach AuraModule at {module['ip']}:{module['port']}",
        )

    except httpx.TimeoutException:
        cb.record_failure({"success": False, "message": "Request timed out", "identified_faces": []})
        raise HTTPException(
            status_code=504,
            detail="AuraModule face recognition timed out (>30s)",
        )
    
    except HTTPException:
        raise
    except Exception as e:
        cb.record_failure({"success": False, "message": str(e), "identified_faces": []})
        raise HTTPException(
            status_code=500,
            detail=f"Failed to identify person: {str(e)}",
        )


@router.get("/live_context")
async def get_live_context(
    patient_uid: Optional[str] = Query(default=None),
    uid: str = Depends(get_current_user_uid),
    aura_modules_db: AuraModulesDB = Depends(get_aura_modules_db),
):
    target_uid = await _resolve_target_patient_uid(uid, patient_uid)
    module = await aura_modules_db.get_module(target_uid)
    if not module:
        raise HTTPException(
            status_code=404,
            detail=f"No module found for patient {target_uid}",
        )

    if module.get("status") != "online":
        raise HTTPException(
            status_code=503,
            detail=f"Aura module for patient {target_uid} is offline",
        )

    base_url = f"http://{module['ip']}:{module['port']}"
    latest_transcript = {
        "text": "",
        "timestamp": None,
        "analysis": {},
    }

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            transcript_response = await client.get(f"{base_url}/latest_transcript")
            if transcript_response.status_code == 200:
                payload = transcript_response.json() or {}
                latest_transcript = {
                    "text": payload.get("text", "") or "",
                    "timestamp": payload.get("timestamp"),
                    "analysis": payload.get("analysis") or {},
                }
    except Exception:
        pass

    return {
        "connected": True,
        "patient_uid": target_uid,
        "snapshot_url": f"{base_url}/snapshot",
        "video_feed_url": f"{base_url}/video_feed",
        "latest_transcript": latest_transcript,
    }


@router.post("/log_event")
async def log_event(
    body: EventLogRequest,
    uid: str = Depends(get_current_user_uid),
    aura_events_db: AuraEventsDB = Depends(get_aura_events_db),
    aura_modules_db: AuraModulesDB = Depends(get_aura_modules_db),
):
    
    if uid != body.patient_uid:
        raise HTTPException(
            status_code=403,
            detail="You can only log events for your own module",
        )

    _validate_event_payload(body)

    try:
        return await _store_event_and_journal(body, aura_events_db, aura_modules_db)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to log event: {str(e)}",
        )


@router.post("/device/log_event")
async def log_event_from_module(
    body: EventLogRequest,
    aura_events_db: AuraEventsDB = Depends(get_aura_events_db),
    aura_modules_db: AuraModulesDB = Depends(get_aura_modules_db),
):
    _validate_event_payload(body)

    try:
        module = await aura_modules_db.get_module(body.patient_uid)
        if not module:
            raise HTTPException(
                status_code=404,
                detail=f"Module not found for patient {body.patient_uid}",
            )

        return await _store_event_and_journal(body, aura_events_db, aura_modules_db)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to log event: {str(e)}",
        )


@router.get("/events/{patient_uid}")
async def get_events(
    patient_uid: str,
    event_type: Optional[str] = None,
    limit: int = 100,
    uid: str = Depends(get_current_user_uid),
    aura_events_db: AuraEventsDB = Depends(get_aura_events_db),
):
    
    has_access = await check_patient_access(uid, patient_uid)
    if not has_access:
        raise HTTPException(
            status_code=403,
            detail="You don't have permission to access this patient's events",
        )
    
    try:
        events = await aura_events_db.get_events(
            patient_uid=patient_uid,
            event_type=event_type,
            limit=limit,
        )

        return {
            "events": events,
            "count": len(events),
            "patient_uid": patient_uid,
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve events: {str(e)}",
        )


@router.delete("/module/{patient_uid}")
async def unregister_module(
    patient_uid: str,
    uid: str = Depends(get_current_user_uid),
    aura_modules_db: AuraModulesDB = Depends(get_aura_modules_db),
):
    
    has_access = await check_patient_access(uid, patient_uid)
    if not has_access:
        raise HTTPException(
            status_code=403,
            detail="You don't have permission to unregister this module",
        )
    
    try:
        success = await aura_modules_db.delete_module(patient_uid)

        if not success:
            raise HTTPException(
                status_code=404,
                detail=f"Module not found for patient {patient_uid}",
            )

        return {
            "status": "unregistered",
            "message": f"Module unregistered for patient {patient_uid}",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to unregister module: {str(e)}",
        )


@router.get("/circuit_breaker/{patient_uid}")
async def get_circuit_breaker_state(
    patient_uid: str,
    uid: str = Depends(get_current_user_uid),
):
    
    has_access = await check_patient_access(uid, patient_uid)
    if not has_access:
        raise HTTPException(
            status_code=403,
            detail="You don't have permission to access this patient's circuit breaker",
        )
    
    cb = get_circuit_breaker(patient_uid)
    return cb.get_state()


@router.post("/circuit_breaker/{patient_uid}/reset")
async def reset_circuit_breaker(
    patient_uid: str,
    uid: str = Depends(get_current_user_uid),
):
    
    has_access = await check_patient_access(uid, patient_uid)
    if not has_access:
        raise HTTPException(
            status_code=403,
            detail="You don't have permission to reset this patient's circuit breaker",
        )
    
    cb = get_circuit_breaker(patient_uid)
    cb.record_success()
    
    return {
        "status": "reset",
        "circuit_breaker_state": cb.get_state(),
        "message": f"Circuit breaker reset for patient {patient_uid}",
    }


@router.get("/health")
async def health_check(
    uid: Optional[str] = None,
    aura_modules_db: AuraModulesDB = Depends(get_aura_modules_db),
):
    try:
        if uid:
            module = await aura_modules_db.get_module(uid)
            if not module:
                return {
                    "status": "not_registered",
                    "message": f"No module registered for uid {uid}",
                }
            
            await aura_modules_db.update_heartbeat(uid)
            
            return {
                "status": "healthy",
                "module": module,
            }
        
        modules = await aura_modules_db.list_modules(status="online", limit=100)
        return {
            "status": "ok",
            "online_modules": len(modules),
            "modules": [{"patient_uid": m["patient_uid"], "ip": m["ip"], "port": m["port"]} for m in modules],
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Health check failed: {str(e)}",
        )
