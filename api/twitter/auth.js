// api/twitter/auth.js
import { randomBytes } from "crypto";
import cookie from "cookie";
import crypto from "crypto";

export default async function handler(req, res) {
    try {
        const state = randomBytes(16).toString("hex");
        const codeVerifier = randomBytes(32).toString("hex");

        // Generate code_challenge
        const codeChallenge = crypto
            .createHash("sha256")
            .update(codeVerifier)
            .digest("base64url");

        // Store `code_verifier` in localStorage-friendly format
        res.json({
            redirectUrl: `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${process.env.TWITTER_API_KEY}&redirect_uri=${process.env.TWITTER_CALLBACK_URL}&scope=tweet.read%20users.read&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
            codeVerifier: codeVerifier, // Return codeVerifier for localStorage
        });
    } catch (error) {
        console.error("Twitter Auth Initiation Error:", error);
        res.status(500).json({ error: "Failed to initiate Twitter authentication" });
    }
}
