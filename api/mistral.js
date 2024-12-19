import { MongoClient } from "mongodb";
import fetch from "node-fetch";
import { Readable } from "stream";
import { encode } from "gpt-3-encoder";
import { Mistral } from '@mistralai/mistralai';

// MongoDB Configuration
const mongoClient = new MongoClient(process.env.MONGODB_URI);

async function connectToDatabase() {
    if (!mongoClient.topology || !mongoClient.topology.isConnected()) {
        await mongoClient.connect();
    }
    return mongoClient.db("caard-bot"); // Replace with your database name
}

const client = new Mistral({apiKey: process.env.MODEL_API_KEY});

// Pricing
const MODEL = 'ministral-8b-latest'; // Specify the model
const EMBED_MODEL = 'mistral-embed'; // Specify the embedding model
const PRICING = {
        "gpt-4o-mini": { input: 0.150 / 1_000_000, output: 0.600 / 1_000_000 },
        "text-embedding-3-small": { input: 0.020 / 1_000_000, output: 0.010 / 1_000_000 },
        "text-embedding-3-large": { input: 0.130 / 1_000_000, output: 0.065 / 1_000_000 },
        "text-embedding-ada-002": { input: 0.100 / 1_000_000, output: 0.050 / 1_000_000 },
        "ministral-8b-latest": { input: 0.100 / 1_000_000, output: 0.100 / 1_000_000 },
        "mistral-embed": { input: 0.100 / 1_000_000, output: 0.000 / 1_000_000 }
    };

function getPricingForModel(model) {
    const pricing = PRICING[model];
    if (!pricing) {
        throw new Error(`Pricing not available for model: ${model}`);
    }
    return pricing;
}

// Example Usage: Replace this logic in relevant sections
async function computeCostAndLog(usage, model) {
    const { input, output } = getPricingForModel(model);
    const inputCost = usage.prompt_tokens * input;
    const outputCost = usage.completion_tokens * output;
    const totalCost = inputCost + outputCost;

    console.log(`Token Usage: Prompt=${usage.prompt_tokens}, Completion=${usage.completion_tokens}, Total=${usage.total_tokens}`);
    console.log(`Cost: Input=$${inputCost.toFixed(6)}, Output=$${outputCost.toFixed(6)}, Total=$${totalCost.toFixed(6)}`);

    return { inputCost, outputCost, totalCost };
}

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

