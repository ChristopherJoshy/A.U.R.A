import os
import logging
from pydantic_settings import BaseSettings
from pydantic import field_validator

logger = logging.getLogger(__name__)


#------This Class handles the Settings Configuration---------
class Settings(BaseSettings):
    backend_url: str = "http://localhost:8001"
    patient_uid: str = ""
    backend_auth_token: str = ""
    hf_token: str = ""
    camera_index: int = 0
    ws_port: int = 8001
    http_port: int = 8001
    discovery_port: int = 5353
    whisper_model: str = "base"
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:7b"
    face_confidence_threshold: float = 0.4
    heartbeat_interval: int = 40
    backend_timeout: float = 10.0
    backend_retry_delay: float = 5.0
    backend_max_retries: int = 10
    websocket_timeout: float = 300.0
    demo_mode: bool = False
    auto_face_recognition_enabled: bool = False
    auto_face_recognition_interval: int = 30

#------This Function validates the patient UID---------
    @field_validator("patient_uid")
    @classmethod
    def validate_patient_uid(cls, v: str) -> str:
        if not v or v.strip() == "":
            logger.warning(
                "PATIENT_UID is not set. Using empty string - "
                "registration with backend may fail."
            )
        return v

#------This Function validates the backend URL---------
    @field_validator("backend_url")
    @classmethod
    def validate_backend_url(cls, v: str) -> str:
        if not v.startswith(("http://", "https://")):
            raise ValueError("backend_url must start with http:// or https://")
        return v.rstrip("/")

#------This Function validates the face threshold---------
    @field_validator("face_confidence_threshold")
    @classmethod
    def validate_face_threshold(cls, v: float) -> float:
        if not 0.0 <= v <= 1.0:
            raise ValueError("face_confidence_threshold must be between 0.0 and 1.0")
        return v

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

#------This Function validates required settings---------
    def validate_required_settings(self) -> bool:
        errors = []
        
        if not self.patient_uid:
            errors.append("PATIENT_UID is required but not set")
        
        if not self.backend_url:
            errors.append("BACKEND_URL is required but not set")
        
        if errors:
            for error in errors:
                logger.error(f"Configuration error: {error}")
            return False
        
        return True



settings = Settings()


logger.info(f"Configuration loaded:")
logger.info(f"  backend_url: {settings.backend_url}")
logger.info(f"  patient_uid: {settings.patient_uid[:8] + '...' if settings.patient_uid else 'NOT SET'}")
logger.info(f"  http_port: {settings.http_port}")
logger.info(f"  demo_mode: {settings.demo_mode}")
logger.info(f"  face_confidence_threshold: {settings.face_confidence_threshold}")
logger.info(f"  auto_face_recognition_enabled: {settings.auto_face_recognition_enabled}")
logger.info(f"  auto_face_recognition_interval: {settings.auto_face_recognition_interval}s")
