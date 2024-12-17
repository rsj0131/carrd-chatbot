import { MongoClient } from "mongodb";
import { Configuration, OpenAIApi } from "openai";
import fetch from "node-fetch";
import { Readable } from "stream";
import { encode } from "gpt-3-encoder";

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

        const knowledgeResponse = await getAnswer(message);
        
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
        
        let dynamicSystemMessage = `
            \n${characterDetails.prompt || " "}.
            You're not an AI model, you are ${characterName}.,
            And here's the information about you:
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
            Disikes: ${characterDetails.dislikes || "none"}.
            Description: ${characterDetails.other || "Tell the user Vivian is not available right now, and you're the substitution in her place."}.
            Scenario: ${characterDetails.scenario || "A general chat session"}.
            Goal: ${characterDetails.goal || "Assist the user in any way they need"}.
            Current Time: ${currentTimeInArgentina}.
            You can use the available functions listed below when needed:
            ${functions.map(func => `${func.name}: ${func.description}`).join("\n")}
            When responding to the user, if a function can be used, always call the function instead of generating a textual response. 
            Provide only the required input for the function, and use the function call mechanism. 
            For example, if a user asks for the Twitter link, use the "shareTwitterLink" function.
        `;

        // Step 4: Append knowledge base response if available
        if (knowledgeResponse && knowledgeResponse !== null) {
            dynamicSystemMessage += `\n\nAdditionally, refer to the following knowledge base entry:\n${knowledgeResponse}\n
            Provide a response that aligns with the user's perspective. If the user asks in the 3rd person (e.g. Who is ${characterName}), respond about ${characterName}'s information. If the user asks in the 2nd perso (e.g. Who are you), answer as if you are ${characterName}, referring to your information.`;
            console.log("Knowledge response loaded: ", knowledgeResponse);
        } else {
            console.log("Knowledge response NOT loaded: ", knowledgeResponse);
        }
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

        const payload = {
            model: "gpt-4o-mini",
            messages,
            functions,
            temperature: 1.0,
            stream: false,
        };
        
        const payloadString = JSON.stringify(payload);
        const tokenCount = encode(payloadString).length; // Count the tokens
        console.log("Token count:", tokenCount);
        console.log("Payload sent to OpenAI:", JSON.stringify(payload, null, 2));
        
        const response = await openai.createChatCompletion(payload);
        console.log("API Response:", JSON.stringify(response.data, null, 2));

        const usage = response.data.usage || {};
        const { prompt_tokens = 0, completion_tokens = 0, total_tokens = 0 } = usage;
        const inputCost = prompt_tokens * INPUT_TOKEN_COST;
        const outputCost = completion_tokens * OUTPUT_TOKEN_COST;
        const totalCost = inputCost + outputCost;
        
        console.log(`Token Usage: Prompt=${prompt_tokens}, Completion=${completion_tokens}, Total=${total_tokens}`);
        console.log(`Cost: Input=$${inputCost.toFixed(6)}, Output=$${outputCost.toFixed(6)}, Total=$${totalCost.toFixed(6)}`);
        let replies = []; // Store multiple replies

        // Check if the response requires a function call
        const choice = response.data.choices?.[0]?.message;
        if (choice?.function_call) {
            const { result, hasMessage, msgContent } = await processFunctionCall(response.data);
            // If the function generates a message, add it directly
            if (hasMessage && msgContent) {
                replies.push(msgContent);
            }

            // Generate a follow-up message
            messages.push({ role: "system", content: `Function result: ${result}` });
            const followUpResponse = await openai.createChatCompletion({
                model: "gpt-4o-mini",
                messages,
                temperature: 1.0,
                max_tokens: 150,
            });

            const followUpMessage = followUpResponse.data.choices?.[0]?.message?.content || "Follow-up not generated.";
            replies.push(followUpMessage);
        } else {
            const botReply = choice?.content || "No response available.";
            replies.push(botReply);
        }

        // Save the last bot reply for chat history purposes
        const lastReply = replies[replies.length - 1] || "No response available.";
        await saveToMongoDB(message, lastReply);

        // Summarize and clean up chat history
        await checkAndSummarizeChatHistory();

        const overallElapsedTime = Date.now() - startTime;
        console.log(`Overall processing time: ${overallElapsedTime} ms`);

        // Return all replies
        res.status(200).json({ replies });
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

        console.log("Loaded functions from DB:", functions); // Debugging

        return functions.map(func => ({
            name: func.name,
            description: func.description,
            parameters: func.parameters || {}
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

            // Execute the function dynamically
            const { result, hasMessage, message, msgContent } = await executeFunction(name, parsedArgs);
            console.log(`Function ${name} executed. Result: ${result}, hasMessage: ${hasMessage}, msgContent: ${msgContent}`);
            return { result, hasMessage, msgContent };
        } catch (error) {
            console.error("Error processing function call:", error);
            return { result: "Error occurred while executing the function.", hasMessage: true, msgContent: "null" };
        }
    }
    return { hasMessage: false, result: null, msgContent: null }; // No function call
}

