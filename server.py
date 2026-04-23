import base64
import hashlib
import hmac
import json
import os
import secrets
import socket
import sqlite3
import time
from pathlib import Path
from typing import Optional
from urllib import error, request

import uvicorn
from fastapi import FastAPI, Form, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates


ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "planner.db"
ENV_PATH = ROOT / ".env"
TEMPLATES = Jinja2Templates(directory=str(ROOT / "templates"))

HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "8000"))
SESSION_COOKIE = "planner_session"
SESSION_TTL_SECONDS = 60 * 60 * 24 * 14
PBKDF2_ITERATIONS = 390_000
MAX_LOGIN_ATTEMPTS = 5
BLOCK_SECONDS = 60 * 10

login_attempts = {}

app = FastAPI(title="Resilient Planner")


def load_env_file():
    if not ENV_PATH.exists():
        return

    for raw_line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def get_secret_key() -> str:
    secret = os.environ.get("APP_SECRET_KEY")
    if secret:
        return secret
    return "development-only-secret-change-me"


def use_secure_cookie(request: Optional[Request] = None) -> bool:
    env_value = os.environ.get("COOKIE_SECURE", "").lower()
    if env_value in {"1", "true", "yes"}:
        return True
    if request:
        proto = request.headers.get("x-forwarded-proto") or request.url.scheme
        return proto == "https"
    return False


def public_app_url() -> str:
    explicit = os.environ.get("PUBLIC_APP_URL")
    if explicit:
        return explicit.rstrip("/")
    render_url = os.environ.get("RENDER_EXTERNAL_URL")
    if render_url:
        return render_url.rstrip("/")
    return f"http://{get_local_ip()}:{PORT}"


def get_local_ip() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


def db_connection():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    with db_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                password_salt TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
            """
        )
        connection.commit()


def bootstrap_admin_user():
    username = os.environ.get("INITIAL_ADMIN_USERNAME", "").strip()
    password = os.environ.get("INITIAL_ADMIN_PASSWORD", "").strip()
    if not username or not password:
        return

    with db_connection() as connection:
        existing = connection.execute("SELECT COUNT(*) AS count FROM users").fetchone()["count"]
        if existing:
            return
        password_hash, salt = hash_password(password)
        connection.execute(
            """
            INSERT INTO users (username, password_hash, password_salt, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (username, password_hash, salt, int(time.time())),
        )
        connection.commit()


def hash_password(password: str, salt: Optional[str] = None):
    salt_bytes = secrets.token_bytes(16) if salt is None else bytes.fromhex(salt)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt_bytes,
        PBKDF2_ITERATIONS,
    )
    return digest.hex(), salt_bytes.hex()


def verify_password(password: str, password_hash: str, salt: str) -> bool:
    computed, _ = hash_password(password, salt)
    return hmac.compare_digest(computed, password_hash)


