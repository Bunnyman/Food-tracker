from __future__ import annotations

import os
from datetime import datetime

import aiosqlite

from .models import Entry, Macros, Product

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    user_id       INTEGER PRIMARY KEY,
    kcal_goal     REAL NOT NULL DEFAULT 0,
    protein_goal  REAL NOT NULL DEFAULT 0,
    fat_goal      REAL NOT NULL DEFAULT 0,
    carbs_goal    REAL NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    name       TEXT NOT NULL,
    kcal       REAL NOT NULL,
    protein    REAL NOT NULL,
    fat        REAL NOT NULL,
    carbs      REAL NOT NULL,
    portion_g  REAL NOT NULL DEFAULT 100,
    source     TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_user ON products(user_id);

CREATE TABLE IF NOT EXISTS entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    product_id   INTEGER,
    product_name TEXT NOT NULL,
    grams        REAL NOT NULL,
    kcal         REAL NOT NULL,
    protein      REAL NOT NULL,
    fat          REAL NOT NULL,
    carbs        REAL NOT NULL,
    day          TEXT NOT NULL,
    eaten_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_user_day ON entries(user_id, day);
"""


def _row_to_product(row: aiosqlite.Row) -> Product:
    return Product(
        id=row["id"],
        user_id=row["user_id"],
        name=row["name"],
        per_100g=Macros(row["kcal"], row["protein"], row["fat"], row["carbs"]),
        portion_g=row["portion_g"],
        source=row["source"],
    )


def _row_to_entry(row: aiosqlite.Row) -> Entry:
    return Entry(
        id=row["id"],
        user_id=row["user_id"],
        product_id=row["product_id"],
        product_name=row["product_name"],
        grams=row["grams"],
        macros=Macros(row["kcal"], row["protein"], row["fat"], row["carbs"]),
        day=row["day"],
        eaten_at=row["eaten_at"],
    )


class Database:
    def __init__(self, path: str) -> None:
        self.path = path
        self._conn: aiosqlite.Connection | None = None

    @property
    def conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("Database is not connected")
        return self._conn

    async def connect(self) -> None:
        if self.path != ":memory:":
            os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
        self._conn = await aiosqlite.connect(self.path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute("PRAGMA foreign_keys=ON")
        await self._conn.executescript(SCHEMA)
        await self._conn.commit()

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    # ---------- users / goals ----------

    async def ensure_user(self, user_id: int) -> None:
        await self.conn.execute(
            "INSERT OR IGNORE INTO users(user_id, created_at) VALUES (?, ?)",
            (user_id, datetime.utcnow().isoformat(timespec="seconds")),
        )
        await self.conn.commit()

    async def set_goal(self, user_id: int, goal: Macros) -> None:
        await self.ensure_user(user_id)
        await self.conn.execute(
            "UPDATE users SET kcal_goal=?, protein_goal=?, fat_goal=?, carbs_goal=? WHERE user_id=?",
            (goal.kcal, goal.protein, goal.fat, goal.carbs, user_id),
        )
        await self.conn.commit()

    async def get_goal(self, user_id: int) -> Macros | None:
        async with self.conn.execute(
            "SELECT kcal_goal, protein_goal, fat_goal, carbs_goal FROM users WHERE user_id=?",
            (user_id,),
        ) as cur:
            row = await cur.fetchone()
        if row is None:
            return None
        goal = Macros(row["kcal_goal"], row["protein_goal"], row["fat_goal"], row["carbs_goal"])
        return None if goal.is_zero() else goal

    # ---------- products ----------

    async def add_product(
        self,
        user_id: int,
        name: str,
        per_100g: Macros,
        portion_g: float = 100.0,
        source: str = "manual",
    ) -> Product:
        await self.ensure_user(user_id)
        cur = await self.conn.execute(
            """INSERT INTO products(user_id, name, kcal, protein, fat, carbs, portion_g, source, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                user_id,
                name.strip(),
                per_100g.kcal,
                per_100g.protein,
                per_100g.fat,
                per_100g.carbs,
                portion_g,
                source,
                datetime.utcnow().isoformat(timespec="seconds"),
            ),
        )
        await self.conn.commit()
        product = await self.get_product(user_id, cur.lastrowid)
        assert product is not None
        return product

    async def list_products(self, user_id: int) -> list[Product]:
        async with self.conn.execute(
            "SELECT * FROM products WHERE user_id=? ORDER BY name COLLATE NOCASE", (user_id,)
        ) as cur:
            rows = await cur.fetchall()
        return [_row_to_product(r) for r in rows]

    async def get_product(self, user_id: int, product_id: int) -> Product | None:
        async with self.conn.execute(
            "SELECT * FROM products WHERE user_id=? AND id=?", (user_id, product_id)
        ) as cur:
            row = await cur.fetchone()
        return _row_to_product(row) if row else None

    async def find_product(self, user_id: int, query: str) -> Product | None:
        """Пошук за назвою: спочатку точний збіг, потім за підрядком."""
        q = query.strip().lower()
        if not q:
            return None
        products = await self.list_products(user_id)
        for p in products:
            if p.name.lower() == q:
                return p
        for p in products:
            if q in p.name.lower():
                return p
        return None

    async def delete_product(self, user_id: int, product_id: int) -> bool:
        cur = await self.conn.execute(
            "DELETE FROM products WHERE user_id=? AND id=?", (user_id, product_id)
        )
        await self.conn.commit()
        return cur.rowcount > 0

    async def set_portion(self, user_id: int, product_id: int, portion_g: float) -> bool:
        cur = await self.conn.execute(
            "UPDATE products SET portion_g=? WHERE user_id=? AND id=?",
            (portion_g, user_id, product_id),
        )
        await self.conn.commit()
        return cur.rowcount > 0

    # ---------- diary entries ----------

    async def add_entry(
        self, user_id: int, product: Product, grams: float, day: str, eaten_at: datetime
    ) -> Entry:
        macros = product.for_grams(grams)
        cur = await self.conn.execute(
            """INSERT INTO entries(user_id, product_id, product_name, grams, kcal, protein, fat, carbs, day, eaten_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                user_id,
                product.id,
                product.name,
                grams,
                macros.kcal,
                macros.protein,
                macros.fat,
                macros.carbs,
                day,
                eaten_at.isoformat(timespec="seconds"),
            ),
        )
        await self.conn.commit()
        async with self.conn.execute("SELECT * FROM entries WHERE id=?", (cur.lastrowid,)) as c:
            row = await c.fetchone()
        assert row is not None
        return _row_to_entry(row)

    async def list_entries(self, user_id: int, day: str) -> list[Entry]:
        async with self.conn.execute(
            "SELECT * FROM entries WHERE user_id=? AND day=? ORDER BY eaten_at, id",
            (user_id, day),
        ) as cur:
            rows = await cur.fetchall()
        return [_row_to_entry(r) for r in rows]

    async def day_totals(self, user_id: int, day: str) -> Macros:
        async with self.conn.execute(
            """SELECT COALESCE(SUM(kcal),0) k, COALESCE(SUM(protein),0) p,
                      COALESCE(SUM(fat),0) f, COALESCE(SUM(carbs),0) c
               FROM entries WHERE user_id=? AND day=?""",
            (user_id, day),
        ) as cur:
            row = await cur.fetchone()
        assert row is not None
        return Macros(row["k"], row["p"], row["f"], row["c"])

    async def delete_entry(self, user_id: int, entry_id: int) -> bool:
        cur = await self.conn.execute(
            "DELETE FROM entries WHERE user_id=? AND id=?", (user_id, entry_id)
        )
        await self.conn.commit()
        return cur.rowcount > 0

    async def delete_last_entry(self, user_id: int, day: str) -> Entry | None:
        async with self.conn.execute(
            "SELECT * FROM entries WHERE user_id=? AND day=? ORDER BY id DESC LIMIT 1",
            (user_id, day),
        ) as cur:
            row = await cur.fetchone()
        if row is None:
            return None
        entry = _row_to_entry(row)
        await self.delete_entry(user_id, entry.id)
        return entry
