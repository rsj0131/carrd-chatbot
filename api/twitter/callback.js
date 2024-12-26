import jwt from "jsonwebtoken";
import cookie from "cookie";

export default async function handler(req, res) {
    const { code } = req.query;

    if (!code) {
        console.error("Missing code parameter");
        return res.status(400).json({ error: "Missing code parameter" });
    }

    // Parse the cookies to retrieve the code_verifier
    const cookies = cookie.parse(req.headers.cookie || "");
    const codeVerifier = cookies.code_verifier;

    if (!codeVerifier) {
        console.error("Missing code_verifier in cookies");
        return res.status(400).json({ error: "Missing code_verifier" });
    }

    try {
        // Exchange the authorization code for access tokens
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
                code_verifier: codeVerifier, // Use the code_verifier from cookies
            }),
        });

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
            console.error("Token exchange failed:", tokenData);
            return res.status(400).json({ error: "Token exchange failed", details: tokenData });
        }

        const { access_token } = tokenData;

        // Fetch user details from Twitter
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

        // Generate session and refresh tokens
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

        // Set session and refresh tokens in cookies
        res.setHeader("Set-Cookie", [
            cookie.serialize("session", sessionToken, {
                httpOnly: true,
                secure: true,
                path: "/",
                maxAge: 7200, // 2 hours
                sameSite: "None",
            }),
            cookie.serialize("refresh_token", refreshToken, {
                httpOnly: true,
                secure: true,
                path: "/",
                maxAge: 604800, // 7 days
                sameSite: "None",
            }),
        ]);

        // Redirect back to the site
        res.redirect(`/site.html`);
    } catch (error) {
        console.error("OAuth Callback Error:", error.message, error.stack);
        res.status(500).json({ error: "Authentication failed" });
    }
}
