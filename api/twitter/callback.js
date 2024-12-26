import jwt from "jsonwebtoken";

export default async function handler(req, res) {
    const { code } = req.query;

    if (!code) {
        console.error("Missing code parameter");
        return res.status(400).json({ error: "Missing code parameter" });
    }

    try {
        const codeVerifier = localStorage.getItem("code_verifier"); // Retrieve from localStorage
        if (!codeVerifier) {
            console.error("Missing code_verifier");
            return res.status(400).json({ error: "Missing code_verifier" });
        }

        const tokenResponse = await fetch("https://api.twitter.com/2/oauth2/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization: `Basic ${Buffer.from(
                    `${process.env.TWITTER_API_KEY}:${process.env.TWITTER_API_SECRET}`
                ).toString("base64")}`,
            },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code,
                redirect_uri: process.env.TWITTER_CALLBACK_URL,
                client_id: process.env.TWITTER_API_KEY,
                code_verifier: codeVerifier,
            }),
        });

        const tokenData = await tokenResponse.json();
        if (!tokenResponse.ok) {
            console.error("Token exchange failed:", tokenData);
            return res.status(400).json({ error: "Token exchange failed", details: tokenData });
        }

        const { access_token } = tokenData;

        const userResponse = await fetch("https://api.twitter.com/2/users/me", {
            headers: {
                Authorization: `Bearer ${access_token}`,
            },
        });

        const userData = await userResponse.json();
        if (!userResponse.ok || !userData.data) {
            console.error("User data fetch failed:", userData);
            return res.status(400).json({ error: "User data fetch failed", details: userData });
        }

        const { id, username, name } = userData.data;

        const sessionToken = jwt.sign(
            { id, username, name },
            process.env.JWT_SECRET,
            { expiresIn: "2h" }
        );

        res.setHeader("Set-Cookie", `session=${sessionToken}; HttpOnly; Path=/; Max-Age=7200; Secure; SameSite=None`);

        res.redirect(`/site.html`);
    } catch (error) {
        console.error("OAuth Callback Error:", error.message, error.stack);
        res.status(500).json({ error: "Authentication failed" });
    }
}
