import calculateTokenCount from "@/helpers/utils/calculateTokenCount";
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
			/* <div class="search-results-children" style="">
				<div style="width: 1px; height: 0.1px; margin-bottom: 0px;"></div>
				<div class="tree-item search-result" draggable="true">
					<div class="tree-item-self search-result-file-title is-clickable">
						<div class="tree-item-icon collapse-icon" style=""><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon right-triangle"><path d="M3 8L12 17L21 8"></path></svg></div><div class="tree-item-inner">무료 사용 가능한 LLM API 서비스</div><div class="tree-item-flair-outer"><span class="tree-item-flair">1</span></div></div><div class="search-result-file-matches" style=""><div style="width: 1px; height: 0.1px; margin-bottom: 0px;"></div><div class="search-result-file-match tappable"><span class="search-result-file-matched-text">[[21 FREE AI Coding Tools THAT I USE!]]</span><div class="search-result-hover-button mod-top" aria-label="앞뒤로 표시" data-tooltip-position="top" style="display: none;"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-chevron-up"><path d="m18 15-6-6-6 6"></path></svg></div><div class="search-result-hover-button mod-bottom" aria-label="앞뒤로 표시" style="display: none;"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-chevron-down"><path d="m6 9 6 6 6-6"></path></svg></div></div>
					</div>
				</div>
			</div> */
		} catch (error) {
			loadingEl.remove();
			this.contentEl.createEl("div", {
				text: `Error loading related notes: ${error.message}`,
				cls: "related-notes-error",
			});
		}
	}
}
