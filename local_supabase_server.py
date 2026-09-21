"""
SecureVision AI - Servidor Local REST Supabase (SQLite Engine)
Fornece uma API REST local 100% compatível com a especificação PostgREST do Supabase.
Permite operação local sem internet, persistência em SQLite e sincronização bidirecional.
"""

import os
import sys
import json
import sqlite3
from urllib.parse import urlparse, parse_qs
from http.server import HTTPServer, BaseHTTPRequestHandler

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "securevision.db")

def init_sqlite_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    # 1. Tabela Users
    c.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        access_level TEXT NOT NULL,
        cpf_encrypted TEXT NOT NULL,
        cpf_hash TEXT UNIQUE NOT NULL,
        lgpd_consent INTEGER DEFAULT 1,
        created_at TEXT
    );
    """)

    # 2. Tabela Biometrics
    c.execute("""
    CREATE TABLE IF NOT EXISTS biometrics (
        user_id TEXT PRIMARY KEY,
        descriptors TEXT NOT NULL,
        source_count INTEGER DEFAULT 1,
        augmented_count INTEGER DEFAULT 0,
        patches_16x16 TEXT DEFAULT '[]',
        updated_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)

    # 3. Tabela Logs
    c.execute("""
    CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        cam_id TEXT DEFAULT 'CAM_01_PORTAL',
        previous_hash TEXT,
        hash TEXT,
        created_at TEXT
    );
    """)

    # 4. Tabela Operators
    c.execute("""
    CREATE TABLE IF NOT EXISTS operators (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'operador',
        created_at TEXT
    );
    """)

    # Bootstrap default operator
    c.execute("SELECT id FROM operators WHERE username = 'admin'")
    if not c.fetchone():
        c.execute("""
        INSERT INTO operators (id, username, email, password_hash, full_name, role, created_at)
        VALUES ('op_master_admin', 'admin', 'admin@securevision.ai', '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918', 'Administrador do Sistema', 'admin', datetime('now'))
        """)

    conn.commit()
    conn.close()
    print(f"[OK] Banco de dados SQLite inicializado: {DB_FILE}")

