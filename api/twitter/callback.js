export default async function handler(req, res) {
    const { code } = req.query;

    if (!code) {
        return res.status(400).json({ error: "Missing code parameter" });
    }

    try {
        const response = await fetch("https://api.twitter.com/2/oauth2/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                code,
                grant_type: "authorization_code",
                client_id: process.env.TWITTER_API_KEY,
                client_secret: process.env.TWITTER_API_SECRET,
                redirect_uri: process.env.TWITTER_CALLBACK_URL,
            }),
        });

        const data = await response.json();

        if (data.error) {
            return res.status(400).json({ error: data.error });
        }

        // Save user data to a session, database, or cookies
        res.redirect("/success"); // Redirect to your app's success page
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to authenticate" });
    }
}
