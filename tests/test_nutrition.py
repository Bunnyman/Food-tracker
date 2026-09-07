import pytest

from bot.models import Macros
from bot.nutrition import LookupResult, NutritionService, parse_off_response


def test_parse_off_picks_first_complete_product():
    data = {
        "products": [
            {"product_name": "no data", "nutriments": {}},
            {
                "product_name": "Buckwheat",
                "product_name_uk": "Гречка",
                "serving_quantity": "150",
                "nutriments": {
                    "energy-kcal_100g": 343,
                    "proteins_100g": 13.3,
                    "fat_100g": 3.4,
                    "carbohydrates_100g": 71.5,
                },
            },
        ]
    }
    res = parse_off_response(data, "гречка")
    assert res is not None
    assert res.name == "Гречка"
    assert res.per_100g == Macros(343, 13.3, 3.4, 71.5)
    assert res.portion_g == 150
    assert res.source == "openfoodfacts"


def test_parse_off_converts_kj_and_defaults():
    data = {"products": [{"nutriments": {"energy_100g": 418.4, "proteins_100g": None}}]}
    res = parse_off_response(data, "щось")
    assert res is not None
    assert res.per_100g.kcal == 100
    assert res.per_100g.protein == 0
    assert res.name == "щось"
    assert res.portion_g == 100


def test_parse_off_empty():
    assert parse_off_response({}, "x") is None


class _Failing:
    async def lookup(self, query):
        raise RuntimeError("boom")


class _Empty:
    async def lookup(self, query):
        return None


class _Found:
    async def lookup(self, query):
        return LookupResult(query, Macros(1, 2, 3, 4), 100, "test")


@pytest.mark.asyncio
async def test_service_falls_back_across_providers():
    service = NutritionService([_Failing(), _Empty(), _Found()])
    res = await service.lookup("банан")
    assert res is not None and res.source == "test"


@pytest.mark.asyncio
async def test_service_returns_none_when_nothing_found():
    assert await NutritionService([_Failing(), _Empty()]).lookup("x") is None


def test_from_settings_without_key_uses_only_off():
    service = NutritionService.from_settings(None, "claude-opus-5")
    assert len(service._providers) == 1
