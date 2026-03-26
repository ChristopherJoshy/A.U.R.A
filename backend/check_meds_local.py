from pymongo import MongoClient
import pprint

client = MongoClient("mongodb://localhost:27017")
db = client.aura

meds = list(db.medications.find())
print(f"Total Meds: {len(meds)}")
for m in meds:
    pprint.pprint(m)

