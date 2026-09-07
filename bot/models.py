from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Macros:
    """Калорії та БЖВ. Використовується і для цілей, і для сум за день."""

    kcal: float = 0.0
    protein: float = 0.0
    fat: float = 0.0
    carbs: float = 0.0

    def __add__(self, other: "Macros") -> "Macros":
        return Macros(
            self.kcal + other.kcal,
            self.protein + other.protein,
            self.fat + other.fat,
            self.carbs + other.carbs,
        )

    def __sub__(self, other: "Macros") -> "Macros":
        return Macros(
            self.kcal - other.kcal,
            self.protein - other.protein,
            self.fat - other.fat,
            self.carbs - other.carbs,
        )

    def scale(self, factor: float) -> "Macros":
        return Macros(
            self.kcal * factor,
            self.protein * factor,
            self.fat * factor,
            self.carbs * factor,
        )

    def is_zero(self) -> bool:
        return not any((self.kcal, self.protein, self.fat, self.carbs))


@dataclass(frozen=True)
class Product:
    id: int
    user_id: int
    name: str
    per_100g: Macros
    portion_g: float
    source: str

    def for_grams(self, grams: float) -> Macros:
        return self.per_100g.scale(grams / 100.0)


@dataclass(frozen=True)
class Entry:
    id: int
    user_id: int
    product_id: int | None
    product_name: str
    grams: float
    macros: Macros
    day: str
    eaten_at: str
