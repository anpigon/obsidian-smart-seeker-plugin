/**
 * 파일 경로로부터 SHA-256 해시값을 생성합니다.
 * @param path 파일 경로
 * @returns SHA-256 해시값 (16진수 문자열)
 */
export async function createPathHash(path: string): Promise<string> {
    // 문자열을 UTF-8 인코딩된 바이트 배열로 변환
    const msgBuffer = new TextEncoder().encode(path);
    
    // SubtleCrypto를 사용하여 SHA-256 해시 생성
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    
    // ArrayBuffer를 16진수 문자열로 변환
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return hashHex;
}
