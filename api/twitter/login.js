import crypto from "crypto";
import { URLSearchParams } from "url";

function generateCodeVerifier() {
    return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier) {
    return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export default async function handler(req, res) {
    const carrdPage = req.headers.referer || "https://doublevchan.carrd.co/"; // Default Carrd page

    const params = new URLSearchParams({
        response_type: "code",
        client_id: process.env.TWITTER_API_KEY, // OAuth 2.0 Client ID
        redirect_uri: process.env.TWITTER_CALLBACK_URL,
        scope: "tweet.read users.read offline.access",
        state: encodeURIComponent(carrdPage), // Save Carrd page URL
        code_challenge: "challenge", // Replace with a real PKCE challenge
        code_challenge_method: "plain",
    });

    res.redirect(`https://twitter.com/i/oauth2/authorize?${params.toString()}`);
}

