import { AppContext, SettingsContext } from "@/helpers/context";
import calculateTokenCount from "@/helpers/utils/calculateTokenCount";
import getEmbeddingModel from "@/helpers/utils/getEmbeddingModel";
import { createPineconeClient } from "@/services/PineconeManager";
import { PluginSettings } from "@/settings/settings";
import { IconName, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
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

	async updateRelatedNotes(): Promise<void> {
		if (!this.currentFile) return;
		console.log("updateRelatedNotes", this.currentFile);

		const loadingEl = this.contentEl.createDiv({ cls: "tree-item-self" });
		loadingEl.createDiv({
			text: "Loading...",
			cls: "tree-item-inner related-notes-loading",
		});

		try {
			// Get file content and limit to 4000 characters
			const content = await this.app.vault.cachedRead(this.currentFile);
			const truncatedContent = content.slice(0, 4000);
			console.log(
				"content length",
				content.length,
				"truncated length",
				truncatedContent.length,
				"calculateTokenCount",
				calculateTokenCount(truncatedContent),
			);

			// Query Pinecone for related documents
			const pc = createPineconeClient(this.settings.pineconeApiKey);
			const index = pc.Index(this.settings.pineconeIndexName);
			const embeddings = await getEmbeddingModel(this.settings);
			const vector = await embeddings.embedQuery(truncatedContent);
			const queryResponse = await index.query({
				vector,
				topK: 100,
				includeMetadata: true,
				filter: {
					filePath: { $ne: this.currentFile.path },
				},
			});

			loadingEl.remove();

			// Create results container
			const resultsEl = this.contentEl.createEl("div", {
				cls: "search-result-container",
			});

			// Display results
			queryResponse.matches?.forEach((match) => {
				const noteEl = resultsEl.createEl("div", {
					cls: "tree-item-self is-clickable outgoing-link-item",
				});

				const itemIconEl = noteEl.createEl("div", {
					cls: "tree-item-icon related-note-icon collapse-icon is-collapsed",
				});
				itemIconEl
					.createSvg("svg", {
						attr: {
							xmlns: "http://www.w3.org/2000/svg",
							width: "24",
							height: "24",
							viewBox: "0 0 24 24",
							fill: "none",
							stroke: "currentColor",
							"stroke-width": "2",
							"stroke-linecap": "round",
							"stroke-linejoin": "round",
							class: "svg-icon right-triangle",
						},
					})
					.createSvg("path", { attr: { d: "M3 8L12 17L21 8" } });

				const itemInnerEl = noteEl.createEl("div", { cls: "tree-item-inner" });

				const title = String(match.metadata?.title || "Untitled");
				const subtext = String(match.metadata?.text || "")?.replace(
					/^(?:\(cont'd\)\s*)?/,
					"",
				);
				const score =
					match.score !== undefined ? match.score.toFixed(2) : "0.00";

				itemInnerEl.createEl("div", {
					text: `${score} | ${title}`,
					cls: "tree-item-inner-text",
				});

				const subtextEl = itemInnerEl.createEl("div", {
					text: subtext,
					cls: "tree-item-inner-subtext related-note-subtext is-collapsed",
				});

				// Add click handler to itemIconEl to toggle subtext
				itemIconEl.addEventListener("click", (e) => {
					e.stopPropagation(); // Prevent triggering the noteEl click event
					subtextEl.toggleClass(
						"is-collapsed",
						!subtextEl.hasClass("is-collapsed"),
					);
					itemIconEl.toggleClass(
						"is-collapsed",
						!itemIconEl.hasClass("is-collapsed"),
					);
				});

				// Add click handler to open the note
				noteEl.addEventListener("click", async () => {
					try {
						const filePath = match.metadata?.filePath?.toString();
						if (!filePath) {
							new Notice("File path not found");
							return;
						}

						const targetFile = this.app.vault.getAbstractFileByPath(filePath);
						if (!(targetFile instanceof TFile)) {
							new Notice(`File not found: ${filePath}`);
							return;
						}

						await this.app.workspace.getLeaf().openFile(targetFile);
					} catch (error) {
						console.error("Error opening file:", error);
						new Notice("Failed to open file");
					}
				});
			});
		} catch (error) {
			loadingEl.remove();
			this.contentEl.createEl("div", {
				text: `Error loading related notes: ${error.message}`,
				cls: "related-notes-error",
			});
		}
	}
}
