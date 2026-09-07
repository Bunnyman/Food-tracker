from __future__ import annotations

from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
)

from .models import Product
from .texts import fmt_num

BTN_TODAY = "📅 Сьогодні"
BTN_ADD = "➕ Додати продукт"
BTN_GOAL = "🎯 Ціль"
BTN_PRODUCTS = "📋 Мої продукти"
BTN_UNDO = "↩️ Відмінити останнє"
BTN_HELP = "❓ Допомога"

QUICK_PORTIONS = (50, 100, 150, 200, 250, 300)


def main_menu() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text=BTN_TODAY), KeyboardButton(text=BTN_ADD)],
            [KeyboardButton(text=BTN_GOAL), KeyboardButton(text=BTN_PRODUCTS)],
            [KeyboardButton(text=BTN_UNDO), KeyboardButton(text=BTN_HELP)],
        ],
        resize_keyboard=True,
    )


def today_keyboard(products: list[Product]) -> InlineKeyboardMarkup:
    rows: list[list[InlineKeyboardButton]] = []
    row: list[InlineKeyboardButton] = []
    for p in products:
        label = f"{p.name} · {fmt_num(p.portion_g)} г"
        row.append(InlineKeyboardButton(text=label[:60], callback_data=f"eat:{p.id}"))
        if len(row) == 2:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    if not products:
        rows.append([InlineKeyboardButton(text="➕ Додати перший продукт", callback_data="add:start")])
    rows.append(
        [
            InlineKeyboardButton(text="🔄 Оновити", callback_data="today:refresh"),
            InlineKeyboardButton(text="↩️ Відмінити останнє", callback_data="today:undo"),
        ]
    )
    return InlineKeyboardMarkup(inline_keyboard=rows)


def confirm_lookup_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="✅ Зберегти", callback_data="add:save"),
                InlineKeyboardButton(text="✏️ Ввести вручну", callback_data="add:manual"),
            ],
            [InlineKeyboardButton(text="❌ Скасувати", callback_data="add:cancel")],
        ]
    )


def manual_only_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="✏️ Ввести вручну", callback_data="add:manual"),
                InlineKeyboardButton(text="❌ Скасувати", callback_data="add:cancel"),
            ]
        ]
    )


def portion_keyboard(default: float) -> InlineKeyboardMarkup:
    buttons = [
        InlineKeyboardButton(text=f"{g} г", callback_data=f"portion:{g}") for g in QUICK_PORTIONS
    ]
    rows = [buttons[:3], buttons[3:]]
    rows.append(
        [InlineKeyboardButton(text=f"Залишити {fmt_num(default)} г", callback_data=f"portion:{default}")]
    )
    return InlineKeyboardMarkup(inline_keyboard=rows)


def products_keyboard(products: list[Product]) -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(text=f"{p.name} · {fmt_num(p.per_100g.kcal)} ккал/100 г", callback_data=f"prod:{p.id}")]
        for p in products
    ]
    rows.append([InlineKeyboardButton(text="➕ Додати продукт", callback_data="add:start")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def product_keyboard(product: Product) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🍽 З'їсти порцію", callback_data=f"eat:{product.id}")],
            [
                InlineKeyboardButton(text="⚖️ Змінити порцію", callback_data=f"prod_portion:{product.id}"),
                InlineKeyboardButton(text="🗑 Видалити", callback_data=f"prod_del:{product.id}"),
            ],
            [InlineKeyboardButton(text="◀️ До списку", callback_data="prod:list")],
        ]
    )


def confirm_delete_keyboard(product_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="🗑 Так, видалити", callback_data=f"prod_del_yes:{product_id}"),
                InlineKeyboardButton(text="◀️ Ні", callback_data=f"prod:{product_id}"),
            ]
        ]
    )


MENU_BUTTONS = frozenset({BTN_TODAY, BTN_ADD, BTN_GOAL, BTN_PRODUCTS, BTN_UNDO, BTN_HELP})


def is_free_text(text: str | None) -> bool:
    """Текст, що не є командою і не кнопкою головного меню (для FSM-станів)."""
    return bool(text) and not text.startswith("/") and text not in MENU_BUTTONS
