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

## Хостинг без локального запуску

Бот можна розгорнути прямо з GitHub через браузер, нічого не встановлюючи.

**Railway (рекомендовано: працює постійно, база зберігається)**

1. [railway.com](https://railway.com) → New Project → Deploy from GitHub repo → оберіть `Food-tracker`.
2. Variables → додайте `TELEGRAM_BOT_TOKEN` і `ANTHROPIC_API_KEY`.
3. Service → Settings → Volumes → Add Volume з mount path `/app/data` (щоб база не зникала при перезапусках).
4. Deploy. Конфігурація береться з `railway.json` і `Dockerfile`.

**Render (безкоштовний тариф)**

1. [render.com](https://render.com) → New → Blueprint → оберіть репозиторій; конфігурація береться з `render.yaml`.
2. Введіть `TELEGRAM_BOT_TOKEN` і `ANTHROPIC_API_KEY`, коли Render їх запитає.
3. Безкоштовний сервіс засинає без HTTP-трафіку: додайте моніторинг на
   [UptimeRobot](https://uptimerobot.com), який відкриває `https://<ваш-сервіс>.onrender.com/health`
   кожні 5 хвилин. Файлова система на free-тарифі не зберігається між деплоями, тому
   список продуктів і щоденник можуть скинутися після нового деплою.

Якщо хостинг вимагає відкритий порт, бот сам піднімає health-endpoint на `PORT`.

## Запуск локально

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
