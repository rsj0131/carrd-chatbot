import jwt from "jsonwebtoken";
import cookie from "cookie";

export default async function handler(req, res) {
    try {
        const cookies = cookie.parse(req.headers.cookie || "");
        const session = cookies.session;

        if (!session) {
            return res.status(200).json({ logged_in: false });
        }

        const decoded = jwt.verify(session, process.env.JWT_SECRET);
        return res.status(200).json({ logged_in: true, username: decoded.username });
    } catch (error) {
        console.error("Auth Check Error:", error);
        return res.status(200).json({ logged_in: false });
    }
}
