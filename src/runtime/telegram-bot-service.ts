import {
  AGENT_DEFAULTS,
  createPlatformConversationBridge,
  createPluginModuleLogger,
  importEsmModule,
  kvService,
  type PlatformConversationBridgeInboundEvent,
  type ServerEnv,
} from "@phantasy/agent/plugin-runtime";

import type { TelegramConfig } from "../telegram-integration";
import {
  buildTelegramGatewayThreadId,
  normalizeTelegramId,
} from "./telegram-thread-helpers";

const logger = createPluginModuleLogger("TelegramBotService");

type TelegramBridge = ReturnType<typeof createPlatformConversationBridge>;

type ResolvedCommand = {
  content?: string;
  handled: boolean;
  responseText?: string;
} | null;

export class TelegramBotService {
  private bridge: TelegramBridge | null = null;
  private connected = false;

  constructor(
    private readonly env: ServerEnv,
    private readonly config: TelegramConfig,
    private readonly webhookUrl?: string,
  ) {}

  async start(): Promise<void> {
    if (this.connected) {
      return;
    }

    const bridge = this.getBridge();
    await bridge.initialize();
    this.connected = true;
    logger.info("Telegram messaging bridge initialized");
  }

  async stop(): Promise<void> {
    if (this.bridge) {
      await this.bridge.shutdown();
      this.bridge = null;
    }
    this.connected = false;
    logger.info("Telegram messaging bridge stopped");
  }

  getStatus(): { connected: boolean } {
    return { connected: this.connected };
  }

  async handleWebhook(request: Request): Promise<Response> {
    return this.getBridge().handleWebhook(request);
  }

  async sendMessage(
    chatId: string,
    content: string,
    options: {
      gatewayThreadId?: string;
      sessionId?: string;
      threadId?: number;
    } = {},
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const bridge = this.getBridge();
    await bridge.initialize();
    const adapter = bridge.getAdapter();
    const threadId = adapter.encodeThreadId({
      chatId,
      messageThreadId: options.threadId,
    });

    return bridge.sendMessage({
      channelUserId: chatId,
      content,
      gatewayMetadata: {
        chatId,
        messageThreadId: options.threadId,
      },
      gatewayThreadId:
        options.gatewayThreadId || buildTelegramGatewayThreadId(chatId, options.threadId),
      sessionId: options.sessionId,
      threadId,
    });
  }

  private getBridge(): TelegramBridge {
    if (this.bridge) {
      return this.bridge;
    }

    this.bridge = createPlatformConversationBridge({
      adapterKey: "telegram",
      env: this.env,
      platform: "telegram",
      registerDirectHandler: true,
      registerMentionHandler: true,
      registerMessageHandler:
        this.config.enableAutoReply && !this.config.enableMentionOnly,
      registerSubscribedHandler: true,
      replyDelayMs: Math.max(0, this.config.replyDelay) * 1000,
      stateKeyPrefix: "phantasy-chat-sdk:telegram",
      userName: this.config.username || "phantasy-telegram",
      createAdapter: async () => {
        const { createTelegramAdapter } = await importEsmModule<{
          createTelegramAdapter: (config: Record<string, unknown>) => unknown;
        }>("@chat-adapter/telegram");

        return createTelegramAdapter({
          botToken: this.config.botToken,
          userName: this.config.username || "phantasy-telegram",
          secretToken: this.config.webhookSecret,
          mode: this.config.mode,
        }) as never;
      },
      normalizeInboundMessage: (event) => this.normalizeInboundMessage(event),
      onStart: async (bridge) => {
        if (this.config.mode !== "polling") {
          return;
        }

        const adapter = bridge.getAdapter() as {
          startPolling?: () => Promise<void>;
        };
        await adapter.startPolling?.();
      },
      onStop: async (bridge) => {
        const adapter = bridge.getAdapter() as {
          stopPolling?: () => Promise<void>;
        };
        await adapter.stopPolling?.();
      },
    });

    return this.bridge;
  }

