import { MongoClient } from "mongodb";
import { Configuration, OpenAIApi } from "openai";
import fetch from "node-fetch";
import { Readable } from "stream";

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

async function checkAndSummarizeChatHistory() {
    const startSummaryTime = Date.now(); // Start timer for summarization

    try {
        const db = await connectToDatabase();
        const collection = db.collection("chatHistory");

        // Fetch all chat history
        const allHistory = await collection.find().sort({ timestamp: 1 }).toArray();
        if (allHistory.length < 10) {
            console.log("Not enough messages for summarization.");
            return; // Skip summarization if history count < 10
        }

        // Separate older messages from the latest 5
        const latestMessages = allHistory.slice(-5);
        const olderMessages = allHistory.slice(0, -5);

        // Summarize older messages
        const messagesToSummarize = olderMessages.map(entry => ({
            role: "user",
            content: entry.userMessage,
        })).concat(
            olderMessages.map(entry => ({
                role: "assistant",
                content: entry.botReply,
            }))
        );

        // Create the prompt for summarization
        const prompt = [
            {
                role: "system",
                content: "You are an assistant summarizing chat histories concisely for records. Summarize the key points of the following conversation history in 5 sentences or less. Ensure the summary is direct and avoids unnecessary detail.",
            },
            ...messagesToSummarize,
        ];

        const response = await fetch("https://mars.chub.ai/mixtral/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.CHUB_API_KEY}`,
            },
            body: JSON.stringify({
                model: "mixtral",
                messages: prompt,
                temperature: 0.5,
                max_tokens: 200,
                stream: false, // Stream is unnecessary for small summary
            }),
        });

        const result = await response.json();
        const summary = result.choices?.[0]?.message?.content || "Summary could not be generated.";

        console.log("Generated summary:", summary);

        // Save the summary back to chatHistory
        await collection.insertOne({
            timestamp: new Date(),
            userMessage: "System: Summary of older chat messages.",
            botReply: summary,
        });

        console.log("Summary saved to chat history.");

        // Delete older messages that were summarized
        const olderIds = olderMessages.map(msg => msg._id);
        await collection.deleteMany({ _id: { $in: olderIds } });

        console.log("Older messages summarized and deleted.");
    } catch (error) {
        console.error("Error checking and summarizing chat history:", error);
    } finally {
        const summaryElapsedTime = Date.now() - startSummaryTime; // End timer for summarization
        console.log(`Time taken for summarization: ${summaryElapsedTime} ms`);
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
        const characterDetails = await getCharacterDetails(characterId);
        const characterName = characterDetails.name || "assistant";

        const functions = await fetchFunctions();
        const functionDescriptions = functions.map(
            func => `Keyword: ${func.keyword}, Description: ${func.description}`
        ).join("\n")
        
        const currentTimeInArgentina = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Argentina/Buenos_Aires',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        }).format(new Date());

        const dynamicSystemMessage = `
            You're roleplaying as ${characterName}., here's the information about the character:
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
            ** Important Notice: ${characterDetails.prompt || "none"}. **
            Current Time: ${currentTimeInArgentina}.
            You can use function calling if the user asks you to perform a task matching the Descriptions:
            ${functionDescriptions}.
            By include the Keyword at the end of your response, you can trigger a function listed above.
            For example: If the Keyword is [send-image], and the Description is sending image to user, 
            when the user ask you to send them an image, you can include the Keyword [send-image] at the end of the message to trigger the function.
        `;

        const history = await fetchChatHistory();

        const messages = [
            { role: "system", content: dynamicSystemMessage },
            ...history.flatMap(entry => [
                { role: "user", content: entry.userMessage },
                { role: "assistant", content: entry.botReply },
            ]),
            { role: "user", content: message },
        ];

        const response = await openai.createChatCompletion({
            model: "mixtral",
            messages,
            temperature: 0.8,
            stream: false,
        });

        let botReply = response.data.choices?.[0]?.message?.content || "No response available.";
        botReply = botReply.replace(/\\n/g, '\n').replace(/{{char}}/g, characterName);
        
        // Process the bot reply for function calls
        botReply = await processFunctionCall(botReply);
        
        await saveToMongoDB(message, botReply);

        // Check and summarize chat history
        await checkAndSummarizeChatHistory();

        const overallElapsedTime = Date.now() - startTime;
        console.log(`Overall processing time: ${overallElapsedTime} ms`);

        res.status(200).json({ reply: botReply });
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
}

//Functions

// Fetch functions from the database
async function fetchFunctions() {
    try {
        const db = await connectToDatabase();
        const collection = db.collection("functions");
        return await collection.find().toArray();
    } catch (error) {
        console.error("Error fetching functions from MongoDB:", error);
        return [];
    }
}

// Process message for function calls
async function processFunctionCall(botReply) {
    const db = await connectToDatabase();
    const functionsCollection = db.collection("functions");

    const functions = await functionsCollection.find().toArray();
    for (const func of functions) {
        if (botReply.includes(func.keyword)) {
            console.log(`Detected keyword: ${func.keyword} in botReply`);
            botReply = await triggerFunction(func.keyword, botReply);
            console.log("Final botReply after replacements:", botReply);
        }
    }
    return botReply;
}

// Function trigger logic
async function triggerFunction(keyword, botReply) {
    switch (keyword) {
        case "[share-twitter]":
            console.log("Replacing [share-twitter] with Twitter link...");
            return await shareTwitterLink(keyword, botReply);
        case "[share-patreon]":
            console.log("Replacing [share-patreon] with Patreon link...");
            return await sharePatreonLink(keyword, botReply);
        default:
            console.log(`No function implemented for keyword: ${keyword}`);
            return botReply;
    }
}

// Function List
async function shareTwitterLink(keyword, botReply) {
    const link = "https://x.com/doublev_nsfw";
    const replacement = `<a href="${link}" target="_blank" rel="noopener noreferrer">Twitter Link</a>`;
    return botReply.replace(keyword, replacement);
}

async function sharePatreonLink(keyword, botReply) {
    const link = "https://patreon.com/doublev_chan";
    const replacement = `<a href="${link}" target="_blank" rel="noopener noreferrer">Patreon Link</a>`;
    return botReply.replace(keyword, replacement);
}

