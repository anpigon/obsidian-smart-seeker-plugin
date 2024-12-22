import type SmartSeekerPlugin from "@/app/main";
import AppProvider from "@/app/provider";
import { type App, PluginSettingTab } from "obsidian";
import { StrictMode } from "react";
import { createRoot, Root } from "react-dom/client";
import SettingTabContainer from "./components/SettingTabContainer";

export default class SmartSeekerSettingTab extends PluginSettingTab {
	root: Root | null = null;
	plugin: SmartSeekerPlugin;
	indexListEl: HTMLElement | null = null;
	indexSelectEl: HTMLSelectElement | null = null;

	constructor(app: App, plugin: SmartSeekerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.root = createRoot(containerEl);

		this.root?.render(
			<StrictMode>
				<AppProvider app={this.app} plugin={this.plugin}>
					<SettingTabContainer />
				</AppProvider>
			</StrictMode>
		);
	}

	hide(): void {
		this.root?.unmount();
		super.hide();
	}
}
