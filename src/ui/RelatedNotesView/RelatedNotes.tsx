import { useApp, useSettings } from "@/helpers/hooks";
import {
	RecordMetadata,
	ScoredPineconeRecord,
} from "@pinecone-database/pinecone";

import getEmbeddingModel from "@/helpers/utils/getEmbeddingModel";
import { createPineconeClient } from "@/services/PineconeManager";
import { TFile } from "obsidian";
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
						return (
							<SearchResultItem
								filePath={filePath}
								title={title}
								text={subtext}
								score={score}
							/>
						);
					})}
				</div>
			</div>
		</>
	);
};

export default RelatedNotes;
