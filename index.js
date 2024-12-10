const express = require('express');
const cors = require('cors');
const openai = require('openai');

const app = express();
const port = process.env.PORT || 3000;

// Set your OpenAI API key from environment variables
openai.apiKey = process.env.OPENAI_API_KEY;

// Use CORS to allow requests from all origins
app.use(cors({
    origin: '*', // Replace '*' with specific domains if needed
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
}));

app.use(express.json());

// Handle preflight OPTIONS request explicitly
app.options('*', cors());

// Main API endpoint
app.post('/reply', async (req, res) => {
    const userMessage = req.body.message;

    if (!userMessage) {
        return res.status(400).json({ error: 'Message is required' });
    }

    try {
        const response = await openai.ChatCompletion.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: userMessage }],
        });
        res.json({ reply: response.choices[0].message.content });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
