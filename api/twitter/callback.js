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
        console.error("Missing code_verifier in cookies");
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

        const refreshToken = jwt.sign(
            { id, username },
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: "7d" }
        );

        res.setHeader("Set-Cookie", [
            cookie.serialize("session", sessionToken, {
                httpOnly: true,
                secure: true,
                path: "/",
                maxAge: 7200,
                sameSite: "None",
            }),
            cookie.serialize("refresh_token", refreshToken, {
                httpOnly: true,
                secure: true,
                path: "/",
                maxAge: 604800,
                sameSite: "None",
            }),
        ]);

        // Send a message to the parent window and close the popup
        res.send(`
            <script>
                window.opener.postMessage({ logged_in: true, username: "${username}", name: "${name}" }, "*");
                window.close();
            </script>
        `);
    } catch (error) {
        console.error("OAuth Callback Error:", error.message, error.stack);
        res.status(500).json({ error: "Authentication failed" });
    }
}
