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
    apiKey: process.env.OPENAI_API_KEY, // Replace with your Mars API key
    //basePath: "https://mars.chub.ai/mixtral/v1", // Correct Mars base path
});
const openai = new OpenAIApi(configuration);

// GPT-4o-mini Pricing
const INPUT_TOKEN_COST = 0.150 / 1_000_000; // $0.150 per 1M input tokens
const OUTPUT_TOKEN_COST = 0.600 / 1_000_000; // $0.600 per 1M output tokens

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

        // Call the OpenAI API for summarization
        const response = await openai.createChatCompletion({
            model: "gpt-4o-mini",
            messages: prompt,
            temperature: 0.5,
            max_tokens: 200,
            stream: false,
        });

        const result = response.data;
        const summary = result.choices?.[0]?.message?.content || "Summary could not be generated.";

        console.log("Generated summary:", summary);

        // Token Usage and Pricing
        const usage = result.usage || {};
        const { prompt_tokens = 0, completion_tokens = 0, total_tokens = 0 } = usage;
        const INPUT_TOKEN_COST = 0.150 / 1_000_000; // $0.150 per 1M input tokens
        const OUTPUT_TOKEN_COST = 0.600 / 1_000_000; // $0.600 per 1M output tokens
        const inputCost = prompt_tokens * INPUT_TOKEN_COST;
        const outputCost = completion_tokens * OUTPUT_TOKEN_COST;
        const totalCost = inputCost + outputCost;

        console.log(`Token Usage for Summarization: Prompt=${prompt_tokens}, Completion=${completion_tokens}, Total=${total_tokens}`);
        console.log(`Summarization Cost: Input=$${inputCost.toFixed(6)}, Output=$${outputCost.toFixed(6)}, Total=$${totalCost.toFixed(6)}`);

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
        
        const currentTimeInArgentina = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Argentina/Buenos_Aires',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        }).format(new Date());

        const dynamicSystemMessage = `
            You're not an AI model, you are ${characterName}., and here's the information about the you:
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
            Trivia: ${characterDetails.trivia || "none"}.
            ** Important Notice: ${characterDetails.prompt || "none"}. **
            Current Time: ${currentTimeInArgentina}.
            You can use the available functions listed below when needed:
            ${functions.map(func => `${func.name}: ${func.description}`).join("\n")}
            When responding to the user, if a function can be used, always call the function instead of generating a textual response. 
            Provide only the required input for the function, and use the function call mechanism. 
            For example, if a user asks for the Twitter link, use the "shareTwitterLink" function.
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
        
        console.log("Available functions:", JSON.stringify(functions, null, 2));
        
        const response = await openai.createChatCompletion({
            model: "gpt-4o-mini",
            messages,
            functions, // Ensure this contains the correct list of functions
            temperature: 0.8,
            stream: false,
        });
        console.log("API Response:", JSON.stringify(response.data, null, 2));

        const usage = response.data.usage || {};
        const { prompt_tokens, completion_tokens, total_tokens } = usage;
        console.log(`Token Usage: Prompt=${prompt_tokens}, Completion=${completion_tokens}, Total=${total_tokens}`);
        console.log(`Cost: Input=$${inputCost.toFixed(6)}, Output=$${outputCost.toFixed(6)}, Total=$${totalCost.toFixed(6)}`);
        
        let botReply = response.data.choices?.[0]?.message?.content || "No response available.";
        botReply = botReply.replace(/\\n/g, '\n').replace(/{{char}}/g, characterName);
        
        if (response.data.choices?.[0]?.message?.function_call) {
            botReply = await processFunctionCall(response.data);
        } else {
            botReply = response.data.choices?.[0]?.message?.content || "No response available.";
        }
        
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
        const functions = await collection.find().toArray();

        return functions.map(func => ({
            name: func.name,
            description: func.description,
            parameters: func.parameters
        }));
    } catch (error) {
        console.error("Error fetching functions from MongoDB:", error);
        return [];
    }
}

// Process message for function calls
async function processFunctionCall(response) {
    const choice = response.choices?.[0];
    if (choice?.message?.function_call) {
        const { name, arguments: args } = choice.message.function_call;
        try {
            const parsedArgs = JSON.parse(args);
            console.log(`Calling function: ${name} with arguments:`, parsedArgs);

            // Trigger the function dynamically
            const result = await executeFunction(name, parsedArgs);
            console.log(`Function ${name} executed. Result: ${result}`);
            return result; // Return the result as the bot's reply
        } catch (error) {
            console.error("Error processing function call:", error);
            return "Error occurred while executing the function.";
        }
    }
    return response.choices?.[0]?.message?.content || "No response.";
}

async function executeFunction(name, args) {
    switch (name) {
        case "shareTwitterLink":
            return await shareTwitterLink(args);
        default:
            console.warn(`No implementation found for function: ${name}`);
            return "Function not implemented.";
    }
}

// Function List
async function shareTwitterLink(args) {
    return `Here is the Twitter link you requested: <a href="https://x.com/doublev_nsfw" target="_blank" rel="noopener noreferrer">Twitter Link</a>`;
}


