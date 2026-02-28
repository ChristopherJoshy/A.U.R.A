# STUB IMPLEMENTATION
# This module contains stub endpoints for call functionality.
# Actual call integration (e.g., Twilio, Vonage) is not yet implemented.

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from typing import Optional
from app.core.firebase import get_current_user_uid

router = APIRouter(prefix="/calls", tags=["calls"])


class CallInitiateRequest(BaseModel):
    phone: str
    relative_id: Optional[str] = None

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        phone = value.strip()
        if not phone:
            raise ValueError("Phone number is required")
        allowed = set("0123456789+ -()")
        if any(ch not in allowed for ch in phone):
            raise ValueError("Phone number contains invalid characters")
        digits = "".join(ch for ch in phone if ch.isdigit())
        if len(digits) < 7:
            raise ValueError("Phone number is too short")
        return phone


#------This Function initiates a call---------
@router.post("/initiate")
async def initiate_call(
    body: CallInitiateRequest,
    uid: str = Depends(get_current_user_uid),
):
    return {
        "status": "initiated",
        "user_uid": uid,
        "phone": body.phone,
        "relative_id": body.relative_id,
        "note": "This is a stub - actual call functionality not yet implemented",
    }
