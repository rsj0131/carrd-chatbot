import { Configuration, OpenAIApi } from "openai";

// OpenAI configuration
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY, // Ensure this is set in Vercel's environment variables
});
const openai = new OpenAIApi(configuration);

export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { message } = req.body;

    if (!message) {
        return res.status(400).json({ error: "Message is required" });
    }

    try {
        const response = await openai.createChatCompletion({
            model: "gpt-4o-mini", // Correct OpenAI model
            messages: [{ role: "user", content: message }],
        });
        res.status(200).json({ reply: response.data.choices[0].message.content });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
    }
}
