from aiogram import Router

from . import common, diary, goals, products


def build_router() -> Router:
    router = Router()
    # Порядок важливий: команди та FSM-стани раніше за "будь-який текст".
    router.include_router(common.router)
    router.include_router(goals.router)
    router.include_router(diary.router)
    router.include_router(products.router)
    return router
