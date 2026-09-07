"""Автоматичне визначення калорій та БЖВ для страви/продукту.

Порядок: Claude (якщо є ANTHROPIC_API_KEY) → Open Food Facts → None (ручне введення).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from urllib.parse import quote

import aiohttp
from pydantic import BaseModel, Field

from .models import Macros

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class LookupResult:
    name: str
    per_100g: Macros
    portion_g: float
    source: str  # "claude" | "openfoodfacts"
    note: str = ""


class NutritionEstimate(BaseModel):
    """Схема структурованої відповіді від Claude."""

    found: bool = Field(description="false, якщо це не їжа або оцінити неможливо")
    name: str = Field(description="Нормалізована назва українською")
    kcal_per_100g: float = Field(ge=0)
    protein_per_100g: float = Field(ge=0)
    fat_per_100g: float = Field(ge=0)
    carbs_per_100g: float = Field(ge=0)
    typical_portion_g: float = Field(gt=0, description="Типова порція в грамах")
    note: str = Field(default="", description="Коротке уточнення (яка саме страва малась на увазі)")


SYSTEM_PROMPT = (
    "Ти — дієтолог і довідник поживної цінності. Користувач надсилає назву страви або "
    "продукту (зазвичай українською, може бути російською чи англійською). Поверни "
    "середні довідникові значення калорійності та БЖВ на 100 г їстівної частини у "
    "готовому до вживання вигляді (якщо не вказано інше: крупи та макарони — варені, "
    "м'ясо — приготоване). Для напоїв — на 100 мл. Якщо назва містить вагу або "
    "об'єм (наприклад «кола 0.5»), все одно рахуй на 100 г/мл, а typical_portion_g "
    "став рівним зазначеній кількості. Якщо це не їжа або назва беззмістовна — found=false "
    "і нулі. Назву у name подавай українською, коротко, без зайвих слів."
)


class ClaudeNutritionProvider:
    def __init__(self, api_key: str, model: str) -> None:
        import anthropic

        self._client = anthropic.AsyncAnthropic(api_key=api_key, timeout=60.0)
        self._model = model

    async def lookup(self, query: str) -> LookupResult | None:
        response = await self._client.messages.parse(
            model=self._model,
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            output_config={"effort": "low"},
            messages=[{"role": "user", "content": query}],
            output_format=NutritionEstimate,
        )
        if response.stop_reason == "refusal":
            log.warning("Claude відмовив у запиті: %s", query)
            return None
        est = response.parsed_output
        if est is None or not est.found:
            return None
        return LookupResult(
            name=est.name.strip() or query.strip(),
            per_100g=Macros(
                round(est.kcal_per_100g, 1),
                round(est.protein_per_100g, 1),
                round(est.fat_per_100g, 1),
                round(est.carbs_per_100g, 1),
            ),
            portion_g=float(est.typical_portion_g) or 100.0,
            source="claude",
            note=est.note.strip(),
        )


OFF_SEARCH_URL = (
    "https://world.openfoodfacts.org/cgi/search.pl?search_terms={q}&search_simple=1"
    "&action=process&json=1&page_size=10&fields=product_name,product_name_uk,nutriments,serving_quantity"
)


def parse_off_response(data: dict, query: str) -> LookupResult | None:
    """Вибирає перший продукт Open Food Facts, у якого є повні дані на 100 г."""
    for prod in data.get("products") or []:
        n = prod.get("nutriments") or {}
        kcal = n.get("energy-kcal_100g")
        if kcal is None:
            kj = n.get("energy_100g")
            if kj is None:
                continue
            kcal = float(kj) / 4.184
        try:
            per_100g = Macros(
                round(float(kcal), 1),
                round(float(n.get("proteins_100g", 0) or 0), 1),
                round(float(n.get("fat_100g", 0) or 0), 1),
                round(float(n.get("carbohydrates_100g", 0) or 0), 1),
            )
        except (TypeError, ValueError):
            continue
        name = (prod.get("product_name_uk") or prod.get("product_name") or query).strip()
        try:
            portion = float(prod.get("serving_quantity") or 0) or 100.0
        except (TypeError, ValueError):
            portion = 100.0
        return LookupResult(name=name, per_100g=per_100g, portion_g=portion, source="openfoodfacts")
    return None


class OpenFoodFactsProvider:
    async def lookup(self, query: str) -> LookupResult | None:
        url = OFF_SEARCH_URL.format(q=quote(query))
        headers = {"User-Agent": "FoodTrackerTelegramBot/1.0 (github.com/bunnyman/food-tracker)"}
        timeout = aiohttp.ClientTimeout(total=15)
        async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
            async with session.get(url) as resp:
                if resp.status != 200:
                    log.warning("Open Food Facts відповів %s", resp.status)
                    return None
                data = await resp.json(content_type=None)
        return parse_off_response(data, query)


class NutritionService:
    def __init__(self, providers: list) -> None:
        self._providers = providers

    @classmethod
    def from_settings(cls, api_key: str | None, model: str) -> "NutritionService":
        providers: list = []
        if api_key:
            providers.append(ClaudeNutritionProvider(api_key, model))
        else:
            log.warning("ANTHROPIC_API_KEY не задано — використовується лише Open Food Facts")
        providers.append(OpenFoodFactsProvider())
        return cls(providers)

    async def lookup(self, query: str) -> LookupResult | None:
        for provider in self._providers:
            try:
                result = await provider.lookup(query)
            except Exception:  # noqa: BLE001 — будь-яка помилка провайдера не має ламати бота
                log.exception("Помилка провайдера %s", type(provider).__name__)
                continue
            if result is not None:
                return result
        return None
