import { Configuration, OpenAIApi } from "openai";

// Configure Mars API
const configuration = new Configuration({
    apiKey: process.env.MARS_API_KEY, // Replace with your Mars API key
    basePath: "https://mars.chub.ai/mixtral/v1", // Correct Mars base path
});
const openai = new OpenAIApi(configuration);
var systemMessage = "You're Vivian, a horny succubus";

export default async function handler(req, res) {
    // Remove session token check for testing
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // Handle preflight OPTIONS request
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
        const response = await openai.createChatCompletion({
            model: "mixtral", // Ensure this model is available with Mars
            messages: [{ role: "system", content: systemMessage }, { role: "user", content: message }],
            stream: false, // Ensure the response is not streamed
        });

        // Log the full API response to inspect its structure
        console.log("API Response:", JSON.stringify(response.data, null, 2));

        // Extract the assistant's message content
        const botReply = response.data.choices?.[0]?.message?.content || "No response available.";

        res.status(200).json({ reply: botReply });
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
}
