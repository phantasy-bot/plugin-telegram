import {
  AGENT_DEFAULTS,
  createPluginModuleLogger,
  fetchWithTimeout,
  kvService,
  type ServerEnv,
} from "@phantasy/agent/plugin-runtime";

import {
  readBoolean,
  readNumber,
  readOptionalString,
  readStringArray,
} from "./runtime/config-helpers";

const logger = createPluginModuleLogger("TelegramIntegration");

export type TelegramAdapterMode = "auto" | "webhook" | "polling";

export interface TelegramConfig {
  botToken: string;
  username?: string;
  defaultChatId?: string;
  allowedChatIds: string[];
  allowedUserIds: string[];
  commandPrefix: string;
  enableCommands: boolean;
  enableAutoReply: boolean;
  enableMentionOnly: boolean;
  parseMode?: string;
  replyDelay: number;
  webhookSecret?: string;
  webhookUrl?: string;
  mode: TelegramAdapterMode;
  autoStart?: boolean;
  connected?: boolean;
  lastUpdateId?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getNestedRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  const next = value[key];
  return isRecord(next) ? next : {};
}

function normalizeTelegramConfig(config: Partial<TelegramConfig>): TelegramConfig {
  const mode = readOptionalString(config.mode);
  return {
    botToken: readOptionalString(config.botToken) || "",
    username: readOptionalString(config.username),
    defaultChatId: readOptionalString(config.defaultChatId),
    allowedChatIds: readStringArray(config.allowedChatIds),
    allowedUserIds: readStringArray(config.allowedUserIds),
    commandPrefix: readOptionalString(config.commandPrefix) || "/",
    enableCommands:
      typeof config.enableCommands === "boolean" ? config.enableCommands : true,
    enableAutoReply:
      typeof config.enableAutoReply === "boolean" ? config.enableAutoReply : true,
    enableMentionOnly:
      typeof config.enableMentionOnly === "boolean" ? config.enableMentionOnly : true,
    parseMode: readOptionalString(config.parseMode),
    replyDelay: readNumber(config.replyDelay, 0),
    webhookSecret: readOptionalString(config.webhookSecret),
    webhookUrl: readOptionalString(config.webhookUrl),
    mode: mode === "auto" || mode === "webhook" || mode === "polling" ? mode : "auto",
    autoStart: readBoolean(config.autoStart),
    connected: readBoolean(config.connected),
    lastUpdateId: readNumber(config.lastUpdateId, 0),
  };
}

function getTelegramIntegrationConfig(
  agent: unknown,
): Partial<TelegramConfig> | undefined {
  const integrations = getNestedRecord(agent, "integrations");
  const telegram = getNestedRecord(integrations, "telegram");
  if (Object.keys(telegram).length === 0) {
    return undefined;
  }

  return normalizeTelegramConfig(telegram as Partial<TelegramConfig>);
}

export class TelegramIntegration {
  constructor(private readonly env: ServerEnv) {}

  async getConfig(): Promise<TelegramConfig | null> {
    try {
      const storedConfig = await kvService.get("integration:telegram");
      const config =
        isRecord(storedConfig) && Object.keys(storedConfig).length > 0
          ? normalizeTelegramConfig(storedConfig as Partial<TelegramConfig>)
          : getTelegramIntegrationConfig(await kvService.get(AGENT_DEFAULTS.ID));

      if (!config?.botToken) {
        return null;
      }

      return config;
    } catch (error) {
      logger.error("Failed to get Telegram config:", error);
      return null;
    }
  }

  async saveConfig(config: TelegramConfig): Promise<boolean> {
    try {
      const normalizedConfig = normalizeTelegramConfig(config);
      if (!normalizedConfig.botToken) {
        throw new Error("Telegram bot token is required");
      }

      await kvService.set("integration:telegram", normalizedConfig);

      const agent = (await kvService.get(AGENT_DEFAULTS.ID)) as Record<
        string,
        unknown
      > | null;
      if (agent) {
        const integrations = getNestedRecord(agent, "integrations");
        agent.integrations = {
          ...integrations,
          telegram: normalizedConfig,
        };
        await kvService.set(AGENT_DEFAULTS.ID, agent);
      }

      return true;
    } catch (error) {
      logger.error("Failed to save Telegram config:", error);
      return false;
    }
  }

  async testConnection(config: Pick<TelegramConfig, "botToken">): Promise<{
    success: boolean;
    error?: string;
    botInfo?: { id?: number; username?: string; first_name?: string };
  }> {
    try {
      const response = await fetchWithTimeout(
        `https://api.telegram.org/bot${encodeURIComponent(config.botToken)}/getMe`,
        {},
        10_000,
      );

      if (!response.ok) {
        return {
          success: false,
          error: `Telegram API returned ${response.status}`,
        };
      }

      const payload = (await response.json()) as {
        ok?: boolean;
        result?: { id?: number; username?: string; first_name?: string };
        description?: string;
      };

      if (!payload.ok || !payload.result) {
        return {
          success: false,
          error: payload.description || "Failed to authenticate with Telegram",
        };
      }

      return {
        success: true,
        botInfo: payload.result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  resolveWebhookUrl(config: TelegramConfig): string | undefined {
    if (config.webhookUrl) {
      return config.webhookUrl;
    }

    const publicUrl = readOptionalString(
      this.env.PUBLIC_URL,
      this.env.PHANTASY_PUBLIC_URL,
      this.env.WEB_BASE_URL,
    );
    if (!publicUrl) {
      return undefined;
    }

    const base = publicUrl.replace(/\/$/, "");
    return `${base}/admin/api/plugins/telegram/webhook`;
  }

  async sendMessage(
    chatId: string,
    content: string,
    options: { parseMode?: string; threadId?: number } = {},
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const config = await this.getConfig();
    if (!config) {
      return { success: false, error: "Telegram integration is not configured" };
    }

    try {
      const body: Record<string, unknown> = {
        chat_id: chatId,
        text: content,
      };
      const parseMode = options.parseMode || config.parseMode;
      if (parseMode) {
        body.parse_mode = parseMode;
      }
      if (typeof options.threadId === "number" && Number.isFinite(options.threadId)) {
        body.message_thread_id = options.threadId;
      }

      const response = await fetchWithTimeout(
        `https://api.telegram.org/bot${encodeURIComponent(config.botToken)}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        10_000,
      );

      if (!response.ok) {
        return {
          success: false,
          error: `Telegram API returned ${response.status}`,
        };
      }

      const payload = (await response.json()) as {
        ok?: boolean;
        result?: { message_id?: number };
        description?: string;
      };

      if (!payload.ok) {
        return {
          success: false,
          error: payload.description || "Failed to send Telegram message",
        };
      }

      return {
        success: true,
        messageId:
          typeof payload.result?.message_id === "number"
            ? String(payload.result.message_id)
            : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