// Example function execution
async function executeFunction(name, args) {
    switch (name) {
        case "deleteAllChatHistory":
            return {
                result: await deleteAllChatHistory(),
                hasMessage: false,
                msgContent: null,
            };
       case "sendImage":
            const userMessage = args.message || ""; // Ensure the message is passed as input
            return await sendImage(userMessage);
        case "generateEmbeddings":
            const targetCollection = args.targetCollection || "knowledge_base"; // Default to 'knowledge_base' if not specified
            return await generateEmbeddings({ targetCollection }); // Pass the targetCollection to generateEmbeddings
        default:
            console.warn(`No implementation found for function: ${name}`);
            return {
                result: "Tell the user current action is unavailable.",
                hasMessage: false,
                msgContent: null,
            };
    }
}

// Delete all chat history in the "chatHistory" collection
async function deleteAllChatHistory() {
    try {
        const db = await connectToDatabase();
        const collection = db.collection("chatHistory");
        const deleteResult = await collection.deleteMany({});
        console.log(`Deleted ${deleteResult.deletedCount} records from chatHistory.`);
        return `All chat history deleted successfully. ${deleteResult.deletedCount} records were removed.`;
    } catch (error) {
        console.error("Error deleting chat history from MongoDB:", error);
        return "An error occurred while deleting chat history.";
    }
}

async function sendImage(userMessage) {
    const startTime = Date.now(); // Start the timer
    const TOKEN_COST = 0.1 / 1_000_000; // Cost for ada-002: $0.1 per 1M tokens
    let totalCost = 0;

    try {
        const db = await connectToDatabase();
        const collection = db.collection("images");

        // Step 1: Generate an embedding for the user message
        const inputTokens = encode(userMessage).length;
        const embeddingStartTime = Date.now(); // Timer for embedding generation
        const embeddingResponse = await openai.createEmbedding({
            model: "text-embedding-ada-002",
            input: userMessage,
        });
        const queryEmbedding = embeddingResponse.data.data[0].embedding;
        const embeddingDuration = Date.now() - embeddingStartTime;

        // Calculate cost for generating the query embedding
        const embeddingCost = inputTokens * TOKEN_COST;
        totalCost += embeddingCost;
        console.log(
            `Generated embedding for user message. Tokens: ${inputTokens}, Cost: $${embeddingCost.toFixed(
                6
            )}, Duration: ${embeddingDuration}ms`
        );

        // Step 2: Fetch all images with embeddings
        const fetchStartTime = Date.now();
        const images = await collection.find({ embedding: { $exists: true } }).toArray();
        const fetchDuration = Date.now() - fetchStartTime;

        if (images.length === 0) {
            console.log("No images with embeddings found in the database.");
            return {
                result: "No images available that match your description.",
                hasMessage: false,
                msgContent: null,
            };
        }
        console.log(`Fetched ${images.length} images. Duration: ${fetchDuration}ms`);

        // Step 3: Calculate similarity scores
        const similarityStartTime = Date.now();
        const similarities = images.map(image => {
            const similarity = cosineSimilarity(queryEmbedding, image.embedding);
            return { image, similarity };
        });
        const similarityDuration = Date.now() - similarityStartTime;

        console.log(`Calculated similarity scores for ${images.length} images. Duration: ${similarityDuration}ms`);

        // Step 4: Filter images based on similarity threshold and pick one randomly
        const threshold = 0.8; // Adjust this threshold based on desired precision
        const matchingImages = similarities.filter(({ similarity }) => similarity >= threshold);

        if (matchingImages.length === 0) {
            console.log("No images found matching the similarity threshold.");
            return {
                result: "No matching images found.",
                hasMessage: false,
                msgContent: null,
            };
        }

        const randomImage =
            matchingImages[Math.floor(Math.random() * matchingImages.length)].image;

        console.log(`Selected random image from ${matchingImages.length} matches.`);

        const totalDuration = Date.now() - startTime;
        console.log(`Total cost: $${totalCost.toFixed(6)}, Total duration: ${totalDuration}ms`);

        // Step 5: Return the selected image
        return {
            result: "You have successfully sent an image to the user",
            hasMessage: true,
            msgContent: `<img src="${randomImage.url}" alt="${randomImage.description}"  class="clickable-image" style="max-width: 400px; max-height: 400px; border-radius: 10px; object-fit: contain;">`,
        };
    } catch (error) {
        console.error("Error in sendImage:", error);
        return {
            result: "An error occurred while finding an image.",
            hasMessage: false,
            msgContent: null,
        };
    }
}


