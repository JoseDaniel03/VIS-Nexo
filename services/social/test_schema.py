"""Local SQLite regression checks for the VIS Ceibo/Humile D1 schema."""
import sqlite3
import pathlib
import unittest

SQL = "\n".join(p.read_text() for p in sorted((pathlib.Path(__file__).parent / "migrations").glob("*.sql")))

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

    def test_visibility_and_private_contact_favorites(self):
        self.db.execute(
            "INSERT INTO humile_presence(account_id,visibility,updated_at) VALUES('anna','invisible','2026-11-11')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO humile_presence(account_id,visibility,updated_at) VALUES('bob','hacked','2026-11-11')")
        record = self.db.execute("SELECT visibility FROM humile_presence WHERE account_id='anna'").fetchone()
        self.assertEqual(record["visibility"], "invisible")
        self.db.execute("INSERT INTO humile_favorites(actor_id,target_id) VALUES('anna','bob')")
        self.assertEqual(self.db.execute(
            "SELECT target_id FROM humile_favorites WHERE actor_id='anna'").fetchone()["target_id"], "bob")
        self.db.execute("INSERT INTO humile_blocks(actor_id,target_id,created_at)"
                        " VALUES('anna','cara','2026-11-11')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO humile_blocks(actor_id,target_id,created_at)"
                            " VALUES('anna','cara','2026-11-11')")

    def test_custom_status_game_privacy_and_expiration(self):
        self.db.execute("INSERT INTO humile_presence(account_id,visibility,custom_status,share_game,updated_at)"
                        " VALUES('anna','online','Creando mundo',0,'2026-11-11')")
        record = self.db.execute("SELECT * FROM humile_presence WHERE account_id='anna'").fetchone()
        self.assertEqual(record["custom_status"], "Creando mundo")
        self.assertEqual(record["share_game"], 0)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE humile_presence SET custom_status=? WHERE account_id='anna'", ("x" * 81,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE humile_presence SET share_game=3 WHERE account_id='anna'")
        self.db.execute("INSERT INTO humile_game_activity(account_id,engine,project,expires_at,updated_at)"
                        " VALUES('anna','rust','Virgoland',2000,'2026-11-11')")
        self.assertEqual(self.db.execute(
            "SELECT engine FROM humile_game_activity WHERE account_id='anna' AND expires_at>?",
            (1000,)).fetchone()["engine"], "rust")
        self.assertIsNone(self.db.execute(
            "SELECT engine FROM humile_game_activity WHERE account_id='anna' AND expires_at>?",
            (3000,)).fetchone())
        self.db.execute("DELETE FROM humile_game_activity WHERE expires_at<?", (3000,))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM humile_game_activity").fetchone()[0], 0)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO humile_game_activity(account_id,engine,project,expires_at,updated_at)"
                            " VALUES('bob','other','',2000,'2026-11-11')")

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
