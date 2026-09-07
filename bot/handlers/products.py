from __future__ import annotations

import logging
from html import escape

from aiogram import F, Router
from aiogram.filters import Command, CommandObject
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from ..config import Settings
from ..db import Database
from ..keyboards import (
    BTN_ADD,
    BTN_PRODUCTS,
    confirm_delete_keyboard,
    confirm_lookup_keyboard,
    is_free_text,
    main_menu,
    manual_only_keyboard,
    portion_keyboard,
    product_keyboard,
    products_keyboard,
)
from ..models import Macros
from ..nutrition import LookupResult, NutritionService
from ..texts import fmt_num, macros_line, parse_grams, parse_numbers, product_card

router = Router(name="products")
log = logging.getLogger(__name__)

SOURCE_LABEL = {"claude": "Claude", "openfoodfacts": "Open Food Facts", "manual": "вручну"}


class AddProduct(StatesGroup):
    name = State()
    confirm = State()
    manual = State()
    portion = State()


class EditPortion(StatesGroup):
    waiting = State()


ASK_NAME = (
    "Напишіть назву страви або продукту, наприклад «гречка варена», «куряче філе», "
    "«борщ». Я підтягну калорії та БЖВ.\n/cancel — скасувати"
)
ASK_MANUAL = (
    "Введіть значення <b>на 100 г</b> у форматі:\n"
    "<code>ккал білки жири вуглеводи</code>\n"
    "Наприклад: <code>110 4.2 1.1 21</code>"
)


# ---------- крок 1: назва ----------

async def _start_add(message: Message, state: FSMContext) -> None:
    await state.clear()
    await state.set_state(AddProduct.name)
    await message.answer(ASK_NAME)


@router.message(Command("add"))
async def cmd_add(
    message: Message, command: CommandObject, state: FSMContext, nutrition: NutritionService
) -> None:
    await state.clear()
    if command.args:
        await _lookup_and_ask(message, command.args, state, nutrition)
    else:
        await _start_add(message, state)


@router.message(F.text == BTN_ADD)
async def btn_add(message: Message, state: FSMContext) -> None:
    await _start_add(message, state)