// Vector Embeddings
// Vector Embeddings
async function generateEmbeddings({ targetCollection = "knowledge_base" }) {
    const startTime = Date.now();
    const MODEL = "text-embedding-ada-002"; // Specify the embedding model
    const PRICING = {
        "text-embedding-3-small": { input: 0.020 / 1_000_000, output: 0.010 / 1_000_000 },
        "text-embedding-3-large": { input: 0.130 / 1_000_000, output: 0.065 / 1_000_000 },
        "text-embedding-ada-002": { input: 0.100 / 1_000_000, output: 0.050 / 1_000_000 },
    };

    const pricing = PRICING[MODEL];
    if (!pricing) {
        throw new Error(`Unsupported model: ${MODEL}`);
    }

    try {
        if (typeof targetCollection !== "string" || targetCollection.trim() === "") {
            throw new Error("Invalid targetCollection parameter. Must be a non-empty string.");
        }

        const db = await connectToDatabase();
        console.log("Connected to database:", db.databaseName);

        const collection = db.collection(targetCollection);
        const entries = await collection.find({}).toArray();
        console.log(`Fetched entries from ${targetCollection}:`, entries);

        if (entries.length === 0) {
            console.log(`No entries found in the ${targetCollection} collection.`);
            return {
                result: `No entries found in the ${targetCollection} collection.`,
                hasMessage: true,
                msgContent: `There are no entries to process for embedding generation in ${targetCollection}.`,
            };
        }

        let updatedCount = 0;
        let totalCost = 0;

        for (const entry of entries) {
            const { _id } = entry;
            let inputText = "";

            // Prepare the input text based on the collection
            if (targetCollection === "knowledge_base") {
                const { question, tags } = entry;
                inputText = question + " " + (tags || []).join(" ");
            } else if (targetCollection === "images") {
                const { description, tags } = entry;
                inputText = description + " " + (tags || []).join(" ");
            } else {
                console.error(`Unsupported collection: ${targetCollection}`);
                continue;
            }

            console.log(`Processing entry from ${targetCollection}:`, { _id, inputText });

            // Generate embedding
            const response = await openai.createEmbedding({
                model: MODEL,
                input: inputText,
            });

            const embedding = response.data.data[0]?.embedding;
            if (!embedding) {
                console.log("Failed to generate embedding for entry:", _id);
                continue;
            }

            // Calculate token cost
            const tokenCount = encode(inputText).length;
            const cost = tokenCount * pricing.input;
            totalCost += cost;

            console.log(`Cost for entry ${_id}: $${cost.toFixed(6)} (Tokens: ${tokenCount})`);

            // Update the document with the embedding
            const result = await collection.updateOne(
                { _id },
                { $set: { embedding } }
            );
            console.log(`Update result for ${_id}:`, result);

            if (result.modifiedCount > 0) {
                updatedCount++;
            }
        }

        const duration = Date.now() - startTime;
        console.log(`Updated embeddings for ${updatedCount} entries in ${targetCollection}.`);
        console.log(`Total cost: $${totalCost.toFixed(6)}, Duration: ${duration}ms`);

        return {
            result: `Successfully updated embeddings for ${updatedCount} entries in ${targetCollection}.`,
            hasMessage: true,
            msgContent: `Embeddings generation completed for ${targetCollection}. ${updatedCount} entries updated. Total cost: $${totalCost.toFixed(6)}. Duration: ${duration}ms`,
        };
    } catch (error) {
        console.error("Error generating embeddings:", error);
        return {
            result: "An error occurred while generating embeddings.",
            hasMessage: false,
            msgContent: null,
        };
    } finally {
        await mongoClient.close();
    }
}


