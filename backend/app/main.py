import logging
import socket
import sys
import threading
import subprocess
import time
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
import asyncio
from typing import Optional
from app.core.config import settings
from app.core.firebase import init_firebase, _app as firebase_app
from app.core.database import connect_db, close_db, get_aura_modules_db, check_db_health
from app.routes import (
    auth,
    onboarding,
    medications,
    journal,
    relatives,
    sos,
    location,
    admin,
    ws,
    aura,
    user,
    notifications,
    suggestions,
    orito,
    reports,
    reminders,
    calls,
    aura_status,
)
from app.routes import settings as settings_router
from app.services.cleanup_task import cleanup_stale_modules


GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
CYAN = "\033[96m"
RESET = "\033[0m"
BOLD = "\033[1m"

UPDATE_CHECK_INTERVAL = 300


logging.basicConfig(
    level=logging.INFO if settings.environment == "production" else logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


#------This Function checks for git updates-------
def check_for_updates():
    try:
        subprocess.run(["git", "fetch"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        result = subprocess.run(
            ["git", "log", "--oneline", "HEAD..origin/main"],
            capture_output=True, text=True, check=False
        )
        return bool(result.stdout.strip())
    except Exception:
        return False


#------This Function pulls updates-------
def pull_updates():
    try:
        subprocess.run(["git", "pull"], check=True)
        return True
    except Exception:
        return False


#------This Function monitors for updates in background-------
def update_monitor():
    while True:
        time.sleep(UPDATE_CHECK_INTERVAL)
        print(f"\n{YELLOW}[UPDATE] Checking for updates...{RESET}")
        if check_for_updates():
            print(f"{GREEN}[UPDATE] Updates found! Pulling...{RESET}")
            if pull_updates():
                print(f"{GREEN}[UPDATE] Updates pulled. Restarting...{RESET}")
                os.execv(sys.executable, [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"])


#------This Function starts the background update monitor-------
def start_update_monitor():
    monitor_thread = threading.Thread(target=update_monitor, daemon=True)
    monitor_thread.start()


_cleanup_task = None


#------This Function handles the CLI arguments---------
def _get_cli_arg_value(flag: str) -> Optional[str]:
    for index, arg in enumerate(sys.argv):
        if arg == flag and index + 1 < len(sys.argv):
            return sys.argv[index + 1]
        if arg.startswith(f"{flag}="):
            return arg.split("=", 1)[1]
    return None


#------This Function resolves the runtime bind---------
def _resolve_runtime_bind() -> tuple[str, int]:
    host = _get_cli_arg_value("--host")
    port_value = _get_cli_arg_value("--port")
    launched_with_uvicorn = any("uvicorn" in arg for arg in sys.argv[:2])

    if host is None:
        host = "127.0.0.1" if launched_with_uvicorn else settings.server_host

    try:
        port = int(port_value) if port_value else settings.port
    except ValueError:
        port = settings.port

    return host, port


#------This Function gets the LAN IPv4---------
def _get_lan_ipv4() -> Optional[str]:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            ip = sock.getsockname()[0]
            if ip and not ip.startswith("127."):
                return ip
    except OSError:
        pass

    try:
        hostname_ip = socket.gethostbyname(socket.gethostname())
        if hostname_ip and not hostname_ip.startswith("127."):
            return hostname_ip
    except OSError:
        pass

    return None


#------This Function logs the access URLs---------
def _log_access_urls() -> None:
    bind_host, bind_port = _resolve_runtime_bind()
    lan_ip = _get_lan_ipv4()

    logger.info(f"Local API URL: http://127.0.0.1:{bind_port}")
    if lan_ip:
        logger.info(f"Network API URL: http://{lan_ip}:{bind_port}")
    else:
        logger.warning("Network API URL: could not determine LAN IP address")

    if bind_host in {"127.0.0.1", "localhost"}:
        logger.warning(
            "Server is bound to loopback only. Use: uvicorn app.main:app --reload --host 0.0.0.0 --port %s",
            bind_port,
        )


#------This Function handles the lifespan events---------
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _cleanup_task

    
    logger.info(f"Starting {settings.environment} environment")
    print(f"{BOLD}{BLUE}A.U.R.A Backend v1.0.0{RESET}")
    
    try:
        init_firebase()
        print(f"{GREEN}[OK] Firebase initialized{RESET}")
    except Exception as e:
        logger.error(f"Failed to initialize Firebase: {str(e)}")
        raise

    try:
        await connect_db()
        print(f"{GREEN}[OK] Database connected{RESET}")
    except Exception as e:
        logger.error(f"Failed to connect to database: {str(e)}")
        raise

    start_update_monitor()
    print(f"{CYAN}[UPDATE] Auto-update monitor started{RESET}")

    
    try:
        aura_modules_db = get_aura_modules_db()
        _cleanup_task = asyncio.create_task(cleanup_stale_modules(aura_modules_db))
        print(f"{GREEN}[OK] Background cleanup task started{RESET}")
    except Exception as e:
        logger.warning(f"Could not start cleanup task: {str(e)}")

    _log_access_urls()

    yield

    
    logger.info("Shutting down application...")
    print(f"{YELLOW}[SHUTDOWN] Stopping services...{RESET}")
    if _cleanup_task:
        _cleanup_task.cancel()
        try:
            await _cleanup_task
        except asyncio.CancelledError:
            pass

    await close_db()
    print(f"{RED}[SHUTDOWN] Application shutdown complete{RESET}")


app = FastAPI(
    title="Aura API",
    description="Assistive User Reminder App — Backend",
    version="1.0.0",
    lifespan=lifespan,
)



#------This Function handles validation errors---------
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.warning(f"Validation error for {request.method} {request.url}: {exc.errors()}")
    return JSONResponse(
        status_code=422,
        content={
            "detail": "Validation error",
            "errors": exc.errors(),
        },
    )


#------This Function handles value errors---------
@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    logger.warning(f"Value error for {request.method} {request.url}: {str(exc)}")
    return JSONResponse(
        status_code=400,
        content={"detail": str(exc)},
    )


#------This Function handles general exceptions---------
@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unexpected error for {request.method} {request.url}: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error" if settings.environment == "production" else str(exc)},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(user.router)
app.include_router(onboarding.router)
app.include_router(medications.router)
app.include_router(journal.router)
app.include_router(relatives.router)
app.include_router(sos.router)
app.include_router(location.router)
app.include_router(notifications.router)
app.include_router(settings_router.router)
app.include_router(suggestions.router)
app.include_router(admin.router)
app.include_router(ws.router)
app.include_router(aura.router)
app.include_router(orito.router)
app.include_router(reports.router)
app.include_router(reminders.router)
app.include_router(calls.router)
app.include_router(aura_status.router)


#------This Function returns health status---------
@app.get("/health")
async def health():
    return {"status": "alive", "service": "aura-backend", "environment": settings.environment}


#------This Function returns detailed health status---------
@app.get("/health/detailed")
async def health_detailed():
    db_health = await check_db_health()
    
    firebase_health = {"status": "healthy"}
    try:
        if firebase_app is None:
            firebase_health = {"status": "uninitialized"}
    except Exception as e:
        firebase_health = {"status": "unhealthy", "error": str(e)}
    
    aura_modules_health = {"total": 0, "online": 0, "offline": 0}
    try:
        aura_modules_db = get_aura_modules_db()
        all_modules = await aura_modules_db.list_modules(limit=1000)
        aura_modules_health = {
            "total": len(all_modules),
            "online": sum(1 for m in all_modules if m.get("status") == "online"),
            "offline": sum(1 for m in all_modules if m.get("status") != "online")
        }
    except Exception as e:
        aura_modules_health = {"error": str(e)}
    
    health_score = 100
    if db_health.get("status") != "healthy":
        health_score -= 40
    if firebase_health.get("status") not in ("healthy", "uninitialized"):
        health_score -= 30
    if aura_modules_health.get("total", 0) > 0 and aura_modules_health.get("online", 0) == 0:
        health_score -= 30
    
    health_score = max(0, health_score)
    
    return {
        "status": "alive",
        "service": "aura-backend",
        "environment": settings.environment,
        "database": db_health,
        "firebase": firebase_health,
        "aura_modules": aura_modules_health,
        "health_score": health_score
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.server_host,
        port=settings.port,
        reload=settings.environment != "production",
    )
