export function buildTelegramGatewayThreadId(
  chatId: string,
  messageThreadId?: number,
): string {
  if (typeof messageThreadId === "number" && Number.isFinite(messageThreadId)) {
    return `telegram:chat:${chatId}:topic:${messageThreadId}`;
  }

  return `telegram:chat:${chatId}`;
}

export function normalizeTelegramId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return undefined;
}
