import { PluginSettings } from "@/shared/constants/settings";
import { App } from "obsidian";
import { createContext } from "react";

export const AppContext = createContext<App | undefined>(undefined);
export const SettingsContext = createContext<PluginSettings | undefined>(
	undefined
);
