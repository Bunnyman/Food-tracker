from datetime import datetime

from bot.models import Macros


async def test_goal_roundtrip(db):
    assert await db.get_goal(1) is None
    await db.set_goal(1, Macros(2000, 150, 60, 200))
    goal = await db.get_goal(1)
    assert goal == Macros(2000, 150, 60, 200)


async def test_zero_goal_is_none(db):
    await db.ensure_user(1)
    assert await db.get_goal(1) is None


async def test_products_are_per_user(db):
    p = await db.add_product(1, "Гречка", Macros(110, 4.2, 1.1, 21), portion_g=150, source="claude")
    assert p.id > 0
    assert p.portion_g == 150
    assert [x.name for x in await db.list_products(1)] == ["Гречка"]
    assert await db.list_products(2) == []
    assert await db.get_product(2, p.id) is None


async def test_find_product_exact_then_substring(db):
    await db.add_product(1, "Куряче філе", Macros(165, 31, 3.6, 0))
    await db.add_product(1, "Філе лосося", Macros(208, 20, 13, 0))
    assert (await db.find_product(1, "філе лосося")).name == "Філе лосося"
    assert (await db.find_product(1, "куряче")).name == "Куряче філе"
    assert await db.find_product(1, "борщ") is None


async def test_entries_and_totals_recalculate(db):
    p = await db.add_product(1, "Гречка", Macros(110, 4, 1, 21), portion_g=100)
    day = "2026-09-07"
    now = datetime(2026, 9, 7, 12, 0)
    await db.add_entry(1, p, 150, day, now)
    await db.add_entry(1, p, 50, day, now)
    totals = await db.day_totals(1, day)
    assert totals == Macros(220, 8, 2, 42)
    assert await db.day_totals(1, "2026-09-08") == Macros()
    entries = await db.list_entries(1, day)
    assert [e.grams for e in entries] == [150, 50]

    removed = await db.delete_last_entry(1, day)
    assert removed is not None and removed.grams == 50
    assert await db.day_totals(1, day) == Macros(165, 6, 1.5, 31.5)
    assert await db.delete_last_entry(1, "2026-09-08") is None


async def test_delete_product_keeps_entries(db):
    p = await db.add_product(1, "Банан", Macros(89, 1.1, 0.3, 23))
    await db.add_entry(1, p, 120, "2026-09-07", datetime(2026, 9, 7))
    assert await db.delete_product(1, p.id)
    assert await db.list_products(1) == []
    entries = await db.list_entries(1, "2026-09-07")
    assert len(entries) == 1 and entries[0].product_name == "Банан"


async def test_set_portion(db):
    p = await db.add_product(1, "Йогурт", Macros(60, 4, 2, 6))
    assert await db.set_portion(1, p.id, 250)
    assert (await db.get_product(1, p.id)).portion_g == 250
    assert not await db.set_portion(2, p.id, 100)
