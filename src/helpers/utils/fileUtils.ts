import { type TAbstractFile, TFile } from "obsidian";

export const getFileName = (filePath: string): string => {
	// 마지막 '/' 이후의 문자열 가져오기
	const fullFileName = filePath.split("/").pop() || "";
	// 확장자 제거
	return fullFileName.split(".")[0];
};

export const getFileNameSafe = (filePath: string): string => {
	// Windows의 '\' 경로도 처리
	const normalizedPath = filePath.replace(/\\/g, "/");
	const fullFileName = normalizedPath.split("/").pop() || "";
	const lastDotIndex = fullFileName.lastIndexOf(".");
	return lastDotIndex === -1
		? fullFileName
		: fullFileName.substring(0, lastDotIndex);
};

export const isMarkdownFile = (file: TAbstractFile): file is TFile => {
	return file instanceof TFile && file.extension === "md";
};
