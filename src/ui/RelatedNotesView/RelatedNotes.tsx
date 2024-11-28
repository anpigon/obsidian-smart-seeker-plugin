import { useApp, useSettings } from "@/helpers/hooks";

import { Logger } from "@/helpers/logger";
import getEmbeddingModel from "@/helpers/utils/getEmbeddingModel";
import truncateContent from "@/helpers/utils/truncateContent";
import { createPineconeClient } from "@/services/PineconeManager";
import { useQuery } from "@tanstack/react-query";
import { Notice, TFile } from "obsidian";
import { useEffect, useMemo } from "react";
import { openAndHighlightText } from "../../utils/editor-helpers";
import SearchResultItem from "./components/SearchResultItem";

interface RelatedNotesProps {
	currentFile: TFile | null;
}

const RelatedNotes = ({ currentFile }: RelatedNotesProps) => {
	const app = useApp();
	const settings = useSettings();
	const logger = useMemo(
		() => new Logger("RelatedNotes", settings?.logLevel),
		[settings?.logLevel],
	);

	const queryByFileContent = async (query: string, excludeFilePath: string) => {
		if (!settings?.pineconeApiKey || !settings?.pineconeIndexName) {
			throw new Error("Pinecone API key or index name is not set");
		}

		const pc = createPineconeClient(settings.pineconeApiKey);
		const index = pc.Index(settings.pineconeIndexName);
		const embeddings = await getEmbeddingModel(settings);
		const vector = await embeddings.embedQuery(query);
		const queryResponse = await index.query({
			vector,
			topK: 100,
			includeMetadata: true,
			filter: {
				filePath: { $ne: excludeFilePath },
			},
		});
		return queryResponse.matches;
	};

	const {
		data: matches = [],
		isLoading,
		error,
		refetch,
	} = useQuery({
		queryKey: ["related-notes", currentFile?.path],
		queryFn: async () => {
			if (!currentFile) return [];
			const content = await app?.vault.cachedRead(currentFile);
			logger.debug("--→ content", content?.length, content);
			if (!content || content.length < 50) return [];
			const truncatedContent = truncateContent(content, 8192);
			return queryByFileContent(truncatedContent || "", currentFile.path);
		},
		enabled:
			!!currentFile &&
			!!settings?.pineconeApiKey &&
			!!settings?.pineconeIndexName,
	});

	const handleTitleClick = async (filePath: string) => {
		if (!filePath) {
			new Notice("File path not found");
			return;
		}

		try {
			const targetFile = app?.vault.getAbstractFileByPath(filePath);
			if (!(targetFile instanceof TFile)) {
				new Notice(`File not found: ${filePath}`);
				return;
			}

			await app?.workspace.getLeaf().openFile(targetFile);
		} catch (error) {
			console.error("Error opening file:", error);
			new Notice("Failed to open file");
		}
	};

	const handleMatchClick = async (
		filePath: string,
		text: string,
		fromLine: number,
		toLine: number,
	) => {
		if (!app) return;

		try {
			await openAndHighlightText(app, filePath, text, {
				from: fromLine,
				to: toLine,
			});
		} catch (error) {
			console.error("Error opening file:", error);
			new Notice(error.message);
		}
	};

	useEffect(() => {
		if (error) {
			console.error("Error fetching related notes:", error);
			new Notice(
				"Error fetching related notes. Please check the console for details.",
			);
		}
	}, [error]);

	if (!settings?.pineconeApiKey || !settings?.pineconeIndexName) {
		return (
			<div className="tree-item-self">
				<div className="tree-item-inner related-notes-loading">
					Please add your Pinecone API key and index name in the settings.
				</div>
			</div>
		);
	}

	return (
		<div className="backlink-pane related-note-pane node-insert-event">
			<div
				className="tree-item-self is-clickable"
				aria-label="접으려면 클릭"
				data-tooltip-position="left"
			>
				<div className="tree-item-inner">Related Notes</div>
				<div className="tree-item-flair-outer">
					<div className="tree-item-flair">
						<div
							className="clickable-icon"
							aria-label="Refresh"
							onClick={() => refetch()}
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38" />
							</svg>
						</div>
					</div>
				</div>
			</div>

			{isLoading && (
				<div className="tree-item-self">
					<div className="tree-item-inner related-notes-loading">
						Loading...
					</div>
				</div>
			)}

			<div className="search-result-container">
				<div className="search-results-children">
					{matches.map((match) => {
						const title = String(match.metadata?.title || "Untitled");
						const subtext = String(match.metadata?.text || "")?.replace(
							/^(?:\(cont'd\)\s*)?/,
							"",
						);
						const score =
							match.score !== undefined ? match.score.toFixed(2) : "0.00";
						const filePath = match.metadata?.filePath?.toString();
						const from = Number(match.metadata?.["loc.lines.from"]);
						const to = Number(match.metadata?.["loc.lines.to"]);
						// console.log("match", match);
						return (
							<SearchResultItem
								key={match.id}
								id={match.id}
								filePath={filePath}
								title={title}
								text={subtext}
								score={score}
								from={from}
								to={to}
								onTitleClick={handleTitleClick}
								onMatchClick={handleMatchClick}
							/>
						);
					})}
				</div>
				{matches.length === 0 && (
					<div className="search-empty-state">
						관련된 노트를 찾을 수 없습니다.
					</div>
				)}
			</div>
		</div>
	);
};

export default RelatedNotes;
