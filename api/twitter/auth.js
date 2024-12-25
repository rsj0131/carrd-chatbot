import { randomBytes } from "crypto";
import cookie from "cookie";

export default async function handler(req, res) {
    try {
        const state = randomBytes(16).toString("hex");
        const codeVerifier = randomBytes(32).toString("hex");

        const codeChallenge = crypto
            .createHash("sha256")
            .update(codeVerifier)
            .digest("base64url");
        console.log("Generated code_verifier:", codeVerifier);
        console.log("Generated code_challenge:", codeChallenge);

        res.setHeader(
            "Set-Cookie",
            cookie.serialize("code_verifier", codeVerifier, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production", // Use HTTPS in production
                path: "/",
                maxAge: 300, // 5 minutes
                sameSite: "Lax", // Change to "Lax" to allow the redirect flow
            })
        );    

        console.log("Set-Cookie header sent with code_verifier:", codeVerifier); // Debug log

        // Delay the redirect for 5 seconds to inspect logs
        const redirectUrl = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${process.env.TWITTER_API_KEY}&redirect_uri=${process.env.TWITTER_CALLBACK_URL}&scope=tweet.read%20users.read&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
    } catch (error) {
        console.error("Twitter Auth Initiation Error:", error);
        res.status(500).json({ error: "Failed to initiate Twitter authentication" });
    }
}

