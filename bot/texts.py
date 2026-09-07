"""Форматування повідомлень і розбір введеного користувачем тексту."""
from __future__ import annotations

import re
from html import escape

from .models import Entry, Macros, Product

NUMBER_RE = re.compile(r"[-+]?\d+(?:[.,]\d+)?")


def fmt_num(value: float) -> str:
    """1234.0 → '1234', 12.34 → '12.3'."""
    if abs(value - round(value)) < 0.05:
        return str(int(round(value)))
    return f"{value:.1f}"


def parse_numbers(text: str) -> list[float]:
    return [float(m.replace(",", ".")) for m in NUMBER_RE.findall(text)]


def parse_macros(text: str) -> Macros | None:
    """'2000 150 60 200' або '2000' → Macros. Повертає None, якщо чисел не 1 і не 4."""
    nums = parse_numbers(text)
    if len(nums) == 1:
        return Macros(kcal=nums[0])
    if len(nums) == 4:
        return Macros(*nums)
    return None


def parse_grams(text: str) -> float | None:
    nums = parse_numbers(text)
    if len(nums) != 1 or nums[0] <= 0:
        return None
    return nums[0]


def macros_line(m: Macros) -> str:
    return (
        f"{fmt_num(m.kcal)} ккал · Б {fmt_num(m.protein)} · "
        f"Ж {fmt_num(m.fat)} · В {fmt_num(m.carbs)}"
    )


def product_card(p: Product) -> str:
    return (
        f"<b>{escape(p.name)}</b>\n"
        f"На 100 г: {macros_line(p.per_100g)}\n"
        f"Порція: {fmt_num(p.portion_g)} г → {macros_line(p.for_grams(p.portion_g))}"
    )


def _bar(consumed: float, goal: float, width: int = 10) -> str:
    if goal <= 0:
        return ""
    ratio = min(consumed / goal, 1.0)
    filled = int(round(ratio * width))
    return "▓" * filled + "░" * (width - filled)


def _limit_row(label: str, consumed: float, goal: float, unit: str) -> str:
    remaining = goal - consumed
    if remaining >= 0:
        tail = f"залишилось <b>{fmt_num(remaining)}</b> {unit}"
    else:
        tail = f"перевищено на <b>{fmt_num(-remaining)}</b> {unit}"
    return f"{label}: {fmt_num(consumed)} / {fmt_num(goal)} {unit} — {tail}\n{_bar(consumed, goal)}"


def day_summary(day_label: str, goal: Macros | None, totals: Macros, entries: list[Entry]) -> str:
    lines = [f"📅 <b>{escape(day_label)}</b>", ""]
    if goal is None:
        lines.append(f"З'їдено: {macros_line(totals)}")
        lines.append("Ціль не задана — натисніть 🎯 Ціль або /goal.")
    else:
        lines.append(_limit_row("🔥 Калорії", totals.kcal, goal.kcal, "ккал"))
        if goal.protein > 0:
            lines.append(_limit_row("🥩 Білки", totals.protein, goal.protein, "г"))
        if goal.fat > 0:
            lines.append(_limit_row("🥑 Жири", totals.fat, goal.fat, "г"))
        if goal.carbs > 0:
            lines.append(_limit_row("🍞 Вуглеводи", totals.carbs, goal.carbs, "г"))
    lines.append("")
    if entries:
        lines.append("<b>З'їдено сьогодні:</b>")
        for i, e in enumerate(entries, 1):
            lines.append(
                f"{i}. {escape(e.product_name)} — {fmt_num(e.grams)} г "
                f"({fmt_num(e.macros.kcal)} ккал)"
            )
    else:
        lines.append("Сьогодні ще нічого не записано.")
    lines.append("")
    lines.append("Оберіть продукт нижче, щоб додати його в щоденник 👇")
    return "\n".join(lines)


def goal_text(goal: Macros) -> str:
    return (
        f"🎯 Ціль на день: <b>{fmt_num(goal.kcal)} ккал</b>\n"
        f"Білки {fmt_num(goal.protein)} г · Жири {fmt_num(goal.fat)} г · "
        f"Вуглеводи {fmt_num(goal.carbs)} г"
    )


HELP = (
    "<b>Що вміє бот</b>\n\n"
    "📅 <b>Сьогодні</b> або /today — ліміт на день, що вже з'їдено, і кнопки продуктів. "
    "Натискання на продукт записує його порцію та перераховує ліміт.\n"
    "➕ <b>Додати продукт</b> або /add &lt;назва&gt; — бот сам підтягне калорії та БЖВ, "
    "ви підтвердите або введете вручну.\n"
    "🎯 <b>Ціль</b> або /goal 2000 150 60 200 — ккал, білки, жири, вуглеводи "
    "(можна лише ккал: /goal 2000).\n"
    "📋 <b>Мої продукти</b> або /products — список, видалення, зміна порції.\n"
    "/eat &lt;назва&gt; &lt;грами&gt; — записати довільну кількість, наприклад "
    "<code>/eat гречка 150</code>.\n"
    "↩️ <b>Відмінити</b> або /undo — прибрати останній запис за сьогодні.\n"
    "/cancel — перервати поточну дію."
)