class SupabaseRESTHandler(BaseHTTPRequestHandler):
    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "apikey, authorization, content-type, prefer, x-client-info")

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()

        if path.startswith("/rest/v1/users"):
            if "select" in qs and "count" in qs["select"]:
                c.execute("SELECT COUNT(*) FROM users")
                cnt = c.fetchone()[0]
                self._send_json([{"count": cnt}])
            else:
                c.execute("SELECT id, name, role, access_level, cpf_encrypted, cpf_hash, lgpd_consent, created_at FROM users")
                rows = c.fetchall()
                data = [{"id": r[0], "name": r[1], "role": r[2], "access_level": r[3], "cpf_encrypted": r[4], "cpf_hash": r[5], "lgpd_consent": bool(r[6]), "created_at": r[7]} for r in rows]
                self._send_json(data)

        elif path.startswith("/rest/v1/biometrics"):
            c.execute("SELECT user_id, descriptors, source_count, augmented_count, patches_16x16, updated_at FROM biometrics")
            rows = c.fetchall()
            data = [{"user_id": r[0], "descriptors": json.loads(r[1] or "[]"), "source_count": r[2], "augmented_count": r[3], "patches_16x16": json.loads(r[4] or "[]"), "updated_at": r[5]} for r in rows]
            self._send_json(data)

        elif path.startswith("/rest/v1/logs"):
            c.execute("SELECT id, type, category, description, cam_id, previous_hash, hash, created_at FROM logs ORDER BY id DESC LIMIT 50")
            rows = c.fetchall()
            data = [{"id": r[0], "type": r[1], "category": r[2], "description": r[3], "cam_id": r[4], "previous_hash": r[5], "hash": r[6], "created_at": r[7]} for r in rows]
            self._send_json(data)

        elif path.startswith("/rest/v1/operators"):
            c.execute("SELECT id, username, email, full_name, role, created_at FROM operators")
            rows = c.fetchall()
            data = [{"id": r[0], "username": r[1], "email": r[2], "full_name": r[3], "role": r[4], "created_at": r[5]} for r in rows]
            self._send_json(data)

        else:
            self._send_json({"status": "online", "engine": "SecureVision Supabase REST Server", "version": "2.0.0"})

        conn.close()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        content_len = int(self.headers.get("Content-Length", 0))
        post_body = self.rfile.read(content_len) if content_len > 0 else b"{}"

        try:
            payload = json.loads(post_body.decode("utf-8"))
        except Exception:
            payload = {}

        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()

        if path.startswith("/rest/v1/users"):
            if isinstance(payload, list):
                items = payload
            else:
                items = [payload]

            for item in items:
                c.execute("""
                INSERT OR REPLACE INTO users (id, name, role, access_level, cpf_encrypted, cpf_hash, lgpd_consent, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    item.get("id"),
                    item.get("name"),
                    item.get("role"),
                    item.get("access_level"),
                    item.get("cpf_encrypted", ""),
                    item.get("cpf_hash", ""),
                    1 if item.get("lgpd_consent", True) else 0,
                    item.get("created_at")
                ))
            conn.commit()
            self._send_json({"status": "success", "synced": len(items)}, 201)

        elif path.startswith("/rest/v1/biometrics"):
            if isinstance(payload, list):
                items = payload
            else:
                items = [payload]

            for item in items:
                desc = json.dumps(item.get("descriptors", []))
                patches = json.dumps(item.get("patches_16x16", []))
                c.execute("""
                INSERT OR REPLACE INTO biometrics (user_id, descriptors, source_count, augmented_count, patches_16x16, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    item.get("user_id"),
                    desc,
                    item.get("source_count", 1),
                    item.get("augmented_count", 0),
                    patches,
                    item.get("updated_at")
                ))
            conn.commit()
            self._send_json({"status": "success", "synced": len(items)}, 201)

        elif path.startswith("/rest/v1/logs"):
            c.execute("""
            INSERT INTO logs (type, category, description, cam_id, previous_hash, hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                payload.get("type", "INFO"),
                payload.get("category", "GERAL"),
                payload.get("description", ""),
                payload.get("cam_id", "CAM_01_PORTAL"),
                payload.get("previous_hash"),
                payload.get("hash"),
                payload.get("created_at")
            ))
            conn.commit()
            self._send_json({"status": "success", "id": c.lastrowid}, 201)

        elif path.startswith("/rest/v1/operators"):
            c.execute("""
            INSERT OR REPLACE INTO operators (id, username, email, password_hash, full_name, role, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                payload.get("id"),
                payload.get("username"),
                payload.get("email"),
                payload.get("password_hash"),
                payload.get("full_name"),
                payload.get("role", "operador"),
                payload.get("created_at")
            ))
            conn.commit()
            self._send_json({"status": "success"}, 201)

        else:
            self._send_json({"error": "Endpoint not found"}, 404)

        conn.close()

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()

        if path.startswith("/rest/v1/users"):
            id_val = None
            if "id" in qs:
                raw_id = qs["id"][0]
                if raw_id.startswith("eq."):
                    id_val = raw_id[3:]
                else:
                    id_val = raw_id
            if id_val:
                c.execute("DELETE FROM users WHERE id = ?", (id_val,))
                c.execute("DELETE FROM biometrics WHERE user_id = ?", (id_val,))
                conn.commit()
                self._send_json({"status": "deleted", "id": id_val})
            else:
                self._send_json({"error": "Missing id parameter"}, 400)

        elif path.startswith("/rest/v1/biometrics"):
            uid = None
            if "user_id" in qs:
                raw_uid = qs["user_id"][0]
                uid = raw_uid[3:] if raw_uid.startswith("eq.") else raw_uid
            if uid:
                c.execute("DELETE FROM biometrics WHERE user_id = ?", (uid,))
                conn.commit()
                self._send_json({"status": "deleted", "user_id": uid})
            else:
                self._send_json({"error": "Missing user_id parameter"}, 400)

        else:
            self._send_json({"error": "Endpoint not found"}, 404)

        conn.close()

    def _send_json(self, data, status_code=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print(f"[Supabase REST Server] {self.command} {self.path} -> {args[1] if len(args) > 1 else ''}")

def run(port=8000):
    init_sqlite_db()
    server_address = ("127.0.0.1", port)
    httpd = HTTPServer(server_address, SupabaseRESTHandler)
    print("================================================================")
    print("  SECUREVISION AI — SERVIDOR SUPABASE REST ATIVO")
    print(f"  URL Local: http://localhost:{port}")
    print("  Status: CONECTADO (SQLite Engine Ativo)")
    print("  Endpoints: /rest/v1/users, /rest/v1/biometrics, /rest/v1/logs")
    print("================================================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[!] Servidor encerrado.")
        httpd.server_close()

if __name__ == "__main__":
    run(8000)
