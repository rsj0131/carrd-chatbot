import fetch from "node-fetch";

var systemMessage = "You're Vivian, a horny succubus";

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
        const response = await fetch("https://mars.chub.ai/mixtral/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.MARS_API_KEY}`, // Mars API Key
            },
            body: JSON.stringify({
                model: "mixtral",
                messages: [{ role: "system", content: systemMessage }, { role: "user", content: message }],
                stream: true,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("API Error:", errorText);
            return res.status(500).json({ error: "Failed to connect to Mars API" });
        }

        let botReply = "";
        const decoder = new TextDecoder();
        for await (const chunk of response.body) {
            const decodedChunk = decoder.decode(chunk, { stream: true });
            const lines = decodedChunk.split("\n").filter((line) => line.trim() !== "");
            for (const line of lines) {
                if (line === "[DONE]") break;
                const parsed = JSON.parse(line.replace(/^data: /, ""));
                const content = parsed.choices[0]?.delta?.content || "";
                botReply += content;
            }
        }

        res.status(200).json({ reply: botReply.trim() || "No response available." });
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
}
