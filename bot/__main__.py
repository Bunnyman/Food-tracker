from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import BotCommand

from .config import load_settings
from .db import Database
from .handlers import build_router
from .nutrition import NutritionService

COMMANDS = [
    BotCommand(command="today", description="Ліміт на сьогодні та список продуктів"),
    BotCommand(command="add", description="Додати страву/продукт"),
    BotCommand(command="goal", description="Задати ціль по ккал та БЖВ"),
    BotCommand(command="products", description="Мої продукти"),
    BotCommand(command="eat", description="Записати: /eat назва грами"),
    BotCommand(command="undo", description="Відмінити останній запис"),
    BotCommand(command="help", description="Допомога"),
    BotCommand(command="cancel", description="Скасувати поточну дію"),
]


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    settings = load_settings()

    db = Database(settings.db_path)
    await db.connect()
    nutrition = NutritionService.from_settings(settings.anthropic_api_key, settings.claude_model)

    bot = Bot(settings.bot_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher(storage=MemoryStorage(), db=db, nutrition=nutrition, settings=settings)
    dp.include_router(build_router())

    await bot.set_my_commands(COMMANDS)
    try:
        await bot.delete_webhook(drop_pending_updates=True)
        await dp.start_polling(bot)
    finally:
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
