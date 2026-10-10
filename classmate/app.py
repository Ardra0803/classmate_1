"""Classmate tutoring website - Flask backend with MySQL.

Setup: copy .env.example to .env, put in your MySQL details, then:  python app.py
Tables (and the database itself) are created automatically on first start.
Static content (tutors, subjects, contact) still lives in data/site.json.
"""
import hmac
import json
import os
import re
import secrets
import smtplib
import sys
import threading
import time
from datetime import timedelta
from email.message import EmailMessage
from functools import wraps

import pymysql
from dotenv import load_dotenv
from flask import Flask, jsonify, redirect, render_template, request, session


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024

# On a live server behind nginx / a hosting proxy, set BEHIND_PROXY=true in .env so each visitor's
# real address is used (otherwise the rate limit and login lockout would treat everyone as one person).
if os.environ.get("BEHIND_PROXY", "false").lower() == "true":
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

BASE = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(BASE, ".env")
ENV_FOUND = load_dotenv(ENV_FILE, override=True)  # .env next to app.py wins over system variables
DATA = os.path.join(BASE, "data")

DB = {
    "host": os.environ.get("DB_HOST", "localhost"),
    "port": int(os.environ.get("DB_PORT", 3306)),
    "user": os.environ.get("DB_USER", "root"),
    "password": os.environ.get("DB_PASSWORD", ""),
}
DB_NAME = os.environ.get("DB_NAME", "classmate")
# true = new feedback is hidden until you set approved = 1 in the database
REQUIRE_APPROVAL = os.environ.get("REQUIRE_APPROVAL", "false").lower() == "true"

# =====================================================================
#  ADMIN SETTINGS  -  fill these in directly (admin page: /admin)
#  The admin login stays disabled until you replace "Fill with your data".
# =====================================================================
ADMIN_EMAIL = "admin@gmail.com"
ADMIN_PASSWORD = "admin@123"
# Any long random text. If left as is, a random one is made on each start (admin logs out on restart).
ADMIN_SECRET_KEY = "Fill with your data"

# Optional: get an email whenever an enquiry or feedback arrives. Leave as is to skip emails.
# Gmail example: host smtp.gmail.com, port 587, user = your gmail, password = a Gmail "App password".
SMTP_HOST = "Fill with your data"
SMTP_PORT = 587
SMTP_USER = "Fill with your data"
SMTP_PASSWORD = "Fill with your data"
NOTIFY_EMAIL = "Fill with your data"  # where alerts are sent
# =====================================================================


def is_set(value):
    return bool(value) and not str(value).startswith("Fill with")


app.secret_key = ADMIN_SECRET_KEY if is_set(ADMIN_SECRET_KEY) else secrets.token_hex(32)
app.permanent_session_lifetime = timedelta(hours=8)
# COOKIE_SECURE=true (in .env) once the site runs on https://
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                  SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "false").lower() == "true")
if not is_set(ADMIN_SECRET_KEY):
    print("NOTE: ADMIN_SECRET_KEY is not set in app.py. Set it before going live, or admin logins will break on a live server.")


# ---------- database ----------
def connect(with_db=True):
    return pymysql.connect(
        **DB,
        database=DB_NAME if with_db else None,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
        connect_timeout=5,
    )


