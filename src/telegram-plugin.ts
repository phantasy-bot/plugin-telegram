import {
  BasePlugin,
  type PlatformCapability,
  type PluginConfig,
  type PluginTool,
} from "@phantasy/agent/plugins";
import {
  createPluginModuleLogger,
  getPluginRuntimeEnv,
  type ServerEnv,
} from "@phantasy/agent/plugin-runtime";

import { handleTelegramPluginEndpoint } from "./telegram-plugin-endpoints";
import { TelegramIntegration, type TelegramConfig } from "./telegram-integration";
import { TelegramBotService } from "./runtime/telegram-bot-service";
import { buildTelegramRuntimeConfig } from "./runtime/telegram-plugin-config";

const log = createPluginModuleLogger("TelegramPlugin");

type TelegramPluginConfig = PluginConfig & Partial<TelegramConfig>;

export class TelegramPlugin extends BasePlugin implements PlatformCapability {
  name = "telegram";
  version = "0.1.0";
  description = "Telegram bot and operator channel integration for Phantasy.";

  protected displayName = "Telegram";
  protected category = "messaging";
  protected tags = ["telegram", "messaging", "bot", "community"];
  protected permissions = ["internet"];
  protected workspace = "business" as const;
  protected extensionKind = "integration" as const;
  protected isPlatform = true;
  protected platformFeatures = {
    messaging: true,
    autonomous: false,
  } as const;
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
      enabled: { type: "boolean", default: true, title: "Enabled" },
      autoStart: {
        type: "boolean",
        default: false,
        title: "Auto-start",
        description:
          "Start the Telegram bridge automatically when this integration is enabled.",
      },
      botToken: { type: "string", title: "Bot token", format: "password" },
      username: { type: "string", title: "Bot username" },
      defaultChatId: {
        type: "string",
        title: "Default chat ID",
        description: "Fallback chat or group for outbound messages.",
      },
      allowedChatIds: {
        type: "array",
        title: "Allowed chat IDs",
        items: { type: "string" },
        default: [],
      },
      allowedUserIds: {
        type: "array",
        title: "Allowed user IDs",
        items: { type: "string" },
        default: [],
      },
      commandPrefix: { type: "string", default: "/", title: "Command prefix" },
      enableCommands: { type: "boolean", default: true, title: "Enable commands" },
      enableAutoReply: { type: "boolean", default: true, title: "Enable auto-reply" },
      enableMentionOnly: {
        type: "boolean",
        default: true,
        title: "Mention-only in groups",
      },
      parseMode: { type: "string", title: "Parse mode" },
      replyDelay: { type: "number", default: 0, title: "Reply delay (seconds)" },
      webhookSecret: { type: "string", title: "Webhook secret", format: "password" },
      webhookUrl: { type: "string", title: "Webhook URL" },
      mode: {
        type: "string",
        enum: ["auto", "webhook", "polling"],
        default: "auto",
        title: "Runtime mode",
      },
    },
  };

  private botService: TelegramBotService | null = null;
  private lastActivity?: Date;

  getTools(): PluginTool[] {
    return [];
  }

  override async onInit(
    _agentConfig: Record<string, unknown>,
    config?: TelegramPluginConfig,
  ): Promise<void> {
    await super.onInit(_agentConfig, config);
    const runtimeConfig = await this.buildRuntimeConfig();
    if (runtimeConfig) {
      await this.createIntegration().saveConfig(runtimeConfig);
    }

    if (this.isEnabled() && runtimeConfig?.autoStart && !this.botService) {
      const result = await this.startBot();
      if (!result.success) {
        log.warn("Telegram auto-start failed", { message: result.message });
      }
    }
  }

  async startBot(): Promise<{ success: boolean; message?: string }> {
    const runtimeConfig = await this.buildRuntimeConfig();
    if (!runtimeConfig) {
      return {
        success: false,
        message: "Set a Telegram bot token before starting the integration.",
      };
    }

    const integration = this.createIntegration();
    const testResult = await integration.testConnection(runtimeConfig);
    if (!testResult.success) {
      return {
        success: false,
        message: testResult.error || "Failed to connect to Telegram",
      };
    }

    const webhookUrl =
      runtimeConfig.webhookUrl || integration.resolveWebhookUrl(runtimeConfig);
    const nextConfig = {
      ...runtimeConfig,
      username: testResult.botInfo?.username || runtimeConfig.username,
      connected: true,
      webhookUrl,
    };
    await integration.saveConfig(nextConfig);

    if (this.botService) {
      await this.botService.stop();
    }

    this.botService = new TelegramBotService(this.getRuntimeEnv(), nextConfig, webhookUrl);
    await this.botService.start();
    this.lastActivity = new Date();

    return {
      success: true,
      message: nextConfig.username
        ? `Connected to Telegram as @${nextConfig.username}`
        : "Connected to Telegram",
    };
  }

  async stopBot(): Promise<{ success: boolean; message?: string }> {
    if (this.botService) {
      await this.botService.stop();
      this.botService = null;
    }

    const runtimeConfig = await this.buildRuntimeConfig();
    if (runtimeConfig) {
      await this.createIntegration().saveConfig({
        ...runtimeConfig,
        connected: false,
      });
    }

    return {
      success: true,
      message: "Telegram integration stopped",
    };
  }

  async getBotStatus(): Promise<{
    connected: boolean;
    streaming?: boolean;
    autonomousPosting?: boolean;
    lastActivity?: Date;
    error?: string;
    summary?: string;
    configuredChannels?: string[];
    recommendedActions?: string[];
  }> {
    const runtimeConfig = await this.buildRuntimeConfig();
    if (!runtimeConfig) {
      return {
        connected: false,
        streaming: false,
        autonomousPosting: false,
        lastActivity: this.lastActivity,
        error: "Telegram bot token is not configured",
        summary: "Needs bot token",
        recommendedActions: [
          "Add TELEGRAM_BOT_TOKEN or configure a bot token in the integration.",
          "Point the Telegram webhook at /admin/api/plugins/telegram/webhook when using webhook mode.",
        ],
      };
    }

    const configuredChannels = Array.from(
      new Set(
        [runtimeConfig.defaultChatId, ...runtimeConfig.allowedChatIds].filter(
          Boolean,
        ) as string[],
      ),
    );

    if (this.botService) {
      const status = this.botService.getStatus();
      return {
        connected: status.connected,
        streaming: false,
        autonomousPosting: false,
        lastActivity: this.lastActivity,
        summary: status.connected
          ? runtimeConfig.username
            ? `Connected as @${runtimeConfig.username}`
            : "Connected"
          : "Configured, reconnecting",
        configuredChannels,
        recommendedActions:
          configuredChannels.length === 0
            ? ["Add a default chat ID or explicit chat allowlist."]
            : [],
      };
    }

    const storedConfig = await this.createIntegration().getConfig();
    const connected = Boolean(storedConfig?.connected);
    return {
      connected,
      streaming: false,
      autonomousPosting: false,
      lastActivity: this.lastActivity,
      error: connected ? undefined : "Telegram bot is not connected",
      summary: connected ? "Configured" : "Configured, not running",
      configuredChannels,
      recommendedActions: ["Start the integration after configuring Telegram credentials."],
    };
  }

  async sendMessage(params: {
    content: string;
    channelId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const runtimeConfig = await this.buildRuntimeConfig();
    const chatId = params.channelId || runtimeConfig?.defaultChatId;

    if (!runtimeConfig || !chatId) {
      return {
        success: false,
        error: "Telegram default chat is not configured",
      };
    }

    const threadId =
      typeof params.metadata?.threadId === "number"
        ? params.metadata.threadId
        : typeof params.metadata?.threadId === "string"
          ? Number(params.metadata.threadId)
          : undefined;

    const result = this.botService
      ? await this.botService.sendMessage(chatId, params.content, {
          threadId: Number.isFinite(threadId) ? threadId : undefined,
          sessionId:
            typeof params.metadata?.sessionId === "string"
              ? params.metadata.sessionId
              : undefined,
          gatewayThreadId:
            typeof params.metadata?.gatewayThreadId === "string"
              ? params.metadata.gatewayThreadId
              : undefined,
        })
      : await this.createIntegration().sendMessage(chatId, params.content, {
          parseMode: runtimeConfig.parseMode,
          threadId: Number.isFinite(threadId) ? threadId : undefined,
        });

    if (result.success) {
      this.lastActivity = new Date();
    }

    return result;
  }

  async onConfigUpdated(newConfig: PluginConfig): Promise<void> {
    await super.onConfigUpdated(newConfig);
    const runtimeConfig = await this.buildRuntimeConfig();
    if (runtimeConfig) {
      await this.createIntegration().saveConfig(runtimeConfig);
    }
  }

  async handleCustomEndpoint(request: Request, path: string): Promise<Response | null> {
    try {
      return handleTelegramPluginEndpoint(this, request, path);
    } catch (error) {
      log.error("Telegram plugin endpoint failed", {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      return new Response(
        JSON.stringify({ success: false, error: "Telegram plugin request failed" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  getBotService(): TelegramBotService | null {
    return this.botService;
  }

  resolveWebhookUrl(config: TelegramConfig | null): string | undefined {
    if (!config) {
      return undefined;
    }
    return this.createIntegration().resolveWebhookUrl(config);
  }

  async testConnection(config: Pick<TelegramConfig, "botToken">): Promise<{
    success: boolean;
    error?: string;
    botInfo?: { id?: number; username?: string; first_name?: string };
  }> {
    return this.createIntegration().testConnection(config);
  }

  async buildRuntimeConfig(
    overrides?: Partial<TelegramConfig>,
  ): Promise<TelegramConfig | null> {
    const snapshot = (this.getConfig() || {}) as TelegramPluginConfig;
    const stored = await this.createIntegration().getConfig();
    return buildTelegramRuntimeConfig({ overrides, snapshot, stored });
  }

  private createIntegration(): TelegramIntegration {
    return new TelegramIntegration(this.getRuntimeEnv());
  }

  private getRuntimeEnv(): ServerEnv {
    return getPluginRuntimeEnv() as unknown as ServerEnv;
  }
}

export default TelegramPlugin;
