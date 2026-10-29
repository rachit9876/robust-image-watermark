import sqlite3
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "provenance.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS watermarks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provenance_id TEXT UNIQUE NOT NULL,
            username TEXT NOT NULL,
            original_image_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            model_type TEXT DEFAULT 'Q',
            ecc_scheme TEXT DEFAULT 'BCH_5'
        )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_provenance_id ON watermarks(provenance_id);")
    conn.commit()
    conn.close()

def save_watermark_record(provenance_id: str, username: str, original_image_hash: str, model_type: str = 'Q', ecc_scheme: str = 'BCH_5'):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO watermarks (provenance_id, username, original_image_hash, model_type, ecc_scheme)
        VALUES (?, ?, ?, ?, ?)
    """, (provenance_id, username, original_image_hash, model_type, ecc_scheme))
    conn.commit()
    conn.close()

def find_watermark_record(provenance_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    # Check by provenance_id first, then fallback to direct username match
    cursor.execute("""
        SELECT provenance_id, username, original_image_hash, created_at, model_type, ecc_scheme
        FROM watermarks
        WHERE provenance_id = ? OR username = ?
        ORDER BY id DESC LIMIT 1
    """, (provenance_id, provenance_id))
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    return None
