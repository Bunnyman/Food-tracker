import aiohttp
import pytest

from bot.health import start_health_server


@pytest.mark.asyncio
async def test_health_endpoint_responds():
    runner = await start_health_server(0)
    port = runner.addresses[0][1]
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"http://127.0.0.1:{port}/health") as resp:
                assert resp.status == 200
                assert await resp.text() == "ok"
    finally:
        await runner.cleanup()
