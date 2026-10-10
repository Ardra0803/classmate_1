# Classmate tutoring website

Python **Flask** backend (`app.py`) + **MySQL** database + HTML / CSS / JavaScript frontend. No login needed.

## 1. Install MySQL
Install MySQL Server (https://dev.mysql.com/downloads/mysql/) or XAMPP / MariaDB, and remember your root password.

## 2. Run the website
1. Install Python 3.9+
2. In this folder:
   - `python -m venv .venv`
   - Windows: `.venv\Scripts\activate`   Mac/Linux: `source .venv/bin/activate`
   - `pip install -r requirements.txt`
3. Copy `.env.example` to `.env` and fill in your MySQL details (`DB_USER`, `DB_PASSWORD` ...).
4. `python app.py`  (it creates the `classmate` database and tables automatically)
5. Open http://localhost:5000

## Structure
- `app.py`: main file, routes and API, plus your admin login and email settings at the top
- `templates/admin.html`, `templates/admin_login.html`, `static/admin.css`, `static/admin.js`: the admin page
- `schema.sql`: table definitions (optional, `app.py` creates them for you)
- `.env`: your database settings (keep private, never share it)
- `templates/index.html`: page structure and text
- `static/style.css`: colours and fonts (top of file), light and dark themes
- `static/app.js`: frontend behaviour
- `data/site.json`: tagline, tutors (Mohammed Rabiyath, Ardra), subjects, steps, contact. Replace every "Fill with your data".

## What is stored in MySQL
- `feedback` table: every student feedback submission (name, class, subject, tutor, duration, email, 5 star ratings, marks before/after, liked, improve, message, recommend, approved).
- `enquiries` table: intro-call requests from the contact form.
- Past work is built automatically from approved rows in `feedback`. Names and emails are never shown there.

## Viewing and managing data
```sql
USE classmate;
SELECT * FROM feedback ORDER BY id DESC;
SELECT * FROM enquiries ORDER BY id DESC;
DELETE FROM feedback WHERE id = 3;            -- remove an entry
```
You can also use MySQL Workbench, phpMyAdmin or DBeaver.

## Reviewing feedback before it goes live
Set `REQUIRE_APPROVAL=true` in `.env`. New feedback stays hidden until you run:
```sql
UPDATE feedback SET approved = 1 WHERE id = 5;
```
To hide an entry later: `UPDATE feedback SET approved = 0 WHERE id = 5;`

## Add earlier students' feedback yourself
Insert rows with MySQL Workbench or SQL (`INSERT INTO feedback ...`), with `approved = 1`.

## Deploying (summary)
In `.env` on the server set `BEHIND_PROXY=true`, `COOKIE_SECURE=true` and leave `FLASK_DEBUG` out. Fill `ADMIN_SECRET_KEY` in `app.py`. Use gunicorn: `pip install gunicorn` then `gunicorn app:app`. Turn off `debug=True` in `app.py`, and use a hosted MySQL (or the host's MySQL) with its details in `.env`.

## Admin page (private)
Open http://localhost:5000/admin (no link to it appears on the public site).

1. Open `app.py` and fill in the block marked **ADMIN SETTINGS** near the top:
   - `ADMIN_EMAIL` and `ADMIN_PASSWORD`: your login (use a strong password)
   - `ADMIN_SECRET_KEY`: any long random text (keeps you logged in across restarts)
2. Restart `python app.py` and log in at `/admin`.

What you can do there:
- See every enquiry (with tap-to-call / email links) and every feedback entry with all ratings and the private email.
- New items are highlighted with a red "New" tag and counted in the tab badges and the browser tab title, e.g. "(2) Admin".
- Mark as read / seen, show only new items, mark all as read.
- Hide feedback from the website, publish it again, or delete it (deleting also removes it from Past work).

### Notifications
- **While the admin page is open:** it checks every 20 seconds, plays a short sound, shows a message, and sends a desktop notification if you press **Turn on alerts**.
- **By email (optional):** fill in `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` and `NOTIFY_EMAIL` in the same block. For Gmail use `smtp.gmail.com`, port 587 and an App Password (Google account, Security, 2-step verification, App passwords). Leave them as "Fill with your data" to skip emails.

### Security notes
- Login lasts 8 hours; 5 wrong attempts lock that visitor out for 15 minutes.
- Use HTTPS when you put the site online (most hosts provide it), because the password is typed into the page.
- The credentials are in `app.py`, so don't share or publish that file.