def create_session_token(user_id: int) -> str:
    payload = {
        "user_id": user_id,
        "issued_at": int(time.time()),
        "csrf": secrets.token_urlsafe(24),
    }
    payload_json = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(payload_json).decode("utf-8")
    signature = hmac.new(
        get_secret_key().encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{payload_b64}.{signature}"


def decode_session_token(token: str):
    if not token or "." not in token:
        return None
    payload_b64, signature = token.rsplit(".", 1)
    expected = hmac.new(
        get_secret_key().encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, signature):
        return None
    try:
        payload_json = base64.urlsafe_b64decode(payload_b64.encode("utf-8"))
        payload = json.loads(payload_json.decode("utf-8"))
    except Exception:
        return None
    if int(time.time()) - int(payload.get("issued_at", 0)) > SESSION_TTL_SECONDS:
        return None
    return payload


def current_session(request: Request):
    token = request.cookies.get(SESSION_COOKIE, "")
    return decode_session_token(token)


def current_user(request: Request):
    session = current_session(request)
    if not session:
        return None
    with db_connection() as connection:
        return connection.execute("SELECT * FROM users WHERE id = ?", (session["user_id"],)).fetchone()


def require_user(request: Request):
    user = current_user(request)
    if not user:
        return None
    return user


def verify_csrf(request: Request):
    session = current_session(request)
    if not session:
        return False
    return hmac.compare_digest(
        request.headers.get("X-CSRF-Token", ""),
        session.get("csrf", ""),
    )


def login_block_status(ip_address: str):
    record = login_attempts.get(ip_address)
    if not record:
        return False
    now = time.time()
    if record["blocked_until"] > now:
        return True
    if record["blocked_until"] <= now and record["attempts"] >= MAX_LOGIN_ATTEMPTS:
        login_attempts.pop(ip_address, None)
    return False


def register_login_failure(ip_address: str):
    now = time.time()
    record = login_attempts.setdefault(ip_address, {"attempts": 0, "blocked_until": 0})
    record["attempts"] += 1
    if record["attempts"] >= MAX_LOGIN_ATTEMPTS:
        record["blocked_until"] = now + BLOCK_SECONDS


def clear_login_failures(ip_address: str):
    login_attempts.pop(ip_address, None)


def asset(path: str):
    return FileResponse(ROOT / path)


def auth_template_context(request: Request):
    with db_connection() as connection:
        has_user = bool(connection.execute("SELECT COUNT(*) AS count FROM users").fetchone()["count"])
    return {
        "request": request,
        "has_user": has_user,
        "bootstrap_ready": bool(
            os.environ.get("INITIAL_ADMIN_USERNAME", "").strip()
            and os.environ.get("INITIAL_ADMIN_PASSWORD", "").strip()
        ),
    }


def build_schedule_prompt(payload):
    return {
        "system": (
            "あなたは日本語で、大学生活と就活と制作を両立させるための現実的なスケジューラです。"
            "目的は、完璧な予定ではなく『崩れても戻れる』現実的な明日のタイムスケジュールを作ることです。"
            "固定条件を優先し、無理な詰め込みを避け、疲労が見える日は負荷を下げてください。"
        ),
        "user": {
            "target_date": payload.get("targetDate"),
            "fixed_rules_text": payload.get("fixedRulesText", ""),
            "todo_items": payload.get("todoItems", []),
            "calendar_note": payload.get("calendarNote", ""),
            "recent_history": payload.get("recentHistory", []),
            "reflection": payload.get("reflection", ""),
            "errands": payload.get("errands", []),
            "future_tasks": payload.get("futureTasks", []),
            "heuristic_schedule": payload.get("heuristicSchedule", {}),
            "fixed_rules": {
                "wake": "07:00",
                "dinner": "20:00",
                "sleep": "23:00",
                "work": ["水 17:00-22:00", "金 17:00-22:00"],
                "classes": ["月 13:00-14:30", "火 13:00-16:00", "金 14:40-16:00"],
            },
            "instructions": [
                "JSONで返してください。",
                "schedule は start, end, title, category, note, fixed を持つ配列にしてください。",
                "summary と priority_todos と warnings も返してください。",
                "時間は24時間表記 HH:MM を使ってください。",
                "fixed_rules_text に書かれた内容があれば最優先で反映してください。",
                "todo_items と calendar_note に重要情報があれば反映してください。",
                "recent_history に直近の記録があれば、似た曜日の負荷感や持ち越し課題も参考にしてください。",
                "23:00 を超える予定は作らないでください。",
                "授業やバイトに重なる予定は置かないでください。",
                "水曜と金曜は回復優先、木曜と土曜は成長枠を活かしてください。",
            ],
        },
    }


def build_schedule_schema():
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "summary": {"type": "array", "items": {"type": "string"}},
            "priority_todos": {"type": "array", "items": {"type": "string"}},
            "warnings": {"type": "array", "items": {"type": "string"}},
            "schedule": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "start": {"type": "string"},
                        "end": {"type": "string"},
                        "title": {"type": "string"},
                        "category": {"type": "string"},
                        "note": {"type": "string"},
                        "fixed": {"type": "boolean"},
                    },
                    "required": ["start", "end", "title", "category", "note", "fixed"],
                },
            },
        },
        "required": ["summary", "priority_todos", "warnings", "schedule"],
    }


def build_chat_input(payload):
    return [
        {
            "role": "system",
            "content": (
                "あなたは生活設計と優先順位整理を手伝う日本語の相棒です。"
                "固定スケジュール、疲労感、就活、研究、制作を踏まえて、短く具体的に助言してください。"
                "押し付けず、現実的で、次の一歩が分かるように答えてください。"
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "message": payload.get("message", ""),
                    "context": payload.get("context", {}),
                    "instructions": [
                        "必要なら優先順位を3つ以内で提案してください。",
                        "必要なら今日や明日に落とし込んでください。",
                        "回答は自然な日本語のテキストで返してください。",
                    ],
                },
                ensure_ascii=False,
            ),
        },
    ]


def post_responses(body):
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY が見つかりません。.env に設定してください。")

    req = request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=90) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI API エラー: {exc.code} {details}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"OpenAI API への接続に失敗しました: {exc.reason}") from exc


def extract_output_text(data):
    if data.get("output_text"):
        return data["output_text"]
    for output in data.get("output", []):
        for content in output.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                return content["text"]
    raise RuntimeError("OpenAI API の応答からテキストを取得できませんでした。")


def call_openai_schedule(payload):
    prompt = build_schedule_prompt(payload)
    response = post_responses(
        {
            "model": payload.get("model") or os.environ.get("OPENAI_MODEL") or "gpt-5-mini",
            "input": [
                {"role": "system", "content": prompt["system"]},
                {"role": "user", "content": json.dumps(prompt["user"], ensure_ascii=False)},
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "daily_schedule",
                    "strict": True,
                    "schema": build_schedule_schema(),
                }
            },
            "store": False,
        }
    )
    return json.loads(extract_output_text(response))


