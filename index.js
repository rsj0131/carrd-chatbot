const express = require("express");
const cors = require("cors");
const { Configuration, OpenAIApi } = require("openai");

const app = express();
const port = process.env.PORT || 3000;

// OpenAI configuration
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Middleware
app.use(cors());
app.use(express.json());

// Route: /reply
app.post("/reply", async (req, res) => {
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
});

app.get("/debug", (req, res) => {
    res.send("Debug route reached successfully!");
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
