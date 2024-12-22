import { AppContext, SettingsContext } from "@/helpers/context";
import { PluginSettings } from "@/shared/constants/settings";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IconName, ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { StrictMode } from "react";
import { Root, createRoot } from "react-dom/client";
import { PLUGIN_APP_ID } from "../../shared/constants";
import RelatedNotes from "./RelatedNotes";

export const VIEW_TYPE_RELATED_NOTES = `${PLUGIN_APP_ID}-related-notes-view`;

export class RelatedNotesView extends ItemView {
	root: Root | null = null;
	private currentFile: TFile | null = null;
	private queryClient: QueryClient;

	constructor(
		leaf: WorkspaceLeaf,
		private settings: PluginSettings,
	) {
		super(leaf);
		this.queryClient = new QueryClient({
			defaultOptions: {
				queries: {
					retry: false,
					refetchOnWindowFocus: false,
				},
			},
		});
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

	private renderComponent() {
		this.root?.render(
			<StrictMode>
				<QueryClientProvider client={this.queryClient}>
					<AppContext.Provider value={this.app}>
						<SettingsContext.Provider value={this.settings}>
							<RelatedNotes
								key={this.currentFile?.path}
								currentFile={this.currentFile}
							/>
						</SettingsContext.Provider>
					</AppContext.Provider>
				</QueryClientProvider>
			</StrictMode>,
		);
	}

	async render(): Promise<void> {
		this.renderComponent();
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		this.root = createRoot(container);

		// Get initial file
		const currentFile = this.app.workspace.getActiveFile();
		if (currentFile && currentFile instanceof TFile) {
			this.currentFile = currentFile;
		}

		// Initial render
		this.renderComponent();

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
						this.renderComponent();
					}, 300); // 300ms debounce
				}
			}),
		);
	}

	async onClose() {
		this.root?.unmount();
	}
}