  private async normalizeInboundMessage(event: PlatformConversationBridgeInboundEvent) {
    const authorId = normalizeTelegramId(event.message.author.userId);
    const authorName =
      normalizeTelegramId(event.message.author.userName) ||
      normalizeTelegramId(event.message.author.fullName) ||
      authorId;

    if (!authorId || !authorName) {
      return null;
    }

    if (
      this.config.allowedUserIds.length > 0 &&
      !this.config.allowedUserIds.includes(authorId)
    ) {
      return null;
    }

    const decoded = event.adapter.decodeThreadId(event.thread.id) as {
      chatId?: string;
      messageThreadId?: number;
    };
    const chatId = normalizeTelegramId(decoded.chatId);
    if (!chatId) {
      return null;
    }

    const monitoredChats = new Set([
      ...this.config.allowedChatIds,
      ...(this.config.defaultChatId ? [this.config.defaultChatId] : []),
    ]);
    if (monitoredChats.size > 0 && !monitoredChats.has(chatId)) {
      return null;
    }

    if (event.reason === "message" && this.config.enableMentionOnly) {
      return null;
    }

    if (
      !this.config.enableAutoReply &&
      event.reason !== "direct" &&
      event.reason !== "mention"
    ) {
      return null;
    }

    const rawText = String(event.message.text || "").trim();
    if (!rawText) {
      return null;
    }

    const command = await this.resolveCommand(rawText);
    if (command?.handled && !command.content) {
      return {
        autoSubscribe: false,
        channelId: chatId,
        channelUserId: authorId,
        content: rawText,
        gatewayMetadata: {
          chatId,
          messageThreadId: decoded.messageThreadId,
        },
        gatewayThreadId: buildTelegramGatewayThreadId(chatId, decoded.messageThreadId),
        immediateResponseText: command.responseText,
        source: "telegram:chat",
        threadId: event.thread.id,
        userId: authorId,
        username: authorName,
      };
    }

    const content = command?.content || rawText;
    if (!content.trim()) {
      return null;
    }

    return {
      autoSubscribe: event.reason !== "message" || this.config.enableAutoReply,
      channelId: chatId,
      channelUserId: authorId,
      content,
      gatewayMetadata: {
        chatId,
        messageThreadId: decoded.messageThreadId,
      },
      gatewayThreadId: buildTelegramGatewayThreadId(chatId, decoded.messageThreadId),
      source: "telegram:chat",
      threadId: event.thread.id,
      userId: authorId,
      username: authorName,
    };
  }

  private async resolveCommand(text: string): Promise<ResolvedCommand> {
    if (!this.config.enableCommands) {
      return null;
    }

    const prefix = this.config.commandPrefix || "/";
    if (!text.startsWith(prefix)) {
      return null;
    }

    const [rawCommand, ...args] = text.slice(prefix.length).trim().split(/\s+/);
    const command = rawCommand?.toLowerCase() || "";

    switch (command) {
      case "help":
        return {
          handled: true,
          responseText: `Available commands:
${prefix}help - Show this help message
${prefix}about - Learn about me
${prefix}chat <message> - Chat with me`,
        };
      case "about": {
        const agent = await kvService.get(AGENT_DEFAULTS.ID);
        const agentRecord =
          agent && typeof agent === "object"
            ? (agent as { name?: string; personality?: string })
            : null;
        return {
          handled: true,
          responseText: agentRecord?.name
            ? `I'm ${agentRecord.name}! ${agentRecord.personality || ""}`.trim()
            : "I'm an AI companion powered by Phantasy!",
        };
      }
      case "chat":
        if (args.length === 0) {
          return {
            handled: true,
            responseText: "Please provide a message to chat about!",
          };
        }
        return {
          content: args.join(" "),
          handled: true,
        };
      default:
        return {
          handled: true,
          responseText: `Unknown command. Use ${prefix}help to see available commands.`,
        };
    }
  }
}
