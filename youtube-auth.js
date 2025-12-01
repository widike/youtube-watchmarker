/**
 * YouTube authentication utilities
 * Handles YouTube cookie authentication and SAPISIDHASH generation
 */

/**
 * Gets YouTube cookies for authentication
 * @returns {Promise<Object>} Object containing cookie values
 */
export async function getYouTubeCookies() {
    const cookieNames = ["SAPISID", "__Secure-3PAPISID"];
    const cookies = {};

    for (const cookieName of cookieNames) {
        const cookie = await chrome.cookies.get({
            url: "https://www.youtube.com",
            name: cookieName,
        });
        cookies[cookieName] = cookie ? cookie.value : null;
    }

    return cookies;
}

/**
 * Creates YouTube authentication header (SAPISIDHASH)
 * @param {Object} cookies - Cookie object from getYouTubeCookies
 * @returns {Promise<string>} SAPISIDHASH authentication string
 */
export async function createYouTubeAuthHeader(cookies) {
    const time = Math.round(Date.now() / 1000);
    const cookie = cookies["SAPISID"] || cookies["__Secure-3PAPISID"];
    const origin = "https://www.youtube.com";

    const hash = await crypto.subtle.digest(
        "SHA-1",
        new TextEncoder().encode(`${time} ${cookie} ${origin}`)
    );

    const hashArray = Array.from(new Uint8Array(hash));
    const hashHex = hashArray
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

    return `SAPISIDHASH ${time}_${hashHex}`;
}