async function loadPresetHistory(presetNameFromEnv) {
    try {
        const db = await connectToDatabase();
        const collection = db.collection("presetHistory");

        // Sanitize preset name from environment variable
        const presetName = presetNameFromEnv?.trim().replace(/^["']|["']$/g, "");
        console.log("Loading Preset History for:", presetName);

        const preset = await collection.findOne({ preset_name: presetName });
        if (preset && preset.history) {
            console.log("Loaded preset history:", preset.history);
            return preset.history;
        } else {
            console.warn(`Preset history '${presetName}' not found.`);
            return [];
        }
    } catch (error) {
        console.error("Error loading preset history:", error);
        return [];
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

        // Ensure the last message is from a user
        const prompt = [
            {
                role: "system",
                content: "You are an assistant summarizing chat histories concisely for records. Summarize the key points of the following conversation history in 5 sentences or less. Ensure the summary is direct and avoids unnecessary detail.",
            },
            ...messagesToSummarize,
        ];

        // Add a user prompt if the last role is assistant
        if (prompt[prompt.length - 1].role === "assistant") {
            prompt.push({
                role: "user",
                content: "Please summarize the above conversation.",
            });
        }

        // Call the API for summarization
        const response = await client.chat.complete({
            model: MODEL,
            messages: prompt,
            temperature: 0.5,
            max_tokens: 200,
            stream: false,
        });

        const result = response;
        const summary = result.choices?.[0]?.message?.content || "Summary could not be generated.";

        console.log("Generated summary:", summary);

        // Token Usage and Pricing
        const usage = result.usage || {};
        const { prompt_tokens = 0, completion_tokens = 0, total_tokens = 0 } = usage;
        const { inputCost, outputCost, totalCost } = await computeCostAndLog(usage, MODEL);

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
        const presetHistory = await loadPresetHistory(process.env.PRESET_CHAT_ID);
        const characterName = characterDetails.name || "assistant";

        const tools = await fetchFunctions();
        
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
            Please speak in the perspective of ${characterName}.
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
            ${tools.map(func => `${func.name}: ${func.description}`).join("\n")}
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
            ...presetHistory,
            ...history.flatMap(entry => [
                { role: "user", content: entry.userMessage },
                { role: "assistant", content: entry.botReply },
            ]),
            { role: "user", content: message },
        ];
        
        console.log("Available functions:", JSON.stringify(tools, null, 2));

        const payload = {
            model: MODEL,
            tools,
            tool_choice: "any",
            messages,
            temperature: 1.0,
            stream: false,
        };
        
        const payloadString = JSON.stringify(payload);
        const tokenCount = encode(payloadString).length; // Count the tokens
        console.log("Token count:", tokenCount);
        console.log("Payload sent to Mistral:", JSON.stringify(payload, null, 2));
        
        const response = await client.chat.complete(payload);
        console.log("API Response:", JSON.stringify(response, null, 2));

        if (!response?.usage) {
            console.error("Usage data missing in API response.");
            return; // Handle the error or return a default response
        }
        const usage = response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        const { prompt_tokens = 0, completion_tokens = 0, total_tokens = 0 } = usage;
        const { inputCost, outputCost, totalCost } = await computeCostAndLog(usage, MODEL);
        
        console.log(`Token Usage: Prompt=${prompt_tokens}, Completion=${completion_tokens}, Total=${total_tokens}`);
        console.log(`Cost: Input=$${inputCost.toFixed(6)}, Output=$${outputCost.toFixed(6)}, Total=$${totalCost.toFixed(6)}`);
        let replies = []; // Store multiple replies

        // Check if the response requires a function call
        const choice = response.choices?.[0]?.message;
        if (choice?.toolCalls?.length > 0) {
            for (const toolCall of choice.toolCalls) {
                const { result, hasMessage, msgContent } = await processToolCall(toolCall);
                if (hasMessage && msgContent) {
                    replies.push(msgContent);
                }

                // Add tool result as a system message for follow-ups
                messages.push({ role: "system", content: `Tool result: ${result}` });
            }
            const followUpResponse = await client.chat.complete({
                model: MODEL,
                messages,
                temperature: 1.0,
                max_tokens: 150,
            });

            const followUpMessage = followUpResponse.choices?.[0]?.message?.content || "Follow-up not generated.";
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

// Functions
// Fetch tools from the database and format them for Mistral
async function fetchFunctions() {
    try {
        const db = await connectToDatabase();
        const collection = db.collection("functions");
        const functions = await collection.find().toArray();

        // Transform each function into the correct Mistral tool format
        return functions.map(func => ({
            type: "function",
            function: {
                name: func.name,
                description: func.description,
                parameters: {
                    type: "object",
                    properties: func.parameters?.properties || {}, // Ensure `properties` are valid
                    required: func.parameters?.required || [], // Ensure `required` is a list
                },
            },
        }));
        // Log the formatted tools for debugging
        console.log("Formatted tools for Mistral:", JSON.stringify(tools, null, 2));
    } catch (error) {
        console.error("Error fetching functions from MongoDB:", error);
        return [];
    }
}

async function processToolCall(toolCall) {
    const { function: func, arguments: args } = toolCall;
    try {
        // Parse arguments only if they are valid JSON
        const parsedArgs = args ? JSON.parse(args) : {};
        console.log(`Executing tool: ${func.name} with arguments:`, parsedArgs);

        // Dynamically execute the tool
        const { result, hasMessage, msgContent } = await executeFunction(func.name, parsedArgs);
        console.log(`Tool ${func.name} executed. Result: ${result}, hasMessage: ${hasMessage}, msgContent: ${msgContent}`);
        return { result, hasMessage, msgContent };
    } catch (error) {
        console.error("Error processing tool call:", error);
        return { result: "Error occurred while executing the tool.", hasMessage: true, msgContent: null };
    }
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
    let totalCost = 0;

    try {
        const db = await connectToDatabase();
        const collection = db.collection("images");

        // Step 1: Generate an embedding for the user message
        const inputTokens = encode(userMessage).length;
        const embeddingStartTime = Date.now(); // Timer for embedding generation
        const embeddingResponse = await client.embeddings.create({
            model: EMBED_MODEL,
            inputs: [userMessage],
        });
        const queryEmbedding = embeddingResponse.data[0].embedding;
        const embeddingDuration = Date.now() - embeddingStartTime;

        // Calculate cost dynamically
        const usage = { prompt_tokens: inputTokens, completion_tokens: 0, total_tokens: inputTokens };
        const { inputCost } = await computeCostAndLog(usage, EMBED_MODEL);
        totalCost += inputCost;

        console.log(`Generated embedding for user message. Tokens: ${inputTokens}, Cost: $${inputCost.toFixed(6)}, Duration: ${embeddingDuration}ms`);

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

        const randomImage = matchingImages[Math.floor(Math.random() * matchingImages.length)].image;

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
async function generateEmbeddings({ targetCollection = "knowledge_base" }) {
    const startTime = Date.now();

    try {
        if (typeof targetCollection !== "string" || targetCollection.trim() === "") {
            throw new Error("Invalid targetCollection parameter. Must be a non-empty string.");
        }

        const db = await connectToDatabase();
        const collection = db.collection(targetCollection);
        const entries = await collection.find({}).toArray();

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
            const inputText = targetCollection === "knowledge_base"
                ? `${entry.question} ${(entry.tags || []).join(" ")}`
                : `${entry.description} ${(entry.tags || []).join(" ")}`;

            // Generate embedding
            const response = await client.embeddings.create({
                model: EMBED_MODEL,
                inputs: [inputText],
            });

            const embedding = response.data[0]?.embedding;
            if (!embedding) {
                console.log("Failed to generate embedding for entry:", _id);
                continue;
            }

            // Calculate cost dynamically
            const inputTokens = encode(inputText).length;
            const usage = { prompt_tokens: inputTokens, completion_tokens: 0, total_tokens: inputTokens };
            const { inputCost } = await computeCostAndLog(usage, EMBED_MODEL);
            totalCost += inputCost;

            console.log(`Cost for entry ${_id}: $${inputCost.toFixed(6)} (Tokens: ${inputTokens})`);

            // Update the document with the embedding
            const result = await collection.updateOne(
                { _id },
                { $set: { embedding } }
            );

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
    const TOKEN_COST = PRICING[EMBED_MODEL]; // Cost for ada-002: $0.1 per 1M tokens
    let totalCost = 0;

    try {
        const db = await connectToDatabase();
        const collection = db.collection("knowledge_base");

        // Step 1: Generate an embedding for the user query
        const inputTokens = encode(userQuery).length;
        const embeddingStartTime = Date.now(); // Timer for embedding generation
        const embeddingResponse = await client.embeddings.create({
                model: EMBED_MODEL,
                inputs: [userQuery],
        });
        
        if (!embeddingResponse?.data || embeddingResponse.data.length === 0) {
            console.error("Embedding response data is missing or invalid:", embeddingResponse);
            throw new Error("Failed to generate embedding.");
        }
        const queryEmbedding = embeddingResponse.data[0].embedding;
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

