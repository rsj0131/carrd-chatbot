import jwt from "jsonwebtoken";
import cookie from "cookie";

export default async function handler(req, res) {
    const { code } = req.query;

    if (!code) {
        return res.status(400).json({ error: "Missing code parameter" });
    }

    // Parse the cookies
    const cookies = cookie.parse(req.headers.cookie || "");
    const codeVerifier = cookies.code_verifier;

    if (!codeVerifier) {
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
                code: code,
                redirect_uri: process.env.TWITTER_CALLBACK_URL,
                client_id: process.env.TWITTER_API_KEY,
                code_verifier: codeVerifier, // Include the code_verifier
            }),
        });

        const tokenData = await tokenResponse.json();
        if (!tokenResponse.ok) {
            console.error("Token exchange failed:", tokenData);
            return res.status(400).json({ error: "Token exchange failed" });
        }

        const { access_token } = tokenData;

        // Fetch user details using the access token
        const userResponse = await fetch("https://api.twitter.com/2/users/me", {
            headers: {
                Authorization: `Bearer ${access_token}`,
            },
        });

        const userData = await userResponse.json();
        if (!userResponse.ok) {
            console.error("Fetching user data failed:", userData);
            return res.status(400).json({ error: "Fetching user data failed" });
        }

        const { id, username } = userData;

        // Generate a JWT token for the session
        const token = jwt.sign(
            { id, username },
            process.env.JWT_SECRET,
            { expiresIn: "1h" } // Session expires in 1 hour
        );

        // Set the session token in a secure HTTP-only cookie
        res.setHeader("Set-Cookie", `session=${token}; HttpOnly; Path=/; Max-Age=3600; Secure; SameSite=Strict`);

        // Redirect the user back to the Carrd page with the login status and username
        res.redirect(`https://doublevchan.carrd.co/?logged_in=true&username=${encodeURIComponent(username)}`);
    } catch (error) {
        console.error("OAuth Callback Error:", error);
        res.status(500).json({ error: "Authentication failed" });
    }
}