@router.callback_query(F.data == "add:start")
async def cb_add_start(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    await _start_add(callback.message, state)


@router.message(AddProduct.name, F.text.func(is_free_text))
async def add_name(message: Message, state: FSMContext, nutrition: NutritionService) -> None:
    await _lookup_and_ask(message, message.text, state, nutrition)


async def _lookup_and_ask(
    message: Message, query: str, state: FSMContext, nutrition: NutritionService
) -> None:
    query = query.strip()
    if len(query) < 2 or len(query) > 100:
        await message.answer("Назва має бути від 2 до 100 символів. Спробуйте ще раз.")
        await state.set_state(AddProduct.name)
        return
    waiting = await message.answer(f"🔎 Шукаю «{escape(query)}»…")
    result: LookupResult | None = await nutrition.lookup(query)
    if result is None:
        await state.update_data(name=query, source="manual", portion_g=100.0)
        await state.set_state(AddProduct.confirm)
        await waiting.edit_text(
            f"Не вдалося автоматично знайти «{escape(query)}». "
            "Можете ввести значення вручну.",
            reply_markup=manual_only_keyboard(),
        )
        return
    await state.update_data(
        name=result.name,
        kcal=result.per_100g.kcal,
        protein=result.per_100g.protein,
        fat=result.per_100g.fat,
        carbs=result.per_100g.carbs,
        portion_g=result.portion_g,
        source=result.source,
    )
    await state.set_state(AddProduct.confirm)
    note = f"\n<i>{escape(result.note)}</i>" if result.note else ""
    await waiting.edit_text(
        f"<b>{escape(result.name)}</b>{note}\n"
        f"На 100 г: {macros_line(result.per_100g)}\n"
        f"Джерело: {SOURCE_LABEL.get(result.source, result.source)}\n\n"
        "Зберегти?",
        reply_markup=confirm_lookup_keyboard(),
    )


# ---------- крок 2: підтвердження / ручне введення ----------

@router.callback_query(AddProduct.confirm, F.data == "add:cancel")
async def cb_add_cancel(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.message.edit_text("Скасовано.")
    await callback.answer()


@router.callback_query(AddProduct.confirm, F.data == "add:manual")
async def cb_add_manual(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(AddProduct.manual)
    await callback.message.edit_text(ASK_MANUAL)
    await callback.answer()


@router.message(AddProduct.manual, F.text.func(is_free_text))
async def add_manual(message: Message, state: FSMContext) -> None:
    nums = parse_numbers(message.text)
    if len(nums) != 4 or any(n < 0 for n in nums):
        await message.answer("Потрібно рівно 4 числа: <code>ккал білки жири вуглеводи</code>.")
        return
    await state.update_data(kcal=nums[0], protein=nums[1], fat=nums[2], carbs=nums[3], source="manual")
    await _ask_portion(message, state)


@router.callback_query(AddProduct.confirm, F.data == "add:save")
async def cb_add_save(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    await _ask_portion(callback.message, state)


# ---------- крок 3: порція ----------

async def _ask_portion(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    default = float(data.get("portion_g") or 100.0)
    await state.set_state(AddProduct.portion)
    await message.answer(
        "Яку порцію записувати одним натисканням у «Сьогодні»?\n"
        f"Оберіть або введіть грами (типова порція: {fmt_num(default)} г).",
        reply_markup=portion_keyboard(default),
    )


@router.callback_query(AddProduct.portion, F.data.startswith("portion:"))
async def cb_portion(callback: CallbackQuery, state: FSMContext, db: Database) -> None:
    grams = float(callback.data.split(":", 1)[1])
    await callback.answer()
    await _finish_add(callback.message, callback.from_user.id, grams, state, db)


@router.message(AddProduct.portion, F.text.func(is_free_text))
async def portion_input(message: Message, state: FSMContext, db: Database) -> None:
    grams = parse_grams(message.text)
    if grams is None:
        await message.answer("Введіть одне число — порцію в грамах, наприклад <code>150</code>.")
        return
    await _finish_add(message, message.from_user.id, grams, state, db)


async def _finish_add(message: Message, user_id: int, grams: float, state: FSMContext, db: Database) -> None:
    data = await state.get_data()
    await state.clear()
    per_100g = Macros(
        float(data["kcal"]), float(data["protein"]), float(data["fat"]), float(data["carbs"])
    )
    product = await db.add_product(
        user_id, data["name"], per_100g, portion_g=grams, source=data.get("source", "manual")
    )
    await message.answer(
        "✅ Додано до списку:\n" + product_card(product) + "\n\nВідкрийте 📅 Сьогодні, щоб записати.",
        reply_markup=main_menu(),
    )


# ---------- список продуктів ----------

async def _send_list(message: Message, user_id: int, db: Database, edit: bool = False) -> None:
    products = await db.list_products(user_id)
    if products:
        text = f"📋 <b>Мої продукти</b> ({len(products)})\nНатисніть, щоб переглянути або змінити."
    else:
        text = "Список порожній. Додайте перший продукт."
    kb = products_keyboard(products)
    if edit:
        await message.edit_text(text, reply_markup=kb)
    else:
        await message.answer(text, reply_markup=kb)


@router.message(Command("products"))
@router.message(F.text == BTN_PRODUCTS)
async def cmd_products(message: Message, db: Database, state: FSMContext) -> None:
    await state.clear()
    await _send_list(message, message.from_user.id, db)


@router.callback_query(F.data == "prod:list")
async def cb_products_list(callback: CallbackQuery, db: Database, state: FSMContext) -> None:
    await state.clear()
    await _send_list(callback.message, callback.from_user.id, db, edit=True)
    await callback.answer()


@router.callback_query(F.data.startswith("prod:"))
async def cb_product(callback: CallbackQuery, db: Database) -> None:
    product = await db.get_product(callback.from_user.id, int(callback.data.split(":", 1)[1]))
    if product is None:
        await callback.answer("Продукт не знайдено", show_alert=True)
        return
    source = SOURCE_LABEL.get(product.source, product.source)
    await callback.message.edit_text(
        product_card(product) + f"\nДжерело: {source}", reply_markup=product_keyboard(product)
    )
    await callback.answer()


@router.callback_query(F.data.startswith("prod_del_yes:"))
async def cb_product_delete_yes(callback: CallbackQuery, db: Database) -> None:
    deleted = await db.delete_product(callback.from_user.id, int(callback.data.split(":", 1)[1]))
    await callback.answer("Видалено" if deleted else "Продукт не знайдено")
    await _send_list(callback.message, callback.from_user.id, db, edit=True)


@router.callback_query(F.data.startswith("prod_del:"))
async def cb_product_delete(callback: CallbackQuery, db: Database) -> None:
    product_id = int(callback.data.split(":", 1)[1])
    product = await db.get_product(callback.from_user.id, product_id)
    if product is None:
        await callback.answer("Продукт не знайдено", show_alert=True)
        return
    await callback.message.edit_text(
        f"Видалити «{escape(product.name)}» зі списку? Записи в щоденнику збережуться.",
        reply_markup=confirm_delete_keyboard(product_id),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("prod_portion:"))
async def cb_product_portion(callback: CallbackQuery, db: Database, state: FSMContext) -> None:
    product_id = int(callback.data.split(":", 1)[1])
    product = await db.get_product(callback.from_user.id, product_id)
    if product is None:
        await callback.answer("Продукт не знайдено", show_alert=True)
        return
    await state.set_state(EditPortion.waiting)
    await state.update_data(product_id=product_id)
    await callback.message.answer(
        f"Нова порція для «{escape(product.name)}» у грамах (зараз {fmt_num(product.portion_g)} г):"
    )
    await callback.answer()


@router.message(EditPortion.waiting, F.text.func(is_free_text))
async def portion_edit_input(message: Message, db: Database, state: FSMContext) -> None:
    grams = parse_grams(message.text)
    if grams is None:
        await message.answer("Введіть одне число — порцію в грамах.")
        return
    data = await state.get_data()
    await state.clear()
    ok = await db.set_portion(message.from_user.id, int(data["product_id"]), grams)
    if not ok:
        await message.answer("Продукт не знайдено.", reply_markup=main_menu())
        return
    product = await db.get_product(message.from_user.id, int(data["product_id"]))
    await message.answer("Оновлено:\n" + product_card(product), reply_markup=main_menu())


# ---------- будь-який інший текст = пошук продукту ----------

@router.message(F.text.func(is_free_text))
async def free_text(message: Message, state: FSMContext, nutrition: NutritionService) -> None:
    await state.clear()
    await _lookup_and_ask(message, message.text, state, nutrition)


# ---------- застарілі кнопки (стан втрачено, напр. після перезапуску) ----------

@router.callback_query(F.data.startswith(("add:", "portion:")))
async def cb_stale(callback: CallbackQuery) -> None:
    await callback.answer(
        "Ця дія вже неактуальна. Почніть заново: ➕ Додати продукт", show_alert=True
    )
