import { Configuration, OpenAIApi } from "openai";

// Configure OpenAI
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY, // Ensure this is set in Vercel's environment variables
});
const openai = new OpenAIApi(configuration);
var systemMessage = "";

export default async function handler(req, res) {
    // Set CORS headers
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
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: systemMessage }, { role: "user", content: message }],
        });

        const botReply = response.data.choices[0].message.content;

        // Save conversation to Google Sheets
        await saveToGoogleSheets(message, botReply);

        res.status(200).json({ reply: botReply });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
    }
}

async function saveToGoogleSheets(userMessage, botReply) {
    try {
        const response = await fetch("https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec", {
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
