"""Інтеграційний smoke-тест: проганяє основні сценарії через Dispatcher із фейковим Telegram."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
import pytest_asyncio
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.base import BaseSession
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.methods import (
    AnswerCallbackQuery,
    EditMessageText,
    SendMessage,
    TelegramMethod,
)
from aiogram.types import CallbackQuery, Chat, InlineKeyboardMarkup, Message, Update, User

from bot.config import Settings
from bot.db import Database
from bot.handlers import build_router
from bot.models import Macros
from bot.nutrition import LookupResult, NutritionService

USER = User(id=42, is_bot=False, first_name="Тест")
CHAT = Chat(id=42, type="private")


class FakeSession(BaseSession):
    def __init__(self) -> None:
        super().__init__()
        self.sent: list[dict] = []
        self._msg_id = 100

    async def close(self) -> None:  # pragma: no cover
        pass

    async def stream_content(self, *a, **kw):  # pragma: no cover
        raise NotImplementedError

    async def make_request(self, bot: Bot, method: TelegramMethod, timeout: int | None = None):
        self.sent.append({"method": type(method).__name__, **method.model_dump(exclude_none=True)})
        inline = method.reply_markup if isinstance(getattr(method, "reply_markup", None), InlineKeyboardMarkup) else None
        if isinstance(method, SendMessage):
            self._msg_id += 1
            return Message(
                message_id=self._msg_id, date=datetime.now(), chat=CHAT, from_user=None,
                text=method.text, reply_markup=inline,
            ).as_(bot)
        if isinstance(method, EditMessageText):
            return Message(
                message_id=method.message_id, date=datetime.now(), chat=CHAT,
                text=method.text, reply_markup=inline,
            ).as_(bot)
        if isinstance(method, AnswerCallbackQuery):
            return True
        return True

    def last_text(self) -> str:
        for call in reversed(self.sent):
            if call["method"] in ("SendMessage", "EditMessageText"):
                return call["text"]
        raise AssertionError("no messages sent")

    def last_keyboard(self):
        for call in reversed(self.sent):
            if call["method"] in ("SendMessage", "EditMessageText") and call.get("reply_markup"):
                return call["reply_markup"]
        raise AssertionError("no keyboard sent")


class FakeProvider:
    async def lookup(self, query: str):
        if query.lower().startswith("гречка"):
            return LookupResult("Гречка варена", Macros(110, 4.2, 1.1, 21), 150, "claude", "")
        return None


SETTINGS = Settings("1:TEST", None, "claude-opus-5", ":memory:", ZoneInfo("Europe/Kyiv"))
SESSION = FakeSession()
BOT = Bot("1:TEST", session=SESSION, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
# Роутери — модульні синглтони, тому Dispatcher створюється один раз на модуль тестів.
DP = Dispatcher(storage=MemoryStorage(), nutrition=NutritionService([FakeProvider()]), settings=SETTINGS)
DP.include_router(build_router())


@pytest_asyncio.fixture
async def env():
    db = Database(":memory:")
    await db.connect()
    session, bot, dp = SESSION, BOT, DP
    session.sent.clear()
    dp.storage.storage.clear()
    dp["db"] = db

    counter = {"n": 0}

    async def send_text(text: str):
        counter["n"] += 1
        msg = Message(
            message_id=counter["n"], date=datetime.now(), chat=CHAT, from_user=USER, text=text,
        )
        await dp.feed_update(bot, Update(update_id=counter["n"], message=msg))

    async def click(data: str, message_id: int = 500):
        counter["n"] += 1
        msg = Message(message_id=message_id, date=datetime.now(), chat=CHAT, text="…")
        cq = CallbackQuery(id=str(counter["n"]), from_user=USER, chat_instance="x", data=data, message=msg)
        await dp.feed_update(bot, Update(update_id=counter["n"], callback_query=cq))

    yield session, db, send_text, click
    await db.close()


def _inline_datas(markup) -> list[str]:
    rows = markup["inline_keyboard"] if isinstance(markup, dict) else markup.inline_keyboard
    out = []
    for row in rows:
        for b in row:
            out.append(b["callback_data"] if isinstance(b, dict) else b.callback_data)
    return out


@pytest.mark.asyncio
async def test_full_flow(env):
    session, db, send_text, click = env

    await send_text("/start")
    assert "Привіт" in session.last_text()

    await send_text("/goal 2000 150 60 200")
    assert "Збережено" in session.last_text()
    assert await db.get_goal(USER.id) == Macros(2000, 150, 60, 200)

    # Додавання продукту через автопошук
    await send_text("/add гречка")
    assert "Гречка варена" in session.last_text()
    await click("add:save")
    assert "порцію" in session.last_text()
    await click("portion:150")
    assert "Додано до списку" in session.last_text()
    products = await db.list_products(USER.id)
    assert len(products) == 1 and products[0].portion_g == 150

    # Не знайдено → ручне введення
    await send_text("➕ Додати продукт")
    await send_text("щось невідоме")
    assert "Не вдалося" in session.last_text()
    await click("add:manual")
    await send_text("100 10 5 2")
    await send_text("200")
    assert "Додано до списку" in session.last_text()
    assert len(await db.list_products(USER.id)) == 2

    # Сьогодні: список продуктів + запис натисканням
    await send_text("📅 Сьогодні")
    text = session.last_text()
    assert "залишилось <b>2000</b> ккал" in text
    datas = _inline_datas(session.last_keyboard())
    eat = [d for d in datas if d.startswith("eat:")]
    assert len(eat) == 2
    grechka_id = products[0].id
    await click(f"eat:{grechka_id}")
    text = session.last_text()
    assert "залишилось <b>1835</b> ккал" in text  # 2000 - 110*1.5
    assert "Гречка варена — 150 г" in text

    # Відміна останнього запису
    await click("today:undo")
    assert "залишилось <b>2000</b> ккал" in session.last_text()

    # /eat з довільною кількістю
    await send_text("/eat гречка 100")
    assert "залишилось <b>1890</b> ккал" in session.last_text()


@pytest.mark.asyncio
async def test_menu_button_interrupts_fsm(env):
    session, db, send_text, click = env
    await send_text("/goal")
    assert "Введіть ціль" in session.last_text()
    await send_text("📅 Сьогодні")  # кнопка меню має перервати введення цілі
    assert "Ціль не задана" in session.last_text()
    await send_text("/goal")
    await send_text("1800")
    assert (await db.get_goal(USER.id)).kcal == 1800


@pytest.mark.asyncio
async def test_stale_callback(env):
    session, db, send_text, click = env
    await click("add:save")
    last = session.sent[-1]
    assert last["method"] == "AnswerCallbackQuery" and "неактуальна" in last["text"]


@pytest.mark.asyncio
async def test_product_delete_flow(env):
    session, db, send_text, click = env
    p = await db.add_product(USER.id, "Банан", Macros(89, 1, 0, 23))
    await send_text("/products")
    assert f"prod:{p.id}" in _inline_datas(session.last_keyboard())
    await click(f"prod:{p.id}")
    assert "Банан" in session.last_text()
    await click(f"prod_del:{p.id}")
    assert "Видалити" in session.last_text()
    await click(f"prod_del_yes:{p.id}")
    assert await db.list_products(USER.id) == []
    assert "порожній" in session.last_text()
