import { RecordMetadata } from "@pinecone-database/pinecone";

export interface NoteMetadata extends RecordMetadata {
	filePath: string;
	ctime: number;
	mtime: number;
	title: string;
}
