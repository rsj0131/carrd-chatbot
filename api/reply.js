import { Configuration, OpenAIApi } from "openai";

// Configure Mars API
const configuration = new Configuration({
    apiKey: process.env.MARS_API_KEY, // Replace with your Mars API key
    basePath: "https://mars.chub.ai/mixtral/v1", // Correct Mars base path
});
const openai = new OpenAIApi(configuration);
var systemMessage = "You're Vivian, a horny succubus";

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
        const response = await openai.createChatCompletion({
            model: "mixtral",
            messages: [{ role: "system", content: systemMessage }, { role: "user", content: message }],
            stream: true, // Enable streaming mode
        });

        let botReply = "";
        response.data.on("data", (chunk) => {
            const lines = chunk.toString().split("\n").filter((line) => line.trim() !== "");
            for (const line of lines) {
                if (line === "[DONE]") {
                    break;
                }
                const parsed = JSON.parse(line.replace(/^data: /, ""));
                const content = parsed.choices[0]?.delta?.content || "";
                botReply += content;
            }
        });

        response.data.on("end", () => {
            res.status(200).json({ reply: botReply.trim() || "No response available." });
        });

        response.data.on("error", (error) => {
            console.error("Stream Error:", error);
            res.status(500).json({ error: "Internal Server Error" });
        });
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
}
