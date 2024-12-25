import { randomBytes } from "crypto";
import cookie from "cookie";

export default async function handler(req, res) {
    try {
        const state = randomBytes(16).toString("hex");
        const codeVerifier = randomBytes(32).toString("hex");

        const codeChallenge = Buffer.from(
            codeVerifier
        ).toString("base64url");

        res.setHeader(
            "Set-Cookie",
            cookie.serialize("code_verifier", codeVerifier, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                path: "/",
                maxAge: 300, // 5 minutes
                sameSite: "Strict", // Adjust if cross-origin issues persist
            })
        );

        const redirectUrl = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${process.env.TWITTER_API_KEY}&redirect_uri=${process.env.TWITTER_CALLBACK_URL}&scope=tweet.read%20users.read&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

        res.redirect(redirectUrl);
    } catch (error) {
        console.error("Twitter Auth Initiation Error:", error);
        res.status(500).json({ error: "Failed to initiate Twitter authentication" });
    }
}
