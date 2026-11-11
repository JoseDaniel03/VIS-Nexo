"""Local SQLite regression checks for the VIS Ceibo/Humile D1 schema."""
import sqlite3
import pathlib
import unittest

SQL = (pathlib.Path(__file__).parent / "migrations" / "0001_ceibo_humile.sql").read_text()

def account(db, user):
    db.execute(
        "INSERT INTO ceibo_accounts(id,username,password_salt,password_hash,password_iterations,created_at)"
        " VALUES(?,?,?,?,?,?)",
        (user, user, "0" * 32, "0" * 64, 600000, "2026-11-11T00:00:00Z")
    )

class SocialSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SQL)
        self.addCleanup(self.db.close)
        for user in ("anna", "bob", "cara"):
            account(self.db, user)

    def test_username_unique_case_insensitive(self):
        with self.assertRaises(sqlite3.IntegrityError):
            account(self.db, "ANNA")

    def test_friendship_unique_and_user_integrity(self):
        self.db.execute(
            "INSERT INTO humile_friendships(id,user_a,user_b,requester_id,status,created_at)"
            " VALUES('f1','anna','bob','anna','accepted','2026-11-11')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO humile_friendships(id,user_a,user_b,requester_id,status,created_at)"
                " VALUES('f2','anna','bob','bob','pending','2026-11-11')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO humile_friendships(id,user_a,user_b,requester_id,status,created_at)"
                " VALUES('f3','anna','ghost','anna','pending','2026-11-11')")

    def test_group_memberships_and_length_guard(self):
        self.db.execute("INSERT INTO humile_chats(id,kind,title,created_at) VALUES('chat1','group','Test','2026-11-11')")
        self.db.execute("INSERT INTO humile_chat_members(chat_id,account_id,joined_at) VALUES('chat1','anna','2026-11-11')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO humile_chat_members(chat_id,account_id,joined_at) VALUES('chat1','anna','2026-11-11')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO humile_messages(id,chat_id,sender_id,body,created_at,expires_at)"
                            " VALUES('m1','chat1','anna',?,'2026-11-11',1800000000000)", ("x" * 2001,))
        self.db.execute("INSERT INTO humile_messages(id,chat_id,sender_id,body,created_at,expires_at)"
                        " VALUES('m2','chat1','anna','Hola','2026-11-11',1800000000000)")
        latest = self.db.execute("SELECT MAX(seq) AS seq FROM humile_messages WHERE chat_id='chat1'").fetchone()
        self.assertGreater(latest["seq"], 0)

    def test_chat_summary_query_matches_worker_api(self):
        self.db.execute("INSERT INTO humile_chats(id,kind,pair_key,created_at) VALUES('c1','direct','dm:anna:bob','2026-11-11')")
        for user in ("anna", "bob"):
            self.db.execute("INSERT INTO humile_chat_members(chat_id,account_id,joined_at) VALUES('c1',?,'2026-11-11')", (user,))
        self.db.execute("INSERT INTO humile_messages(id,chat_id,sender_id,body,created_at,expires_at)"
                        " VALUES('m1','c1','bob','Hola','2026-11-11',1800000000000)")
        row = self.db.execute(
            "SELECT c.id,c.kind,c.title,c.created_at,m.last_read_seq,"
            "(SELECT MAX(seq) FROM humile_messages WHERE chat_id=c.id) AS latest_seq,"
            "(SELECT COUNT(*) FROM humile_messages WHERE chat_id=c.id AND seq>m.last_read_seq AND sender_id<>?) AS unread,"
            "(SELECT a.username FROM humile_chat_members cm JOIN ceibo_accounts a ON a.id=cm.account_id WHERE cm.chat_id=c.id AND cm.account_id<>? LIMIT 1) AS peer_username "
            "FROM humile_chats c JOIN humile_chat_members m ON m.chat_id=c.id "
            "WHERE m.account_id=? ORDER BY latest_seq DESC,c.created_at DESC LIMIT 100",
            ("anna", "anna", "anna")
        ).fetchone()
        self.assertEqual(row["unread"], 1)
        self.assertEqual(row["peer_username"], "bob")

if __name__ == "__main__":
    unittest.main()
