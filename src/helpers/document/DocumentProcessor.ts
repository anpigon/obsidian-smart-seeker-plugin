import { Document } from "@langchain/core/documents";
import { PineconeStore } from "@langchain/pinecone";
import {
	RecursiveCharacterTextSplitter,
	TextSplitter,
} from "@langchain/textsplitters";
import { Index, RecordMetadata } from "@pinecone-database/pinecone";
import { DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_SIZE, ZERO_VECTOR } from "src/constants";
import { createPineconeClient } from "src/services/PineconeManager";
import { PluginSettings } from "src/settings/settings";
import { Logger } from "../logger";
import getEmbeddingModel from "../utils/getEmbeddingModel";
import { createHash } from "../utils/hash";

interface ProcessingResult {
	totalDocuments: number; // 입력된 전체 문서 수
	processedDocuments: number; // 처리된 문서 수
	skippedDocuments: number; // 건너뛴 문서 수
	processedChunks: number; // 처리된 청크 수
}

interface DocumentChunk {
	ids: string[];
	chunks: Document[];
}

export default class DocumentProcessor {
	private logger: Logger;
	private textSplitter: TextSplitter;
	private pineconeIndex: Index<RecordMetadata>;

	constructor(private settings: PluginSettings, private maxConcurrency = 5) {
		this.logger = this.initializeLogger(settings);
		this.textSplitter = this.initializeTextSplitter();
		this.pineconeIndex = this.initializePineconeIndex(settings);
	}

	private initializeLogger(settings: PluginSettings): Logger {
		return new Logger(
			"SmartSeekerPlugin::DocumentProcessor",
			settings.logLevel
		);
	}

	private initializeTextSplitter(): TextSplitter {
		return new RecursiveCharacterTextSplitter({
			chunkSize: DEFAULT_CHUNK_SIZE,
			chunkOverlap: DEFAULT_CHUNK_OVERLAP,
		});
	}

	private initializePineconeIndex(
		settings: PluginSettings
	): Index<RecordMetadata> {
		const pinecone = createPineconeClient(settings.pineconeApiKey);
		return pinecone.Index(settings.selectedIndex);
	}

	// 기존 파인콘DB에 있는 문서는 필터링한다.
	private async filterDocuments(documents: Document[]): Promise<Document[]> {
		if (!documents?.length) return [];

		try {
			const documentIds = this.generateDocumentIds(documents);
			const existingHashes = await this.fetchExistingHashes(documentIds);

			return documents.filter(
				(doc) => !existingHashes.has(doc.metadata.hash)
			);
		} catch (error) {
			this.logger.error("Error filtering documents:", error);
		}

		return [];
	}

	private async fetchExistingHashes(
		documentIds: string[]
	): Promise<Set<string>> {
		const { records } = await this.pineconeIndex.fetch(documentIds);
		return new Set(
			Object.values(records).map(
				(record) => (record.metadata as { hash: string }).hash
			)
		);
	}

	private generateDocumentIds(documents: Document[]): string[] {
		return documents.map((doc) => `${doc.metadata.id}-0`);
	}

	async processDocuments(documents: Document[]): Promise<ProcessingResult> {
		try {
			const totalDocuments = documents.length;
			const filteredDocs = await this.filterDocuments(documents);
			this.logger.debug("Filtered documents count:", filteredDocs.length);

			if (!filteredDocs.length) {
				return {
					totalDocuments: totalDocuments,
					processedDocuments: 0,
					skippedDocuments: totalDocuments,
					processedChunks: 0,
				};
			}

			const { ids, chunks } = await this.createChunks(filteredDocs);
			await this.saveToVectorStore(chunks, ids);

			return {
				totalDocuments: totalDocuments,
				processedDocuments: filteredDocs.length,
				skippedDocuments: totalDocuments - filteredDocs.length,
				processedChunks: chunks.length,
			};
		} catch (error) {
			this.logger.error("Error processing documents:", error);
			throw error;
		}
	}

	private async createChunks(documents: Document[]): Promise<DocumentChunk> {
		const result: DocumentChunk = { ids: [], chunks: [] };

		for (const document of documents) {
			const splitDocuments = await this.textSplitter.splitDocuments(
				[document],
				{ appendChunkOverlapHeader: true }
			);

			for (const [idx, splitDocument] of splitDocuments.entries()) {
				const hash = await createHash(splitDocument.metadata.filePath);
				result.ids.push(`${hash}-${idx}`);
				result.chunks.push(splitDocument);
			}
		}

		this.logger.debug(`Created chunks count: ${result.chunks.length}`);
		return result;
	}

	private async saveToVectorStore(
		chunks: Document[],
		ids: string[]
	): Promise<string[]> {
		const embedding = getEmbeddingModel(this.settings);
		const vectorStore = await PineconeStore.fromExistingIndex(embedding, {
			pineconeIndex: this.pineconeIndex,
			maxConcurrency: this.maxConcurrency,
		});
		return await vectorStore.addDocuments(chunks, { ids });
	}

	private async filterDocumentsByQuery(documents: Document[]) {
		const filterPromises = documents.map(async (doc) => {
			try {
				const queryResult = await this.pineconeIndex.query({
					vector: ZERO_VECTOR,
					topK: 100,
					includeMetadata: true,
					filter: {
						filePath: doc.metadata.filePath,
					},
				});

				// 매치가 없거나 해시가 다른 경우에만 포함
				const shouldInclude =
					!queryResult.matches?.length ||
					queryResult.matches[0].metadata?.hash !== doc.metadata.hash;

				return shouldInclude ? doc : null;
			} catch (error) {
				console.error(
					`Error querying document ${doc.metadata.filePath}:`,
					error
				);
				return null;
			}
		});
		const results = await Promise.all(filterPromises);
		return results.filter((doc): doc is Document => doc !== null);
	}
}
