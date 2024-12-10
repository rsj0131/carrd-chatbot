import { URLSearchParams } from "url";

export default async function handler(req, res) {
    const params = new URLSearchParams({
        response_type: "code",
        client_id: process.env.TWITTER_API_KEY,
        redirect_uri: process.env.TWITTER_CALLBACK_URL,
        scope: "tweet.read users.read offline.access",
        state: "randomstring", // Ensure a secure, random state string
        code_challenge: "challenge", // Replace with a valid PKCE challenge
        code_challenge_method: "plain",
    });

    console.log(`https://twitter.com/i/oauth2/authorize?${params.toString()}`);
    res.redirect(`https://twitter.com/i/oauth2/authorize?${params.toString()}`);
}
