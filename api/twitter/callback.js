import jwt from "jsonwebtoken";

export default async function handler(req, res) {
    const { code, codeVerifier } = req.query; // Accept `codeVerifier` from the request query

    if (!code || !codeVerifier) {
        console.error("Missing code or codeVerifier parameter");
        return res.status(400).json({ error: "Missing code or codeVerifier parameter" });
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
                code,
                redirect_uri: process.env.TWITTER_CALLBACK_URL,
                client_id: process.env.TWITTER_API_KEY,
                code_verifier: codeVerifier, // Pass codeVerifier from request
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
            headers: { Authorization: `Bearer ${access_token}` },
        });

        const userData = await userResponse.json();

        if (!userResponse.ok || !userData.data) {
            console.error("Fetching user data failed:", userData);
            return res.status(400).json({ error: "Fetching user data failed" });
        }

        const { id, username, name } = userData.data;

        const sessionToken = jwt.sign(
            { id, username, name },
            process.env.JWT_SECRET,
            { expiresIn: "2h" }
        );

        const refreshToken = jwt.sign(
            { id, username },
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: "7d" }
        );

        res.setHeader("Set-Cookie", [
            `session=${sessionToken}; HttpOnly; Path=/; Max-Age=7200; Secure; SameSite=None`,
            `refresh_token=${refreshToken}; HttpOnly; Path=/; Max-Age=604800; Secure; SameSite=None`,
        ]);

        // Use postMessage to send authentication status to the parent window
        res.send(`
            <script>
                window.opener.postMessage({ logged_in: true, username: "${username}", name: "${name}" }, "*");
                window.close();
            </script>
        `);
    } catch (error) {
        console.error("OAuth Callback Error:", error);
        res.status(500).json({ error: "Authentication failed" });
    }
}
