import { Configuration, OpenAIApi } from "openai";
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI; // Set your MongoDB connection string in environment variables
const client = new MongoClient(uri);
const dbName = "chatHistory";

// Configure Mars API
const configuration = new Configuration({
    apiKey: process.env.CHUB_API_KEY, // Replace with your Mars API key
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
            messages: [
                { role: "system", content: systemMessage }, 
                { role: "user", content: message }
            ],
            temperature: 0.8,
            stream: false, // Ensure the response is not streamed
        });

        // Log the response to inspect its structure
        console.log("API Response:", JSON.stringify(response.data, null, 2));

        // Adjust based on the Mars API response format
        const botReply = response.data.choices?.[0]?.message?.content || "No response available.";

        // Save to MongoDB
        await saveToMongoDB(message, botReply);
        
        res.status(200).json({ reply: botReply });
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
}

async function saveToMongoDB(userMessage, botReply) {
    try {
        await client.connect();
        const database = client.db(dbName);
        const messages = database.collection("messages");

        const doc = {
            userMessage,
            botReply,
            timestamp: new Date(),
        };

        const result = await messages.insertOne(doc);
        console.log(`New document inserted with _id: ${result.insertedId}`);
    } catch (error) {
        console.error("Error saving to MongoDB:", error);
    } finally {
        await client.close();
    }
}

async function fetchChatHistory(limit = 10) {
    try {
        await client.connect();
        const database = client.db(dbName);
        const messages = database.collection("messages");

        const history = await messages.find().sort({ timestamp: -1 }).limit(limit).toArray();
        return history;
    } catch (error) {
        console.error("Error fetching chat history:", error);
        return [];
    } finally {
        await client.close();
    }
}