def init_db():
    """Create the database and tables if they do not exist."""
    safe = re.sub(r"[^A-Za-z0-9_]", "", DB_NAME)
    with connect(with_db=False) as c, c.cursor() as cur:
        cur.execute(f"CREATE DATABASE IF NOT EXISTS `{safe}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
    with connect() as c, c.cursor() as cur:
        cur.execute("""CREATE TABLE IF NOT EXISTS feedback (
          id INT AUTO_INCREMENT PRIMARY KEY,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          name VARCHAR(60) NOT NULL, grade VARCHAR(30) NOT NULL, subject VARCHAR(60) NOT NULL,
          tutor VARCHAR(60) NOT NULL, duration VARCHAR(40) DEFAULT '', email VARCHAR(100) DEFAULT '',
          show_name TINYINT(1) NOT NULL DEFAULT 1,
          r_overall TINYINT NOT NULL, r_clarity TINYINT NOT NULL, r_personalisation TINYINT NOT NULL,
          r_doubts TINYINT NOT NULL, r_assessments TINYINT NOT NULL,
          marks_before VARCHAR(40) DEFAULT '', marks_after VARCHAR(40) DEFAULT '',
          liked TEXT, improve TEXT, message TEXT NOT NULL,
          recommend ENUM('yes','no') NOT NULL DEFAULT 'yes',
          approved TINYINT(1) NOT NULL DEFAULT 1
        ) CHARACTER SET utf8mb4""")
        cur.execute("""CREATE TABLE IF NOT EXISTS enquiries (
          id INT AUTO_INCREMENT PRIMARY KEY,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          name VARCHAR(60) NOT NULL, contact VARCHAR(100) NOT NULL,
          grade VARCHAR(30) DEFAULT '', subject VARCHAR(60) DEFAULT '', message TEXT
        ) CHARACTER SET utf8mb4""")
        # Flags used by the admin page (safe to run on old databases too)
        for sql in ("ALTER TABLE enquiries ADD COLUMN is_read TINYINT(1) NOT NULL DEFAULT 0",
                    "ALTER TABLE feedback ADD COLUMN is_seen TINYINT(1) NOT NULL DEFAULT 0"):
            try:
                cur.execute(sql)
            except pymysql.MySQLError as err:
                if err.args[0] != 1060:  # 1060 = column already exists
                    raise


def run(sql, args=(), fetch=False):
    with connect() as c, c.cursor() as cur:
        cur.execute(sql, args)
        return cur.fetchall() if fetch else None


@app.errorhandler(pymysql.MySQLError)
def db_error(e):
    app.logger.error("MySQL error: %s", e)
    return jsonify(error="Database is unavailable right now. Please try again later."), 503


# ---------- helpers ----------
def clean(value, max_len):
    return re.sub(r"[<>]", "", str(value if value is not None else "")).strip()[:max_len]


_hits = {}
# Max successful submissions per visitor per hour. Set RATE_LIMIT=0 in .env to switch it off (handy while testing).
RATE_LIMIT = int(os.environ.get("RATE_LIMIT", 5))


def rate_limited(record=True, window=3600):
    """True if this visitor reached the limit. record=True counts one more submission."""
    if RATE_LIMIT <= 0:
        return False
    ip, now = request.remote_addr, time.time()
    recent = [t for t in _hits.get(ip, []) if now - t < window]
    if len(recent) >= RATE_LIMIT:
        _hits[ip] = recent
        return True
    _hits[ip] = recent + ([now] if record else [])
    return False


def rating(value):
    try:
        return min(5, max(1, int(value)))
    except (TypeError, ValueError):
        return 0


def normalise_grade(grade):
    m = re.search(r"\d+", grade or "")
    return f"Class {int(m.group())}" if m else (grade or "Student")


# ---------- pages ----------
@app.route("/")
def home():
    return render_template("index.html")


# ---------- API ----------
@app.get("/api/site")
def api_site():
    with open(os.path.join(DATA, "site.json"), encoding="utf-8") as f:
        return jsonify(json.load(f))


@app.get("/api/works")
def api_works():
    """Past work is built automatically from approved feedback. Names and emails are never included."""
    rows = run("SELECT grade, subject, tutor, duration, liked, message, marks_before, marks_after, r_overall "
               "FROM feedback WHERE approved = 1 ORDER BY id DESC", fetch=True)
    works = [{
        "level": normalise_grade(r["grade"]), "subject": r["subject"], "tutor": r["tutor"],
        "duration": r["duration"] or "", "liked": r["liked"] or "", "message": r["message"] or "",
        "before": r["marks_before"] or "", "after": r["marks_after"] or "", "rating": r["r_overall"],
    } for r in rows]
    return jsonify(works)


@app.get("/api/feedback")
def api_feedback_list():
    rows = run("SELECT id, created_at, name, grade, subject, tutor, duration, show_name, r_overall, r_clarity, "
               "r_personalisation, r_doubts, r_assessments, marks_before, marks_after, liked, improve, message, recommend "
               "FROM feedback WHERE approved = 1 ORDER BY id DESC", fetch=True)  # email is never selected
    return jsonify([{
        "id": r["id"], "date": r["created_at"].isoformat(), "name": r["name"], "grade": r["grade"],
        "subject": r["subject"], "tutor": r["tutor"], "duration": r["duration"] or "",
        "showName": bool(r["show_name"]),
        "ratings": {"overall": r["r_overall"], "clarity": r["r_clarity"], "personalisation": r["r_personalisation"],
                    "doubts": r["r_doubts"], "assessments": r["r_assessments"]},
        "before": r["marks_before"] or "", "after": r["marks_after"] or "",
        "liked": r["liked"] or "", "improve": r["improve"] or "", "message": r["message"],
        "recommend": r["recommend"],
    } for r in rows])


@app.post("/api/feedback")
def api_feedback_create():
    b = request.get_json(silent=True) or {}
    if b.get("website"):  # honeypot: bots fill it, humans don't
        return jsonify(ok=True)
    if rate_limited(record=False):
        return jsonify(error="Too many submissions. Please try again later."), 429

    e = {
        "name": clean(b.get("name"), 60), "grade": clean(b.get("grade"), 30),
        "subject": clean(b.get("subject"), 60), "tutor": clean(b.get("tutor"), 60),
        "duration": clean(b.get("duration"), 40), "email": clean(b.get("email"), 100),
        "before": clean(b.get("before"), 40), "after": clean(b.get("after"), 40),
        "liked": clean(b.get("liked"), 600), "improve": clean(b.get("improve"), 600),
        "message": clean(b.get("message"), 1200),
    }
    r = {k: rating(b.get(k)) for k in ("overall", "clarity", "personalisation", "doubts", "assessments")}

    errors = []
    if len(e["name"]) < 2: errors.append("Name is required.")
    if not e["grade"]: errors.append("Class / grade is required.")
    if not e["subject"]: errors.append("Subject is required.")
    if not e["tutor"]: errors.append("Please choose your tutor.")
    if any(v < 1 for v in r.values()): errors.append("Please give all star ratings.")
    if len(e["message"]) < 20: errors.append("Please write at least 20 characters of feedback.")
    if errors:
        return jsonify(error=" ".join(errors)), 400

    rate_limited()  # count this valid submission
    approved = 0 if REQUIRE_APPROVAL else 1
    run("INSERT INTO feedback (name, grade, subject, tutor, duration, email, show_name, r_overall, r_clarity, "
        "r_personalisation, r_doubts, r_assessments, marks_before, marks_after, liked, improve, message, recommend, approved) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (e["name"], e["grade"], e["subject"], e["tutor"], e["duration"], e["email"],
         0 if b.get("showName") is False else 1,
         r["overall"], r["clarity"], r["personalisation"], r["doubts"], r["assessments"],
         e["before"], e["after"], e["liked"], e["improve"], e["message"],
         "yes" if b.get("recommend") == "yes" else "no", approved))
    notify("New student feedback", f"{e['name']} ({e['grade']}, {e['subject']}) rated {r['overall']}/5\n\n{e['message']}")
    return jsonify(ok=True, approved=bool(approved))


