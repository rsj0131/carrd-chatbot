import jwt from "jsonwebtoken";

export default async function handler(req, res) {
    const { code } = req.query;

    if (!code) {
        return res.status(400).json({ error: "Missing code parameter" });
    }

    try {
        // Exchange code for user details (use your OAuth implementation here)
        const user = { id: "123", username: "example_user" }; // Mock data

        // Generate a JWT token for the session
        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET, // Add this key to your Vercel environment variables
            { expiresIn: "1h" } // Session expires in 1 hour
        );

        // Set the session token in a secure HTTP-only cookie
        res.setHeader("Set-Cookie", `session=${token}; HttpOnly; Path=/; Max-Age=3600; Secure; SameSite=Strict`);

        // Redirect the user to the chatbot interface
        res.redirect("/");
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Authentication failed" });
    }
}
