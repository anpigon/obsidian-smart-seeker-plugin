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
	return fullFileName.split(".")[0];
};