def call_openai_chat(payload):
    body = {
        "model": payload.get("model") or os.environ.get("OPENAI_MODEL") or "gpt-5-mini",
        "input": build_chat_input(payload),
        "store": False,
    }
    if payload.get("previousResponseId"):
        body["previous_response_id"] = payload["previousResponseId"]
    response = post_responses(body)
    return {
        "answer": extract_output_text(response),
        "response_id": response.get("id", ""),
    }


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Cache-Control"] = "no-store"
    if use_secure_cookie(request):
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


@app.on_event("startup")
def startup():
    load_env_file()
    init_db()
    bootstrap_admin_user()


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request, error: Optional[str] = None, native_app: Optional[str] = None):
    if current_user(request):
        destination = "/?native_app=1" if native_app == "1" else "/"
        return RedirectResponse(destination, status_code=303)
    context = auth_template_context(request)
    context["error"] = error
    context["native_app"] = native_app == "1"
    return TEMPLATES.TemplateResponse(request=request, name="login.html", context=context)


@app.post("/login")
def login(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    native_app: Optional[str] = Form(default=None),
):
    ip_address = request.client.host if request.client else "unknown"
    if login_block_status(ip_address):
        return login_page(
            request,
            error="ログイン失敗が続いたため、少し待ってから再試行してください。",
            native_app=native_app,
        )

    with db_connection() as connection:
        user = connection.execute("SELECT * FROM users WHERE username = ?", (username.strip(),)).fetchone()

    if not user or not verify_password(password, user["password_hash"], user["password_salt"]):
        register_login_failure(ip_address)
        return login_page(
            request,
            error="ユーザー名またはパスワードが正しくありません。",
            native_app=native_app,
        )

    clear_login_failures(ip_address)
    token = create_session_token(user["id"])
    response = RedirectResponse("/?native_app=1" if native_app == "1" else "/", status_code=303)
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        secure=use_secure_cookie(request),
        samesite="lax",
        max_age=SESSION_TTL_SECONDS,
        path="/",
    )
    return response


@app.post("/logout")
def logout(request: Request):
    native_app = request.query_params.get("native_app") == "1"
    response = RedirectResponse("/login?native_app=1" if native_app else "/login", status_code=303)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    user = require_user(request)
    if not user:
        native_app = request.query_params.get("native_app") == "1"
        return RedirectResponse("/login?native_app=1" if native_app else "/login", status_code=303)
    return FileResponse(ROOT / "index.html")


@app.get("/api/status")
def api_status(request: Request):
    user = require_user(request)
    if not user:
        return JSONResponse({"authenticated": False}, status_code=401)
    session = current_session(request)
    return {
        "authenticated": True,
        "configured": bool(os.environ.get("OPENAI_API_KEY")),
        "model": os.environ.get("OPENAI_MODEL", "gpt-5-mini"),
        "csrf_token": session["csrf"],
        "app_url": public_app_url(),
        "install_ready": public_app_url().startswith("https://"),
        "username": user["username"],
    }


@app.post("/api/generate-schedule")
async def api_generate_schedule(request: Request):
    user = require_user(request)
    if not user:
        return JSONResponse({"error": "認証が必要です。"}, status_code=401)
    if not verify_csrf(request):
        return JSONResponse({"error": "CSRF検証に失敗しました。"}, status_code=403)
    payload = await request.json()
    try:
        return {"result": call_openai_schedule(payload)}
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)


@app.post("/api/chat")
async def api_chat(request: Request):
    user = require_user(request)
    if not user:
        return JSONResponse({"error": "認証が必要です。"}, status_code=401)
    if not verify_csrf(request):
        return JSONResponse({"error": "CSRF検証に失敗しました。"}, status_code=403)
    payload = await request.json()
    try:
        return {"result": call_openai_chat(payload)}
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)


@app.get("/styles.css")
def styles():
    return asset("styles.css")


@app.get("/app.js")
def app_js():
    return asset("app.js")


@app.get("/manifest.webmanifest")
def manifest():
    return asset("manifest.webmanifest")


@app.get("/service-worker.js")
def service_worker():
    return asset("service-worker.js")


@app.get("/icon.svg")
def icon_svg():
    return asset("icon.svg")


@app.get("/icon-192.png")
def icon_192():
    return asset("icon-192.png")


@app.get("/icon-512.png")
def icon_512():
    return asset("icon-512.png")


@app.get("/favicon.ico")
def favicon():
    return asset("icon-192.png")


if __name__ == "__main__":
    load_env_file()
    init_db()
    bootstrap_admin_user()
    uvicorn.run("server:app", host=HOST, port=PORT, reload=False)
