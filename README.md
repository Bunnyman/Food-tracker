# Food Tracker — Telegram-бот для обліку калорій та БЖВ

Бот веде особистий список страв/продуктів, сам підтягує калорійність і БЖВ,
зберігає денну ціль і показує, скільки ще можна з'їсти сьогодні.

## Можливості

1. **Список страв і продуктів.** `➕ Додати продукт` або `/add гречка варена` —
   бот через Claude (або Open Food Facts) визначає ккал/білки/жири/вуглеводи на
   100 г, ви підтверджуєте або вводите значення вручну та задаєте порцію
   за замовчуванням.
2. **Ціль на день.** `🎯 Ціль` або `/goal 2000 150 60 200`
   (ккал, білки, жири, вуглеводи; можна лише `/goal 2000`).
3. **Сьогодні.** `📅 Сьогодні` або `/today` — залишок ліміту по ккал і БЖВ,
   список з'їденого та кнопки продуктів. Натискання на продукт записує його
   порцію, ліміт одразу перераховується. `↩️ Відмінити останнє` прибирає
   останній запис, `/eat гречка 150` записує довільну кількість.

Інше: `📋 Мої продукти` / `/products` — перегляд, зміна порції, видалення;
`/help`, `/cancel`. Будь-який довільний текст сприймається як назва продукту
для додавання.

## Запуск

```bash
cp .env.example .env      # вписати TELEGRAM_BOT_TOKEN та ANTHROPIC_API_KEY
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -m bot
```

Або в Docker:

```bash
docker compose up -d --build
```

### Змінні середовища

| Змінна | Опис |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Токен від [@BotFather](https://t.me/BotFather). Обов'язково. |
| `ANTHROPIC_API_KEY` | Ключ Anthropic для автоматичного визначення БЖВ. Без нього використовується лише Open Food Facts. |
| `CLAUDE_MODEL` | Модель Claude, типово `claude-opus-5`. |
| `DB_PATH` | Шлях до SQLite-бази, типово `data/food.db`. |
| `TZ` | Часовий пояс для визначення «сьогодні», типово `Europe/Kyiv`. |

## Структура

```
bot/
  __main__.py     запуск (long polling)
  config.py       налаштування з env / .env
  db.py           SQLite: користувачі й цілі, продукти, щоденник
  models.py       Macros, Product, Entry
  nutrition.py    пошук БЖВ: Claude → Open Food Facts → вручну
  texts.py        форматування повідомлень і розбір чисел
  keyboards.py    reply- та inline-клавіатури
  handlers/       common, goals, diary (сьогодні/запис), products (додавання/список)
tests/            pytest (БД, форматування, провайдери, сценарії через Dispatcher)
```

## Тести

```bash
pip install -r requirements-dev.txt
pytest
```
