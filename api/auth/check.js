import jwt from "jsonwebtoken";

export default function handler(req, res) {
    const { session } = req.cookies || {};

    if (!session) {
        return res.status(200).json({ logged_in: false });
    }

    try {
        const decoded = jwt.verify(session, process.env.JWT_SECRET);
        return res.status(200).json({ logged_in: true, username: decoded.username });
    } catch (error) {
        console.error("Invalid session:", error);
        return res.status(200).json({ logged_in: false });
    }
}
