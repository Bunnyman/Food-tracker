from bot.models import Entry, Macros, Product
from bot.texts import day_summary, fmt_num, parse_grams, parse_macros, parse_numbers, product_card


def test_fmt_num():
    assert fmt_num(1234.0) == "1234"
    assert fmt_num(12.34) == "12.3"
    assert fmt_num(0.96) == "1"


def test_parse_numbers_accepts_comma_decimal():
    assert parse_numbers("110 4,2 1.1 21") == [110, 4.2, 1.1, 21]


def test_parse_macros():
    assert parse_macros("2000") == Macros(kcal=2000)
    assert parse_macros("2000 150 60 200") == Macros(2000, 150, 60, 200)
    assert parse_macros("2000 150") is None
    assert parse_macros("abc") is None


def test_parse_grams():
    assert parse_grams("150") == 150
    assert parse_grams("150 г") == 150
    assert parse_grams("-5") is None
    assert parse_grams("1 2") is None


def test_product_scaling():
    p = Product(1, 1, "Гречка", Macros(110, 4, 1, 21), 150, "claude")
    assert p.for_grams(50) == Macros(55, 2, 0.5, 10.5)


def test_day_summary_shows_remaining_and_overrun():
    goal = Macros(2000, 150, 60, 200)
    totals = Macros(1500, 160, 20, 100)
    entries = [Entry(1, 1, 1, "Гречка", 150, Macros(165, 6, 1.5, 31.5), "2026-09-07", "t")]
    text = day_summary("Сьогодні, 7 вересня", goal, totals, entries)
    assert "залишилось <b>500</b> ккал" in text
    assert "перевищено на <b>10</b> г" in text
    assert "1. Гречка — 150 г (165 ккал)" in text


def test_day_summary_without_goal():
    text = day_summary("Сьогодні", None, Macros(), [])
    assert "Ціль не задана" in text
    assert "ще нічого не записано" in text


def test_product_card_escapes_html():
    p = Product(1, 1, "<b>x</b>", Macros(1, 1, 1, 1), 100, "manual")
    assert "&lt;b&gt;" in product_card(p)
