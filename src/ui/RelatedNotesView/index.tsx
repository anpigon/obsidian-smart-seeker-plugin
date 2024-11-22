import { AppContext, SettingsContext } from "@/helpers/context";
import { PluginSettings } from "@/settings/settings";
import { IconName, ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { StrictMode } from "react";
import { Root, createRoot } from "react-dom/client";
import { PLUGIN_APP_ID } from "../../constants";
import RelatedNotes from "./RelatedNotes";

export const VIEW_TYPE_RELATED_NOTES = `${PLUGIN_APP_ID}-related-notes-view`;

export class RelatedNotesView extends ItemView {
	root: Root | null = null;
	private currentFile: TFile | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private settings: PluginSettings,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_RELATED_NOTES;
	}

	getDisplayText(): string {
		return "Smart Seeker";
	}

	getIcon(): IconName {
		return "documents";
	}

	async render(): Promise<void> {
		this.root?.render(
			<StrictMode>
				<AppContext.Provider value={this.app}>
					<SettingsContext.Provider value={this.settings}>
						<RelatedNotes currentFile={this.currentFile} />
					</SettingsContext.Provider>
				</AppContext.Provider>
			</StrictMode>,
		);
	}

	async onOpen(): Promise<void> {
		this.root = createRoot(this.containerEl.children[1]);

		// Get initial file
		const currentFile = this.app.workspace.getActiveFile();
		if (currentFile && currentFile instanceof TFile) {
			this.currentFile = currentFile;
		}

		this.render();

		// Register event for file open with debounce
		let timeoutId: NodeJS.Timeout;
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (
					file &&
					file instanceof TFile &&
					this.currentFile?.path !== file.path
				) {
					// Clear previous timeout
					if (timeoutId) clearTimeout(timeoutId);

					// Set new timeout
					timeoutId = setTimeout(() => {
						this.currentFile = file;
						this.render();
					}, 300); // 300ms debounce
				}
			}),
		);
	}

	async onClose() {
		this.root?.unmount();
	}
}