@app.post("/api/contact")
def api_contact():
    b = request.get_json(silent=True) or {}
    if b.get("website"):
        return jsonify(ok=True)
    if rate_limited(record=False):
        return jsonify(error="Too many submissions. Please try again later."), 429
    e = {k: clean(b.get(k), n) for k, n in (("name", 60), ("contact", 100), ("grade", 30), ("subject", 60), ("message", 1000))}
    if len(e["name"]) < 2 or len(e["contact"]) < 5:
        return jsonify(error="Name and a phone/email are required."), 400
    rate_limited()  # count this valid submission
    run("INSERT INTO enquiries (name, contact, grade, subject, message) VALUES (%s,%s,%s,%s,%s)",
        (e["name"], e["contact"], e["grade"], e["subject"], e["message"]))
    notify("New enquiry", f"Name: {e['name']}\nContact: {e['contact']}\nClass: {e['grade']}\nSubject: {e['subject']}\n\n{e['message']}")
    return jsonify(ok=True)


# ---------- admin: email notifications ----------
def notify(subject, body):
    """Send an email alert in the background (only if SMTP settings are filled in)."""
    if not all(is_set(v) for v in (SMTP_HOST, SMTP_USER, SMTP_PASSWORD, NOTIFY_EMAIL)):
        return

    def send():
        try:
            msg = EmailMessage()
            msg["Subject"], msg["From"], msg["To"] = f"[Classmate] {subject}", SMTP_USER, NOTIFY_EMAIL
            msg.set_content(body + "\n\nOpen the admin page to reply or manage it.")
            if int(SMTP_PORT) == 465:
                with smtplib.SMTP_SSL(SMTP_HOST, int(SMTP_PORT), timeout=15) as s:
                    s.login(SMTP_USER, SMTP_PASSWORD); s.send_message(msg)
            else:
                with smtplib.SMTP(SMTP_HOST, int(SMTP_PORT), timeout=15) as s:
                    s.starttls(); s.login(SMTP_USER, SMTP_PASSWORD); s.send_message(msg)
        except Exception as err:  # never break the website because an email failed
            app.logger.error("Email alert failed: %s", err)

    threading.Thread(target=send, daemon=True).start()


