import * as crypto from "crypto";

/**
 * 파일 경로로부터 SHA-256 해시값을 생성합니다.
 * @param path 파일 경로
 * @returns SHA-256 해시값 (16진수 문자열)
 */
export function createPathHash(path: string): string {
	return crypto.createHash("sha256").update(path).digest("hex");
}
