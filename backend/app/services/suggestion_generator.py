
import json
import os
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Optional
import httpx
from ..models.suggestion import Suggestion, SuggestionType
from ..models.medication import Medication
from ..models.journal import JournalEntry


logger = logging.getLogger(__name__)


GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")


class SuggestionGenerator:

    def __init__(self):
        self.api_key = GROQ_API_KEY

#------This Function generates daily suggestions---------
    async def generate_daily_suggestions(
        self,
        user_id: str,
        medications: List[Medication],
        recent_journals: List[JournalEntry],
        patient_info: Optional[Dict] = None,
    ) -> List[Suggestion]:

        if not self.api_key:
            return []

        
        context = self._build_context(medications, recent_journals, patient_info)

        
        suggestions_data = await self._call_groq_api(context)

        if not suggestions_data:
            return []

        
        suggestions = []
        for suggestion_dict in suggestions_data:
            priority_str = suggestion_dict.get("priority", "medium")
            priority_value = {"low": 0, "medium": 1, "high": 2}.get(priority_str.lower(), 1)
            
            suggestion = Suggestion(
                user_uid=user_id,
                type=self._map_type(suggestion_dict.get("type", "general")),
                title=suggestion_dict.get("title", "Suggestion"),
                description=suggestion_dict.get("description", ""),
                priority=priority_value,
                action_label=suggestion_dict.get("action_label"),
                context_data=suggestion_dict.get("context_data", {}),
                expires_at=datetime.utcnow() + timedelta(days=1),  
            )
            suggestions.append(suggestion)

        return suggestions

#------This Function builds context---------
    def _build_context(
        self,
        medications: List[Medication],
        recent_journals: List[JournalEntry],
        patient_info: Optional[Dict],
    ) -> str:

        context_parts = []

        
        if patient_info:
            context_parts.append(f"PATIENT INFORMATION:")
            context_parts.append(
                f"Condition: {patient_info.get('condition', 'Unknown')}"
            )
            context_parts.append(f"Severity: {patient_info.get('severity', 'Unknown')}")
            context_parts.append(f"Notes: {patient_info.get('notes', 'None')}")
            context_parts.append("")

        
        if medications:
            context_parts.append(f"CURRENT MEDICATIONS ({len(medications)}):")
            for med in medications[:10]:  
                schedule = (
                    ", ".join(med.schedule_times)
                    if med.schedule_times
                    else "No schedule"
                )
                context_parts.append(f"- {med.name} ({med.dosage}) - {schedule}")
            context_parts.append("")

        
        if recent_journals:
            context_parts.append(f"RECENT JOURNAL ENTRIES ({len(recent_journals)}):")
            for entry in recent_journals[:5]:  
                date_str = (
                    entry.created_at.strftime("%Y-%m-%d")
                    if entry.created_at
                    else "Unknown"
                )
                content_preview = (
                    entry.content[:100] + "..."
                    if len(entry.content) > 100
                    else entry.content
                )
                context_parts.append(f"- [{date_str}] {content_preview}")
            context_parts.append("")

        
        now = datetime.now()
        context_parts.append(f"CURRENT TIME:")
        context_parts.append(f"Date: {now.strftime('%A, %B %d, %Y')}")
        context_parts.append(f"Time: {now.strftime('%I:%M %p')}")

        return "\n".join(context_parts)

#------This Function calls Groq API---------
    async def _call_groq_api(self, context: str) -> Optional[List[Dict]]:

        system_prompt = """You are an empathetic medical AI assistant specialized in helping Alzheimer's patients.
Generate 2-4 daily suggestions that are:
- Specific and actionable
- Personalized to the patient's context
- Caring and encouraging
- Time-appropriate

Each suggestion should have:
- type: one of [medication, activity, wellness, reminder, routine, general]
- title: Short, clear title (2-5 words)
- description: 1-2 sentences describing the suggestion
- priority: high, medium, or low
- action_label: Optional action button text (e.g., "Take Now", "Start Activity", "View Details")

Return ONLY valid JSON array format:
[
  {
    "type": "activity",
    "title": "Morning Walk",
    "description": "Take a 15-minute walk to help with medication absorption and mood.",
    "priority": "medium",
    "action_label": "Start Walk"
  }
]"""

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    GROQ_API_URL,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "llama-3.1-8b-instant",
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": f"Generate suggestions based on this context:\n\n{context}"},
                        ],
                        "temperature": 0.7,
                        "max_tokens": 1000,
                    },
                )

                if response.status_code != 200:
                    logger.error(f"Groq API error: {response.status_code} - {response.text}")
                    return None

                result = response.json()
                content = result.get("choices", [{}])[0].get("message", {}).get("content", "[]")

                suggestions_data = json.loads(content)
                return suggestions_data

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON response: {e}")
            return None
        except httpx.RequestError as e:
            logger.error(f"HTTP request failed: {e}")
            return None
        except Exception as e:
            logger.exception(f"Unexpected error in _call_groq_api: {e}")
            return None

#------This Function maps suggestion type string to enum---------
    def _map_type(self, type_str: str) -> SuggestionType:
        type_mapping = {
            "medication": SuggestionType.MEDICATION,
            "activity": SuggestionType.ACTIVITY,
            "wellness": SuggestionType.WELLNESS,
            "reminder": SuggestionType.REMINDER,
            "routine": SuggestionType.ROUTINE,
            "general": SuggestionType.GENERAL,
        }
        return type_mapping.get(type_str.lower(), SuggestionType.GENERAL)



suggestion_generator = SuggestionGenerator()
