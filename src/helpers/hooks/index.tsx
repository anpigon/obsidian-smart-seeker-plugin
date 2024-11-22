import type { App } from "obsidian";
import { useContext } from "react";
import { AppContext, SettingsContext } from "../context";
import { PluginSettings } from "@/settings/settings";

export const useApp = (): App | undefined => {
	return useContext(AppContext);
};

export const useSettings = (): PluginSettings | undefined => {
	return useContext(SettingsContext);
};