# ---------- admin: login ----------
_fails = {}  # ip -> list of failed login times


def locked_out(ip, limit=5, window=900):
    now = time.time()
    _fails[ip] = [t for t in _fails.get(ip, []) if now - t < window]
    return len(_fails[ip]) >= limit


def page_admin(fn):
    @wraps(fn)
    def wrapper(*a, **k):
        if not session.get("admin"):
            return redirect("/admin/login")
        return fn(*a, **k)
    return wrapper


def api_admin(fn):
    @wraps(fn)
    def wrapper(*a, **k):
        if not session.get("admin"):
            return jsonify(error="Please log in."), 401
        # Changes must come from our own page (custom header blocks cross-site requests)
        if request.method != "GET" and request.headers.get("X-Admin") != "1":
            return jsonify(error="Forbidden."), 403
        return fn(*a, **k)
    return wrapper


@app.after_request
def no_cache_admin(resp):
    if request.path.startswith("/admin"):
        resp.headers["Cache-Control"] = "no-store"
        resp.headers["X-Robots-Tag"] = "noindex, nofollow"
    return resp


@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    configured = is_set(ADMIN_EMAIL) and is_set(ADMIN_PASSWORD)
    error = None
    if request.method == "POST":
        ip = request.remote_addr
        if not configured:
            error = "Admin login is not set up. Fill in ADMIN_EMAIL and ADMIN_PASSWORD at the top of app.py."
        elif locked_out(ip):
            error = "Too many failed attempts. Try again in 15 minutes."
        else:
            email = request.form.get("email", "").strip().lower().encode()
            pw = request.form.get("password", "").encode()
            ok = hmac.compare_digest(email, ADMIN_EMAIL.strip().lower().encode()) & hmac.compare_digest(pw, ADMIN_PASSWORD.encode())
            if ok:
                session.clear()
                session.permanent = True
                session["admin"] = True
                _fails.pop(ip, None)
                return redirect("/admin")
            _fails.setdefault(ip, []).append(time.time())
            error = "Wrong email or password."
    elif session.get("admin"):
        return redirect("/admin")
    return render_template("admin_login.html", error=error, configured=configured), (401 if error else 200)


@app.post("/admin/logout")
def admin_logout():
    session.clear()
    return redirect("/admin/login")


