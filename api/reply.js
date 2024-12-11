import { Configuration, OpenAIApi } from "openai";
import { MongoClient } from "mongodb";

// Configure Mars API
const configuration = new Configuration({
    apiKey: process.env.CHUB_API_KEY, // Replace with your Mars API key
    basePath: "https://mars.chub.ai/mixtral/v1", // Correct Mars base path
});
const openai = new OpenAIApi(configuration);
var systemMessage = "You're Vivian, a horny succubus";

let client;
let clientPromise;

// Initialize MongoDB client
if (!client) {
    client = new MongoClient(process.env.MONGODB_URI);
    clientPromise = client.connect(); // Persistent connection
}

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
            messages: [
                { role: "system", content: systemMessage },
                { role: "user", content: message },
            ],
            temperature: 0.8,
            stream: false,
        });

        const botReply = response.data.choices?.[0]?.message?.content || "No response available.";
        console.log("API Response:", JSON.stringify(response.data, null, 2));

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
        const client = await clientPromise; // Reuse persistent connection
        const database = client.db("chatHistory");
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
    }
}

async function fetchChatHistory(limit = 10) {
    try {
        const client = await clientPromise; // Reuse persistent connection
        const database = client.db("chatHistory");
        const messages = database.collection("messages");

        const history = await messages.find().sort({ timestamp: -1 }).limit(limit).toArray();
        return history;
    } catch (error) {
        console.error("Error fetching chat history:", error);
        return [];
    }
}
