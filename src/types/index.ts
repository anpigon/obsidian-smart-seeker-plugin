import { FrontMatterCache } from "obsidian";

export interface NoteMetadata extends FrontMatterCache {
	id: string;
	filePath: string;
	ctime: number;
	mtime: number;
	title: string;
	hash: string;
}
