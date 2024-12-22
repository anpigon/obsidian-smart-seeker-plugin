import { PluginSettings } from "@/shared/constants/settings";
import type { App } from "obsidian";
import { useContext } from "react";
import { AppContext, SettingsContext } from "../context";

export const useApp = (): App | undefined => {
	return useContext(AppContext);
};

export const useSettings = (): PluginSettings | undefined => {
	return useContext(SettingsContext);
};
