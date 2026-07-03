import type { TelegramConfig } from "../telegram-integration";
import {
  readBoolean,
  readNumber,
  readOptionalString,
  readRequiredString,
  readStringArray,
} from "./config-helpers";

export function buildTelegramRuntimeConfig(input: {
  overrides?: Partial<TelegramConfig>;
  snapshot: Partial<TelegramConfig>;
  stored: TelegramConfig | null;
}): TelegramConfig | null {
  const { overrides, snapshot, stored } = input;
  const mode = readOptionalString(overrides?.mode, snapshot.mode, stored?.mode);
  const runtimeConfig: TelegramConfig = {
    botToken: readRequiredString(
      overrides?.botToken,
      snapshot.botToken,
      stored?.botToken,
      process.env.TELEGRAM_BOT_TOKEN,
    ),
    username: readOptionalString(
      overrides?.username,
      snapshot.username,
      stored?.username,
      process.env.TELEGRAM_BOT_USERNAME,
    ),
    defaultChatId: readOptionalString(
      overrides?.defaultChatId,
      snapshot.defaultChatId,
      stored?.defaultChatId,
    ),
    allowedChatIds: readStringArray(
      overrides?.allowedChatIds,
      snapshot.allowedChatIds,
      stored?.allowedChatIds,
    ),
    allowedUserIds: readStringArray(
      overrides?.allowedUserIds,
      snapshot.allowedUserIds,
      stored?.allowedUserIds,
    ),
    commandPrefix:
      readOptionalString(
        overrides?.commandPrefix,
        snapshot.commandPrefix,
        stored?.commandPrefix,
      ) || "/",
    enableCommands:
      typeof overrides?.enableCommands === "boolean"
        ? overrides.enableCommands
        : typeof snapshot.enableCommands === "boolean"
          ? snapshot.enableCommands
          : typeof stored?.enableCommands === "boolean"
            ? stored.enableCommands
            : true,
    enableAutoReply:
      typeof overrides?.enableAutoReply === "boolean"
        ? overrides.enableAutoReply
        : typeof snapshot.enableAutoReply === "boolean"
          ? snapshot.enableAutoReply
          : typeof stored?.enableAutoReply === "boolean"
            ? stored.enableAutoReply
            : true,
    enableMentionOnly:
      typeof overrides?.enableMentionOnly === "boolean"
        ? overrides.enableMentionOnly
        : typeof snapshot.enableMentionOnly === "boolean"
          ? snapshot.enableMentionOnly
          : typeof stored?.enableMentionOnly === "boolean"
            ? stored.enableMentionOnly
            : true,
    parseMode: readOptionalString(
      overrides?.parseMode,
      snapshot.parseMode,
      stored?.parseMode,
    ),
    replyDelay: readNumber(
      overrides?.replyDelay,
      snapshot.replyDelay,
      stored?.replyDelay,
      0,
    ),
    webhookSecret: readOptionalString(
      overrides?.webhookSecret,
      snapshot.webhookSecret,
      stored?.webhookSecret,
      process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
    ),
    webhookUrl: readOptionalString(
      overrides?.webhookUrl,
      snapshot.webhookUrl,
      stored?.webhookUrl,
    ),
    mode:
      mode === "auto" || mode === "webhook" || mode === "polling" ? mode : "auto",
    autoStart: readBoolean(overrides?.autoStart, snapshot.autoStart, stored?.autoStart),
    connected: stored?.connected,
    lastUpdateId: readNumber(
      overrides?.lastUpdateId,
      snapshot.lastUpdateId,
      stored?.lastUpdateId,
      0,
    ),
  };

  if (!runtimeConfig.botToken) {
    return null;
  }

  return runtimeConfig;
}
