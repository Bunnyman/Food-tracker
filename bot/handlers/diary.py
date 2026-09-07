from __future__ import annotations

import logging
from datetime import datetime

from aiogram import F, Router
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command, CommandObject
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardMarkup, Message

from ..config import Settings
from ..db import Database
from ..keyboards import BTN_TODAY, BTN_UNDO, main_menu, today_keyboard
from ..texts import day_summary, fmt_num, macros_line, parse_numbers

router = Router(name="diary")
log = logging.getLogger(__name__)

MONTHS = [
    "січня", "лютого", "березня", "квітня", "травня", "червня",
    "липня", "серпня", "вересня", "жовтня", "листопада", "грудня",
]


def now_local(settings: Settings) -> datetime:
    return datetime.now(settings.tz)


def today_key(settings: Settings) -> str:
    return now_local(settings).date().isoformat()


def today_label(settings: Settings) -> str:
    d = now_local(settings)
    return f"Сьогодні, {d.day} {MONTHS[d.month - 1]}"


async def render_today(user_id: int, db: Database, settings: Settings) -> tuple[str, InlineKeyboardMarkup]:
    day = today_key(settings)
    goal = await db.get_goal(user_id)
    totals = await db.day_totals(user_id, day)
    entries = await db.list_entries(user_id, day)
    products = await db.list_products(user_id)
    return day_summary(today_label(settings), goal, totals, entries), today_keyboard(products)


async def send_today(message: Message, db: Database, settings: Settings) -> None:
    text, kb = await render_today(message.from_user.id, db, settings)
    await message.answer(text, reply_markup=kb)


async def edit_today(callback: CallbackQuery, db: Database, settings: Settings) -> None:
    text, kb = await render_today(callback.from_user.id, db, settings)
    try:
        await callback.message.edit_text(text, reply_markup=kb)
    except TelegramBadRequest as exc:
        if "message is not modified" not in str(exc):
            raise


@router.message(Command("today"))
@router.message(F.text == BTN_TODAY)
async def cmd_today(message: Message, db: Database, settings: Settings, state: FSMContext) -> None:
    await state.clear()
    await db.ensure_user(message.from_user.id)
    await send_today(message, db, settings)


@router.callback_query(F.data == "today:refresh")
async def cb_refresh(callback: CallbackQuery, db: Database, settings: Settings) -> None:
    await edit_today(callback, db, settings)
    await callback.answer("Оновлено")


@router.callback_query(F.data.startswith("eat:"))
async def cb_eat(callback: CallbackQuery, db: Database, settings: Settings) -> None:
    product_id = int(callback.data.split(":", 1)[1])
    product = await db.get_product(callback.from_user.id, product_id)
    if product is None:
        await callback.answer("Продукт не знайдено", show_alert=True)
        await edit_today(callback, db, settings)
        return
    entry = await db.add_entry(
        callback.from_user.id, product, product.portion_g, today_key(settings), now_local(settings)
    )
    await edit_today(callback, db, settings)
    await callback.answer(f"+ {product.name} {fmt_num(entry.grams)} г ({fmt_num(entry.macros.kcal)} ккал)")


async def _undo(user_id: int, db: Database, settings: Settings) -> str:
    entry = await db.delete_last_entry(user_id, today_key(settings))
    if entry is None:
        return "Сьогодні ще немає записів."
    return f"Видалено: {entry.product_name} {fmt_num(entry.grams)} г ({fmt_num(entry.macros.kcal)} ккал)"


@router.callback_query(F.data == "today:undo")
async def cb_undo(callback: CallbackQuery, db: Database, settings: Settings) -> None:
    text = await _undo(callback.from_user.id, db, settings)
    await edit_today(callback, db, settings)
    await callback.answer(text)


@router.message(Command("undo"))
@router.message(F.text == BTN_UNDO)
async def cmd_undo(message: Message, db: Database, settings: Settings, state: FSMContext) -> None:
    await state.clear()
    await message.answer(await _undo(message.from_user.id, db, settings))
    await send_today(message, db, settings)


@router.message(Command("eat"))
async def cmd_eat(message: Message, command: CommandObject, db: Database, settings: Settings) -> None:
    """/eat <назва> [грами] — записати довільну кількість продукту."""
    args = (command.args or "").strip()
    if not args:
        await message.answer(
            "Формат: <code>/eat назва грами</code>, наприклад <code>/eat гречка 150</code>.",
            reply_markup=main_menu(),
        )
        return
    parts = args.rsplit(maxsplit=1)
    grams: float | None = None
    name = args
    if len(parts) == 2:
        nums = parse_numbers(parts[1])
        if len(nums) == 1 and nums[0] > 0 and parts[1].replace(",", ".").replace(".", "", 1).isdigit():
            grams = nums[0]
            name = parts[0]
    product = await db.find_product(message.from_user.id, name)
    if product is None:
        await message.answer(
            f"Продукт «{name}» не знайдено у вашому списку. Додайте його: /add {name}",
        )
        return
    grams = grams or product.portion_g
    entry = await db.add_entry(
        message.from_user.id, product, grams, today_key(settings), now_local(settings)
    )
    await message.answer(
        f"Записано: <b>{product.name}</b> {fmt_num(entry.grams)} г — {macros_line(entry.macros)}"
    )
    await send_today(message, db, settings)
