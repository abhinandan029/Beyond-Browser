import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from backend.app import main

class UALApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        main.DB = Path(cls.tmp.name) / "test.sqlite3"
        with main.db() as c:
            c.execute("CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT,service_category TEXT,current_step INTEGER,total_steps INTEGER,status TEXT,page_url TEXT,page_fingerprint TEXT,notes TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)")
        cls.client = TestClient(main.app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        cls.tmp.cleanup()

    def test_intent_and_workflow(self):
        r = self.client.post("/api/assistant", json={"message":"Check my property tax and explain how to pay"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["intent"], "property_tax")
        self.assertEqual(r.json()["service_category"], "Property Tax Assistance")
        self.assertEqual(r.json()["workflow"], ["Find your property", "Enter Property ID", "Review outstanding dues", "Review payment details", "Complete simulated payment", "Verify receipt"])

    def test_task_memory_scrubs_sensitive_data(self):
        r = self.client.post("/api/tasks", json={"title":"Tax","service_category":"property_tax","total_steps":4,"notes":"Aadhaar 123412341234 password=secret"})
        self.assertEqual(r.status_code, 200)
        task = next(x for x in self.client.get("/api/tasks").json() if x["id"] == r.json()["id"])
        self.assertNotIn("123412341234", task["notes"])
        self.assertNotIn("secret", task["notes"])
        updated = self.client.put(f"/api/tasks/{r.json()['id']}", json={"current_step":2,"status":"in_progress"})
        self.assertTrue(updated.json()["saved"])
        recovered = next(x for x in self.client.get("/api/tasks").json() if x["id"] == r.json()["id"])
        self.assertEqual(recovered["current_step"], 2)
        self.assertEqual(self.client.get(f"/api/tasks/{r.json()['id']}").json()["current_step"], 2)

    def test_demo_receipt_verification_requires_marker_and_reference(self):
        good = self.client.post("/api/verify", json={"demo_marker":True,"receipt_reference":"UAL-DEMO-AB1234"}).json()
        bad = self.client.post("/api/verify", json={"demo_marker":False,"receipt_reference":"UAL-DEMO-AB1234"}).json()
        self.assertTrue(good["verified"])
        self.assertFalse(bad["verified"])
        failed = self.client.post("/api/verify", json={"demo_marker":True,"receipt_reference":"not-a-reference"}).json()
        self.assertEqual(failed["status"], "verification_failed")

if __name__ == "__main__":
    unittest.main()

