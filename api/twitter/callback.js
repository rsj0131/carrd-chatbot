import jwt from "jsonwebtoken";

export default async function handler(req, res) {
    const { code, state } = req.query; // Retrieve Carrd page from state

    if (!code) {
        return res.status(400).json({ error: "Missing code parameter" });
    }

    try {
        // Exchange code for user details (mock example)
        const user = { id: "123", username: "example_user" }; // Replace with real Twitter user data

        // Generate a JWT token for the session
        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: "1h" } // Session expires in 1 hour
        );

        // Set the session token in a secure HTTP-only cookie
        res.setHeader("Set-Cookie", `session=${token}; HttpOnly; Path=/; Max-Age=3600; Secure; SameSite=Strict`);

        // Redirect back to the Carrd page with a success parameter
        const carrdPage = decodeURIComponent(state);
        res.redirect(`${carrdPage}?logged_in=true&username=${encodeURIComponent(user.username)}`);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Authentication failed" });
    }
}
