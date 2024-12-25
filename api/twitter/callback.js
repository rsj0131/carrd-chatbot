import jwt from "jsonwebtoken";
import cookie from "cookie";

export default async function handler(req, res) {
    const { code } = req.query;

    if (!code) {
        console.error("Missing code parameter");
        return res.status(400).json({ error: "Missing code parameter" });
    }

    const cookies = cookie.parse(req.headers.cookie || "");
    const codeVerifier = cookies.code_verifier;

    if (!codeVerifier) {
        console.error("Missing code_verifier");
        return res.status(400).json({ error: "Missing code_verifier" });
    }

    try {
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
                code: code,
                redirect_uri: process.env.TWITTER_CALLBACK_URL,
                client_id: process.env.TWITTER_API_KEY,
                code_verifier: codeVerifier,
            }),
        });

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
            console.error("Token exchange failed:", tokenData);
            return res.status(400).json({ error: "Token exchange failed" });
        }

        const { access_token, scope } = tokenData;

        if (!scope.includes("tweet.read") || !scope.includes("users.read")) {
            console.error("Insufficient scope permissions");
            return res.status(403).json({ error: "Insufficient scope permissions" });
        }

        const userResponse = await fetch("https://api.twitter.com/2/users/me", {
            headers: {
                Authorization: `Bearer ${access_token}`,
            },
        });

        const userData = await userResponse.json();

        if (!userResponse.ok || !userData.data) {
            console.error("Fetching user data failed:", userData);
            return res.status(400).json({ error: "Fetching user data failed" });
        }

        const { id, username, name } = userData.data;

        const token = jwt.sign(
            { id, username, name },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        res.setHeader(
            "Set-Cookie",
            `session=${token}; HttpOnly; Path=/; Max-Age=3600; Secure; SameSite=Lax`
        );

        // Send a script to post a message to the parent window
        res.send(`
            <script>
                window.opener.postMessage({ logged_in: true, username: "${username}" }, "*");
                window.close();
            </script>
        `);
    } catch (error) {
        console.error("OAuth Callback Error:", error);
        res.status(500).json({ error: "Authentication failed" });
    }
}
