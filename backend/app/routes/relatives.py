from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional, List
from app.core.firebase import get_current_user_uid
from app.core.database import get_aura_modules_db
from app.db.aura_modules import AuraModulesDB
from app.models.relative import Relative
from app.models.user import User
import base64
import httpx

router = APIRouter(prefix="/relatives", tags=["relatives"])


class RelativeCreate(BaseModel):
    name: str
    relationship: str = ""
    phone: str = ""
    notes: str = ""


class RelativeUpdate(BaseModel):
    name: Optional[str] = None
    relationship: Optional[str] = None
    phone: Optional[str] = None
    photos: Optional[List[str]] = None
    notes: Optional[str] = None


#------This Function lists relatives---------
@router.get("/")
async def list_relatives(uid: str = Depends(get_current_user_uid)):
    relatives = await Relative.find(Relative.patient_uid == uid).to_list()
    return [_serialize(r) for r in relatives]


#------This Function gets relative---------
@router.get("/{rel_id}")
async def get_relative(rel_id: str, uid: str = Depends(get_current_user_uid)):
    rel = await Relative.get(rel_id)
    if not rel or rel.patient_uid != uid:
        raise HTTPException(status_code=404, detail="Not found")
    return _serialize(rel)


#------This Function creates relative---------
@router.post("/")
async def create_relative(
    body: RelativeCreate, uid: str = Depends(get_current_user_uid)
):
    rel = Relative(patient_uid=uid, **body.model_dump())
    await rel.insert()
    return _serialize(rel)


#------This Function updates relative---------
@router.put("/{rel_id}")
async def update_relative(
    rel_id: str, body: RelativeUpdate, uid: str = Depends(get_current_user_uid)
):
    rel = await Relative.get(rel_id)
    if not rel or rel.patient_uid != uid:
        raise HTTPException(status_code=404, detail="Not found")
    updates = body.model_dump(exclude_none=True)
    for k, v in updates.items():
        setattr(rel, k, v)
    await rel.save()
    return _serialize(rel)


#------This Function uploads photo---------
@router.post("/{rel_id}/photo")
async def upload_photo(
    rel_id: str,
    file: UploadFile = File(...),
    uid: str = Depends(get_current_user_uid),
    aura_modules_db: AuraModulesDB = Depends(get_aura_modules_db),
):
    rel = await Relative.get(rel_id)
    if not rel or rel.patient_uid != uid:
        raise HTTPException(status_code=404, detail="Not found")

    contents = await file.read()
    b64 = base64.b64encode(contents).decode("utf-8")
    photo_url = f"data:{file.content_type};base64,{b64}"
    rel.photos.append(photo_url)

    user = await User.find_one(User.firebase_uid == uid)
    if user and user.aura_module_ip:
        module_port = 8001
        module = await aura_modules_db.get_module(uid)
        if module and module.get("port"):
            module_port = module["port"]
        
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"http://{user.aura_module_ip}:{module_port}/extract_face",
                    json={"image_b64": b64},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get("embeddings"):
                        rel.face_embeddings.extend(data["embeddings"])
                        print(
                            f"[RELATIVES] Extracted {len(data['embeddings'])} face embeddings"
                        )
        except Exception as e:
            print(f"[RELATIVES] Failed to extract face embeddings: {e}")

    await rel.save()
    return {
        "status": "ok",
        "photo_count": len(rel.photos),
        "embeddings_count": len(rel.face_embeddings),
    }


#------This Function updates embeddings---------
@router.put("/{rel_id}/embeddings")
async def update_embeddings(
    rel_id: str,
    embeddings: List[List[float]],
    uid: str = Depends(get_current_user_uid),
):
    rel = await Relative.get(rel_id)
    if not rel or rel.patient_uid != uid:
        raise HTTPException(status_code=404, detail="Not found")
    rel.face_embeddings = embeddings
    await rel.save()
    return {"status": "ok"}


#------This Function deletes relative---------
@router.delete("/{rel_id}")
async def delete_relative(rel_id: str, uid: str = Depends(get_current_user_uid)):
    rel = await Relative.get(rel_id)
    if not rel or rel.patient_uid != uid:
        raise HTTPException(status_code=404, detail="Not found")
    await rel.delete()
    return {"status": "ok"}


def _serialize(rel: Relative) -> dict:
    return {
        "id": str(rel.id),
        "name": rel.name,
        "relationship": rel.relationship,
        "phone": rel.phone,
        "photos": rel.photos,
        "face_embeddings": rel.face_embeddings,
        "photo_count": len(rel.photos),
        "has_embeddings": len(rel.face_embeddings) > 0,
        "notes": rel.notes,
        "created_at": rel.created_at.isoformat(),
    }
