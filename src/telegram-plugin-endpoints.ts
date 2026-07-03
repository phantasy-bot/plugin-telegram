import type { TelegramConfig } from "./telegram-integration";
import type { TelegramPlugin } from "./telegram-plugin";

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleTelegramPluginEndpoint(
  plugin: TelegramPlugin,
  request: Request,
  path: string,
): Promise<Response | null> {
  if ((path === "/status" || path === "/bot-status") && request.method === "GET") {
    const runtimeConfig = await plugin.buildRuntimeConfig();
    const status = await plugin.getBotStatus();
    return jsonResponse({
      enabled: plugin.isEnabled(),
      connected: status.connected,
      error: status.error,
      summary: status.summary,
      lastActivity: status.lastActivity,
      username: runtimeConfig?.username || null,
      defaultChatId: runtimeConfig?.defaultChatId || null,
      allowedChatIds: runtimeConfig?.allowedChatIds || [],
      allowedUserIds: runtimeConfig?.allowedUserIds || [],
      webhookUrl: runtimeConfig?.webhookUrl || plugin.resolveWebhookUrl(runtimeConfig),
      mode: runtimeConfig?.mode || "auto",
      autoStart: runtimeConfig?.autoStart ?? false,
    });
  }

  if (path === "/webhook") {
    const botService = plugin.getBotService();
    if (!botService) {
      return new Response("Telegram integration is not running", { status: 503 });
    }

    return botService.handleWebhook(request);
  }

  if (path === "/start" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (body && typeof body === "object" && "config" in body) {
      await plugin.updateConfig((body as { config: Record<string, unknown> }).config);
    }

    const result = await plugin.startBot();
    return jsonResponse(result, result.success ? 200 : 400);
  }

  if (path === "/stop" && request.method === "POST") {
    const result = await plugin.stopBot();
    return jsonResponse(result, result.success ? 200 : 400);
  }

  if (path === "/test" && request.method === "POST") {
    const runtimeConfig = await plugin.buildRuntimeConfig();
    if (!runtimeConfig) {
      return jsonResponse(
        {
          success: false,
          configured: false,
          error: "Telegram bot token is required",
        },
        400,
      );
    }

    return jsonResponse({
      success: true,
      configured: true,
      username: runtimeConfig.username,
      defaultChatId: runtimeConfig.defaultChatId || null,
      allowedChatIds: runtimeConfig.allowedChatIds,
      allowedUserIds: runtimeConfig.allowedUserIds,
    });
  }

  if ((path === "/test-connection") && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const runtimeConfig = await plugin.buildRuntimeConfig(
      (body || {}) as Partial<TelegramConfig>,
    );

    if (!runtimeConfig) {
      return jsonResponse(
        {
          success: false,
          error: "Telegram bot token is required",
        },
        400,
      );
    }

    const result = await plugin.testConnection(runtimeConfig);
    return jsonResponse(
      {
        ...result,
        connected: result.success,
        username: result.botInfo?.username,
        userId:
          typeof result.botInfo?.id === "number" ? String(result.botInfo.id) : undefined,
      },
      result.success ? 200 : 400,
    );
  }

  return null;
}
