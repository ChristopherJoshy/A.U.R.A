from pymongo import MongoClient
import pprint

client = MongoClient("mongodb://127.0.0.1:27017")
db = client.aura

meds = list(db.medications.find())
print(f"Total Meds: {len(meds)}")
for m in meds:
    pprint.pprint(m)

users = list(db.users.find())
print(f"Total Users: {len(users)}")
for u in users:
    print(u.get('email', ''), u.get('firebase_uid', ''), u.get('medications', []))
