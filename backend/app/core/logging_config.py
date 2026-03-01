import logging
import sys

# ── ANSI colour palette ──────────────────────────────────────────────────────
_R = "\033[0m"       # reset
_BOLD = "\033[1m"
_DIM = "\033[2m"

_GREY   = "\033[38;5;245m"
_CYAN   = "\033[38;5;51m"
_GREEN  = "\033[38;5;82m"
_YELLOW = "\033[38;5;220m"
_ORANGE = "\033[38;5;208m"
_RED    = "\033[38;5;196m"
_PINK   = "\033[38;5;213m"
_BLUE   = "\033[38;5;39m"
_WHITE  = "\033[38;5;255m"

_LEVEL_STYLES: dict[int, tuple[str, str]] = {
    logging.DEBUG:    (_DIM + _GREY,   "  DEBUG "),
    logging.INFO:     (_CYAN,          "  INFO  "),
    logging.WARNING:  (_YELLOW,        "  WARN  "),
    logging.ERROR:    (_RED,           "  ERROR "),
    logging.CRITICAL: (_BOLD + _PINK,  "  CRIT  "),
}

# Module-name → short tag colour
_MODULE_COLOUR = _BLUE


class _AuraFormatter(logging.Formatter):
    """Compact, colour-coded single-line formatter for A.U.R.A."""

    def format(self, record: logging.LogRecord) -> str:
        colour, label = _LEVEL_STYLES.get(record.levelno, (_WHITE, " UNKNOWN"))

        # Shorten module name: app.routes.orito → routes.orito
        name = record.name
        if name.startswith("app."):
            name = name[4:]

        # Time – just HH:MM:SS
        time_str = self.formatTime(record, "%H:%M:%S")

        # Message (handles exceptions inline)
        msg = record.getMessage()
        if record.exc_info:
            if not record.exc_text:
                record.exc_text = self.formatException(record.exc_info)
        if record.exc_text:
            msg = f"{msg}\n{_DIM}{record.exc_text}{_R}"

        return (
            f"{_DIM}{time_str}{_R} "
            f"{colour}{_BOLD}{label}{_R} "
            f"{_MODULE_COLOUR}{name:<22}{_R} "
            f"{_WHITE}{msg}{_R}"
        )


def setup_logging(debug: bool = False) -> None:
    """
    Configure logging for A.U.R.A backend:
    - Beautiful colour-coded output for app loggers
    - Silences verbose third-party noise (pymongo, httpx, watchfiles…)
    """
    root = logging.getLogger()
    root.setLevel(logging.DEBUG if debug else logging.INFO)

    # Remove any existing handlers (e.g. from basicConfig)
    root.handlers.clear()

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(logging.DEBUG if debug else logging.INFO)
    handler.setFormatter(_AuraFormatter())
    root.addHandler(handler)

    # ── Silence noisy third-party loggers ─────────────────────────────────────
    _quiet = [
        # pymongo internal events (the JSON spam)
        "pymongo",
        "pymongo.topology",
        "pymongo.connection",
        "pymongo.serverSelection",
        "pymongo.command",
        "pymongo.monitoring",
        # motor (async pymongo wrapper)
        "motor",
        # httpx
        "httpx",
        "httpcore",
        # watchfiles (uvicorn reloader)
        "watchfiles",
        # beanie / odmantic
        "beanie",
        # uvicorn access log (we log at app level instead)
        "uvicorn.access",
    ]
    for name in _quiet:
        logging.getLogger(name).setLevel(logging.WARNING)

    # Keep uvicorn.error visible but clean
    logging.getLogger("uvicorn.error").setLevel(logging.INFO)
