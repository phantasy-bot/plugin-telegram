import {
  BasePlugin,
  type PluginConfig,
  type PluginTool,
} from "@phantasy/agent/plugins";

type TelegramPluginConfig = PluginConfig & {
  botToken?: string;
  username?: string;
  defaultChatId?: string;
  webhookSecret?: string;
  parseMode?: string;
};

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function describeTelegramConfig(config: TelegramPluginConfig) {
  const botToken = getTrimmedString(config.botToken);
  const username = getTrimmedString(config.username);
  const defaultChatId = getTrimmedString(config.defaultChatId);
  const parseMode = getTrimmedString(config.parseMode) || "Markdown";

  const configured = Boolean(botToken);

  return {
    configured,
    botTokenConfigured: Boolean(botToken),
    username: username || null,
    defaultChatId: defaultChatId || null,
    parseMode,
    error: configured
      ? undefined
      : "Set a Telegram bot token before using this integration.",
  };
}

export class TelegramPlugin extends BasePlugin {
  name = "telegram";
  version = "0.1.0";
  description = "Telegram bot and channel integration for Phantasy.";

  protected displayName = "Telegram";
  protected category = "messaging";
  protected tags = ["telegram", "messaging", "bot", "community"];
  protected permissions = ["internet"];
  protected workspace = "business" as const;
  protected extensionKind = "integration" as const;
  protected adminSurface = {
    tabId: "telegram",
    label: "Telegram",
    section: "business",
    workspace: "business",
    kind: "generic",
    keywords: ["telegram", "messaging", "bot", "community"],
    dashboardIcon: "telegram",
  } as const;
  protected configSchema = {
    type: "object",
    properties: {
      enabled: { type: "boolean", default: true },
      botToken: { type: "string" },
      username: { type: "string" },
      defaultChatId: { type: "string" },
      webhookSecret: { type: "string" },
      parseMode: { type: "string", default: "Markdown" },
    },
  };

  getTools(): PluginTool[] {
    return [];
  }

  async handleCustomEndpoint(
    request: Request,
    path: string,
  ): Promise<Response | null> {
    const status = describeTelegramConfig(this.getConfig() as TelegramPluginConfig);

    if (path === "/status" && request.method === "GET") {
      return jsonResponse({
        enabled: this.isEnabled(),
        ...status,
      });
    }

    if (path === "/test" && request.method === "POST") {
      if (!status.configured) {
        return jsonResponse(
          {
            success: false,
            error: status.error,
          },
          400,
        );
      }

      return jsonResponse({
        success: true,
        message: "Telegram integration is configured.",
        ...status,
      });
    }

    return null;
  }
}

export default TelegramPlugin;
