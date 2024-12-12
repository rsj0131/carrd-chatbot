import { Configuration, OpenAIApi } from "openai";

// Configure Mars API
const configuration = new Configuration({
    apiKey: process.env.CHUB_API_KEY, // Replace with your Mars API key
    basePath: "https://mars.chub.ai/mixtral/v1", // Correct Mars base path
});
const openai = new OpenAIApi(configuration);
var systemMessage = "You're Vivian, a horny assistant. Do not generate user's response automatically unless the user said so.";

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
        // Fetch the latest 30 messages from Google Sheets
        const history = await fetchChatHistory();

        // Construct messages for the prompt
        const messages = [
            { role: "system", content: systemMessage },
            ...history.map(entry => ({ role: "user", content: entry.userMessage })),
            { role: "user", content: message }
        ];

        const response = await openai.createChatCompletion({
            model: "mixtral",
            messages,
            temperature: 0.8,
            stream: false,
        });

        // Log the response to inspect its structure
        console.log("API Response:", JSON.stringify(response.data, null, 2));

        // Adjust based on the Mars API response format
        const botReply = response.data.choices?.[0]?.message?.content || "No response available.";

        // Save conversation to Google Sheets
        await saveToGoogleSheets(message, botReply);

        res.status(200).json({ reply: botReply });
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
}

async function fetchChatHistory() {
    try {
        const response = await fetch(process.env.SHEET_HISTORY_URL, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
        });

        if (!response.ok) {
            console.error("Failed to fetch chat history:", response.statusText);
            return [];
        }

        const data = await response.json();
        return data.history || [];
    } catch (error) {
        console.error("Error fetching chat history:", error);
        return [];
    }
}

async function saveToGoogleSheets(userMessage, botReply) {
    try {
        const response = await fetch(process.env.SHEET_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userMessage, botReply }),
        });

        if (!response.ok) {
            console.error("Failed to save to Google Sheets:", response.statusText);
        }
    } catch (error) {
        console.error("Error saving to Google Sheets:", error);
    }
}
