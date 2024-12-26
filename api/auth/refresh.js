import jwt from "jsonwebtoken";
import cookie from "cookie";

export default async function handler(req, res) {
    try {
        const cookies = cookie.parse(req.headers.cookie || "");
        const refreshToken = cookies.refresh_token;

        if (!refreshToken) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

        // Issue a new session token
        const newSessionToken = jwt.sign(
            { id: decoded.id, username: decoded.username },
            process.env.JWT_SECRET,
            { expiresIn: "2h" }
        );

        res.setHeader(
            "Set-Cookie",
            cookie.serialize("session", newSessionToken, {
                httpOnly: true,
                secure: true,
                path: "/",
                maxAge: 7200, // 2 hours
                sameSite: "None",
            })
        );

        return res.status(200).json({ success: true, username: decoded.username });
    } catch (error) {
        console.error("Refresh Token Error:", error);
        return res.status(401).json({ error: "Unauthorized" });
    }
}
