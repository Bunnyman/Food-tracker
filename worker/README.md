# Food Tracker — версія для Cloudflare Workers

Той самий бот, що й у корені репозиторію, але на TypeScript для Cloudflare Workers:
Telegram надсилає оновлення через вебхук, дані зберігаються в Cloudflare D1.
Безкоштовного тарифу Cloudflare вистачає з великим запасом.

## Розгортання з браузера (без терміналу)

1. Зайдіть на [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** →
   **Import a repository** → підключіть GitHub і оберіть `Food-tracker`.
2. Налаштування імпорту залиште типовими (Root directory порожній, build command порожній,
   deploy command `npx wrangler deploy`). Натисніть **Create and deploy**.
   Конфігурація Worker лежить у `wrangler.jsonc` в корені репозиторію, а база D1
   `food-tracker-db` створюється автоматично під час першого деплою.
3. Відкрийте Worker → **Settings** → **Variables and Secrets** → додайте секрети
   `TELEGRAM_BOT_TOKEN` (від @BotFather) і `ANTHROPIC_API_KEY`
   (з [console.anthropic.com](https://console.anthropic.com)). Збережіть — Worker перезапуститься.
4. Відкрийте в браузері `https://<назва-воркера>.<ваш-субдомен>.workers.dev/setup`.
   Сторінка створить таблиці, зареєструє вебхук і команди та покаже посилання на бота.
5. Напишіть боту `/start`.

Кожен push у гілку, обрану при імпорті, автоматично передеплоює Worker.
`/setup` можна відкривати повторно — це безпечно.

## Змінні

| Змінна | Де задається | Опис |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Secret у Dashboard | Токен бота. Обов'язково. |
| `ANTHROPIC_API_KEY` | Secret у Dashboard | Ключ Anthropic для автоматичного визначення БЖВ. Без нього — лише Open Food Facts і ручне введення. |
| `CLAUDE_MODEL` | `wrangler.jsonc` | Модель Claude, типово `claude-opus-5`. |
| `TZ` | `wrangler.jsonc` | Часовий пояс для «сьогодні», типово `Europe/Kyiv`. |

## Як це працює

- `src/index.ts` — маршрути: `POST /webhook` (перевірка секретного заголовка Telegram, обробка у фоні
  через `waitUntil`), `GET /setup` (схема БД, `setWebhook`, `setMyCommands`), `/health`.
- `src/bot.ts` — обробники grammY: команди, кнопки меню, inline-кнопки, стан діалогу.
- `src/db.ts` — D1: користувачі й цілі, продукти, щоденник, стан діалогу.
- `src/nutrition.ts` — Claude (structured output) → Open Food Facts → ручне введення.
- `src/texts.ts`, `src/keyboards.ts` — тексти українською та клавіатури.

## Локальна розробка (необов'язково)

У корені репозиторію (npm workspace):

```bash
npm install
npm test          # vitest у workerd з локальною D1
npm run typecheck
npx wrangler dev  # локальний запуск
```
