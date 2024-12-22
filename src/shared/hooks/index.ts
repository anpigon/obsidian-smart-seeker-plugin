import SmartSeekerPlugin from "@/app/main";
import type { PluginSettings } from "@/shared/constants/settings";
import { AppContext, PluginContext, SettingsContext } from "@/shared/context";
import type { App } from "obsidian";
import { useContext } from "react";

export const useApp = (): App => {
	const context = useContext(AppContext);
	if (!context) {
		throw new Error("useApp must be used within an AppContext.Provider");
	}
	return context;
};

export const useSettings = (): PluginSettings => {
	const context = useContext(SettingsContext);
	if (!context) {
		throw new Error(
			"useSettings must be used within a SettingsContext.Provider",
		);
	}
	return context;
};

export const usePlugin = (): SmartSeekerPlugin => {
	const context = useContext(PluginContext);
	if (!context) {
		throw new Error("usePlugin must be used within a PluginContext.Provider");
	}
	return context;
};
