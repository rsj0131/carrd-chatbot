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

    // Start timing
    const startTime = Date.now();

    try {
        // Fetch character details
        const characterDetails = await getCharacterDetails(characterId);
        const characterName = characterDetails.name || "assistant";

        if (!characterDetails.name) {
            console.warn(`Character with ID ${characterId} not found, using default assistant.`);
        }

        // Get current time in Argentina
        const currentTimeInArgentina = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Argentina/Buenos_Aires',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        }).format(new Date());
        
        // Construct system prompt dynamically
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

        // Calculate elapsed time
        const elapsedTime = Date.now() - startTime;
        console.log(`Reply generated in ${elapsedTime} ms`);

        // Log the response to inspect its structure
        console.log("API Response:", JSON.stringify(response.data, null, 2));

        // Adjust based on the Mars API response format
        let botReply = response.data.choices?.[0]?.message?.content || "No response available.";

        botReply = botReply.replace(/\\n/g, '\n'); // Replace \\n in botReply
        
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
