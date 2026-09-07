/** Сховище D1 спільне для тестів у файлі — чистимо таблиці перед кожним тестом. */
export async function resetTables(d1: D1Database): Promise<void> {
  await d1.batch(["entries", "products", "users", "states"].map((t) => d1.prepare(`DELETE FROM ${t}`)));
}
