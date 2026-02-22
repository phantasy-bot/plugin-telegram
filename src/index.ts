import { BasePlugin, PluginManifest, PluginTool } from "@phantasy/plugin-base";

export class TelegramPlugin extends BasePlugin {
  readonly name = "telegram";
  readonly version = "1.0.0";

  getManifest(): PluginManifest {
    return {
      name: this.name,
      version: this.version,
      description: "Telegram bot integration - send messages, commands, and webhooks",
      author: "Phantasy",
      license: "BUSL-1.1",
      repository: "https://github.com/phantasy-bot/plugin-telegram",
      category: "social",
      isPlatform: true,
      platformFeatures: { messaging: true, streaming: false, autonomous: true },
    };
  }

  getTools(): PluginTool[] {
    return [
      { name: "send_message", description: "Send a message to a Telegram chat", parameters: { type: "object", properties: { chatId: { type: "string" }, text: { type: "string" } }, required: ["chatId", "text"] } },
    ];
  }

  async initialize(): Promise<void> {}
}
export default TelegramPlugin;
