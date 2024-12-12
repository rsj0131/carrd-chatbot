import { MongoClient } from "mongodb";
import { Configuration, OpenAIApi } from "openai";

// MongoDB Configuration
const mongoClient = new MongoClient(process.env.MONGODB_URI);

async function connectToDatabase() {
    if (!mongoClient.topology || !mongoClient.topology.isConnected()) {
        await mongoClient.connect();
    }
    return mongoClient.db("caard-bot"); // Replace with your database name
}

// OpenAI Configuration
const configuration = new Configuration({
    apiKey: process.env.CHUB_API_KEY, // Replace with your Mars API key
    basePath: "https://mars.chub.ai/mixtral/v1", // Correct Mars base path
});
const openai = new OpenAIApi(configuration);

async function getCharacterDetails(characterId) {
    try {
        const db = await connectToDatabase();
        const collection = db.collection("characters");
        const character = await collection.findOne({ id: characterId });
        console.log("Fetched character:", character);
        return character || {};
    } catch (error) {
        console.error("Error fetching character details from MongoDB:", error);
        return {};
    }
}

async function fetchChatHistory() {
    try {
        const db = await connectToDatabase();
        const collection = db.collection("chatHistory");
        const history = await collection.find().sort({ timestamp: -1 }).limit(30).toArray();
        console.log("Fetched chat history:", history);
        return history.map(entry => ({
            userMessage: entry.userMessage,
            botReply: entry.botReply,
        }));
    } catch (error) {
        console.error("Error fetching chat history from MongoDB:", error);
        return [];
    }
}

// Save summarized text to MongoDB
async function saveSummaryToMongoDB(summary) {
    try {
        const db = await connectToDatabase();
        const collection = db.collection("summaries");
        await collection.insertOne({
            timestamp: new Date(),
            summary,
        });
        console.log("Summary saved to MongoDB.");
    } catch (error) {
        console.error("Error saving summary to MongoDB:", error);
    }
}

// Summarize chat history
async function summarizeChatHistory() {
    try {
        const chatHistory = await fetchChatHistory();
        const messages = chatHistory.flatMap(entry => [
            { role: "user", content: entry.userMessage },
            { role: "assistant", content: entry.botReply },
        ]);

        // Check token count and truncate if necessary
        const MAX_TOKENS = 3000;
        let tokenCount = 0;
        const trimmedMessages = [];

        for (const msg of messages) {
            const tokenEstimate = msg.content.length / 4; // Approx. 4 chars per token
            if (tokenCount + tokenEstimate > MAX_TOKENS) break;
            tokenCount += tokenEstimate;
            trimmedMessages.push(msg);
        }

        const prompt = [
            { role: "system", content: "You are an assistant summarizing chat histories concisely for records. Summarize the key points of the following conversation history." },
            ...trimmedMessages,
        ];

        const response = await openai.createChatCompletion({
            model: "mixtral",
            messages: prompt,
            temperature: 0.7,
        });

        console.log("Summary Response:", response.data);

        const summary = response.data.choices?.[0]?.message?.content || "Summary could not be generated.";
        console.log("Generated summary:", summary);

        await saveSummaryToMongoDB(summary);
    } catch (error) {
        console.error("Error summarizing chat history:", error);
    }
}


async function saveToMongoDB(userMessage, botReply) {
    try {
        const db = await connectToDatabase();
        const collection = db.collection("chatHistory");
        await collection.insertOne({
            timestamp: new Date(),
            userMessage,
            botReply,
        });
        console.log("Saved conversation to MongoDB.");
    } catch (error) {
        console.error("Error saving conversation to MongoDB:", error);
    }
}

// Main handler function
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

    const { message, characterId } = req.body;

    if (!message) {
        return res.status(400).json({ error: "Message is required" });
    }

    const startTime = Date.now();

    try {
        const characterStartTime = Date.now();
        const characterDetails = await getCharacterDetails(characterId);
        console.log(`Character details fetched in ${Date.now() - characterStartTime} ms`);

        const characterName = characterDetails.name || "assistant";

        const currentTimeInArgentina = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Argentina/Buenos_Aires',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        }).format(new Date());

        const dynamicSystemMessage = `
            Name: ${characterName}.
            Age: ${characterDetails.age || "none"}.
            Gender: ${characterDetails.gender || "none"}.
            Birthday: ${characterDetails.birthday || "none"}.
            Height: ${characterDetails.height || "none"}.
            Weight: ${characterDetails.weight || "none"}.
            Measurements: ${characterDetails.measurements || "none"}.
            Appearance: ${characterDetails.appearance || "none"}.
            Personality: ${characterDetails.personality || "Neutral"}.
            Likes: ${characterDetails.likes || "none"}.
            Dislikes: ${characterDetails.dislikes || "none"}.
            Description: ${characterDetails.other || "Tell the user Vivian is not available right now, and you're the substitution in her place."}.
            Scenario: ${characterDetails.scenario || "A general chat session"}.
            Goal: ${characterDetails.goal || "Assist the user in any way they need"}.
            Current Time: ${currentTimeInArgentina}.
        `;

        const chatHistoryStartTime = Date.now();
        const history = await fetchChatHistory();
        console.log(`Chat history fetched in ${Date.now() - chatHistoryStartTime} ms`);

        const messages = [
            { role: "system", content: dynamicSystemMessage },
            ...history.flatMap(entry => [
                { role: "user", content: entry.userMessage },
                { role: "assistant", content: entry.botReply },
            ]),
            { role: "user", content: message },
        ];

        const replyStartTime = Date.now();
        const response = await openai.createChatCompletion({
            model: "mixtral",
            messages,
            temperature: 0.8,
            stream: false,
        });
        console.log(`Reply generated in ${Date.now() - replyStartTime} ms`);

        let botReply = response.data.choices?.[0]?.message?.content || "No response available.";
        botReply = botReply.replace(/\\n/g, '\n').replace(/{{char}}/g, characterName);

        await saveToMongoDB(message, botReply);

        // Trigger chat summarization after saving the reply
        await summarizeChatHistory();
        
        const overallElapsedTime = Date.now() - startTime;
        console.log(`Overall processing time: ${overallElapsedTime} ms`);

        res.status(200).json({ reply: botReply });
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
}
