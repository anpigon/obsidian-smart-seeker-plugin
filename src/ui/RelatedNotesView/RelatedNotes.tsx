/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { useApp, useSettings } from "@/helpers/hooks";

import { ZERO_VECTOR } from "@/constants";
import { NotFoundError } from "@/errors/NotFoundError";
import { Logger } from "@/helpers/logger";
import {
	openNote,
	openNoteAndHighlightText,
} from "@/helpers/utils/editorHelpers";
import getEmbeddingModel from "@/helpers/utils/getEmbeddingModel";
import truncateContent from "@/helpers/utils/truncateContent";
import { createPineconeClient } from "@/services/PineconeManager";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Notice, TFile } from "obsidian";
import { useEffect, useMemo, useRef } from "react";
import SearchResultItem from "./components/SearchResultItem";

interface RelatedNotesProps {
	currentFile: TFile | null;
}

const RelatedNotes = ({ currentFile }: RelatedNotesProps) => {
	const app = useApp()!;
	const settings = useSettings();
	const logger = useMemo(
		() => new Logger("RelatedNotes", settings?.logLevel),
		[settings?.logLevel],
	);

	const queryClient = useQueryClient();

	const deleteConfirmDialogRef = useRef<HTMLDialogElement>(null);
	const deleteTargetIdRef = useRef<string | null>(null);

	const showConfirmDialog = (id: string) => {
		deleteTargetIdRef.current = id;
		deleteConfirmDialogRef.current?.showModal();
	};

	const closeConfirmDialog = () => {
		deleteConfirmDialogRef.current?.close();
		deleteTargetIdRef.current = null;
	};

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
		isSuccess,
		error,
		refetch,
	} = useQuery({
		queryKey: ["related-notes", currentFile?.path],
		queryFn: async () => {
			if (!currentFile) return [];
			const content = await app?.vault.cachedRead(currentFile);
			// logger.debug("--→ content", content?.length, content);
			if (!content || content.length < 50) return [];
			const truncatedContent = truncateContent(content, 8192);
			return queryByFileContent(truncatedContent || "", currentFile.path);
		},
		enabled:
			!!currentFile &&
			!!settings?.pineconeApiKey &&
			!!settings?.pineconeIndexName,
	});

	const handlePineconeDelete = async () => {
		const deleteTargetId = deleteTargetIdRef.current;
		if (!deleteTargetId) return;

		try {
			if (!settings?.pineconeApiKey || !settings?.pineconeIndexName) {
				throw new Error("Pinecone API key or index name is not set");
			}

			const find = matches.find((item) => item.id === deleteTargetId);
			const parentId = find?.metadata?.id?.toString();

			const pc = createPineconeClient(settings?.pineconeApiKey);
			const index = pc.Index(settings?.pineconeIndexName);
			const results = await index.query({
				vector: ZERO_VECTOR,
				topK: 100,
				includeMetadata: true,
				includeValues: false,
				filter: { id: parentId },
			});
			const ids = (results?.matches || [])
				.filter((item) => item?.metadata?.id === parentId)
				.map((item) => item.id);
			await index.deleteMany(ids);

			new Notice(
				`Successfully removed "${find?.metadata?.title}" from Pinecone.`,
			);
			queryClient.invalidateQueries({
				queryKey: ["related-notes"],
			});
		} catch (e) {
			console.error("Error deleting from Pinecone:", e);
			new Notice("Failed to delete from Pinecone.");
		}
		closeConfirmDialog();
	};

	const validateAndGetFile = async (
		id: string,
	): Promise<{ file: TFile; match: any }> => {
		const match = matches.find((item) => item.id === id);
		if (!match) {
			throw new NotFoundError(`Match not found: ${id}`);
		}

		const filePath = match?.metadata?.filePath?.toString();
		if (!filePath) {
			throw new NotFoundError(`File not found: ${filePath}`);
		}

		const file = app?.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			throw new NotFoundError(`File not found: ${filePath}`);
		}

		return { file, match };
	};

	const handleTitleClick = async (id: string) => {
		try {
			const { file, match } = await validateAndGetFile(id);
			logger.debug("--→ handleTitleClick", match);

			await openNote(app, file.path);
		} catch (error) {
			if (error instanceof NotFoundError) {
				showConfirmDialog(id);
			} else {
				console.error("Error opening file:", error);
				new Notice("Failed to open file");
			}
		}
	};

	const handleMatchClick = async (id: string) => {
		try {
			const { file, match } = await validateAndGetFile(id);
			logger.debug("--→ handleMatchClick", match);

			const text = String(match?.metadata?.text || "");
			const from = Number(match?.metadata?.["loc.lines.from"]);
			const to = Number(match?.metadata?.["loc.lines.to"]);

			await openNoteAndHighlightText(app, file.path, text, { from, to });
		} catch (error) {
			if (error instanceof NotFoundError) {
				showConfirmDialog(id);
			} else {
				console.error("Error opening file:", error);
				new Notice("Failed to open file");
			}
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
		<>
			<div className="backlink-pane related-note-pane node-insert-event">
				<div
					className="tree-item-self is-clickable"
					aria-label="접으려면 클릭"
					data-tooltip-position="left"
				>
					<div className="tree-item-inner">Related Note Chunks</div>
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
						{isSuccess &&
							matches.map((match) => {
								const title = String(match.metadata?.title || "Untitled");
								const subtext = String(match.metadata?.text || "")?.replace(
									/^(?:\(cont'd\)\s*)?/,
									"",
								);
								const score =
									match.score !== undefined ? match.score.toFixed(2) : "0.00";
								return (
									<SearchResultItem
										key={match.id}
										id={match.id}
										title={title}
										text={subtext}
										score={score}
										onTitleClick={handleTitleClick}
										onMatchClick={handleMatchClick}
									/>
								);
							})}
					</div>
					{!isLoading && matches.length === 0 && (
						<div className="search-empty-state">
							관련된 노트를 찾을 수 없습니다.
						</div>
					)}
				</div>
			</div>

			<dialog ref={deleteConfirmDialogRef} className="modal">
				<div className="modal-content">
					<h2>Remove from Pinecone?</h2>
					<p>The file was not found. Do you want to remove it from Pinecone?</p>
					<div className="modal-button-container">
						<button className="mod-cta" onClick={handlePineconeDelete}>
							Yes
						</button>
						<button onClick={closeConfirmDialog}>No</button>
					</div>
				</div>
			</dialog>
		</>
	);
};

export default RelatedNotes;