@app.route("/admin")
@page_admin
def admin_dashboard():
    return render_template("admin.html", admin_email=ADMIN_EMAIL)


# ---------- admin: API ----------
@app.get("/admin/api/summary")
@api_admin
def admin_summary():
    row = run("SELECT (SELECT COUNT(*) FROM enquiries WHERE is_read = 0) AS new_enquiries, "
              "(SELECT COUNT(*) FROM enquiries) AS total_enquiries, "
              "(SELECT COUNT(*) FROM feedback WHERE is_seen = 0) AS new_feedback, "
              "(SELECT COUNT(*) FROM feedback) AS total_feedback", fetch=True)[0]
    return jsonify(row)


@app.get("/admin/api/enquiries")
@api_admin
def admin_enquiries():
    rows = run("SELECT id, created_at, name, contact, grade, subject, message, is_read FROM enquiries ORDER BY id DESC", fetch=True)
    for r in rows:
        r["created_at"] = r["created_at"].isoformat()
        r["is_read"] = bool(r["is_read"])
    return jsonify(rows)


@app.get("/admin/api/feedback")
@api_admin
def admin_feedback():
    rows = run("SELECT * FROM feedback ORDER BY id DESC", fetch=True)
    for r in rows:
        r["created_at"] = r["created_at"].isoformat()
        for k in ("show_name", "approved", "is_seen"):
            r[k] = bool(r[k])
    return jsonify(rows)


def flag(table, column, rid):
    value = 1 if (request.get_json(silent=True) or {}).get("value", True) else 0
    run(f"UPDATE {table} SET {column} = %s WHERE id = %s", (value, rid))
    return jsonify(ok=True)


@app.post("/admin/api/enquiries/<int:rid>/read")
@api_admin
def admin_enquiry_read(rid):
    return flag("enquiries", "is_read", rid)


@app.post("/admin/api/enquiries/read-all")
@api_admin
def admin_enquiries_read_all():
    run("UPDATE enquiries SET is_read = 1")
    return jsonify(ok=True)


@app.delete("/admin/api/enquiries/<int:rid>")
@api_admin
def admin_enquiry_delete(rid):
    run("DELETE FROM enquiries WHERE id = %s", (rid,))
    return jsonify(ok=True)


@app.post("/admin/api/feedback/<int:rid>/approve")
@api_admin
def admin_feedback_approve(rid):
    return flag("feedback", "approved", rid)


@app.post("/admin/api/feedback/<int:rid>/seen")
@api_admin
def admin_feedback_seen(rid):
    return flag("feedback", "is_seen", rid)


@app.post("/admin/api/feedback/seen-all")
@api_admin
def admin_feedback_seen_all():
    run("UPDATE feedback SET is_seen = 1")
    return jsonify(ok=True)


@app.delete("/admin/api/feedback/<int:rid>")
@api_admin
def admin_feedback_delete(rid):
    run("DELETE FROM feedback WHERE id = %s", (rid,))
    return jsonify(ok=True)


@app.errorhandler(413)
def too_large(_):
    return jsonify(error="Submission is too large."), 413


# Runs on startup (python app.py or gunicorn)
try:
    init_db()
    print(f"MySQL connected. Database '{DB_NAME}' is ready.")
except pymysql.MySQLError as err:
    print(f"\nCould not connect to MySQL: {err}", file=sys.stderr)
    if not ENV_FOUND:
        print(f"No .env file found at {ENV_FILE}\nCopy .env.example to .env (exact name, no .txt) and fill in DB_PASSWORD.\n", file=sys.stderr)
    elif not DB["password"]:
        print(".env was found but DB_PASSWORD is empty. Add your MySQL password and restart.\n", file=sys.stderr)
    else:
        print("Check DB_USER / DB_PASSWORD in .env and that MySQL is running.\n", file=sys.stderr)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)),
            debug=os.environ.get("FLASK_DEBUG", "false").lower() == "true")
