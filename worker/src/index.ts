import type { Bot } from "grammy";
import { COMMANDS, createBot } from "./bot";
import { Database } from "./db";
import { NutritionService } from "./nutrition";
import type { Env } from "./types";

const WEBHOOK_PATH = "/webhook";

/** Секрет для перевірки, що оновлення прийшло від Telegram: похідна від токена, без окремої змінної. */
async function webhookSecret(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("food-tracker:" + token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}

// Кеш на час життя ізоляту: бот та факт ініціалізації схеми.
let cached: { token: string; bot: Bot; ready: Promise<void> } | null = null;

function getBot(env: Env): { bot: Bot; ready: Promise<void> } {
  if (cached && cached.token === env.TELEGRAM_BOT_TOKEN) return cached;
  const db = new Database(env.DB);
  const nutrition = NutritionService.fromEnv(env.ANTHROPIC_API_KEY, env.CLAUDE_MODEL || "claude-opus-5");
  const bot = createBot(env.TELEGRAM_BOT_TOKEN, { db, nutrition, timeZone: env.TZ || "Europe/Kyiv" });
  const ready = Promise.all([db.ensureSchema(), bot.init()]).then(() => undefined);
  cached = { token: env.TELEGRAM_BOT_TOKEN, bot, ready };
  ready.catch(() => {
    cached = null;
  });
  return cached;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (!env.TELEGRAM_BOT_TOKEN) {
      return new Response("TELEGRAM_BOT_TOKEN не задано. Додайте секрет у Settings → Variables and Secrets.", { status: 500 });
    }

    // Одноразове налаштування: схема БД, вебхук, список команд. Ідемпотентно.
    if (url.pathname === "/setup") {
      const { bot, ready } = getBot(env);
      await ready;
      const secret = await webhookSecret(env.TELEGRAM_BOT_TOKEN);
      await bot.api.setWebhook(`${url.origin}${WEBHOOK_PATH}`, {
        secret_token: secret,
        drop_pending_updates: true,
        allowed_updates: ["message", "callback_query"],
      });
      await bot.api.setMyCommands(COMMANDS);
      const me = bot.botInfo;
      return new Response(
        `Готово ✅\nБот @${me.username} підключено до ${url.origin}${WEBHOOK_PATH}.\n` +
          `Claude: ${env.ANTHROPIC_API_KEY ? "увімкнено" : "вимкнено (немає ANTHROPIC_API_KEY)"}.\n` +
          `Відкрийте https://t.me/${me.username} і надішліть /start.`,
        { headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }

    if (url.pathname === WEBHOOK_PATH && request.method === "POST") {
      const secret = await webhookSecret(env.TELEGRAM_BOT_TOKEN);
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) {
        return new Response("forbidden", { status: 403 });
      }
      const update = await request.json();
      const { bot, ready } = getBot(env);
      // Відповідаємо Telegram одразу, обробку робимо у фоні — інакше повільний пошук БЖВ спричинить повтори.
      ctx.waitUntil(ready.then(() => bot.handleUpdate(update as Parameters<Bot["handleUpdate"]>[0])));
      return new Response("ok");
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("Food Tracker bot is running. Відкрийте /setup для підключення до Telegram.", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
