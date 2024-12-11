import { Configuration, OpenAIApi } from "openai";

// Configure Mars API
const configuration = new Configuration({
    apiKey: process.env.CHUB_API_KEY, // Mars API key, not OpenAI
    basePath: "https://mars.chub.ai/v1", // Mars API endpoint
});
const marsApi = new OpenAIApi(configuration); // Still uses OpenAIApi for compatibility

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.status(204).end();
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { message } = req.body;

    if (!message) {
        return res.status(400).json({ error: "Message is required" });
    }

    try {
        const response = await marsApi.createChatCompletion({
            model: "mars", // Specify Mars model
            messages: [{ role: "system", content: "You are a helpful assistant." }, { role: "user", content: message }],
        });

        const botReply = response.data.choices[0].message.content;

        res.status(200).json({ reply: botReply });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
    }
}
