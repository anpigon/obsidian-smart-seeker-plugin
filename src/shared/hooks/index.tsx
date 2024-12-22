import { PluginSettings } from "@/shared/constants/settings";
import { AppContext, SettingsContext } from "@/shared/context";
import type { App } from "obsidian";
import { useContext } from "react";

export const useApp = (): App | undefined => {
	return useContext(AppContext);
};

export const useSettings = (): PluginSettings | undefined => {
	return useContext(SettingsContext);
};