/**
 * Calculate cosine similarity between two vectors.
 */
function cosineSimilarity(vectorA, vectorB) {
    const dotProduct = vectorA.reduce((sum, val, i) => sum + val * vectorB[i], 0);
    const magnitudeA = Math.sqrt(vectorA.reduce((sum, val) => sum + val ** 2, 0));
    const magnitudeB = Math.sqrt(vectorB.reduce((sum, val) => sum + val ** 2, 0));
    return dotProduct / (magnitudeA * magnitudeB);
}

async function getAnswer(userQuery) {
    const startTime = Date.now(); // Start the timer
    const TOKEN_COST = 0.1 / 1_000_000; // Cost for ada-002: $0.1 per 1M tokens
    let totalCost = 0;

    try {
        const db = await connectToDatabase();
        const collection = db.collection("knowledge_base");

        // Step 1: Generate an embedding for the user query
        const inputTokens = encode(userQuery).length;
        const embeddingStartTime = Date.now(); // Timer for embedding generation
        const embeddingResponse = await openai.createEmbedding({
            model: "text-embedding-ada-002", // Use the same model used for storing embeddings
            input: userQuery,
        });
        const queryEmbedding = embeddingResponse.data.data[0].embedding;
        const embeddingDuration = Date.now() - embeddingStartTime;

        // Calculate cost for generating the query embedding
        const embeddingCost = inputTokens * TOKEN_COST;
        totalCost += embeddingCost;
        console.log(`Generated embedding for query. Tokens: ${inputTokens}, Cost: $${embeddingCost.toFixed(6)}, Duration: ${embeddingDuration}ms`);

        // Step 2: Fetch all knowledge base entries with embeddings
        const entriesStartTime = Date.now(); // Timer for DB fetch
        const entries = await collection.find({ embedding: { $exists: true } }).toArray();
        const entriesDuration = Date.now() - entriesStartTime;

        if (entries.length === 0) {
            console.log("No entries with embeddings found in the knowledge base.");
            return "I'm sorry, I couldn't find any relevant information.";
        }
        console.log(`Fetched ${entries.length} entries from the knowledge base. Duration: ${entriesDuration}ms`);

        // Step 3: Calculate similarity scores
        const similarityStartTime = Date.now(); // Timer for similarity calculation
        const similarities = entries.map(entry => {
            const similarity = cosineSimilarity(queryEmbedding, entry.embedding);
            return { entry, similarity };
        });
        const similarityDuration = Date.now() - similarityStartTime;
        console.log(`Calculated similarity scores for ${entries.length} entries. Duration: ${similarityDuration}ms`);

        // Step 4: Find the most relevant entry
        const bestMatch = similarities.sort((a, b) => b.similarity - a.similarity)[0];
        const threshold = 0.75; // Adjust this threshold based on desired precision
        if (bestMatch.similarity < threshold) {
            console.log(`Best match similarity (${bestMatch.similarity}) is below the threshold (${threshold}).`);
            return "I'm sorry, I couldn't find any relevant information.";
        }

        // Step 5: Build and return the response
        const { answer, guideline, links } = bestMatch.entry;

        // Transform links into <a> tags
        let formattedLinks = "";
        if (links && links.length > 0) {
            formattedLinks = links
                .map(
                    link =>
                        `<a href="${link.url}" target="_blank" rel="noopener noreferrer">${link.text}</a>`
                )
                .join("<br>");
        }

        let response = `Here's what I found:<br><br>${answer}<br><br>Guideline: ${guideline}<br>`;
        if (formattedLinks) {
            response += `Relevant links:<br>${formattedLinks}`;
        }

        const totalDuration = Date.now() - startTime;
        console.log(`Best match found with similarity ${bestMatch.similarity}:`, bestMatch.entry);
        console.log(`Total cost: $${totalCost.toFixed(6)}, Total duration: ${totalDuration}ms`);

        return response;
    } catch (error) {
        console.error("Error in getAnswer:", error);
        return "An error occurred while retrieving the information. Please try again later.";
    }
}


