import { Configuration, OpenAIApi } from "openai";

// Configure Mars API
const configuration = new Configuration({
    apiKey: process.env.CHUB_API_KEY, // Replace with your Mars API key
    basePath: "https://mars.chub.ai/mixtral/v1", // Correct Mars base path
});
const openai = new OpenAIApi(configuration);

async function getCharacterDetails(characterId) {
    try {
        const characters = await fetchCharacterInfo();
        console.log("Fetched characters:", characters); // Debug logging
        return characters.find(char => String(char.id) === String(characterId)) || {};
    } catch (error) {
        console.error("Error fetching character details:", error);
        return {};
    }
}

// Main handler function
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

    const { message, characterId } = req.body;

    if (!message) {
        return res.status(400).json({ error: "Message is required" });
    }

    try {
        // Fetch character details
        const characterDetails = await getCharacterDetails(characterId);
        const characterName = characterDetails.name || "assistant";

        if (!characterDetails.name) {
            console.warn(`Character with ID ${characterId} not found, using default assistant.`); // Debug logging
        }

        // Construct system prompt dynamically
        const dynamicSystemMessage = `
            Name: ${characterName}.
            Age: ${characterDetails.age || "none"}.
            Birthday: ${characterDetails.birthday || "none"}.
            Height: ${characterDetails.height || "none"}.
            Weight: ${characterDetails.weight || "none"}.
            Measurements: ${characterDetails.measurements || "none"}.
            Appearance: ${characterDetails.appearance || "none"}.
            Personality: ${characterDetails.personality || "Neutral"}.
            Likes: ${characterDetails.likes || "none"}.
            Dislikes: ${characterDetails.dislikes || "none"}.
            Other Description: ${characterDetails.other || "none"}.
            Scenario: ${characterDetails.scenario || "A general chat session"}.
            Goal: ${characterDetails.goal || "Assist the user in any way they need"}.
        `;

        // Fetch the latest 30 messages from Google Sheets
        const history = await fetchChatHistory();

        // Construct messages for the prompt
        const messages = [
            { role: "system", content: dynamicSystemMessage },
            ...history.flatMap(entry => [
                { role: "user", content: entry.userMessage },
                { role: "assistant", content: entry.botReply },
            ]),
            { role: "user", content: message },
        ];

        console.log("Constructed messages:", JSON.stringify(messages, null, 2));
      
        const response = await openai.createChatCompletion({
            model: "mixtral",
            messages,
            temperature: 0.8,
            stream: false,
        });

        // Log the response to inspect its structure
        console.log("API Response:", JSON.stringify(response.data, null, 2));

        // Adjust based on the Mars API response format
        let botReply = response.data.choices?.[0]?.message?.content || "No response available.";

        // Replace {{char}} with the character name
        botReply = botReply.replace(/{{char}}/g, characterName);

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
        const response = await fetch(process.env.SHEET_BACKEND_URL, {
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

async function fetchCharacterInfo() {
    try {
        const response = await fetch(`${process.env.SHEET_BACKEND_URL}?sheet=characters`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
        });

        if (!response.ok) {
            console.error("Failed to fetch character info:", response.statusText);
            return [];
        }

        const data = await response.json();
        console.log("Character data received:", data.characters); // Debug logging
        return data.characters || [];
    } catch (error) {
        console.error("Error fetching character info:", error);
        return [];
    }
}

async function saveToGoogleSheets(userMessage, botReply) {
    try {
        const response = await fetch(process.env.SHEET_BACKEND_URL, {
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
