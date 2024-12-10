import { randomBytes, createHash } from "crypto";

export default async function handler(req, res) {
    // Generate a random code_verifier
    const codeVerifier = randomBytes(32).toString("hex");

    // Store the code_verifier in a secure HTTP-only cookie
    res.setHeader(
        "Set-Cookie",
        `code_verifier=${codeVerifier}; HttpOnly; Path=/; Max-Age=300; Secure; SameSite=Strict`
    );

    // Generate the corresponding code_challenge
    const codeChallenge = createHash("sha256")
        .update(codeVerifier)
        .digest("base64url"); // Use URL-safe Base64 encoding

    const params = new URLSearchParams({
        response_type: "code",
        client_id: process.env.TWITTER_API_KEY,
        redirect_uri: process.env.TWITTER_CALLBACK_URL,
        scope: "tweet.read users.read offline.access",
        state: "randomstring", // Add state validation for security
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
    });

    // Redirect to Twitter authorization endpoint
    res.redirect(`https://twitter.com/i/oauth2/authorize?${params.toString()}`);
}
