import { MongoClient } from "mongodb";
import fetch from "node-fetch";
import { Readable } from "stream";
import { encode } from "gpt-3-encoder";
import { GoogleGenerativeAI } from "@google/generative-ai";

let cachedEmbedding = null;

// MongoDB Configuration
const mongoClient = new MongoClient(process.env.MONGODB_URI);

async function connectToDatabase() {
    if (!mongoClient.topology || !mongoClient.topology.isConnected()) {
        await mongoClient.connect();
    }
    return mongoClient.db("caard-bot"); // Replace with your database name
}

const MODEL = "gemini-1.5-flash";
const EMBED_MODEL = "text-embedding-004"; // Specify the embedding model

// Initialize the client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Pricing
const PRICING = {
        "gemini-1.5-flash": { input: 0.0375 / 1_000_000, output: 0.0150 / 1_000_000 },
        "text-embedding-004": { input: 0.000 / 1_000_000, output: 0.000 / 1_000_000 }
    };

function getPricingForModel(model) {
    const pricing = PRICING[model];
    if (!pricing) {
        throw new Error(`Pricing not available for model: ${model}`);
    }
    return pricing;
}

function transformMarkdownLinksToHTML(text) {
    const markdownLinkRegex = /\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g;
    return text.replace(markdownLinkRegex, (_, text, url) => {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });
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

async function isAdmin(userID) {
    try {
        const db = await connectToDatabase();
        const adminsCollection = db.collection("admins");

        // Ensure the `userID` is treated as a string
        const adminRecord = await adminsCollection.findOne({ userID: String(userID) });

        // Log the result for debugging
        console.log(`Admin check for user ${userID}:`, adminRecord);

        return {
            isAdminUser: !!adminRecord, // Return true if the record exists
            adminName: adminRecord?.name || null, // Extract `name` or return null if not found
        };
    } catch (error) {
        console.error("Error checking admin status:", error);
        return {
            isAdminUser: false, // Default to false if there's an error
            adminName: null,    // Default to null for admin name
        };
    }
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


async function fetchChatHistory(userID) {
    if (!userID) {
        console.error("User ID is required to fetch chat history.");
        return [];
    }

    try {
        const db = await connectToDatabase();
        const collection = db.collection("chatHistory");

        // Fetch chat history for the specific user, sorted by timestamp in descending order
        const history = await collection
            .find({ userID }) // Filter by user ID
            .sort({ timestamp: -1 }) // Sort by timestamp (newest first)
            //.limit(30) // Limit to the last 30 entries
            .toArray();

        console.log(`Fetched chat history for user ${userID}:`, history);

        return history.map(entry => ({
            userMessage: entry.userMessage,
            botReply: entry.botReply,
            timestamp: entry.timestamp, // Add timestamp for ordering in the UI
        }));
    } catch (error) {
        console.error("Error fetching chat history from MongoDB:", error);
        return [];
    }
}

async function checkAndSummarizeChatHistory(userID) {
    const startSummaryTime = Date.now(); // Start timer for summarization

    try {
        if (!userID) {
            console.error("User ID is required to summarize chat history.");
            return;
        }

        const db = await connectToDatabase();
        const collection = db.collection("chatHistory");

        // Fetch chat history for the specific user, sorted by timestamp
        const allHistory = await collection.find({ userID: userID }).sort({ timestamp: 1 }).toArray();

        if (allHistory.length < 10) {
            console.log(`Not enough messages for summarization for user ${userID}.`);
            return; // Skip summarization if history count < 10
        }

         // Separate older messages from the latest 5
        const latestMessages = allHistory.slice(-5);
        const olderMessages = allHistory.slice(0, -5);

        // Prepare Gemini-formatted messages
        const messagesToSummarize = olderMessages.flatMap(entry => [
            {
                role: "user",
                parts: [{ text: entry.userMessage }],
            },
            {
                role: "assistant",
                parts: [{ text: entry.botReply }],
            },
        ]);

        // Ensure the last message is from a user
        if (messagesToSummarize[messagesToSummarize.length - 1]?.role === "assistant") {
            messagesToSummarize.push({
                role: "user",
                parts: [{ text: "Please summarize the above conversation." }],
            });
        }

        // System instruction
        const systemInstruction =
            "You are an assistant summarizing chat histories concisely for records. Summarize the key points of the following conversation history in 5 sentences or less. Ensure the summary is direct and avoids unnecessary detail.";

        // Initialize the model with system instruction
        const model = genAI.getGenerativeModel({
            model: MODEL,
            systemInstruction,
        });

        // Perform content generation
        const result = await model.generateContent({
            contents: messagesToSummarize,
            generationConfig: {
                maxOutputTokens: 200, // Limit tokens for summarization
                temperature: 0.5,     // Maintain balanced creativity and accuracy
            },
        });

        // Extract and return the summary
        const summary = result.response?.text() || "Summary could not be generated.";
        console.log(`Generated summary for user ${userID}:`, summary);

        // Token Usage and Pricing
        const usage = result.usage || {};
        const { prompt_tokens = 0, completion_tokens = 0, total_tokens = 0 } = usage;
        const { inputCost, outputCost, totalCost } = await computeCostAndLog(usage, MODEL);

        console.log(`Token Usage for Summarization: Prompt=${prompt_tokens}, Completion=${completion_tokens}, Total=${total_tokens}`);
        console.log(`Summarization Cost: Input=$${inputCost.toFixed(6)}, Output=$${outputCost.toFixed(6)}, Total=$${totalCost.toFixed(6)}`);

        // Save the summary back to chatHistory
        await collection.insertOne({
            timestamp: new Date(),
            userMessage: "(Summary of older chat messages)",
            botReply: summary,
            userID: userID,
        });

        console.log(`Summary saved to chat history for user ${userID}.`);

        // Delete older messages that were summarized
        const olderIds = olderMessages.map(msg => msg._id);
        await collection.deleteMany({ _id: { $in: olderIds } });

        console.log(`Older messages summarized and deleted for user ${userID}.`);
    } catch (error) {
        console.error(`Error checking and summarizing chat history for user ${userID}:`, error);
    } finally {
        const summaryElapsedTime = Date.now() - startSummaryTime; // End timer for summarization
        console.log(`Time taken for summarization for user ${userID}: ${summaryElapsedTime} ms`);
    }
}



async function saveChatHistory(userMessage, botReplies, userID) {
    try {
        const db = await connectToDatabase();
        const collection = db.collection("chatHistory");
        
        // Save each reply as a separate entry
        const chatEntries = botReplies.map(reply => ({
            timestamp: new Date(),
            userMessage,
            botReply: reply,
            userID: userID,
        }));

        await collection.insertMany(chatEntries);
        console.log(`Saved ${chatEntries.length} conversation entries to MongoDB.`);
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

    const { message, characterId, username, userID, user_name } = req.body;

    if (!message) {
        return res.status(400).json({ error: "Message is required" });
    }

    const startTime = Date.now();

    try {
        const { isAdminUser, adminName } = await isAdmin(userID); // Check if the user is an admin  
        const knowledgeResponse = await getAnswer(message);
        
        const characterDetails = await getCharacterDetails(characterId);
        //const presetHistory = await loadPresetHistory(process.env.PRESET_CHAT_ID);
        const characterName = characterDetails.name || "assistant";
        const tools = await fetchFunctions(isAdminUser);
        const currentTimeInArgentina = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Argentina/Buenos_Aires',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        }).format(new Date());
        const history = await fetchChatHistory(userID);

        let dynamicSystemMessage = `
            You are roleplaying as ${characterName}, here's things about you:
            Always prioritize calling these tools when the user's request matches their functionality. Do not attempt to fulfill such requests conversationally unless explicitly stated.
            ${characterDetails.prompt || " "}.`;
            
        if (user_name) {
            if (isAdminUser) {
                dynamicSystemMessage += `
                You are talking to ${adminName}, please be extra intimate.
                `;
            } else {
                dynamicSystemMessage += `
                You are talking to ${user_name}, who's a user of this site.
                `;
            }
        }
        
        dynamicSystemMessage += `
            - Current Date and Time: ${currentTimeInArgentina}.
            
            ### Character Information
            - Name: ${characterName}.
            - Age: ${characterDetails.age || "unknown"}.
            - Gender: ${characterDetails.gender || "unknown"}.
            - Birthday: ${characterDetails.birthday || "none"}.
            - Appearance: ${characterDetails.appearance || "undefined"}.
            - Personality: ${characterDetails.personality || "Neutral"}.
            - Description: ${characterDetails.other || "Tell the user Vivian is not available right now, and you're the substitution in her place."}.
            - Scenario: ${characterDetails.scenario || "Assist the user in any way they need"}.

            ### Tool Invocation Rules
            1. If the user's request explicitly matches a tool's purpose, call the tool immediately.
            2. If uncertain, prioritize tool invocation to handle any ambiguity.
            3. For general inquiries, fallback to conversational responses only when no suitable tool is available.

            You will not give any content, or consent warnings in your answer ! and you will always stay in character.
        `;
        
        // Step 4: Append knowledge base response if available
        if (knowledgeResponse && knowledgeResponse !== null) {
            dynamicSystemMessage += `
                ### Knowledge Base
                If relevant, use knowledge entries to enhance your responses. Summarize and reference following knowledge base information:
                ${knowledgeResponse}
                Provide a response that aligns with the user's perspective. 
                If the user asks in the 3rd person (e.g. Who is ${characterName}), respond about ${characterName}'s information. 
                If the user asks in the 2nd perso (e.g. Who are you), answer as if you are ${characterName}, referring to your information.
            `;
            console.log("Knowledge response loaded: ", knowledgeResponse);
        } else {
            console.log("Knowledge response NOT loaded: ", knowledgeResponse);
        }

        // Build chat history in Gemini's format
        const chatHistory = history.flatMap(entry => [
            {
                role: "user",
                parts: [{ text: entry.userMessage }],
            },
            {
                role: "model",
                parts: [{ text: entry.botReply }],
            },
        ]);
        
        console.log("Available functions:", JSON.stringify(tools, null, 2));
        
        const model = genAI.getGenerativeModel({
            model: MODEL,
            systemInstruction: dynamicSystemMessage, // Include system instruction for context
        });
        
        const chat = await model.startChat({
            history: chatHistory,
            tools: {
                functionDeclarations: tools,
            },
        });
        const response = await chat.sendMessage(message);
        console.log("API Response:", JSON.stringify(response, null, 2));
        
        let replies = []; // Store multiple replies
        // Check if the response includes a function call or text
        const responseParts = response.response.candidates[0]?.content?.parts || [];
        
        let functionProcessed = false; // To track if a function call was processed
        let textProcessed = false; // To track if text has already been added to replies
        
        for (const part of responseParts) {
            if (part.functionCall) {
                // Extract function call details
                const { name, args } = part.functionCall;
                console.log("Function call detected:", name, args);
        
                // Process the tool call with the extracted name and arguments
                const { result, hasMessage, msgContent } = await processToolCall(
                    { function: { name, arguments: args } },
                    message
                );
        
                if (hasMessage && msgContent) {
                    replies.push(transformMarkdownLinksToHTML(msgContent)); // Ensure formatting
                }
        
                // Update the system message to inform the user about the result
                dynamicSystemMessage += `\n\nYou have used a tool. Inform the user about result: ${result}`;
                functionProcessed = true;
            } else if (part.text && !textProcessed) {
                // If text exists and hasn't been processed, add it as a reply
                const followUpMessage = transformMarkdownLinksToHTML(part.text);
                replies.push(followUpMessage);
                textProcessed = true; // Mark text as processed to avoid duplication
            }
        }
        
        // If a function call was processed but no follow-up text was included, generate one
        if (functionProcessed && !textProcessed) {
            console.log("No follow-up text found. Generating a follow-up response...");
            const followupModel = genAI.getGenerativeModel({
                model: MODEL,
                systemInstruction: dynamicSystemMessage,
            });
        
            // Start a new follow-up chat
            const followupChat = await followupModel.startChat({
                history: chatHistory,
            });
            const followUpResponse = await followupChat.sendMessage(message);
            console.log("Follow-up Response:", JSON.stringify(followUpResponse, null, 2));
        
            // Extract and format the follow-up message
            const followUpContent = followUpResponse.response?.candidates[0]?.content?.parts[0]?.text;
            const followUpMessage = followUpContent
                ? transformMarkdownLinksToHTML(followUpContent)
                : "Follow-up not generated.";
            replies.push(followUpMessage);
        }
        
        // Ensure no fallback logic repeats already added text
        if (!functionProcessed && !textProcessed) {
            const botReplyContent = responseParts.map(part => part.text).join(" ").trim();
            const botReply = botReplyContent || "No response available.";
            replies.push(transformMarkdownLinksToHTML(botReply));
        }
        await saveChatHistory(message, replies, userID);

        // Summarize and clean up chat history
        await checkAndSummarizeChatHistory(userID);

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
async function fetchFunctions(isAdminUser = false) {
    try {
        const db = await connectToDatabase();
        const collection = db.collection("functions");
        const functions = await collection.find().toArray();
        console.log("Is Admin User:", isAdminUser);
        
        // Filter the functions based on admin privileges
        const filteredFunctions = functions.filter(func => {
            const forAdmin = Number(func.forAdmin) === 1;
            return !forAdmin || isAdminUser; // Include non-admin functions or admin-only for admins
        });

        // Transform each function into the correct Mistral tool format
        return filteredFunctions.map(func => ({
            name: func.name,
            parameters: {
                type: "OBJECT",
                description: func.description,
                properties: func.parameters?.properties || {},
                required: func.parameters?.required || [],
            },
        }));
    } catch (error) {
        console.error("Error fetching functions from MongoDB:", error);
        return [];
    }
}

async function processToolCall(toolCall, userMessage) {
    try {
        const func = toolCall.function;
        let args = func?.arguments;

        // Debugging logs
        console.log("Tool call received:", JSON.stringify(toolCall, null, 2));
        console.log("Raw arguments type:", typeof args);
        console.log("Raw arguments value:", args);

        // Ensure arguments are in object form
        if (typeof args === "string") {
            try {
                args = JSON.parse(args); // Parse only if it's a JSON string
            } catch (err) {
                console.error("Failed to parse arguments as JSON:", args);
                throw new Error("Invalid arguments format; expected a JSON string or object.");
            }
        }

        console.log(`Executing tool: ${func.name} with arguments:`, args);

        // Dynamically execute the tool
        const { result, hasMessage, msgContent } = await executeFunction(func.name, args, userMessage);
        console.log(`Tool ${func.name} executed. Result: ${result}, hasMessage: ${hasMessage}, msgContent: ${msgContent}`);
        return { result, hasMessage, msgContent };
    } catch (error) {
        console.error("Error processing tool call:", error);
        return { result: "Error occurred while executing the tool.", hasMessage: true, msgContent: null };
    }
}


// Example function execution
async function executeFunction(name, args, userMessage) {
    switch (name) {
        case "deleteAllChatHistory":
            return await deleteAllChatHistory();
            
        case "sendImage":
            //const userMessage = args.message || ""; // Ensure the message is passed as input
            return await sendImage(userMessage);
            
        case "generateEmbeddings":
            if (!args || !args.targetCollection) {
                console.warn(`Missing or invalid targetCollection in args: ${JSON.stringify(args, null, 2)}; defaulting to "knowledge_base"`);
            }
            const targetCollection = args?.targetCollection || "knowledge_base"; // Ensure a fallback
            console.log(`Target collection for embeddings: ${targetCollection}`);
            return await generateEmbeddings({ targetCollection });
            
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
        return {
            result: `All chat history deleted successfully. ${deleteResult.deletedCount} records were removed.`,
            hasMessage: true,
            msgContent: `Console: All chat history deleted successfully. ${deleteResult.deletedCount} records were removed.`,
        };
    } catch (error) {
        console.error("Error deleting chat history from MongoDB:", error);
        return {
            result: "An error occurred while finding an image.",
            hasMessage: true,
            msgContent: "Console: An error occurred while deleting chat history.",
        };
    }
}

async function sendImage(userMessage) {
    const startTime = Date.now(); // Start the timer
    let totalCost = 0;

    try {
        const db = await connectToDatabase();
        const collection = db.collection("images");

        // Step 1: Validate input text
        if (!userMessage || userMessage.trim().length === 0) {
            console.error("Invalid user message. Skipping embedding generation.");
            return {
                result: "Invalid user message. Cannot generate image.",
                hasMessage: false,
                msgContent: null,
            };
        }

        // Step 2: Generate an embedding for the user message
        let queryEmbedding = cachedEmbedding;
        if (!queryEmbedding) {
            console.log("No cached embedding found, generating a new one.");

            const model = genAI.getGenerativeModel({ model: EMBED_MODEL });
            const embeddingResponse = await model.embedContent(userMessage);

            // Debugging the API response
            console.log("Embedding API response:", JSON.stringify(embeddingResponse, null, 2));

            // Access embedding values directly
            queryEmbedding = embeddingResponse?.embedding?.values;
            if (!queryEmbedding || queryEmbedding.length === 0) {
                console.error("Invalid or missing embedding data.");
                return {
                    result: "Failed to generate embedding for the user message.",
                    hasMessage: false,
                    msgContent: null,
                };
            }

            // Calculate cost dynamically
            const inputTokens = encode(userMessage).length;
            const usage = { prompt_tokens: inputTokens, completion_tokens: 0, total_tokens: inputTokens };
            const { inputCost } = await computeCostAndLog(usage, EMBED_MODEL);
            totalCost += inputCost;

            console.log(`Generated embedding for user message. Tokens: ${inputTokens}, Cost: $${inputCost.toFixed(6)}.`);
        } else {
            console.log("Using cached embedding:", queryEmbedding);
        }

        // Step 3: Fetch all images with embeddings
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
        console.log(`Fetched ${images.length} images. Duration: ${fetchDuration}ms.`);

        // Step 4: Calculate similarity scores
        const similarityStartTime = Date.now();
        const similarities = images.map(image => {
            const similarity = cosineSimilarity(queryEmbedding, image.embedding);
            return { image, similarity };
        });
        const similarityDuration = Date.now() - similarityStartTime;

        console.log(`Calculated similarity scores for ${images.length} images. Duration: ${similarityDuration}ms.`);

        // Step 5: Filter images based on similarity threshold
        const threshold = 0.7; // Adjust this threshold based on desired precision
        const matchingImages = similarities.filter(({ similarity }) => similarity >= threshold);

        if (matchingImages.length === 0) {
            console.log("No images found matching the similarity threshold.");
            return {
                result: "No matching images found.",
                hasMessage: false,
                msgContent: null,
            };
        }

        // Step 6: Pick one randomly and return it
        const randomImage = matchingImages[Math.floor(Math.random() * matchingImages.length)].image;

        console.log(`Selected random image from ${matchingImages.length} matches.`);

        const totalDuration = Date.now() - startTime;
        console.log(`Total cost: $${totalCost.toFixed(6)}, Total duration: ${totalDuration}ms.`);

        return {
            result: `You have successfully sent an image to the user, the image description: ${randomImage.description}`,
            hasMessage: true,
            msgContent: `<img src="${randomImage.url}" alt="${randomImage.description}" class="clickable-image" style="max-width: 400px; max-height: 400px; border-radius: 10px; object-fit: contain;">`,
            isNSFW: randomImage.tags?.includes("nsfw") || false,
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

            // Skip entries with invalid input text
            if (!inputText || inputText.trim().length === 0) {
                console.error(`Invalid input text for entry with ID: ${_id}. Skipping.`);
                continue;
            }

            const MAX_RETRIES = 3;
            let retries = 0;

            while (retries < MAX_RETRIES) {
                try {
                    const model = genAI.getGenerativeModel({ model: EMBED_MODEL });
                    const response = await model.embedContent(inputText);

                    console.log("Embedding API response:", JSON.stringify(response, null, 2));

                    const embedding = response?.embedding?.values;
                    if (!embedding || embedding.length === 0) {
                        throw new Error("No embedding data returned.");
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

                    break; // Exit retry loop on success
                } catch (retryError) {
                    retries++;
                    console.error(`Retry ${retries} failed for entry: ${_id}`, retryError);
                    if (retries === MAX_RETRIES) {
                        console.error(`Max retries reached for entry: ${_id}. Skipping.`);
                    }
                }
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
    const TOKEN_COST = PRICING[EMBED_MODEL]; // Cost for embedding generation
    let totalCost = 0;

    try {
        // Step 1: Validate input query
        if (!userQuery || userQuery.trim().length === 0) {
            console.error("Invalid user query. Cannot generate an answer.");
            return "Invalid query provided. Please refine your question.";
        }

        const db = await connectToDatabase();
        const collection = db.collection("knowledge_base");

        // Step 2: Generate an embedding for the user query
        const MAX_RETRIES = 3;
        let queryEmbedding = null;
        let retries = 0;

        while (retries < MAX_RETRIES) {
            try {
                const model = genAI.getGenerativeModel({ model: EMBED_MODEL });
                const embeddingResponse = await model.embedContent(userQuery);

                // Debugging the API response
                console.log("Embedding API response:", JSON.stringify(embeddingResponse, null, 2));

                queryEmbedding = embeddingResponse?.embedding?.values;
                if (!queryEmbedding || queryEmbedding.length === 0) {
                    throw new Error("Invalid or missing embedding data.");
                }

                // Calculate cost dynamically
                const inputTokens = encode(userQuery).length;
                const usage = { prompt_tokens: inputTokens, completion_tokens: 0, total_tokens: inputTokens };
                const { inputCost } = await computeCostAndLog(usage, EMBED_MODEL);
                totalCost += inputCost;

                console.log(`Generated embedding for query. Tokens: ${inputTokens}, Cost: $${inputCost.toFixed(6)}.`);
                break; // Exit retry loop on success
            } catch (retryError) {
                retries++;
                console.error(`Retry ${retries} failed for embedding generation.`, retryError);
                if (retries === MAX_RETRIES) {
                    console.error("Max retries reached for embedding generation. Skipping.");
                    return "Failed to process your query. Please try again later.";
                }
            }
        }

        // Step 3: Fetch all knowledge base entries with embeddings
        const entries = await collection.find({ embedding: { $exists: true } }).toArray();

        if (entries.length === 0) {
            console.log("No entries with embeddings found in the knowledge base.");
            return "No relevant information found in the knowledge base.";
        }
        console.log(`Fetched ${entries.length} entries from the knowledge base.`);

        // Step 4: Calculate similarity scores
        const similarities = entries.map(entry => {
            const similarity = cosineSimilarity(queryEmbedding, entry.embedding);
            return { entry, similarity };
        });

        // Step 5: Find the most relevant entry
        const bestMatch = similarities.sort((a, b) => b.similarity - a.similarity)[0];
        const threshold = 0.7; // Adjust this threshold based on desired precision
        if (bestMatch.similarity < threshold) {
            console.log(`Best match similarity (${bestMatch.similarity}) is below the threshold (${threshold}).`);
            return "No relevant match found for your query.";
        }

        const { answer, guideline, links } = bestMatch.entry;

        // Transform links into <a> tags
        const formattedLinks = links
            ? links
                .map(link => `<a href="${link.url}" target="_blank" rel="noopener noreferrer">${link.text}</a>`)
                .join("<br>")
            : "";

        // Step 6: Build and return the response
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
        cachedEmbedding = null; // Clear the cache on error
        return "An error occurred while retrieving the information. Please try again later.";
    }
}
