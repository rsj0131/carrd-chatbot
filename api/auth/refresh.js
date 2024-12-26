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

        // Issue a new JWT
        const newToken = jwt.sign(
            { id: decoded.id, username: decoded.username },
            process.env.JWT_SECRET,
            { expiresIn: "2h" } // New JWT valid for 2 hours
        );

        res.setHeader(
            "Set-Cookie",
            `session=${newToken}; HttpOnly; Path=/; Max-Age=7200; Secure; SameSite=None`
        );

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error("Refresh Token Error:", error);
        return res.status(401).json({ error: "Unauthorized" });
    }
}
