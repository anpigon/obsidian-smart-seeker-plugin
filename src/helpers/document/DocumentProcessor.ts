import SmartSeekerPlugin from "@/main";
import { NoteMetadata } from "@/types";
import { Document } from "@langchain/core/documents";
import {
	MarkdownTextSplitter,
	type TextSplitter,
} from "@langchain/textsplitters";
import type { Index, RecordMetadata } from "@pinecone-database/pinecone";
import { FrontMatterCache, TFile } from "obsidian";
import {
	DEFAULT_CHUNK_OVERLAP,
	DEFAULT_CHUNK_SIZE,
	ZERO_VECTOR,
} from "src/constants";
import { createPineconeClient } from "src/services/PineconeManager";
import type { PluginSettings } from "src/settings/settings";
import { PineconeStore } from "../langchain/vectorstores";
import { Logger } from "../logger";
import { getFileNameSafe } from "../utils/fileUtils";
import getEmbeddingModel from "../utils/getEmbeddingModel";
import { createContentHash, createHash } from "../utils/hash";

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
	private settings: PluginSettings;
	private textSplitter: TextSplitter;
	private pineconeIndex: Index<RecordMetadata>;

	constructor(
		private plugin: SmartSeekerPlugin,
		private maxConcurrency = 5,
	) {
		this.settings = this.plugin.settings;
		this.logger = this.initializeLogger(plugin.settings);
		this.pineconeIndex = this.initializePineconeIndex(plugin.settings);
		this.textSplitter = this.initializeTextSplitter();
	}

	private initializeLogger(settings: PluginSettings): Logger {
		return new Logger(
			"SmartSeekerPlugin::DocumentProcessor",
			settings.logLevel,
		);
	}

	private initializeTextSplitter(): TextSplitter {
		return new MarkdownTextSplitter({
			chunkSize: DEFAULT_CHUNK_SIZE,
			chunkOverlap: DEFAULT_CHUNK_OVERLAP,
			keepSeparator: true,
		});
	}

	private initializePineconeIndex(
		settings: PluginSettings,
	): Index<RecordMetadata> {
		const pinecone = createPineconeClient(settings.pineconeApiKey);
		return pinecone.Index(settings.selectedIndex);
	}

	// 기존 파인콘DB에 있는 문서는 필터링한다.
	async filterDocuments(documents: Document[]): Promise<Document[]> {
		if (!documents?.length) return [];

		try {
			const documentIds = this.generateDocumentIds(documents);
			const existingHashes = await this.fetchExistingHashes(documentIds);

			return documents.filter((doc) => !existingHashes.has(doc.metadata.hash));
		} catch (error) {
			this.logger.error("Error filtering documents:", error);
		}

		return [];
	}

	private async fetchExistingHashes(
		documentIds: string[],
	): Promise<Set<string>> {
		const { records } = await this.pineconeIndex.fetch(documentIds);
		return new Set(
			Object.values(records).map(
				(record) => (record.metadata as { hash: string }).hash,
			),
		);
	}

	private generateDocumentIds(documents: Document[]): string[] {
		return documents.map((doc) => `${doc.metadata.id}-0`);
	}

	async processSingleDocument(document: Document) {
		const { ids, chunks } = await this.createChunks([document]);
		this.logger.debug("chunks", chunks);
		return await this.saveToVectorStore(chunks, ids);
	}

	async processSingleFile(file: TFile) {
		const document = await this.createDocument(file);
		const { ids, chunks } = await this.createChunks([document]);
		return await this.saveToVectorStore(chunks, ids);
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
			console.log("chunks", chunks);
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

	async processMultiFiles(files: TFile[]) {
		const documents = []
		for (const file of files) {
			const document = await this.createDocument(file);
			documents.push(document);
		}
		const { ids, chunks } = await this.createChunks(documents);
		await this.saveToVectorStore(chunks, ids);
	}

	private async createChunks(documents: Document[]): Promise<DocumentChunk> {
		const result: DocumentChunk = { ids: [], chunks: [] };

		for (const document of documents) {
			const splitDocuments = await this.textSplitter.splitDocuments(
				[document],
				{ appendChunkOverlapHeader: true },
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
		ids: string[],
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
					error,
				);
				return null;
			}
		});
		const results = await Promise.all(filterPromises);
		return results.filter((doc): doc is Document => doc !== null);
	}

	private async createDocument(file: TFile) {
		const content = await this.plugin.app.vault.read(file);
		const hash = await createContentHash(content);
		const id = await createHash(file.path);
		let pageContent = content;

		let frontmatter: FrontMatterCache | null = null;
		await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
			frontmatter = fm;
			pageContent = pageContent
				.substring(pageContent.indexOf("---", 3) + 3)
				.trim();
		});
		console.log("--→ frontmatter", frontmatter);

		const metadata: NoteMetadata = {
			...(frontmatter as unknown as NoteMetadata),
			id,
			hash,
			filePath: file.path,
			ctime: file.stat.ctime,
			mtime: file.stat.mtime,
			title: getFileNameSafe(file.path),
		};
		console.log("--→ metadata", frontmatter);

		const document = new Document({ pageContent, metadata });

		console.log("--→ document", document);
		return document;
	}
}
