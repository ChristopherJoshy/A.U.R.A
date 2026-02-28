import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, List
from datetime import datetime, timedelta
from collections import Counter
from pydantic import BaseModel, field_validator

from app.core.firebase import get_current_user_uid
from app.models.user import User, UserRole
from app.models.journal import JournalEntry
from app.models.medication import Medication
from app.models.sos import SOSEvent
from app.models.orito_interaction import OritoInteraction
from app.models.suggestion import Suggestion, SuggestionType

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/reports", tags=["reports"])


class SendEncouragementRequest(BaseModel):
    message: str
    patient_uid: Optional[str] = None
    priority: int = 3
    title: Optional[str] = None

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("Message cannot be empty")
        if len(text) > 500:
            raise ValueError("Message cannot exceed 500 characters")
        return text

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, value: int) -> int:
        if value < 1 or value > 5:
            raise ValueError("Priority must be between 1 and 5")
        return value


#------This Function gets daily report---------
@router.get("/daily")
async def get_daily_report(
    date: Optional[str] = Query(None, description="Date in YYYY-MM-DD format"),
    patient_uid: Optional[str] = None,
    uid: str = Depends(get_current_user_uid),
):
    try:
        target_uid = patient_uid or uid
        await _verify_access(uid, target_uid)
        if date:
            try:
                target_date = datetime.strptime(date, "%Y-%m-%d")
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
        else:
            target_date = datetime.utcnow()
        start_of_day = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = start_of_day + timedelta(days=1)
        medications = await Medication.find(
            Medication.patient_uid == target_uid,
            Medication.is_active == True,
        ).to_list()
        meds_taken_today = 0
        total_scheduled = 0
        for med in medications:
            total_scheduled += len(med.schedule_times) if med.schedule_times else 1
            if med.last_taken and start_of_day <= med.last_taken < end_of_day:
                meds_taken_today += 1
        journal_entries = await JournalEntry.find(
            JournalEntry.patient_uid == target_uid,
            JournalEntry.created_at >= start_of_day,
            JournalEntry.created_at < end_of_day,
        ).to_list()
        interactions = await OritoInteraction.find(
            OritoInteraction.user_uid == target_uid,
            OritoInteraction.created_at >= start_of_day,
            OritoInteraction.created_at < end_of_day,
        ).to_list()
        suggestions = await Suggestion.find(
            Suggestion.user_uid == target_uid,
            Suggestion.created_at >= start_of_day,
            Suggestion.created_at < end_of_day,
        ).to_list()
        
        suggestions_accepted = sum(1 for s in suggestions if s.status.value in ["completed", "confirmed"])
        suggestions_dismissed = sum(1 for s in suggestions if s.status.value == "dismissed")
        
        return {
            "date": start_of_day.strftime("%Y-%m-%d"),
            "steps": 0,
            "medicationsTaken": meds_taken_today,
            "medicationsTotal": total_scheduled,
            "conversations": len(interactions),
            "journalEntries": len(journal_entries),
            "suggestionsAccepted": suggestions_accepted,
            "suggestionsDismissed": suggestions_dismissed,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get daily report: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve daily report")


#------This Function gets daily summary---------
@router.get("/daily-summary")
async def get_daily_summary(
    date: Optional[str] = Query(None, description="Date in YYYY-MM-DD format"),
    patient_uid: Optional[str] = None,
    uid: str = Depends(get_current_user_uid),
):
    target_uid = await _resolve_target_uid(uid, patient_uid)
    await _verify_access(uid, target_uid)

    if date:
        try:
            target_date = datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    else:
        target_date = datetime.utcnow()

    start_of_day = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + timedelta(days=1)

    medications = await Medication.find(
        Medication.patient_uid == target_uid,
        Medication.is_active == True,
    ).to_list()

    meds_taken = 0
    total_meds = 0
    for med in medications:
        total_meds += len(med.schedule_times) if med.schedule_times else 1
        if med.last_taken and start_of_day <= med.last_taken < end_of_day:
            meds_taken += 1

    conversations = await OritoInteraction.find(
        OritoInteraction.user_uid == target_uid,
        OritoInteraction.created_at >= start_of_day,
        OritoInteraction.created_at < end_of_day,
    ).count()

    journal_entries = await JournalEntry.find(
        JournalEntry.patient_uid == target_uid,
        JournalEntry.created_at >= start_of_day,
        JournalEntry.created_at < end_of_day,
    ).count()

    return {
        "date": start_of_day.strftime("%Y-%m-%d"),
        "patient_uid": target_uid,
        "meds_taken": meds_taken,
        "total_meds": total_meds,
        "conversations": conversations,
        "journal_entries": journal_entries,
    }


#------This Function gets emotion report---------
@router.get("/emotions")
async def get_emotion_report(
    days: int = Query(default=7, ge=1, le=30),
    patient_uid: Optional[str] = None,
    uid: str = Depends(get_current_user_uid),
):
    try:
        target_uid = patient_uid or uid
        await _verify_access(uid, target_uid)
        end_date = datetime.utcnow()
        start_date = end_date - timedelta(days=days)
        journal_entries = await JournalEntry.find(
            JournalEntry.patient_uid == target_uid,
            JournalEntry.created_at >= start_date,
            JournalEntry.created_at < end_date,
            JournalEntry.mood != "",
        ).to_list()
        interactions = await OritoInteraction.find(
            OritoInteraction.user_uid == target_uid,
            OritoInteraction.created_at >= start_date,
            OritoInteraction.created_at < end_date,
        ).to_list()
        emotion_counts: Counter = Counter()
        for entry in journal_entries:
            if entry.mood:
                emotion_counts[entry.mood.lower()] += 1
        for interaction in interactions:
            for emotion in interaction.emotions_detected:
                emotion_counts[emotion.lower()] += 1
        total = sum(emotion_counts.values())
        emotions = []
        for emotion, count in emotion_counts.most_common(6):
            emotions.append({
                "emotion": emotion.capitalize(),
                "count": count,
                "percentage": round((count / total) * 100) if total > 0 else 0,
            })
        mid_date = start_date + timedelta(days=days // 2)
        first_half_count = sum(
            1 for e in journal_entries
            if e.created_at < mid_date and e.mood
        ) + sum(
            1 for i in interactions
            if i.created_at < mid_date and i.emotions_detected
        )
        
        second_half_count = sum(
            1 for e in journal_entries
            if e.created_at >= mid_date and e.mood
        ) + sum(
            1 for i in interactions
            if i.created_at >= mid_date and i.emotions_detected
        )
        positive_emotions = {"happy", "calm", "excited", "content", "joyful", "grateful"}
        negative_emotions = {"sad", "anxious", "angry", "frustrated", "confused", "worried"}

        positive_count = sum(count for emotion, count in emotion_counts.items() if emotion in positive_emotions)
        negative_count = sum(count for emotion, count in emotion_counts.items() if emotion in negative_emotions)

        if positive_count > negative_count * 1.2:
            trend = "improving"
            change = round(((positive_count / max(negative_count, 1)) - 1) * 10)
        elif negative_count > positive_count * 1.2:
            trend = "declining"
            change = -round(((negative_count / max(positive_count, 1)) - 1) * 10)
        else:
            trend = "stable"
            change = 0
        
        return {
            "emotions": emotions,
            "trend": {
                "trend": trend,
                "change": change,
            },
            "period": f"{days} days",
            "totalEntries": total,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get emotion report: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve emotion report")


#------This Function gets timeline---------
@router.get("/timeline")
async def get_timeline(
    date: Optional[str] = Query(None, description="Date in YYYY-MM-DD format"),
    patient_uid: Optional[str] = None,
    uid: str = Depends(get_current_user_uid),
):
    try:
        target_uid = patient_uid or uid
        await _verify_access(uid, target_uid)
        if date:
            try:
                target_date = datetime.strptime(date, "%Y-%m-%d")
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
        else:
            target_date = datetime.utcnow()

        start_of_day = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = start_of_day + timedelta(days=1)

        events = []
        medications = await Medication.find(
            Medication.patient_uid == target_uid,
        ).to_list()

        for med in medications:
            if med.last_taken and start_of_day <= med.last_taken < end_of_day:
                events.append({
                    "time": med.last_taken.strftime("%I:%M %p"),
                    "type": "medication",
                    "description": f"Took {med.name}",
                    "timestamp": med.last_taken.isoformat(),
                })

        journal_entries = await JournalEntry.find(
            JournalEntry.patient_uid == target_uid,
            JournalEntry.created_at >= start_of_day,
            JournalEntry.created_at < end_of_day,
        ).to_list()

        for entry in journal_entries:
            events.append({
                "time": entry.created_at.strftime("%I:%M %p"),
                "type": "journal",
                "description": f"Journal entry: {entry.content[:50]}..." if len(entry.content) > 50 else f"Journal entry: {entry.content}",
                "timestamp": entry.created_at.isoformat(),
            })

        interactions = await OritoInteraction.find(
            OritoInteraction.user_uid == target_uid,
            OritoInteraction.created_at >= start_of_day,
            OritoInteraction.created_at < end_of_day,
        ).to_list()

        for interaction in interactions:
            events.append({
                "time": interaction.created_at.strftime("%I:%M %p"),
                "type": "conversation",
                "description": f"Chatted with Orito",
                "timestamp": interaction.created_at.isoformat(),
            })

        sos_events = await SOSEvent.find(
            SOSEvent.patient_uid == target_uid,
            SOSEvent.created_at >= start_of_day,
            SOSEvent.created_at < end_of_day,
        ).to_list()

        for sos in sos_events:
            events.append({
                "time": sos.created_at.strftime("%I:%M %p"),
                "type": "sos",
                "description": f"SOS triggered - Level {sos.level}",
                "timestamp": sos.created_at.isoformat(),
            })

        events.sort(key=lambda x: x["timestamp"])

        morning_events = [e for e in events if 6 <= datetime.fromisoformat(e["timestamp"]).hour < 12]
        afternoon_events = [e for e in events if 12 <= datetime.fromisoformat(e["timestamp"]).hour < 18]
        evening_events = [e for e in events if 18 <= datetime.fromisoformat(e["timestamp"]).hour < 24]
        night_events = [e for e in events if 0 <= datetime.fromisoformat(e["timestamp"]).hour < 6]
        
        return {
            "date": start_of_day.strftime("%Y-%m-%d"),
            "periods": [
                {
                    "period": "Morning (6AM - 12PM)",
                    "steps": 0,
                    "events": morning_events,
                },
                {
                    "period": "Afternoon (12PM - 6PM)",
                    "steps": 0,
                    "events": afternoon_events,
                },
                {
                    "period": "Evening (6PM - 12AM)",
                    "steps": 0,
                    "events": evening_events,
                },
                {
                    "period": "Night (12AM - 6AM)",
                    "steps": 0,
                    "events": night_events,
                },
            ],
            "totalEvents": len(events),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get timeline: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve timeline")


#------This Function gets weekly comparison---------
@router.get("/weekly")
async def get_weekly_comparison(
    patient_uid: Optional[str] = None,
    uid: str = Depends(get_current_user_uid),
):
    try:
        target_uid = patient_uid or uid
        await _verify_access(uid, target_uid)
        now = datetime.utcnow()
        this_week_end = now
        this_week_start = now - timedelta(days=7)

        last_week_end = this_week_start
        last_week_start = this_week_start - timedelta(days=7)

        this_week_meds = await _get_medication_adherence(target_uid, this_week_start, this_week_end)
        this_week_interactions = await OritoInteraction.find(
            OritoInteraction.user_uid == target_uid,
            OritoInteraction.created_at >= this_week_start,
            OritoInteraction.created_at < this_week_end,
        ).to_list()

        last_week_meds = await _get_medication_adherence(target_uid, last_week_start, last_week_end)
        last_week_interactions = await OritoInteraction.find(
            OritoInteraction.user_uid == target_uid,
            OritoInteraction.created_at >= last_week_start,
            OritoInteraction.created_at < last_week_end,
        ).to_list()

        this_week_social = len(this_week_interactions)
        last_week_social = len(last_week_interactions)

        med_change = this_week_meds - last_week_meds
        social_change = round(((this_week_social - last_week_social) / max(last_week_social, 1)) * 100)

        return {
            "thisWeek": {
                "steps": 0,
                "medicationAdherence": this_week_meds,
                "socialInteractions": this_week_social,
            },
            "lastWeek": {
                "steps": 0,
                "medicationAdherence": last_week_meds,
                "socialInteractions": last_week_social,
            },
            "stepsChange": 0,
            "medicationAdherenceChange": med_change,
            "socialInteractionsChange": social_change,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get weekly comparison: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve weekly comparison")


#------This Function gets behavior alerts---------
@router.get("/alerts")
async def get_behavior_alerts(
    patient_uid: Optional[str] = None,
    uid: str = Depends(get_current_user_uid),
):
    try:
        target_uid = patient_uid or uid
        await _verify_access(uid, target_uid)

        alerts = []
        now = datetime.utcnow()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

        medications = await Medication.find(
            Medication.patient_uid == target_uid,
            Medication.is_active == True,
        ).to_list()

        missed_meds = []
        for med in medications:
            if med.schedule_times:
                for scheduled_time in med.schedule_times:
                    try:
                        hour, minute = map(int, scheduled_time.split(":"))
                        scheduled_datetime = today_start.replace(hour=hour, minute=minute)

                        if scheduled_datetime < now:
                            if not med.last_taken or med.last_taken < today_start:
                                missed_meds.append(med.name)
                    except (ValueError, AttributeError):
                        pass

        if missed_meds:
            alerts.append({
                "id": f"missed_med_{len(alerts)}",
                "type": "missed_medication",
                "message": f"Missed medications: {', '.join(set(missed_meds))}",
                "time": now.isoformat(),
                "reviewed": False,
            })

        sos_events = await SOSEvent.find(
            SOSEvent.patient_uid == target_uid,
            SOSEvent.resolved == False,
            SOSEvent.created_at >= today_start,
        ).to_list()

        for sos in sos_events:
            alerts.append({
                "id": str(sos.id),
                "type": "sos",
                "message": f"SOS triggered - Level {sos.level}",
                "time": sos.created_at.isoformat(),
                "reviewed": sos.resolved,
            })

        interactions = await OritoInteraction.find(
            OritoInteraction.user_uid == target_uid,
            OritoInteraction.created_at >= today_start,
        ).to_list()
        
        journal_entries = await JournalEntry.find(
            JournalEntry.patient_uid == target_uid,
            JournalEntry.created_at >= today_start,
        ).to_list()

        hours_since_activity = 0
        if not interactions and not journal_entries:
            hours_since_activity = (now - today_start).seconds // 3600
        else:
            last_activity = today_start
            if interactions:
                last_activity = max(last_activity, max(i.created_at for i in interactions))
            if journal_entries:
                last_activity = max(last_activity, max(e.created_at for e in journal_entries))
            hours_since_activity = (now - last_activity).seconds // 3600

        if hours_since_activity >= 6:
            alerts.append({
                "id": "no_activity",
                "type": "no_activity",
                "message": f"No activity detected for {hours_since_activity} hours",
                "time": now.isoformat(),
                "reviewed": False,
            })
        
        return {"alerts": alerts}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get behavior alerts: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve alerts")


@router.post("/encouragement")
async def send_encouragement(
    body: SendEncouragementRequest,
    uid: str = Depends(get_current_user_uid),
):
    sender = await User.find_one(User.firebase_uid == uid)
    if not sender:
        raise HTTPException(status_code=404, detail="User not found")

    target_uid = await _resolve_target_uid(uid, body.patient_uid)
    await _verify_access(uid, target_uid)

    if sender.role != UserRole.CAREGIVER and uid != target_uid:
        raise HTTPException(status_code=403, detail="Only caregivers can send encouragement to other users")

    title = body.title.strip() if body.title and body.title.strip() else "Message from your caregiver"
    sender_name = sender.display_name.strip() if sender.display_name else sender.email

    suggestion = Suggestion(
        user_uid=target_uid,
        type=SuggestionType.GENERAL,
        title=title,
        description=body.message,
        priority=body.priority,
        action_label="Mark as read",
        context_data={
            "source": "caregiver_encouragement",
            "sender_uid": uid,
            "sender_name": sender_name,
            "sent_at": datetime.utcnow().isoformat(),
        },
    )
    await suggestion.insert()

    return {
        "status": "sent",
        "target_uid": target_uid,
        "suggestion_id": str(suggestion.id),
    }


async def _get_medication_adherence(patient_uid: str, start_date: datetime, end_date: datetime) -> int:
    medications = await Medication.find(
        Medication.patient_uid == patient_uid,
        Medication.is_active == True,
    ).to_list()
    
    if not medications:
        return 0
    
    total_scheduled = 0
    total_taken = 0
    
    for med in medications:
        if med.last_taken and start_date <= med.last_taken < end_date:
            total_taken += 1
        total_scheduled += len(med.schedule_times) if med.schedule_times else 1
    
    if total_scheduled == 0:
        return 0
    
    return round((total_taken / total_scheduled) * 100)


async def _verify_access(requester_uid: str, patient_uid: str):
    if requester_uid == patient_uid:
        return
    
    user = await User.find_one(User.firebase_uid == requester_uid)
    if not user:
        raise HTTPException(status_code=403, detail="Access denied")
    
    if user.role.value == "admin":
        return
    
    if user.role.value == "caregiver" and patient_uid in user.linked_patients:
        return
    
    raise HTTPException(status_code=403, detail="Access denied")


async def _resolve_target_uid(uid: str, patient_uid: Optional[str]) -> str:
    if patient_uid:
        return patient_uid
    user = await User.find_one(User.firebase_uid == uid)
    if not user:
        return uid
    if user.role.value == "caregiver" and user.linked_patients:
        return user.linked_patients[0]
    return uid
