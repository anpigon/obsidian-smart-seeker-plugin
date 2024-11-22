import { useApp, useSettings } from "@/helpers/hooks";
import {
	RecordMetadata,
	ScoredPineconeRecord,
} from "@pinecone-database/pinecone";

import getEmbeddingModel from "@/helpers/utils/getEmbeddingModel";
import { createPineconeClient } from "@/services/PineconeManager";
import { MarkdownView, Notice, TFile } from "obsidian";
import { useEffect, useState } from "react";
import SearchResultItem from "./components/SearchResultItem";

interface RelatedNotesProps {
	currentFile: TFile | null;
}

const RelatedNotes = ({ currentFile }: RelatedNotesProps) => {
	const app = useApp();
	const settings = useSettings();

	const [isLoading, setIsLoading] = useState(false);
	const [matches, setMatches] = useState<
		ScoredPineconeRecord<RecordMetadata>[]
	>([]);

	const queryByFileContent = async (
		query: string,
		excludeFilePath: string,
	): Promise<ScoredPineconeRecord<RecordMetadata>[] | null> => {
		if (!settings?.pineconeApiKey || !settings?.pineconeIndexName) {
			return null;
		}

		try {
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
		} catch (error) {
			console.error("Error filtering documents:", error);
		}

		return null;
	};

	const updateRelatedNotes = async () => {
		if (currentFile) {
			setMatches([]);
			setIsLoading(true);
			const truncatedContent = await app?.vault.cachedRead(currentFile);
			const matches = await queryByFileContent(
				truncatedContent || "",
				currentFile.path,
			);
			setMatches(matches || []);
			setIsLoading(false);
		}
	};

	const handleTitleClick = async (filePath: string) => {
		console.log(filePath);
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

			const leaf = app?.workspace.getLeaf();
			if (!leaf) return;

			await leaf.openFile(targetFile);

			const view = leaf.view;
			if (view.getViewType() !== "markdown") return;

			const editor = (view as MarkdownView).editor;
			if (!editor) return;

			const searchText = text
				?.toString()
				.replace(/^(?:\(cont'd\)\s*)?/, "") // Remove (cont'd) prefix if exists
				.split("\n")[0]
				.trim();

			const fileContent = editor.getValue();
			const lines = fileContent.split("\n");

			// DB에 저장된 라인 수와 실제 텍스트의 라인 수가 달라질 수 있으므로,
			// 실제 텍스트가 있는 라인을 찾습니다.
			const foundLine =
				lines.slice(fromLine).findIndex((line) => line.includes(searchText)) +
				fromLine;

			if (foundLine > -1) {
				const offset = foundLine - fromLine;
				const from = { line: foundLine, ch: 0 };
				const to = { line: toLine + offset, ch: lines[toLine + offset].length };

				// 해당 위치로 스크롤하고 텍스트를 선택
				editor.setCursor(from);
				editor.setSelection(from, to);
				editor.scrollIntoView({ from, to: from }, true);
			}

			editor.focus();
		} catch (error) {
			console.error("Error opening file:", error);
			new Notice("Failed to open file");
		}
	};

	useEffect(() => {
		if (currentFile) {
			updateRelatedNotes();
		}
	}, [currentFile]);

	return (
		<>
			<div className="tree-item-self">Related Notes</div>

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
			</div>
		</>
	);
};

export default RelatedNotes;
