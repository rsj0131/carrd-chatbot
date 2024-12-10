import { Configuration, OpenAIApi } from "openai";

const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

export default async function handler(req, res) {
    if (req.method === "POST") {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ error: "Message is required" });
        }

        try {
            const response = await openai.createChatCompletion({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: message }],
            });
            res.json({ reply: response.data.choices[0].message.content });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: "Internal Server Error" });
        }
    } else {
        res.setHeader("Allow", ["POST"]);
        res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }
}
