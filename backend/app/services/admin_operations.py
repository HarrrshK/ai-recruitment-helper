"""Single-process maintenance admission and destructive-operation interlock."""
from threading import RLock

lock = RLock()
active_requests = 0
maintenance = False
cleanup_running = False


def enter(path):
    global active_requests
    if not path.startswith("/api/") or path.startswith(("/api/dev/cleanup", "/api/dev/maintenance")):
        exempt = True
    else:
        exempt = False
    with lock:
        if cleanup_running and path.startswith("/api/") and path not in ("/api/dev/cleanup/execute",):
            return None
        if maintenance and not path.startswith("/api/dev/") and path not in ("/api/auth/login", "/api/auth/me"):
            return None
        if exempt:
            return False
        active_requests += 1
        return True


def leave():
    global active_requests
    with lock:
        active_requests -= 1
