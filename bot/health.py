"""Мінімальний HTTP-endpoint для хостингів, які очікують відкритий порт (Render, Koyeb тощо)."""
from __future__ import annotations

import logging

from aiohttp import web

log = logging.getLogger(__name__)


async def _ok(_: web.Request) -> web.Response:
    return web.Response(text="ok")


async def start_health_server(port: int) -> web.AppRunner:
    app = web.Application()
    app.router.add_get("/", _ok)
    app.router.add_get("/health", _ok)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", port).start()
    log.info("Health endpoint слухає порт %s", port)
    return runner
