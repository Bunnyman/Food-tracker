from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from ..db import Database
from ..keyboards import BTN_HELP, main_menu
from ..texts import HELP

router = Router(name="common")

WELCOME = (
    "Привіт! Я допоможу рахувати калорії та БЖВ.\n\n"
    "1️⃣ Додайте свої страви та продукти — я сам підтягну калорії й БЖВ.\n"
    "2️⃣ Задайте ціль на день.\n"
    "3️⃣ Відкривайте «Сьогодні», тисніть на продукт — і ліміт перерахується.\n\n"
    "Почніть із 🎯 Ціль або ➕ Додати продукт."
)


@router.message(CommandStart())
async def cmd_start(message: Message, db: Database, state: FSMContext) -> None:
    await state.clear()
    await db.ensure_user(message.from_user.id)
    await message.answer(WELCOME, reply_markup=main_menu())


@router.message(Command("help"))
@router.message(F.text == BTN_HELP)
async def cmd_help(message: Message) -> None:
    await message.answer(HELP, reply_markup=main_menu())


@router.message(Command("cancel"))
async def cmd_cancel(message: Message, state: FSMContext) -> None:
    if await state.get_state() is None:
        await message.answer("Немає активної дії.", reply_markup=main_menu())
        return
    await state.clear()
    await message.answer("Скасовано.", reply_markup=main_menu())


@router.callback_query(F.data == "noop")
async def cb_noop(callback: CallbackQuery) -> None:
    await callback.answer()
