import type SmartSeekerPlugin from "@/app/main";
import type { PluginSettings } from "@/shared/constants/settings";
import type { App } from "obsidian";
import { createContext } from "react";

export const AppContext = createContext<App | null>(null);
export const SettingsContext = createContext<PluginSettings | null>(null);
export const PluginContext = createContext<SmartSeekerPlugin | null>(null);
