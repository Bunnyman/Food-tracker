from __future__ import annotations

import os
from dataclasses import dataclass
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    bot_token: str
    anthropic_api_key: str | None
    claude_model: str
    db_path: str
    tz: ZoneInfo


def load_settings() -> Settings:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        raise SystemExit("TELEGRAM_BOT_TOKEN не задано. Див. .env.example")
    return Settings(
        bot_token=token,
        anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY", "").strip() or None,
        claude_model=os.environ.get("CLAUDE_MODEL", "claude-opus-5").strip(),
        db_path=os.environ.get("DB_PATH", "data/food.db"),
        tz=ZoneInfo(os.environ.get("TZ", "Europe/Kyiv")),
    )
