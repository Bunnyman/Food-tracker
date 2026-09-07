from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import Command, CommandObject
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import Message

from ..db import Database
from ..keyboards import BTN_GOAL, is_free_text, main_menu
from ..models import Macros
from ..texts import goal_text, parse_macros

router = Router(name="goals")


class SetGoal(StatesGroup):
    waiting = State()


GOAL_PROMPT = (
    "Введіть ціль на день у форматі:\n"
    "<code>ккал білки жири вуглеводи</code>\n"
    "Наприклад: <code>2000 150 60 200</code>\n\n"
    "Можна лише калорії: <code>2000</code>\n"
    "/cancel — скасувати"
)


async def _save_goal(message: Message, db: Database, text: str) -> bool:
    goal = parse_macros(text)
    if goal is None or goal.kcal <= 0 or any(
        v < 0 for v in (goal.protein, goal.fat, goal.carbs)
    ):
        await message.answer(
            "Не зрозумів. Потрібно 1 або 4 числа, наприклад <code>2000 150 60 200</code>."
        )
        return False
    await db.set_goal(message.from_user.id, goal)
    await message.answer("Збережено!\n" + goal_text(goal), reply_markup=main_menu())
    return True


@router.message(Command("goal"))
async def cmd_goal(message: Message, command: CommandObject, db: Database, state: FSMContext) -> None:
    if command.args:
        if await _save_goal(message, db, command.args):
            await state.clear()
        return
    await _ask_goal(message, db, state)


@router.message(F.text == BTN_GOAL)
async def btn_goal(message: Message, db: Database, state: FSMContext) -> None:
    await state.clear()
    await _ask_goal(message, db, state)


async def _ask_goal(message: Message, db: Database, state: FSMContext) -> None:
    current: Macros | None = await db.get_goal(message.from_user.id)
    prefix = (goal_text(current) + "\n\n") if current else ""
    await state.set_state(SetGoal.waiting)
    await message.answer(prefix + GOAL_PROMPT)


@router.message(SetGoal.waiting, F.text.func(is_free_text))
async def goal_input(message: Message, db: Database, state: FSMContext) -> None:
    if await _save_goal(message, db, message.text):
        await state.clear()
