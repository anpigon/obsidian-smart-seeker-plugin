import getEmbeddingModel from "@/helpers/utils/getEmbeddingModel";
import { createPineconeClient } from "@/services/PineconeManager";
import { PluginSettings } from "@/settings/settings";
import { IconName, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { PLUGIN_APP_ID } from "../constants";

export const VIEW_TYPE_RELATED_NOTES = `${PLUGIN_APP_ID}-related-notes-view`;

export class RelatedNotesView extends ItemView {
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

	private renderTitle(): void {
		this.contentEl.empty();
		const headerEl = this.contentEl.createDiv({ cls: "tree-item-self" });
		headerEl.createDiv({ text: "Related Notes", cls: "tree-item-inner" });
	}

	async onOpen(): Promise<void> {
		this.renderTitle();

		// Register event for file open
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (file && file instanceof TFile) {
					this.currentFile = file;
					this.updateRelatedNotes();
				}
			}),
		);
	}

	async updateRelatedNotes(): Promise<void> {
		if (!this.currentFile) return;
		console.log("updateRelatedNotes", this.currentFile);

		this.renderTitle();

		const loadingEl = this.contentEl.createEl("div", {
			text: "Loading...",
			cls: "related-notes-loading",
		});

		try {
			// Get file content
			const content = await this.app.vault.cachedRead(this.currentFile);
			console.log("content", content);

			// Query Pinecone for related documents
			const pc = createPineconeClient(this.settings.pineconeApiKey);
			const index = pc.Index(this.settings.pineconeIndexName);
			const embeddings = await getEmbeddingModel(this.settings);
			const vector = await embeddings.embedQuery(content);
			const queryResponse = await index.query({
				vector,
				topK: 100,
				includeMetadata: true,
			});

			loadingEl.remove();

			// Create results container
			const resultsEl = this.contentEl.createEl("div", {
				cls: "search-result-container related-notes-list",
			});

			// Display results
			queryResponse.matches?.forEach((match) => {
				const noteEl = resultsEl.createEl("div", {
					cls: "tree-item-self is-clickable outgoing-link-item",
				});

				const itemEl = noteEl.createEl("div", { cls: "tree-item-inner" });

				const title = String(match.metadata?.title || "Untitled");
				const subtext = String(match.metadata?.text || "")?.replace(
					/^(?:\(cont'd\)\s*)?/,
					"",
				);
				const score =
					match.score !== undefined ? match.score.toFixed(2) : "0.00";

				itemEl.createEl("div", {
					text: `${score} | ${title}`,
					cls: "tree-item-inner-text",
				});

				itemEl.createEl("div", {
					text: subtext,
					cls: "tree-item-inner-subtext related-note-subtext",
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
