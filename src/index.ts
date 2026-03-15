import { BasePlugin, type PluginTool } from "@phantasy/agent/plugins";

export class TelegramPlugin extends BasePlugin {
  name = "telegram";
  version = "2.0.0";
  description = "Telegram bot and channel integration plugin for Phantasy companions.";

  protected displayName = "Telegram";
  protected category = "messaging";
  protected tags = ["telegram","messaging","bot","community"];
  protected permissions = ["internet"];
  protected workspace = "business" as const;
  protected extensionKind = "integration" as const;
  protected adminSurface =   {
    "tabId": "telegram",
    "label": "Telegram",
    "section": "business",
    "workspace": "business",
    "kind": "generic",
    "keywords": [
      "telegram",
      "messaging",
      "bot",
      "community"
    ]
  } as const;
  protected configSchema =   {
    "type": "object",
    "properties": {
      "enabled": {
        "type": "boolean",
        "default": true
      }
    }
  };

  getTools(): PluginTool[] {
    return [];
  }
}

export default TelegramPlugin;
